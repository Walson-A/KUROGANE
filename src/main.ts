import * as THREE from 'three'
import './style.css'
import { Player, LANES } from './player'
import { Opponent } from './opponent'
import { Track, SPRINT_ZONE } from './track'
import { Input } from './input'
import { Net, type RemotePlayer, type LobbyView } from './net'
import { Bot, PROFILS, BOTS_MAX, construireRangees } from './bot'
import {
  PARCHEMINS,
  TIRAGE,
  SLOTS_MAX,
  VENT_BOOST,
  VENT_DUREE,
  GRUE_DUREE,
  KUSARIGAMA_FACTEUR,
  KUSARIGAMA_DUREE,
  ARMURE_SOLIDITE,
  ARMURE_COUT_MUR,
  ARMURE_COUT_PETIT,
  MIROIR_DUREE,
  FUMIGENE_DUREE,
  SENBON_DUREE,
  ONMYOJI_VITESSE,
  LUEUR_DUREE,
  type ParcheminKind,
} from './parchemin'
import { Menu, escapeHtml } from './menu'
import { souffleDeVent } from './sfx'
import type { Quality } from './settings'

/**
 * La longueur de la course, en mètres. Départ → torii sacré.
 * Calibrée pour qu'une course propre — aucun parchemin, aucun trébuchement,
 * aucun martèlement — dure 75 s à la vitesse de croisière ci-dessous.
 */
const COURSE_LENGTH = 1920

/**
 * ————— Le sprint final —————
 * Sur les SPRINT_ZONE derniers mètres, marteler l'écran fait accélérer.
 * Réglages calibrés par simulation, pour tenir deux promesses contradictoires :
 *
 *  · Départager deux joueurs au coude-à-coude : à fond, on gagne 0,37 s (≈ 10 m).
 *  · Ne PAS refaire la course : un trébuchement coûte 0,53 s (≈ 15 m). Le sprint
 *    parfait vaut moins que ça, donc il ne rattrape jamais une vraie faute.
 *
 * Ne pas marteler ne pénalise pas : on garde la vitesse normale, c'est un bonus.
 *
 * ⚠️ Aucun passif de guerrier ne touche à ces valeurs : dans les 120 derniers
 * mètres, tout le monde est à armes égales.
 */
const SPRINT_BOOST = 0.15 // +15 % de vitesse à jauge pleine
const SPRINT_FULL_RATE = 8 // taps/s pour remplir la jauge — au-delà, plus rien
const SPRINT_WINDOW = 0.6 // durée sur laquelle on mesure la cadence (s)

// ————— La scène 3D —————
const canvas = document.querySelector<HTMLCanvasElement>('#game')!
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x151a2c) // nuit indigo
scene.fog = new THREE.Fog(0x151a2c, 30, 85) // la brume cache l'apparition des obstacles

const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 200)
camera.position.set(0, 4.4, 7.5)
camera.lookAt(0, 1.2, -8)

// Lumières : clair de lune + lueur d'ambiance
const ambient = new THREE.HemisphereLight(0xbfd4ff, 0x30281e, 0.9)
const moon = new THREE.DirectionalLight(0xdfe8ff, 1.4)
moon.position.set(-6, 12, -4)
scene.add(ambient, moon)

const player = new Player(scene)
const track = new Track(scene)

// ————— Les adversaires en ligne (jusqu'à 9 avatars) —————
// Un pool d'avatars fantômes qu'on ASSIGNE aux joueurs présents dans le salon.
// On ne recrée jamais de mesh en pleine course : on recycle.
const MAX_OPP = 9
const oppPool = Array.from({ length: MAX_OPP }, () => new Opponent(scene))

/** Un adversaire réel : son avatar + ce qu'on garde pour le classement. */
interface Rival {
  opp: Opponent
  id: string
  name: string
  rank: number
  finished: boolean
  /** Était-il en l'air à l'image précédente ? (pour la poussière d'atterrissage) */
  enLAir: boolean
}
/** Les rivaux du salon, par identifiant réseau. */
const rivals = new Map<string, Rival>()

/** Rend tous les avatars au pool et vide la table (fin de course, retour menu). */
function clearRivals() {
  for (const r of rivals.values()) {
    r.opp.active = false
    r.opp.reset()
  }
  rivals.clear()
}

/**
 * Met les avatars en phase avec la liste du serveur : on crée ceux qui
 * arrivent, on libère ceux qui partent, on nourrit l'extrapolation des autres.
 */
function syncRivals(others: RemotePlayer[]) {
  const present = new Set(others.map((p) => p.id))
  for (const [id, r] of rivals) {
    if (!present.has(id)) {
      r.opp.active = false
      r.opp.reset()
      rivals.delete(id)
    }
  }
  for (const p of others) {
    let r = rivals.get(p.id)
    if (!r) {
      const pris = new Set([...rivals.values()].map((x) => x.opp))
      const libre = oppPool.find((o) => !pris.has(o))
      if (!libre) continue // plus de 9 rivaux : les suivants ne sont pas dessinés
      libre.active = true
      libre.reset(p.startLane)
      r = { opp: libre, id: p.id, name: '', rank: 0, finished: false, enLAir: false }
      rivals.set(p.id, r)
    }
    r.opp.setFighter(p.fighter)
    r.name = p.name || 'Rival'
    r.opp.setName(r.name)
    r.rank = p.rank
    r.opp.latency = net.rtt / 2
    r.opp.onNetUpdate(
      { lane: p.lane, y: p.y, distance: p.distance, sliding: p.sliding },
      net.ageOf(p.at)
    )
    if (p.finished && !r.finished) {
      r.finished = true
      if (state === 'course') toast(`⛩️ ${r.name} a franchi le torii !`)
    }
  }
}

/** Le rival le plus proche DEVANT nous : la cible naturelle d'un sort offensif. */
function rivalDevant(): Rival | undefined {
  return [...rivals.values()]
    .filter((r) => !r.finished && r.opp.distanceNow > distance)
    .sort((a, b) => a.opp.distanceNow - b.opp.distanceNow)[0]
}

// Les 4 rivaux existent dès le départ ; seuls les `nbBots` premiers courent.
const bots = PROFILS.map((p) => new Bot(scene, p))

/**
 * La qualité graphique ne joue QUE sur le nombre de pixels dessinés — c'est de
 * loin le plus gros coût sur mobile, et diviser par 2 le pixelRatio, c'est 4
 * fois moins de pixels.
 *
 * On ne touche SURTOUT pas à la brume : c'est elle qui décide à quelle distance
 * on découvre les obstacles. La rapprocher pour gagner des images/s donnerait
 * moins de temps pour réagir — ce serait un réglage de difficulté déguisé en
 * réglage graphique, et un désavantage en duel.
 */
function applyQuality(q: Quality) {
  const mobile = matchMedia('(pointer: coarse)').matches
  const cap = q === 'bas' ? 1 : q === 'haut' ? 2 : mobile ? 1.5 : 2
  renderer.setPixelRatio(Math.min(devicePixelRatio, cap))
  resize() // setSize doit être rappelé après un changement de pixelRatio
}

// ————— L'interface —————
const scoreEl = document.getElementById('score')!
const toastEl = document.getElementById('toast')!
const countEl = document.getElementById('count')!
const flashEl = document.getElementById('flash')!
const fumeeEl = document.getElementById('fumee')!
const progressEl = document.getElementById('progressfill')!
const oppmarkEl = document.getElementById('oppmark')!
const gapEl = document.getElementById('gap')!
const sprintEl = document.getElementById('sprint')!
const sprintFillEl = document.getElementById('sprintfill')!
const slotEls = [document.getElementById('slot0')!, document.getElementById('slot1')!]
const progressbarEl = document.getElementById('progressbar')!
const rankEl = document.getElementById('rank')!
const sprintLabelEl = document.getElementById('sprintlabel')!
const botRowEl = document.getElementById('botrow')!
const botNamesEl = document.getElementById('botnames')!
const btnGo = document.getElementById('btnGo')!

let toastTimer = 0
function toast(text: string) {
  toastEl.textContent = text
  toastEl.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1400)
}

function flash() {
  flashEl.classList.add('show')
  setTimeout(() => flashEl.classList.remove('show'), 120)
}

// ————— L'état de la course —————
let state: 'menu' | 'attente' | 'depart' | 'course' | 'fini' = 'menu'
let online = false // course en ligne ou entraînement ?
let raceGo = false // le serveur a-t-il donné le GO ?
let time = 0 // le chrono
let distance = 0 // mètres parcourus
let speed = 0
let countdown = 0 // secondes avant le GO !
let stumble = 0 // invincibilité après un trébuchement
let netTimer = 0 // pour n'envoyer notre position que 10 fois/s
let sprintTaps: number[] = [] // instants des derniers taps → cadence
let sprintCharge = 0 // la jauge de sprint, 0 → 1
let sprintSeen = false // la bannière ne s'annonce qu'une fois
let rankTimer = 0 // le classement se redessine 10 fois/s, pas 60

// ————— Les rivaux d'entraînement —————
// Le choix est gardé sur le téléphone : on reprend l'entraînement où on l'a
// laissé, sans re-cliquer à chaque course.
const CLE_BOTS = 'kurogane-bots'
let nbBots = Math.min(BOTS_MAX, Math.max(1, Number(localStorage.getItem(CLE_BOTS)) || 1))

/** Un repère par rival sur la barre de progression, à sa couleur. */
const botMarks = bots.map((b) => {
  const el = document.createElement('div')
  el.className = 'botmark hidden'
  el.style.background = `#${b.profil.bandeau.toString(16).padStart(6, '0')}`
  el.title = b.profil.nom
  progressbarEl.appendChild(el)
  return el
})

// ————— Les parchemins —————
// Une FILE d'attente : on lance toujours le plus ancien ramassé. Impossible de
// garder le bon sort au chaud — c'est ce qui rend le ramassage tendu.
let slots: ParcheminKind[] = []
let ventFin = 0 // 🌀 le dash court jusqu'à cet instant du chrono
let kusarigamaFin = 0 // ⛓️ on est bridé jusqu'à cet instant
let armure = 0 // 🛡️ solidité restante de l'armure (0 = pas d'armure)
let grueFin = 0 // 🕊️ le double saut est armé jusqu'ici
let miroirFin = 0 // 🪞 la parade est levée jusqu'ici
let fumigeneFin = 0 // 💨 l'écran est noyé de fumée
let senbonFin = 0 // ☠️ l'écran ondule

/** 🔮 Le portail en vol : il file tout droit dans SA ligne jusqu'au 1er mur. */
let portail: { d: number; lane: number } | null = null

// La bille du portail. Un seul maillage recyclé : il n'y en a jamais deux.
const portailMesh = new THREE.Mesh(
  new THREE.SphereGeometry(0.42, 14, 14),
  new THREE.MeshBasicMaterial({ color: 0xb98cff })
)
portailMesh.visible = false
scene.add(portailMesh)

/**
 * ————— Les projectiles : un sabotage, ça VOLE jusqu'à sa victime —————
 *
 * Une seule mécanique pour toutes les armes du jeu, avec une silhouette par
 * sort. Sans ça, on encaissait des sorts sans jamais RIEN voir venir — juste un
 * message et une vitesse qui s'effondre.
 *
 * Ils sont PUREMENT décoratifs : le sort a déjà frappé quand le projectile
 * part. Sa durée de vol ne doit rien coûter à personne, sinon on toucherait au
 * calibrage des parchemins (cf. README). C'est un traceur, pas un projectile.
 *
 * Le VOL EST FIXE (0,28 s) quelle que soit la distance : une lame qui met deux
 * secondes à traverser 60 m se lirait comme un ralenti, pas comme un jet.
 */
const PROJET_VOL = 0.28

/** La dégaine d'un sort : ce qu'on voit filer, et s'il tournoie. */
interface StyleProjet {
  geo: () => THREE.BufferGeometry
  couleur: number
  emissive: number
  /** Une lame tournoie ; une aiguille file droit, sinon elle ne pique plus. */
  tournoie: boolean
}
const STYLES_PROJET: Partial<Record<ParcheminKind, StyleProjet>> = {
  kunai: {
    geo: () => new THREE.BoxGeometry(0.16, 0.16, 1),
    couleur: 0xd8dfec,
    emissive: 0xe24b3a,
    tournoie: true,
  },
  senbon: {
    // Longue et fine : une aiguille se reconnaît à sa silhouette, pas à sa taille
    geo: () => new THREE.BoxGeometry(0.05, 0.05, 1.2),
    couleur: 0xd9c8ff,
    emissive: 0x9b5cff,
    tournoie: false,
  },
  kusarigama: {
    // Le poids au bout de la chaîne : compact et lourd
    geo: () => new THREE.SphereGeometry(0.2, 10, 8),
    couleur: 0x8a97ab,
    emissive: 0x3d4560,
    tournoie: true,
  },
}

interface Projet {
  mesh: THREE.Mesh
  kind: ParcheminKind
  de: THREE.Vector3
  a: THREE.Vector3
  /** Le corps visé : c'est LUI qu'on marquera d'une aura à l'arrivée. */
  cible: THREE.Object3D | null
  fin: number
  actif: boolean
}
const projets: Projet[] = []

/**
 * Envoie le projectile de `kind` de `de` vers `a`. `cible` (facultatif) est le
 * corps visé : à l'arrivée, c'est lui qui reçoit l'aura du sort.
 */
function lancerProjet(
  kind: ParcheminKind,
  de: THREE.Vector3,
  a: THREE.Vector3,
  cible: THREE.Object3D | null = null
) {
  const style = STYLES_PROJET[kind]
  if (!style) return
  let p = projets.find((x) => !x.actif && x.kind === kind)
  if (!p) {
    const mesh = new THREE.Mesh(
      style.geo(),
      new THREE.MeshStandardMaterial({
        color: style.couleur,
        emissive: style.emissive,
        emissiveIntensity: 0.45,
      })
    )
    mesh.visible = false
    scene.add(mesh)
    p = { mesh, kind, de: new THREE.Vector3(), a: new THREE.Vector3(), cible: null, fin: 0, actif: false }
    projets.push(p)
  }
  // On part de positions AU SOL : on relève le tir à hauteur de poitrine une
  // bonne fois ici, sinon la 1re image s'affiche dans les pieds.
  const poitrine = new THREE.Vector3(0, 0.6, 0)
  p.de.copy(de).add(poitrine)
  p.a.copy(a).add(poitrine)
  p.cible = cible
  p.fin = time + PROJET_VOL
  p.actif = true
  p.mesh.position.copy(p.de)
  p.mesh.visible = true
}

/**
 * ————— Les auras : « ce sort agit, sur LUI, encore maintenant » —————
 *
 * Une bulle colorée collée à un coureur, pour toute la durée du sort. C'est la
 * même règle que le nuage de fumée : une aura n'est pas un décor, c'est la
 * JAUGE de l'effet — tant qu'elle brille, l'effet court.
 *
 * Elle sert aux deux camps : sur soi pour les sorts qu'on s'applique, sur la
 * victime pour les sabotages. Une couleur par sort, toujours la même.
 *
 * Trois sorts s'en passent : la Grue a son anneau, la Parade sa glace et le
 * Kusarigama ses chaînes. Une bulle de plus ne les aurait pas racontés.
 */
const AURA_VENT = 0x8fe6ff
const AURA_THE = 0x8fce7a
const AURA_SENBON = 0x9b5cff // le violet du poison

interface Aura {
  mesh: THREE.Mesh
  cible: THREE.Object3D
  duree: number
  fin: number
  actif: boolean
}
const auras: Aura[] = []

/** Enveloppe `cible` de `couleur` pendant `duree` secondes. */
function poserAura(cible: THREE.Object3D, couleur: number, duree: number) {
  let a = auras.find((x) => !x.actif)
  if (!a) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1.05, 16, 12),
      new THREE.MeshBasicMaterial({
        color: couleur,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    )
    mesh.visible = false
    scene.add(mesh)
    a = { mesh, cible, duree, fin: 0, actif: false }
    auras.push(a)
  }
  ;(a.mesh.material as THREE.MeshBasicMaterial).color.setHex(couleur)
  a.cible = cible
  a.duree = duree
  a.fin = time + duree
  a.actif = true
  a.mesh.visible = true
  a.mesh.position.copy(cible.position).setY(0.85)
}

// ————— 🕊️ L'anneau du Saut de la Grue —————
// Un cercle vert qui te ceint. Il SUIT le saut — hauteur comprise : c'est un
// pouvoir de saut, un anneau resté au sol pendant que tu voles ne dirait rien.
const GRUE_VERT = 0x5ef08a
const grueAnneau = new THREE.Mesh(
  new THREE.TorusGeometry(0.95, 0.055, 8, 32),
  new THREE.MeshBasicMaterial({
    color: GRUE_VERT,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
)
grueAnneau.rotation.x = -Math.PI / 2 // à plat, comme un cerceau autour du coureur
grueAnneau.visible = false
scene.add(grueAnneau)

// ————— ⛓️ Les chaînes du Kusarigama —————
// Une entrave qu'on VOIT : des maillons partent de la hanche de la victime et
// retombent au sol derrière elle, qu'elle traîne tant que le sort dure. Un
// simple halo gris ne disait pas « tu es enchaîné », juste « il se passe un truc ».
const CHAINE_MAILLONS = 9
interface Chaine {
  group: THREE.Group
  maillons: THREE.Mesh[]
  boulet: THREE.Mesh
  cible: THREE.Object3D
  fin: number
  duree: number
  actif: boolean
}
const chaines: Chaine[] = []

function poserChaines(cible: THREE.Object3D, duree: number) {
  let c = chaines.find((x) => !x.actif)
  if (!c) {
    const group = new THREE.Group()
    const mat = () =>
      new THREE.MeshStandardMaterial({ color: 0x9aa4b8, roughness: 0.45, metalness: 0.8 })
    const maillons: THREE.Mesh[] = []
    for (let i = 0; i < CHAINE_MAILLONS; i++) {
      const m = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.032, 6, 10), mat())
      // Un maillon sur deux pivote d'un quart de tour : c'est ce qui fait lire
      // « chaîne » plutôt que « collier de rondelles ».
      m.rotation.y = (i % 2) * (Math.PI / 2)
      maillons.push(m)
      group.add(m)
    }
    const boulet = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), mat())
    group.add(boulet)
    group.visible = false
    scene.add(group)
    c = { group, maillons, boulet, cible, fin: 0, duree, actif: false }
    chaines.push(c)
  }
  c.cible = cible
  c.duree = duree
  c.fin = time + duree
  c.actif = true
  c.group.visible = true
}

/** Coupe les chaînes qui pendent à `cible` (le 🍵 Thé les fait tomber). */
function libererChaines(cible: THREE.Object3D) {
  for (const c of chaines) {
    if (c.actif && c.cible === cible) {
      c.actif = false
      c.group.visible = false
    }
  }
}

// ————— 🪞 Le miroir de la Parade —————
// Une grande glace dressée derrière toi, face aux sorts qui arrivent — c'est
// de là qu'ils viennent, lancés par ceux qui te suivent. Un reflet balaie sa
// surface : sans ce glissement, un rectangle gris ne se lit pas comme un miroir.
function makeRefletTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas')
  cv.width = 128
  cv.height = 128
  const g = cv.getContext('2d')!
  // Le fond : un verre bleuté qui s'assombrit vers le bas
  const fond = g.createLinearGradient(0, 0, 0, 128)
  fond.addColorStop(0, '#cfe2ff')
  fond.addColorStop(1, '#6d86ad')
  g.fillStyle = fond
  g.fillRect(0, 0, 128, 128)
  // La bande de reflet, en biais : c'est elle qui glissera
  const bande = g.createLinearGradient(0, 128, 128, 0)
  bande.addColorStop(0, 'rgba(255,255,255,0)')
  bande.addColorStop(0.42, 'rgba(255,255,255,0)')
  bande.addColorStop(0.5, 'rgba(255,255,255,0.95)')
  bande.addColorStop(0.58, 'rgba(255,255,255,0)')
  bande.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = bande
  g.fillRect(0, 0, 128, 128)
  const tex = new THREE.CanvasTexture(cv)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  return tex
}
const miroirTex = makeRefletTexture()
const miroirGroup = new THREE.Group()
const miroirGlace = new THREE.Mesh(
  new THREE.PlaneGeometry(2.1, 2.5),
  new THREE.MeshBasicMaterial({
    map: miroirTex,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
  })
)
// Le cadre : sans lui, la glace flotte comme un simple carré de lumière
const miroirCadre = new THREE.Mesh(
  new THREE.PlaneGeometry(2.34, 2.74),
  new THREE.MeshBasicMaterial({
    color: 0xd6ac5a,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
  })
)
miroirCadre.position.z = -0.02
miroirGroup.add(miroirCadre, miroirGlace)
miroirGroup.visible = false
scene.add(miroirGroup)

/**
 * 🔮 La lueur jaune de l'échange. Elle enveloppe LES DEUX échangés : sans ça,
 * on se téléporterait sans comprendre ce qui vient d'arriver ni avec qui.
 */
function makeLueur() {
  return new THREE.Mesh(
    new THREE.SphereGeometry(1.15, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0xffd94a, transparent: true, opacity: 0.4 })
  )
}
const lueurJoueur = makeLueur()
const lueurRival = makeLueur()
lueurJoueur.visible = false
lueurRival.visible = false
scene.add(lueurJoueur, lueurRival)

let lueurFin = 0 // les deux lueurs brillent jusqu'à cet instant
let lueurCible: THREE.Object3D | null = null // le corps de l'échangé

/**
 * ⚡ L'éclair du Sharingan — le passif de Sasuke.
 * DEUX vrais éclairs en zigzag, style cartoon (remplissage vif + gros contour
 * bleu nuit), qui claquent entre l'ancienne et la nouvelle ligne à chaque
 * changement de voie, quand le guerrier a le style de Sasuke (`player.spark`).
 */
// L'éclair se DESSINE (très vite) puis se DISSIPE — il ne doit jamais avoir
// l'air « déjà posé » : on doit voir le trait naître et filer.
const SPARK_TRACE = 0.07 // la création, à la vitesse de la lumière
const SPARK_DISSIP = 0.2 // puis il s'efface en s'étalant
let sparkT0 = -99 // instant du déclenchement
let sparkDe = 0 // bornes X du tracé — le plan de coupe balaie entre les deux
let sparkVers = 0

/**
 * Le plan de coupe qui RÉVÈLE l'éclair au fil de sa création. On le fait
 * glisser de `sparkDe` à `sparkVers` : le zigzag apparaît au fur et à mesure,
 * comme s'il se traçait tout seul. C'est ça qui donne la vitesse de la lumière.
 */
const sparkPlane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0)
// Les deux sens de balayage : vers la droite on garde « x < balai », vers la
// gauche « x > balai ». (Three.js garde le côté où normale·point + constante > 0.)
const SPARK_N_NEG = new THREE.Vector3(-1, 0, 0)
const SPARK_N_POS = new THREE.Vector3(1, 0, 0)
renderer.localClippingEnabled = true

/** La silhouette d'un éclair (zigzag façon ⚡), en unités locales. */
function boltShape(): THREE.Shape {
  const s = new THREE.Shape()
  s.moveTo(0.08, 0.55)
  s.lineTo(-0.24, 0.04)
  s.lineTo(-0.05, 0.04)
  s.lineTo(-0.17, -0.55)
  s.lineTo(0.24, 0.1)
  s.lineTo(0.04, 0.1)
  s.closePath()
  return s
}

/** Un éclair cartoon : un gros contour bleu nuit + un remplissage vif dessus. */
function makeBolt(): THREE.Group {
  const geo = new THREE.ShapeGeometry(boltShape())
  const g = new THREE.Group()
  // Les deux matériaux sont coupés par le MÊME plan : le trait se révèle d'un bloc
  const contour = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({
      color: 0x11224a,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      clippingPlanes: [sparkPlane],
    })
  )
  contour.scale.set(1.45, 1.18, 1)
  contour.position.z = -0.01
  const remplissage = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({
      color: 0x9fe8ff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      clippingPlanes: [sparkPlane],
    })
  )
  g.add(contour, remplissage)
  return g
}

const sparkBolts = [makeBolt(), makeBolt()]
for (const b of sparkBolts) {
  b.visible = false
  scene.add(b)
}

/** Cache les deux éclairs (fin de course, retour menu). */
function hideSpark() {
  for (const b of sparkBolts) b.visible = false
  sparkT0 = -99
}

/**
 * Fait naître les DEUX éclairs entre deux positions X. `echelle` : 1 pour un
 * changement de ligne, plus petit pour le saut. Ils ne sont pas « posés » : le
 * plan de coupe les trace de `fromX` vers `toX` en 70 ms, puis ils se dissipent.
 */
function flashSpark(fromX: number, toX: number, echelle = 1) {
  const z = player.mesh.position.z + 0.12
  const dir = Math.sign(toX - fromX) || 1
  // Le 1er éclair, plus haut et incliné vers le départ ; le 2e plus bas, penché
  // à l'inverse et plus petit : deux zigzags qui crépitent sur le trajet.
  sparkBolts[0].position.set(fromX + (toX - fromX) * 0.32, 1.2, z)
  sparkBolts[0].rotation.z = dir * -0.3
  sparkBolts[0].scale.setScalar(echelle)
  sparkBolts[0].userData.base = echelle
  sparkBolts[1].position.set(fromX + (toX - fromX) * 0.72, 0.7, z + 0.04)
  sparkBolts[1].rotation.z = dir * 0.45
  sparkBolts[1].scale.setScalar(0.78 * echelle)
  sparkBolts[1].userData.base = 0.78 * echelle
  for (const b of sparkBolts) b.visible = true
  // Les bornes du tracé : on déborde un peu pour que les pointes soient prises
  sparkDe = Math.min(fromX, toX) - 0.7
  sparkVers = Math.max(fromX, toX) + 0.7
  if (dir < 0) [sparkDe, sparkVers] = [sparkVers, sparkDe] // on trace dans le sens du saut
  sparkT0 = time
}

/** ⚡ Le petit éclair du saut : même effet, en réduit, autour du guerrier. */
function flashSparkSaut() {
  const x = player.mesh.position.x
  flashSpark(x - 0.6, x + 0.6, 0.5)
}

// ═══════════ Effets visuels de course ═══════════

// ————— 🌸 Le cerisier du départ + ses pétales —————
// Un arbre UNIQUE, planté à la ligne de départ. Il défile vers l'arrière quand
// on s'élance et ne réapparaît jamais : c'est le seuil du tournoi, pas un décor
// qui se répète. Pendant le décompte, ses pétales tombent.
const CERISIER_X = -5.6
function makeCerisier(): THREE.Group {
  const g = new THREE.Group()
  const tronc = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.3, 2.8, 6),
    new THREE.MeshStandardMaterial({ color: 0x5a3a2e, roughness: 0.9 })
  )
  tronc.position.y = 1.4
  g.add(tronc)
  // La frondaison : des boules roses, deux tons pour le volume
  const roses = [0xffb7d5, 0xf79ac2, 0xffc9e0]
  for (let i = 0; i < 5; i++) {
    const blob = new THREE.Mesh(
      new THREE.SphereGeometry(0.9 + i * 0.12, 10, 8),
      new THREE.MeshStandardMaterial({ color: roses[i % 3], roughness: 0.85 })
    )
    blob.position.set((i - 2) * 0.42, 3 + Math.sin(i) * 0.5, Math.cos(i) * 0.5)
    g.add(blob)
  }
  return g
}
const cerisier = makeCerisier()
cerisier.visible = false
scene.add(cerisier)

// Les pétales : un banc de petits plans roses qui chutent en tanguant.
interface Petale {
  mesh: THREE.Mesh
  vx: number
  vy: number
  phase: number
}
const petaleMat = new THREE.MeshStandardMaterial({
  color: 0xffc2dd,
  roughness: 0.7,
  side: THREE.DoubleSide,
  transparent: true,
  opacity: 0.95,
})
const petales: Petale[] = []
for (let i = 0; i < 40; i++) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.12), petaleMat)
  m.visible = false
  scene.add(m)
  petales.push({ mesh: m, vx: 0, vy: 0, phase: 0 })
}
let petalesActifs = false // on ne fait NAÎTRE de nouveaux pétales qu'au départ
let ventPhase = 0 // l'horloge de la rafale (le chrono, lui, est figé au décompte)

/**
 * (Re)lâche un pétale. `neuf` : au tout premier souffle on en sème déjà EN
 * TRAVERS de l'écran — sinon la première seconde est vide, le temps qu'ils
 * traversent depuis l'arbre.
 */
function poserPetale(p: Petale, neuf: boolean) {
  p.mesh.position.set(
    cerisier.position.x + (neuf ? Math.random() * 9 : (Math.random() - 0.5) * 2.6),
    cerisier.position.y + (neuf ? 1.2 + Math.random() * 3.2 : 3.4 + Math.random() * 1.4),
    cerisier.position.z + (Math.random() - 0.5) * 2.4
  )
  // Le vent les emporte vers la DROITE : ils balaient toute la piste
  p.vx = 3.4 + Math.random() * 2.8
  p.vy = -0.35 - Math.random() * 0.4
  p.phase = Math.random() * 6.28
  p.mesh.visible = true
}

// ————— 💥 L'explosion (Kunai qui touche, ou trébuchement) —————
// Une boule additive qui gonfle et s'éteint. Un seul maillage recyclé : deux
// explosions quasi simultanées se recouvrent, on l'assume.
const BOOM_DUREE = 0.42
const boomMat = new THREE.MeshBasicMaterial({
  color: 0xffa23a,
  transparent: true,
  opacity: 0,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
})
const boomMesh = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12), boomMat)
boomMesh.visible = false
scene.add(boomMesh)
let boomFin = 0
function boom(pos: THREE.Vector3) {
  boomMesh.position.copy(pos)
  boomMesh.scale.setScalar(0.4)
  boomMesh.visible = true
  boomFin = time + BOOM_DUREE
}

// ————— 🛡️ Le bouclier d'acier, façon Protection de Daruk —————
// Un dôme facetté ambré enveloppe le coureur tant que l'armure tient : on SAIT
// qu'on est protégé, au lieu de le deviner. Comme dans Breath of the Wild, il
// réagit de deux façons bien distinctes, et c'est toute la lecture du sort :
//
//  · Un choc encaissé, mais l'armure tient → le dôme CLAQUE (flash + sursaut)
//    et quelques éclats se détachent. Il reste là : « il t'en reste ».
//  · La dernière plaque cède → volée d'éclats dans toutes les directions,
//    souffle lumineux, et le dôme DISPARAÎT. Plus rien ne te protège.
//
// Deux maillages superposés : un remplissage translucide et un fil de fer qui
// dessine les facettes. C'est le fil de fer qui fait la signature Daruk.
const BOUCLIER_R = 1.35
const boucGeo = new THREE.IcosahedronGeometry(BOUCLIER_R, 1)
const boucFillMat = new THREE.MeshBasicMaterial({
  color: 0xff9a3c,
  transparent: true,
  opacity: 0,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
})
const boucLineMat = new THREE.MeshBasicMaterial({
  color: 0xffd08a,
  transparent: true,
  opacity: 0,
  wireframe: true,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
})
const boucFill = new THREE.Mesh(boucGeo, boucFillMat)
const boucLignes = new THREE.Mesh(boucGeo, boucLineMat)
boucFill.visible = false
boucLignes.visible = false
scene.add(boucFill, boucLignes)
const BOUC_CLAQUE = 0.25 // durée du claquement quand un choc est encaissé
let boucFlash = 0

/** Un éclat de bouclier qui part en tournoyant. */
interface Eclat {
  mesh: THREE.Mesh
  vx: number
  vy: number
  vz: number
  fin: number
}
const ECLAT_VIE = 0.6
const eclats: Eclat[] = []
for (let i = 0; i < 26; i++) {
  // Chacun son matériau : ils doivent pouvoir s'éteindre à leur propre rythme
  const m = new THREE.Mesh(
    new THREE.TetrahedronGeometry(0.17),
    new THREE.MeshBasicMaterial({
      color: 0xffb055,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  )
  m.visible = false
  scene.add(m)
  eclats.push({ mesh: m, vx: 0, vy: 0, vz: 0, fin: 0 })
}

/** Fait sauter `nb` éclats de la coque, projetés à `force` mètres/seconde. */
function briserBouclier(nb: number, force: number) {
  const p = player.mesh.position
  let poses = 0
  for (const e of eclats) {
    if (poses >= nb) break
    if (e.mesh.visible) continue
    // Un point au hasard sur la coque : les éclats partent de la surface
    const th = Math.random() * Math.PI * 2
    const ph = Math.acos(2 * Math.random() - 1)
    const dx = Math.sin(ph) * Math.cos(th)
    const dy = Math.cos(ph)
    const dz = Math.sin(ph) * Math.sin(th)
    e.mesh.position.set(p.x + dx * BOUCLIER_R, 0.85 + dy * BOUCLIER_R, p.z + dz * BOUCLIER_R)
    e.vx = dx * force
    e.vy = dy * force + 1.2 // un rien vers le haut : ça retombe joliment
    e.vz = dz * force
    e.mesh.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6)
    e.fin = time + ECLAT_VIE
    e.mesh.visible = true
    poses++
  }
}

/**
 * L'armure vient d'encaisser un choc. `brisee` : c'était la dernière plaque.
 * Les deux cas doivent se lire d'un coup d'œil, sans lire le message.
 */
function armureEncaisse(brisee: boolean) {
  if (brisee) {
    briserBouclier(20, 5.5) // toute la coque explose…
    boom(new THREE.Vector3(player.mesh.position.x, 0.85, player.mesh.position.z)) // …dans un souffle
  } else {
    boucFlash = time + BOUC_CLAQUE // le dôme claque et tient bon
    briserBouclier(7, 2.6)
  }
}

// ————— 💨 La zone de fumée, COLLÉE à sa victime —————
// Le nuage gris suit le coureur enfumé pendant toute la durée du sort, en plus
// du voile d'écran. Deux règles, et elles vont ensemble :
//
//  · Il COLLE à sa cible. Posé au sol une fois pour toutes, il serait distancé
//    en une seconde (on court à 30 m/s) et n'apprendrait plus rien à personne.
//    Accroché au coureur, il dit « c'est LUI qui est aveuglé ».
//  · Il dure exactement FUMIGENE_DUREE. Le nuage n'est pas un décor : c'est la
//    JAUGE de l'effet. Tant qu'il est là, l'effet court ; il s'éteint avec lui.
//
// Un petit banc recyclé : rarement plus d'un ou deux à la fois.
interface FumeeZone {
  disque: THREE.Mesh
  dome: THREE.Mesh
  /** Le coureur enfumé : la zone se recale sur lui à chaque image. */
  cible: THREE.Object3D
  fin: number
  actif: boolean
}
const fumeeZones: FumeeZone[] = []
function spawnFumeeZone(cible: THREE.Object3D) {
  let z = fumeeZones.find((f) => !f.actif)
  if (!z) {
    const disque = new THREE.Mesh(
      new THREE.CircleGeometry(1.9, 24),
      new THREE.MeshBasicMaterial({ color: 0x9aa2ad, transparent: true, opacity: 0, depthWrite: false })
    )
    disque.rotation.x = -Math.PI / 2
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(1.5, 16, 10),
      new THREE.MeshBasicMaterial({ color: 0x8a929d, transparent: true, opacity: 0, depthWrite: false })
    )
    dome.scale.y = 0.5
    scene.add(disque, dome)
    z = { disque, dome, cible, fin: 0, actif: false }
    fumeeZones.push(z)
  }
  z.cible = cible
  z.fin = time + FUMIGENE_DUREE // la zone vit exactement le temps de l'effet
  z.actif = true
  z.disque.visible = true
  z.dome.visible = true
  placerFumeeZone(z, 0) // en place dès la 1re image, sans attendre la boucle
}

/** Recale la zone sur sa victime. `age` fait monter le dôme au fil du temps. */
function placerFumeeZone(z: FumeeZone, age: number) {
  const p = z.cible.position
  z.disque.position.set(p.x, 0.05, p.z)
  z.dome.position.set(p.x, 0.4 + age * 0.16, p.z)
}

// ————— 💨💥 Le rideau de vitesse (sprint final + dash) —————
// Un overlay DOM (créé ici, pas dans index.html, pour ne pas gêner l'autre
// chantier en cours). Son intensité suit le martèlement et les dash.
const speedEl = document.createElement('div')
speedEl.id = 'speedlines'
// Les éclats triangulaires, semés une fois pour toutes. Tailles, départs et
// vitesses tirés au hasard : sans ça, les deux bords battraient à l'unisson et
// l'effet ferait « rideau » au lieu de « rafale ».
for (const cote of ['g', 'd'] as const) {
  for (let i = 0; i < 14; i++) {
    const t = document.createElement('i')
    t.className = `tri ${cote}`
    t.style.top = `${Math.random() * 100}%`
    t.style.height = `${5 + Math.random() * 13}px`
    t.style.width = `${70 + Math.random() * 170}px`
    t.style.background = `rgba(233, 240, 255, ${0.4 + Math.random() * 0.5})`
    t.style.animationDuration = `${0.32 + Math.random() * 0.4}s`
    t.style.animationDelay = `${-Math.random() * 0.8}s` // déjà en vol au 1er affichage
    speedEl.appendChild(t)
  }
}
document.body.appendChild(speedEl)

// ————— 💨 La poussière d'atterrissage (tout le monde, bots compris) —————
// Un petit nuage plat qui s'étale au sol quand un coureur retombe d'un saut.
// Une horloge à part (`effetTemps`) : le chrono de course est figé pendant le
// décompte, ces effets doivent tourner quand même.
interface Poussiere {
  mesh: THREE.Mesh
  fin: number
}
const POUSSIERE_DUREE = 0.5
let effetTemps = 0
const poussieres: Poussiere[] = []
for (let i = 0; i < 14; i++) {
  const m = new THREE.Mesh(
    new THREE.CircleGeometry(0.42, 16),
    new THREE.MeshBasicMaterial({
      color: 0xcbbba0,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    })
  )
  m.rotation.x = -Math.PI / 2 // à plat sur le sol
  m.visible = false
  scene.add(m)
  poussieres.push({ mesh: m, fin: 0 })
}

/** Lâche un nuage de poussière au sol, aux pieds d'un coureur qui atterrit. */
function poserPoussiere(x: number, z: number) {
  const p = poussieres.find((q) => !q.mesh.visible) ?? poussieres[0]
  p.mesh.position.set(x, 0.04, z)
  p.mesh.scale.setScalar(0.45)
  p.mesh.visible = true
  p.fin = effetTemps + POUSSIERE_DUREE
}

// Qui était en l'air à l'image d'avant ? On compare avec maintenant : passer de
// « en l'air » à « au sol », c'est un atterrissage.
let joueurEnLAir = false
const botEnLAir = PROFILS.map(() => false)

/** Repère les atterrissages de TOUT LE MONDE et lâche la poussière qui va avec. */
function detecterAtterrissages() {
  const AIR = 0.05 // au-dessus de ça, on considère qu'on décolle

  const pAir = player.mesh.position.y > AIR
  if (joueurEnLAir && !pAir) poserPoussiere(player.mesh.position.x, player.mesh.position.z)
  joueurEnLAir = pAir

  bots.forEach((b, i) => {
    if (!b.actif) {
      botEnLAir[i] = false
      return
    }
    const air = b.mesh.position.y > AIR
    if (botEnLAir[i] && !air) poserPoussiere(b.mesh.position.x, b.mesh.position.z)
    botEnLAir[i] = air
  })

  for (const r of rivals.values()) {
    const air = r.opp.mesh.position.y > AIR
    if (r.enLAir && !air) poserPoussiere(r.opp.mesh.position.x, r.opp.mesh.position.z)
    r.enLAir = air
  }
}

/** Fait avancer tous les effets d'un pas. `dz` = recul du monde cette image. */
function updateEffets(dt: number, dz: number) {
  effetTemps += dt
  // 💨 Les nuages de poussière s'étalent au sol puis s'effacent
  for (const p of poussieres) {
    if (!p.mesh.visible) continue
    const k = (p.fin - effetTemps) / POUSSIERE_DUREE // 1 → 0
    if (k <= 0) {
      p.mesh.visible = false
      continue
    }
    p.mesh.position.z += dz
    p.mesh.scale.setScalar(0.45 + (1 - k) * 1.6)
    ;(p.mesh.material as THREE.MeshBasicMaterial).opacity = k * 0.45
  }
  // 🌸 Le cerisier glisse vers l'arrière puis disparaît, une fois dépassé
  if (cerisier.visible) {
    cerisier.position.z += dz
    if (cerisier.position.z > 14) cerisier.visible = false
  }
  // 🌸 Les pétales : emportés vers la DROITE par le vent, en tanguant.
  // La rafale enfle et retombe : un vent constant ferait « tapis roulant ».
  ventPhase += dt
  const rafale = 1 + Math.sin(ventPhase * 1.6) * 0.35
  for (const p of petales) {
    if (!p.mesh.visible) {
      if (petalesActifs && cerisier.visible && Math.random() < 0.4) poserPetale(p, true)
      continue
    }
    p.phase += dt * 3
    p.mesh.position.x += (p.vx * rafale + Math.sin(p.phase) * 0.5) * dt
    p.mesh.position.y += (p.vy + Math.sin(p.phase * 0.7) * 0.25) * dt
    p.mesh.position.z += dz
    p.mesh.rotation.z += dt * 3.2 // ils tourbillonnent plus fort dans le vent
    p.mesh.rotation.x += dt * 2.2
    // Recyclés dès qu'ils sortent : par la droite (le vent), par le bas, ou derrière
    if (p.mesh.position.y < 0 || p.mesh.position.x > 13 || p.mesh.position.z > 14) {
      if (petalesActifs && cerisier.visible) poserPetale(p, false)
      else p.mesh.visible = false
    }
  }
  // 💥 L'explosion gonfle et s'éteint
  if (boomMesh.visible) {
    const k = (boomFin - time) / BOOM_DUREE // 1 → 0
    if (k <= 0) boomMesh.visible = false
    else {
      boomMesh.scale.setScalar(0.4 + (1 - k) * 2.8)
      boomMat.opacity = k * 0.85
    }
  }

  // 🛡️ Le dôme : présent tant qu'il reste de la solidité, il respire doucement
  // et CLAQUE quand il vient d'encaisser. Sa seule présence dit « tu es couvert ».
  const bouclierOn = armure > 0
  boucFill.visible = bouclierOn
  boucLignes.visible = bouclierOn
  if (bouclierOn) {
    const p = player.mesh.position
    boucFill.position.set(p.x, 0.85, p.z)
    boucLignes.position.copy(boucFill.position)
    boucLignes.rotation.y += dt * 0.5
    boucFill.rotation.y = boucLignes.rotation.y
    const claque = Math.max(0, (boucFlash - time) / BOUC_CLAQUE) // 1 → 0
    boucFillMat.opacity = 0.1 + Math.sin(time * 3) * 0.02 + claque * 0.5
    boucLineMat.opacity = 0.28 + claque * 0.6
    const s = 1 + claque * 0.18 // il enfle une fraction de seconde sous le choc
    boucFill.scale.setScalar(s)
    boucLignes.scale.setScalar(s)
  }

  // 🛡️ Les éclats : ils fusent, retombent et s'éteignent
  for (const e of eclats) {
    if (!e.mesh.visible) continue
    const reste = e.fin - time
    if (reste <= 0) {
      e.mesh.visible = false
      continue
    }
    e.mesh.position.x += e.vx * dt
    e.mesh.position.y += e.vy * dt
    e.mesh.position.z += e.vz * dt + dz // + dz : ils restent dans le décor qui recule
    e.vy -= 6 * dt // un peu de gravité, pour qu'ils retombent au lieu de flotter
    e.mesh.rotation.x += dt * 6
    e.mesh.rotation.z += dt * 5
    ;(e.mesh.material as THREE.MeshBasicMaterial).opacity = (reste / ECLAT_VIE) * 0.9
  }

  // 💨 Les zones de fumée : entrée franche, tenue, sortie en fondu ; elles montent
  for (const z of fumeeZones) {
    if (!z.actif) continue
    const reste = z.fin - time
    if (reste <= 0) {
      z.actif = false
      z.disque.visible = false
      z.dome.visible = false
      continue
    }
    const age = FUMIGENE_DUREE - reste
    // Elle tient pleine presque tout l'effet : on ne fond qu'à la toute fin,
    // pour que sa disparition annonce la fin de l'aveuglement.
    const fade = Math.min(1, age / 0.3) * Math.min(1, reste / 0.5)
    ;(z.disque.material as THREE.MeshBasicMaterial).opacity = fade * 0.5
    ;(z.dome.material as THREE.MeshBasicMaterial).opacity = fade * 0.42
    // Elle SUIT sa victime au lieu de défiler avec le décor : c'est ce qui en
    // fait un indicateur d'effet et non une simple tache sur la piste.
    placerFumeeZone(z, age)
    z.dome.rotation.y += dt * 0.6
  }
}

// ————— Le rouleau-machine à sous —————
// À chaque ramassage, la case fait défiler les icônes façon machine de casino
// et s'arrête PILE sur l'objet gagné, qui grossit et brille 1,5 s.
const REEL_MS = 1000 // durée du déroulé
const WON_MS = 1500 // durée « grossi + brillance »
const reelTimers: (ReturnType<typeof setTimeout>[])[] = [[], []]

/** Coupe un déroulé en cours sur une case (avant de la redessiner proprement). */
function clearReel(i: number) {
  for (const t of reelTimers[i]) clearTimeout(t)
  reelTimers[i] = []
  const el = slotEls[i]
  el.classList.remove('won', 'rolling')
  el.querySelector('.reel')?.remove()
}

/** Redessine les 2 slots. Le 1er est mis en avant : c'est le prochain lancé. */
function drawSlots(pop = -1) {
  slotEls.forEach((el, i) => {
    clearReel(i) // un déroulé en cours est annulé : on repart d'un état net
    const k = slots[i]
    el.textContent = k ? PARCHEMINS[k].icone : '—'
    el.classList.toggle('actif', i === 0 && !!k)
    if (i === pop) {
      el.classList.remove('plein')
      void el.offsetWidth // relance l'animation même sur un ramassage consécutif
      el.classList.add('plein')
    }
  })
}

/**
 * Le déroulé « machine à sous » d'un ramassage sur la case `i` : les icônes
 * défilent et ralentissent, s'arrêtent pile sur `kind`, puis la case grossit et
 * brille 1,5 s. Purement visuel — le vrai contenu est déjà dans `slots`, et le
 * toast a annoncé l'objet, donc on peut jouer même pendant le déroulé.
 */
function revealSlot(i: number, kind: ParcheminKind) {
  clearReel(i)
  const el = slotEls[i]
  el.classList.remove('actif', 'plein')
  el.textContent = ''
  const H = el.clientHeight || 42

  // La bande : des icônes au hasard, et l'objet GAGNÉ tout en bas.
  const N = 18
  const cells: string[] = []
  for (let k = 0; k < N - 1; k++) {
    cells.push(PARCHEMINS[TIRAGE[Math.floor(Math.random() * TIRAGE.length)]].icone)
  }
  cells.push(PARCHEMINS[kind].icone)

  const reel = document.createElement('div')
  reel.className = 'reel'
  reel.innerHTML = cells
    .map((ic) => `<span style="height:${H}px">${ic}</span>`)
    .join('')
  reel.style.transition = `transform ${REEL_MS}ms cubic-bezier(0.13, 0.75, 0.2, 1)`
  el.classList.add('rolling')
  el.appendChild(reel)

  // On force un reflow, puis on lance le défilé jusqu'à la dernière case (gagnée)
  void reel.offsetWidth
  reel.style.transform = `translateY(${-(N - 1) * H}px)`

  reelTimers[i].push(
    setTimeout(() => {
      // Arrêt pile sur l'objet : on retire la bande, on fige l'icône, on brille
      reel.remove()
      el.classList.remove('rolling')
      el.textContent = PARCHEMINS[kind].icone
      el.classList.toggle('actif', i === 0)
      void el.offsetWidth
      el.classList.add('won')
      reelTimers[i].push(setTimeout(() => el.classList.remove('won'), WON_MS))
    }, REEL_MS)
  )
}

/** Le sélecteur 1-2-3-4 du menu : boutons + qui on va affronter. */
function drawBotPick() {
  for (const el of Array.from(botRowEl.children)) {
    el.classList.toggle('actif', Number((el as HTMLElement).dataset.n) === nbBots)
  }
  // On annonce les noms : le joueur doit savoir qu'ajouter un rival, c'est
  // ajouter un rival PLUS FORT — pas juste un de plus.
  botNamesEl.textContent = PROFILS.slice(0, nbBots)
    .map((p) => p.nom)
    .join(' · ')
}

for (let n = 1; n <= BOTS_MAX; n++) {
  const b = document.createElement('button')
  b.className = 'botn'
  b.dataset.n = String(n)
  b.textContent = String(n)
  b.addEventListener('click', () => {
    nbBots = n
    localStorage.setItem(CLE_BOTS, String(n))
    drawBotPick()
  })
  botRowEl.appendChild(b)
}
drawBotPick()

/** Les rivaux qui courent vraiment sur cette course. */
function botsEnCourse() {
  return bots.filter((b) => b.actif)
}

/**
 * Le classement en direct. On le trie par distance : le meneur en haut. Les
 * écarts sont donnés EN SECONDES et non en mètres — c'est la seule unité qui
 * parle au joueur, celle de son chrono et de son record.
 */
function drawRank() {
  const coureurs = [
    { nom: 'Toi', couleur: 0xc33a2c, d: distance, arrivee: -1, moi: true },
    ...botsEnCourse().map((b) => ({
      nom: b.profil.nom,
      couleur: b.profil.bandeau,
      d: b.distance,
      arrivee: b.tempsArrivee,
      moi: false,
    })),
  ]

  if (online) {
    for (const r of rivals.values()) {
      coureurs.push({
        nom: r.name,
        couleur: r.opp.currentFighter.band,
        d: r.opp.distanceNow,
        arrivee: r.finished ? r.rank : -1, // le rang sert juste à trier les arrivés
        moi: false,
      })
    }
  }

  // Arrivés d'abord (départagés au chrono), puis les autres à la distance
  coureurs.sort((a, b) => {
    if (a.arrivee >= 0 && b.arrivee >= 0) return a.arrivee - b.arrivee
    if (a.arrivee >= 0) return -1
    if (b.arrivee >= 0) return 1
    return b.d - a.d
  })

  rankEl.innerHTML = coureurs
    .map((c, i) => {
      // L'écart est compté à TA vitesse : « ce qu'il me faudrait pour y être »
      const ecart = (c.d - distance) / Math.max(speed, 1)
      let gap = ''
      if (c.arrivee >= 0) gap = '⛩️'
      else if (!c.moi) gap = `${ecart >= 0 ? '+' : ''}${ecart.toFixed(2)}`
      const couleur = `#${c.couleur.toString(16).padStart(6, '0')}`
      return `<div class="rankrow${c.moi ? ' moi' : ''}">
        <span class="rankpos">${i + 1}</span>
        <span class="rankdot" style="background:${couleur}"></span>
        <span class="rankname">${c.nom}</span>
        <span class="rankgap">${gap}</span>
      </div>`
    })
    .join('')
}

/**
 * On encaisse un sort. Si la 🪞 parade est levée, il repart chez son auteur au
 * lieu de nous toucher — d'où le retour : `true` = renvoyé.
 */
function subirSort(
  kind: string,
  deBot: Bot | null = null,
  srcMesh: THREE.Object3D | null = null,
  fromId = ''
): boolean {
  if (time < miroirFin) {
    miroirFin = 0 // la parade est à usage unique
    toast('🪞 Parade Miroir — renvoyé !')
    // En ligne, le renvoi repart chez SON lanceur (fromId), pas au hasard
    if (online) net.sendSpell(kind, fromId)
    else if (deBot) deBot.subir(kind as ParcheminKind, time)
    return true
  }

  // D'où vient le tir : le bot qui l'a lancé, le rival en ligne, ou la brume
  // si on l'ignore. Calculé pour tous les sabotages, pas seulement le kunai.
  const lanceur =
    deBot?.mesh.position ?? srcMesh?.position ?? new THREE.Vector3(player.mesh.position.x, 1.2, -22)

  if (kind === 'kusarigama') {
    kusarigamaFin = time + KUSARIGAMA_DUREE
    lancerProjet('kusarigama', lanceur, player.mesh.position, player.mesh) // ⛓️
    toast('⛓️ Kusarigama ! Tu es entravé…')
  } else if (kind === 'kunai') {
    // Avant le test d'armure : on doit voir la lame même quand elle éclate dessus.
    lancerProjet('kunai', lanceur, player.mesh.position, player.mesh)

    // Le seul sort qui fait trébucher sec. L'armure peut encore l'avaler.
    if (armure > 0) {
      armure = Math.max(0, armure - ARMURE_COUT_PETIT)
      armureEncaisse(armure === 0) // 🛡️ même lecture que sur un obstacle
      toast('🛡️ Le kunai éclate sur l\'armure !')
      return false
    }
    speed = Math.max(6, speed * 0.35)
    stumble = 1.2
    toast('🎯 Kunai en pleine course !')
  } else if (kind === 'fumigene') {
    fumigeneFin = time + FUMIGENE_DUREE
    spawnFumeeZone(player.mesh) // 💨 le nuage te suit tant que tu es aveuglé
    toast('💨 Tu ne vois plus rien !')
  } else if (kind === 'senbon') {
    senbonFin = time + SENBON_DUREE
    // ☠️ L'aiguille file jusqu'à toi, et te laisse son aura violette
    lancerProjet('senbon', lanceur, player.mesh.position, player.mesh)
    toast('☠️ Poison — tout tangue…')
  } else if (kind === 'onmyoji') {
    return false // l'échange est traité par l'appelant : il connaît les 2 places
  }
  flash()
  return false
}

/**
 * 🔮 Échange nos places avec `d`. Le sort le plus violent du jeu.
 * `corps` = le maillage de l'échangé, pour l'envelopper de la même lueur.
 */
function echangerAvec(d: number, qui: string, corps: THREE.Object3D | null = null) {
  distance = d
  lueurFin = time + LUEUR_DUREE
  lueurCible = corps
  toast(`🔮 Portail ! Tu échanges avec ${qui}`)
  flash()
}

/**
 * Trouve à qui envoyer un sort offensif en solo : le rival le plus proche
 * DEVANT. Les autres ne te coûtent rien — les saboter serait du gâchis, et le
 * joueur ne choisit pas sa cible en pleine course.
 */
function cibleDevant(): Bot | undefined {
  return botsEnCourse()
    .filter((b) => b.tempsArrivee < 0 && b.distance > distance)
    .sort((a, b) => a.distance - b.distance)[0]
}

/** Lance le parchemin le plus ancien. Rien à faire s'il n'y en a pas. */
function lancerParchemin() {
  // Dans le sprint, tous les taps servent à marteler : pas de sort ici, sinon
  // le clavier pourrait encore lancer (touche E) là où le mobile ne peut plus.
  if (inSprintZone()) {
    toast('🔥 Pas de parchemin dans le sprint !')
    return
  }
  const kind = slots.shift()
  if (!kind) {
    toast('📜 Aucun parchemin en main')
    return
  }
  const p = PARCHEMINS[kind]
  drawSlots()
  toast(p.cri)

  // ————— Sur soi —————
  // Chacun pose son aura pour SA durée : tant qu'elle brille, le sort court.
  // L'armure fait exception — son dôme facetté joue déjà ce rôle, en mieux.
  if (kind === 'vent') {
    ventFin = time + VENT_DUREE
    poserAura(player.mesh, AURA_VENT, VENT_DUREE)
  } else if (kind === 'grue') {
    grueFin = time + GRUE_DUREE // 🕊️ l'anneau vert suit `grueFin` tout seul
  } else if (kind === 'armure') armure = ARMURE_SOLIDITE
  else if (kind === 'miroir') {
    miroirFin = time + MIROIR_DUREE // 🪞 la glace suit `miroirFin` tout seul
  } else if (kind === 'the') {
    // 🍵 Le thé lave TOUT d'un coup — y compris ce qu'on vient d'encaisser
    kusarigamaFin = 0
    fumigeneFin = 0
    senbonFin = 0
    // Les marques des afflictions s'éteignent avec elles : sinon on se croirait
    // encore empoisonné et entravé alors qu'on vient de se purifier.
    libererChaines(player.mesh) // ⛓️ les chaînes tombent
    for (const a of auras) {
      if ((a.mesh.material as THREE.MeshBasicMaterial).color.getHex() === AURA_SENBON) {
        a.actif = false
        a.mesh.visible = false
      }
    }
    poserAura(player.mesh, AURA_THE, 0.9) // une bouffée verte, courte : c'est instantané
  }
  // ————— 🔮 Le portail : il part, il ne vise pas —————
  else if (kind === 'onmyoji') {
    portail = { d: distance, lane: player.currentLane }
  }
  // ————— Offensif : ça part chez quelqu'un —————
  else if (p.cible === 'adversaire') {
    if (online) {
      // Il vise le rival le plus proche DEVANT — comme en solo, mais parmi les
      // 9 autres. Le serveur ne l'applique qu'à celui-là.
      const cible = rivalDevant()
      if (!cible) {
        toast(`${p.icone} …mais tu mènes déjà !`)
        // On a quand même retiré le rouleau du slot : on le rend, sinon on
        // aurait payé un sort perdu.
        slots.unshift(kind)
        drawSlots()
        return
      }
      lancerProjet(kind, player.mesh.position, cible.opp.mesh.position, cible.opp.mesh)
      if (kind === 'fumigene') spawnFumeeZone(cible.opp.mesh)
      net.sendSpell(kind, cible.id)
      toast(`${p.icone} sur ${cible.name} !`)
      return
    }
    const cible = cibleDevant()
    if (!cible) {
      toast(`${p.icone} …mais tu mènes déjà !`)
      return
    }
    // 🎯 La lame part vers sa victime. Si elle nous revient dans les dents,
    // `subirSort` rejouera le vol dans l'autre sens : c'est le même maillage,
    // donc le retour écrase l'aller — on ne voit que le trajet qui compte.
    lancerProjet(kind, player.mesh.position, cible.mesh.position, cible.mesh)
    if (kind === 'fumigene') spawnFumeeZone(cible.mesh)

    // Sa parade peut nous le renvoyer dans les dents : on l'a bien cherché
    if (cible.subir(kind, time)) {
      toast(`🪞 ${cible.profil.nom} te l'a renvoyé !`)
      subirSort(kind)
    } else {
      toast(`${p.icone} sur ${cible.profil.nom} !`)
    }
  }
}

/**
 * Ton pseudo, sur ton étiquette au-dessus de ta tête.
 * Relu à chaque départ : c'est le seul moment qui compte, et le pseudo comme le
 * perso ont pu changer dans le menu entre deux courses.
 */
function updateMeLabel() {
  player.setName(menu.settings.name)
}

/**
 * Quand les taps servent à MARTELER plutôt qu'à esquiver :
 * - le sprint final (les derniers mètres)
 * - le décompte 3-2-1 : le DÉPART CANON — plus tu martèles, plus tu pars vite
 */
function inSprintZone() {
  return (
    (state === 'course' && distance >= COURSE_LENGTH - SPRINT_ZONE) ||
    state === 'depart'
  )
}

/** Retour à l'écran-titre. `banner` : le mot de la fin de la course précédente. */
function backToMenu(banner?: string) {
  state = 'menu'
  online = false
  clearRivals()
  for (const b of bots) {
    b.actif = false
    b.cacher()
  }
  for (const m of botMarks) m.classList.add('hidden')
  // Une lame encore en l'air à l'arrivée resterait plantée dans le menu
  for (const p of projets) {
    p.actif = false
    p.mesh.visible = false
  }
  for (const a of auras) {
    a.actif = false
    a.mesh.visible = false
  }
  for (const c of chaines) {
    c.actif = false
    c.group.visible = false
  }
  grueAnneau.visible = false
  miroirGroup.visible = false
  hideSpark()
  oppmarkEl.classList.add('hidden')
  rankEl.classList.add('hidden')
  gapEl.classList.add('hidden')
  countEl.classList.remove('show')
  sprintEl.classList.add('hidden')
  menu.showTitle(banner)
}

/** Lance une course. En ligne, la graine vient du serveur : même piste pour les deux ! */
function startRace(seed: number) {
  // ————— La grille de départ —————
  // On aligne joueur + bots sur la MÊME ligne, répartis de gauche à droite sur
  // les 3 voies (le joueur à gauche, les bots vers la droite). En duel, c'est le
  // serveur qui donne la place ; ici on ne gère que la grille solo.
  const nbCoureurs = 1 + nbBots
  const voieDe = (k: number) => (nbCoureurs === 1 ? 1 : Math.round((k / (nbCoureurs - 1)) * 2))
  player.reset(online ? net.myStartLane : voieDe(0))
  // Les avatars des rivaux sont (re)placés par syncRivals dès la 1re position
  // reçue ; ici on repart d'une table propre en solo, et on garde les rivaux
  // déjà connus du lobby en ligne.
  if (!online) clearRivals()
  track.reset(COURSE_LENGTH, seed)
  time = 0
  distance = 0
  speed = 0
  stumble = 0
  netTimer = 0
  raceGo = false
  sprintTaps = []
  sprintCharge = 0
  sprintSeen = false
  slots = []
  ventFin = 0
  kusarigamaFin = 0
  armure = 0
  grueFin = 0
  miroirFin = 0
  fumigeneFin = 0
  senbonFin = 0
  portail = null
  portailMesh.visible = false
  for (const p of projets) {
    p.actif = false
    p.mesh.visible = false
  }
  for (const a of auras) {
    a.actif = false
    a.mesh.visible = false
  }
  for (const c of chaines) {
    c.actif = false
    c.group.visible = false
  }
  grueAnneau.visible = false
  miroirGroup.visible = false
  lueurFin = 0
  lueurCible = null
  lueurJoueur.visible = false
  lueurRival.visible = false
  hideSpark()
  fumeeEl.classList.remove('show')
  canvas.classList.remove('poison')
  // 🌸💥💨 Les effets de course repartent à zéro : cerisier au départ, pétales
  // et zones de fumée éteints, rideau de vitesse coupé.
  cerisier.position.set(CERISIER_X, 0, -9)
  cerisier.visible = true
  for (const p of petales) p.mesh.visible = false
  petalesActifs = true
  ventPhase = 0
  // 🌬️ La rafale qui emporte les pétales, le temps du décompte (10 s en salon,
  // 3 s en solo). Le son est synthétisé : aucun fichier à charger.
  souffleDeVent(online ? 5 : 3.2)
  boomMesh.visible = false
  // 💨 Poussière : on efface les nuages et on repart « tout le monde au sol »
  for (const p of poussieres) p.mesh.visible = false
  joueurEnLAir = false
  botEnLAir.fill(false)
  // 🛡️ Ni dôme ni éclat ne survivent d'une course à l'autre
  boucFlash = 0
  boucFill.visible = false
  boucLignes.visible = false
  for (const e of eclats) e.mesh.visible = false
  for (const z of fumeeZones) {
    z.actif = false
    z.disque.visible = false
    z.dome.visible = false
  }
  speedEl.style.opacity = '0'
  drawSlots()

  // Les rivaux : uniquement en entraînement (en ligne, l'adversaire est réel).
  // Ils lisent le MÊME plan d'obstacles et de rouleaux que le joueur.
  const rangees = construireRangees(track.obstaclesPrevus())
  const rouleaux = track.parcheminsPrevus()
  bots.forEach((b, i) => {
    b.actif = !online && i < nbBots
    // Graine dérivée : chaque rival tire ses fautes ailleurs dans la suite,
    // sinon les 4 rateraient exactement les mêmes obstacles au même endroit.
    // Le joueur est l'indice 0 de la grille, les bots suivent (voie répartie).
    b.reset(rangees, rouleaux, (seed ^ ((i + 1) * 0x9e3779b1)) | 0, voieDe(i + 1))
    botMarks[i].classList.toggle('hidden', !b.actif)
    botMarks[i].style.left = '0%'
  })

  // Le classement en direct : visible dans les deux modes !
  rankEl.classList.remove('hidden')
  rankTimer = 0
  drawRank()

  countdown = 3
  state = 'depart'
  menu.hide()
  updateMeLabel()
  countEl.classList.add('show')
  // Le départ canon : la jauge apparaît dans les 3 dernières secondes (cf. boucle)
  sprintEl.classList.add('hidden')
  sprintLabelEl.textContent = '🚀 DÉPART CANON'
  sprintFillEl.style.width = '0%'
  progressEl.style.width = '0%'
  // Le marqueur unique n'a plus de sens à 10 : c'est le classement en direct
  // qui montre où en est chacun. La bulle d'écart vise le plus proche devant.
  oppmarkEl.classList.add('hidden')
  gapEl.classList.remove('hidden')
}

/**
 * Le verdict de l'entraînement. On le calcule à l'instant où le joueur coupe
 * la ligne : tout rival qui n'a pas encore fini est forcément derrière lui.
 */
function classement(): string {
  const rivaux = botsEnCourse()
  if (!rivaux.length) return ''

  const finis = rivaux.filter((b) => b.tempsArrivee >= 0)
  const rang = 1 + finis.length
  const medaille = ['🥇', '🥈', '🥉'][rang - 1] ?? '🏁'
  const place = `${medaille} ${rang === 1 ? '1er' : `${rang}ᵉ`} sur ${rivaux.length + 1}`

  if (finis.length) {
    // Celui qui vient de te battre : le dernier arrivé juste avant toi. C'est
    // lui l'objectif de la prochaine course, pas le vainqueur inaccessible.
    const devant = finis.reduce((a, b) => (a.tempsArrivee > b.tempsArrivee ? a : b))
    const ecart = (time - devant.tempsArrivee).toFixed(2)
    return `${place} — ${devant.profil.nom} t'a devancé de ${ecart} s`
  }

  // Tu mènes : l'écart sur le poursuivant, estimé à son rythme du moment
  const second = rivaux.reduce((a, b) => (a.distance > b.distance ? a : b))
  const reste = (COURSE_LENGTH - second.distance) / Math.max(second.speed, 1)
  return `${place} — tu devances ${second.profil.nom} de ${reste.toFixed(2)} s`
}

function crossFinishLine() {
  player.mesh.visible = true // au cas où on franchit la ligne en plein clignotement
  sprintEl.classList.add('hidden')
  gapEl.classList.add('hidden')
  const t = time.toFixed(2)

  if (online) {
    // On prévient le serveur et on attend le classement (les autres courent encore)
    net.sendFinished(time)
    state = 'fini'
    const restants = [...rivals.values()].filter((r) => !r.finished).length
    menu.showStatus(
      `⛩️ Ligne franchie en <b>${t} s</b> !<br>` +
        (restants > 0 ? `${restants} guerrier${restants > 1 ? 's' : ''} encore en course…` : 'Classement…')
    )
    return
  }

  // Solo : meilleur temps gardé en mémoire sur le téléphone
  state = 'fini'
  // La clé porte la longueur : un record établi sur une course plus courte
  // serait imbattable et resterait affiché à vie.
  const CLE_RECORD = `kurogane-best-${COURSE_LENGTH}`
  const best = Number(localStorage.getItem(CLE_RECORD) ?? Infinity)
  let bestLine: string
  if (time < best) {
    localStorage.setItem(CLE_RECORD, String(time))
    bestLine = '🏆 Nouveau record personnel !'
  } else {
    bestLine = `Record à battre : ${best.toFixed(2)} s`
  }
  backToMenu(`⛩️ Torii sacré franchi en <b>${t} s</b> !<br>${classement()}<br>${bestLine}`)
}

/** Le classement final : trié, arrivés d'abord (au rang), puis les abandons. */
function showResults(view: LobbyView) {
  const ranked = [...view.players].sort((a, b) => {
    if (a.rank && b.rank) return a.rank - b.rank
    if (a.rank) return -1
    if (b.rank) return 1
    return b.distance - a.distance
  })
  const me = view.players.find((p) => p.id === view.me)
  const total = view.players.length
  const rang = me?.rank || 0
  const titre =
    rang === 1
      ? '🏆 <b>VICTOIRE !</b> La lame légendaire est à toi.'
      : rang > 0
        ? `Tu finis <b>${rang}ᵉ</b> sur ${total}.`
        : '☁️ Tu n\'as pas fini la course…'

  const lignes = ranked
    .map((p, i) => {
      const medaille = ['🥇', '🥈', '🥉'][i] ?? `${i + 1}ᵉ`
      const chrono = p.rank ? `${p.time.toFixed(2)} s` : 'abandon'
      const moi = p.id === view.me ? ' moi' : ''
      // ⚠️ escapeHtml : les pseudos viennent des autres joueurs
      return `<div class="resrow${moi}"><span>${medaille}</span>` +
        `<span class="resname">${escapeHtml(p.name || 'Guerrier')}</span>` +
        `<span class="restime">${chrono}</span></div>`
    })
    .join('')

  menu.showResults(`${titre}<div class="reslist">${lignes}</div>`, view.isHost)
}

// ————— Le réseau —————
const net = new Net({
  onLobby(view) {
    // Le salon a bougé (arrivée, départ, prêt…) : on (re)dessine le lobby, tant
    // qu'on n'est pas déjà en course. Sert aussi au retour au salon d'après-course.
    if (state === 'course' || state === 'depart') return
    if (state === 'fini' && view.phase === 'lobby') clearRivals() // rematch : on repart propre
    state = 'attente'
    menu.showLobby(view)
  },
  onCountdown(seed) {
    online = true
    toast('⚔️ La course commence !')
    startRace(seed)
  },
  onGo() {
    raceGo = true
    for (const r of rivals.values()) r.opp.go()
  },
  onPlayers(others) {
    // Positions de tous les autres : on met les avatars en phase avec le salon
    syncRivals(others)
  },
  onSpell(from, kind, d) {
    if (state !== 'course') return
    const r = rivals.get(from)
    // 🔮 Le portail est à part : un échange, pas une affliction. On prend SA
    // place (d) ; de son côté il prend la nôtre. La 🪞 parade ne le renvoie pas.
    if (kind === 'onmyoji') echangerAvec(d, r ? r.name : 'un rival', r ? r.opp.mesh : null)
    else subirSort(kind, null, r ? r.opp.mesh : null, from)
  },
  onAction(a) {
    // Une action d'un rival, reçue à l'instant où il l'a faite — routée vers SON avatar
    rivals.get(a.from)?.opp.applyAction(a)
  },
  onChat(from, name, text) {
    menu.addChatLine(name, text, from === net.id)
  },
  onLink(up) {
    // NOTRE connexion qui vacille — le SDK retente tout seul derrière
    toast(up ? '📡 Reconnecté !' : '📡 Connexion instable… reconnexion en cours')
  },
  onResults(view) {
    state = 'fini'
    sprintEl.classList.add('hidden')
    gapEl.classList.add('hidden')
    rankEl.classList.add('hidden')
    showResults(view)
  },
  onError(message) {
    net.leave()
    backToMenu(`⚠️ ${escapeHtml(message)}`)
  },
})

// ————— Les menus —————
const identity = () => ({ name: menu.settings.name, fighter: menu.settings.fighter })

const menu = new Menu({
  onSolo() {
    online = false
    menu.showBotPick()
  },
  onOnline() {
    // Plus de recherche 1v1 : on ouvre l'accueil des salons (créer / rejoindre).
    menu.showSalon()
  },
  onCreateSalon() {
    menu.showStatus('🏮 Création du salon…')
    net.createSalon(identity())
  },
  onQuick() {
    menu.showStatus('⚡ Recherche d\'un salon public…')
    net.joinQuick(identity())
  },
  onJoinByCode(code) {
    if (!code) return
    menu.showStatus('🚪 On rejoint le salon…')
    net.joinByCode(identity(), code)
  },
  onJoinRoom(roomId) {
    menu.showStatus('🚪 On rejoint le salon…')
    net.joinRoom(identity(), roomId)
  },
  onListSalons() {
    return net.listSalons()
  },
  onReady(ready) {
    net.sendReady(ready)
  },
  onStart() {
    net.sendStart()
  },
  onChat(text) {
    net.sendChat(text)
  },
  onReplay() {
    net.sendToLobby()
  },
  onLeaveSalon() {
    net.leave()
    clearRivals()
    backToMenu()
  },
  onFighter(f) {
    // Le guerrier qui court derrière le menu change tout de suite : on voit son
    // choix avant même de lancer la course.
    player.setFighter(f)
  },
  onQuality(q) {
    applyQuality(q)
  },
  onCancel() {
    net.leave()
    backToMenu()
  },
})

btnGo.addEventListener('click', () => {
  online = false
  startRace(Math.floor(Math.random() * 2 ** 31))
})

applyQuality(menu.settings.quality)
updateMeLabel()
menu.showTitle()

// ————— Les contrôles —————
// Chaque action est AUSSI envoyée au serveur en événement instantané : le
// rival la voit ~50 ms plus tôt que si elle était fondue dans le flux 20 Hz.
new Input(document.body, {
  left: () => {
    if (state !== 'course') return
    const de = player.currentLane
    player.moveLeft()
    if (player.currentLane !== de && player.spark) flashSpark(LANES[de], LANES[player.currentLane])
    if (online) net.sendAction({ t: 'lane', lane: player.currentLane })
  },
  right: () => {
    if (state !== 'course') return
    const de = player.currentLane
    player.moveRight()
    if (player.currentLane !== de && player.spark) flashSpark(LANES[de], LANES[player.currentLane])
    if (online) net.sendAction({ t: 'lane', lane: player.currentLane })
  },
  jump: () => {
    if (state !== 'course') return
    const v = player.jump(time < grueFin)
    // ⚡ Le style de Sasuke crépite aussi au décollage, en plus petit
    if (v > 0 && player.spark) flashSparkSaut()
    if (online && v > 0) net.sendAction({ t: 'jump', v })
  },
  slide: () => {
    if (state !== 'course') return
    const d = player.slide()
    if (online && d > 0) net.sendAction({ t: 'slide', d })
  },
  spell: () => state === 'course' && lancerParchemin(),
  // On horodate chaque coup : la boucle de jeu en déduit la cadence.
  // Horloge de la page (pas le chrono de course) : le chrono est figé à 0
  // pendant le décompte, or le DÉPART CANON se martèle pendant le décompte !
  sprint: () => sprintTaps.push(performance.now() / 1000),
  isSprint: inSprintZone,
})

// ————— La boucle de jeu (60 fois par seconde) —————
const timer = new THREE.Timer()

function tick(now?: number) {
  requestAnimationFrame(tick)
  timer.update(now)
  const dt = Math.min(timer.getDelta(), 0.05) // temps écoulé depuis la dernière image

  if (state === 'depart') {
    // 3… 2… 1… GO ! En duel, le départ est PROGRAMMÉ à une heure serveur
    // précise (startAt) : les deux téléphones tirent au même instant absolu,
    // quel que soit leur ping. (Avant, chacun partait à la réception du
    // signal — le mieux connecté partait toujours en premier !)
    if (online && net.startAt > 0 && net.clockReady) {
      countdown = (net.startAt - net.serverNow()) / 1000
    } else {
      countdown -= dt // solo, ou horloge pas encore synchronisée
    }
    // Le décompte peut durer 10 s (salon) ou 3 s (solo) : on affiche le vrai chiffre.
    countEl.textContent = countdown > 0 ? `${Math.min(10, Math.ceil(countdown))}` : 'GO !'

    // ————— Le DÉPART CANON : marteler dans les 3 dernières secondes —————
    // Pas plus tôt : sur un décompte de 10 s, marteler dès le début serait
    // épuisant et sans intérêt. La jauge n'apparaît que dans la ligne droite.
    const canon = countdown <= 3.2
    sprintEl.classList.toggle('hidden', !canon)
    const pnow = performance.now() / 1000
    sprintTaps = sprintTaps.filter((t) => pnow - t < SPRINT_WINDOW)
    if (canon) {
      const startRate = sprintTaps.length / SPRINT_WINDOW
      sprintCharge += (Math.min(1, startRate / SPRINT_FULL_RATE) - sprintCharge) * Math.min(1, dt * 8)
      sprintFillEl.style.width = `${sprintCharge * 100}%`
    }

    // Le GO : à l'heure programmée en duel (petit temps d'affichage du
    // « GO ! » identique pour les deux), au bout du décompte en solo.
    const ready = online
      ? net.startAt > 0 && net.clockReady
        ? countdown <= -0.4
        : raceGo && countdown <= 0 // secours si l'horloge n'est pas prête
      : countdown <= -0.6
    if (ready) {
      countEl.classList.remove('show')
      state = 'course'
      // La jauge convertit le martèlement en vitesse initiale : à fond, on
      // part directement à la vitesse de croisière (≈ 0,3 s de gagnées) —
      // toujours moins qu'un trébuchement : ça départage, ça ne décide pas.
      speed = 12 + 10 * sprintCharge
      if (sprintCharge > 0.75) toast('🚀 Départ canon !')
      if (online) for (const r of rivals.values()) r.opp.go()
      sprintTaps = []
      sprintCharge = 0
      sprintEl.classList.add('hidden')
      sprintLabelEl.textContent = 'SPRINT FINAL'
    } else if (online && countdown < -4) {
      // Le GO du serveur n'arrive pas : connexion perdue
      net.leave()
      backToMenu('⚠️ Connexion perdue au départ.')
    }
    player.update(dt)
    for (const r of rivals.values()) r.opp.update(dt, distance)
    // Les rivaux sont déjà sur la ligne de départ pendant le décompte
    for (const b of botsEnCourse()) b.placer(dt, distance)
    // 🌸 Les pétales tombent pendant tout le décompte (monde immobile : dz = 0)
    petalesActifs = true
    updateEffets(dt, 0)
  } else if (state === 'course') {
    time += dt

    // ————— Sprint final : plus on martèle vite, plus on accélère —————
    const sprinting = inSprintZone()
    const pnow = performance.now() / 1000
    sprintTaps = sprintTaps.filter((t) => pnow - t < SPRINT_WINDOW)

    // La cadence est PLAFONNÉE à SPRINT_FULL_RATE : au-delà, plus aucun gain.
    // C'est ce qui met le pouce d'un mobile et un autoclicker à égalité.
    const rate = sprintTaps.length / SPRINT_WINDOW
    const target = sprinting ? Math.min(1, rate / SPRINT_FULL_RATE) : 0
    sprintCharge += (target - sprintCharge) * Math.min(1, dt * 8)

    // La vitesse de croisière augmente au fil de la course…
    let cruise = 22 + 8 * (distance / COURSE_LENGTH)
    // …le martèlement la pousse encore un peu dans les derniers mètres…
    if (sprinting) cruise *= 1 + SPRINT_BOOST * sprintCharge
    // …et les parchemins par-dessus. Un dash sous entrave reste bride : les
    // deux effets se multiplient au lieu de s'annuler.
    if (time < ventFin) cruise *= 1 + VENT_BOOST
    if (time < kusarigamaFin) cruise *= KUSARIGAMA_FACTEUR
    speed += (cruise - speed) * Math.min(1, dt * 1.2)

    distance += speed * dt
    player.update(dt)
    for (const r of rivals.values()) r.opp.update(dt, distance)
    track.update(dt, speed, distance)

    // Chaque rival court sa propre course, sans jamais toucher à la nôtre
    bots.forEach((b, i) => {
      if (!b.actif) return
      if (b.avance(dt, time, COURSE_LENGTH)) toast(`⛩️ ${b.profil.nom} a franchi le torii !`)
      b.placer(dt, distance)
      botMarks[i].style.left = `${Math.min(100, (b.distance / COURSE_LENGTH) * 100)}%`

      // Ses parchemins. Un sort offensif part sur celui qui le précède — le
      // joueur compris : c'est ce qui rend l'entraînement mordant.
      const lance = b.jouerParchemin(time)
      if (!lance) return
      const devant = [...botsEnCourse(), null].find(
        (x) => x !== b && (x ? x.distance : distance) > b.distance
      )
      if (lance === 'onmyoji') {
        // Un bot ne vise pas mieux que nous : son portail part droit devant et
        // meurt au premier mur, exactement comme le nôtre.
        const mur = track.premierMur(b.ligne, b.distance, distance)
        if (devant === null && b.ligne === player.currentLane && mur === null && distance > b.distance) {
          const sien = b.distance
          b.distance = distance
          echangerAvec(sien, b.profil.nom)
        }
      } else if (devant === null) {
        // C'est nous qu'il vise
        if (subirSort(lance, b)) toast(`🪞 Renvoyé à ${b.profil.nom} !`)
      } else if (devant) {
        devant.subir(lance, time)
      }
    })

    // ————— 🔮 Le portail en vol —————
    if (portail) {
      const avant = portail.d
      portail.d += (speed + ONMYOJI_VITESSE) * dt

      // Un mur l'avale : c'est la piste qui borne sa portée, pas un chiffre
      const mur = track.premierMur(portail.lane, avant, portail.d)
      // Qui croise-t-il dans sa ligne cette image ? Bots (solo) ET rivaux (en
      // ligne) confondus — le PLUS PROCHE l'emporte. On teste le franchissement :
      // à ~83 m/s il parcourt ~1,4 m par image, un test de proximité le raterait.
      const botTouche = botsEnCourse()
        .filter((b) => b.ligne === portail!.lane && b.distance > avant && b.distance <= portail!.d)
        .sort((a, b) => a.distance - b.distance)[0]
      const rivalTouche = [...rivals.values()]
        .filter(
          (r) =>
            r.opp.currentLane === portail!.lane &&
            r.opp.distanceNow > avant &&
            r.opp.distanceNow <= portail!.d
        )
        .sort((a, b) => a.opp.distanceNow - b.opp.distanceNow)[0]

      const dMur = mur ?? Infinity
      const dBot = botTouche ? botTouche.distance : Infinity
      const dRival = rivalTouche ? rivalTouche.opp.distanceNow : Infinity

      if (dMur <= dBot && dMur <= dRival && dMur !== Infinity) {
        portail = null
        portailMesh.visible = false
        toast('🔮 Le portail se brise sur un mur…')
      } else if (botTouche && dBot <= dRival) {
        const sien = botTouche.distance
        botTouche.distance = distance
        portail = null
        portailMesh.visible = false
        echangerAvec(sien, botTouche.profil.nom, botTouche.mesh)
      } else if (rivalTouche) {
        // En ligne : on lui envoie NOTRE place, il prendra la sienne. Chacun
        // calcule l'échange de son côté — à 100 ms de ping, l'écart est de ~3 m.
        net.sendSpell('onmyoji', rivalTouche.id, distance)
        const sien = rivalTouche.opp.distanceNow
        portail = null
        portailMesh.visible = false
        echangerAvec(sien, rivalTouche.name, rivalTouche.opp.mesh)
      } else if (portail.d > COURSE_LENGTH) {
        // Aucun plafond de distance : sa portée est INFINIE. Seuls un rival ou
        // un mur l'arrêtent. Faute de quoi il finit par franchir le torii, et
        // il n'y a plus personne à échanger derrière.
        portail = null
        portailMesh.visible = false
      } else {
        portailMesh.visible = true
        portailMesh.position.set(LANES[portail.lane], 1.1, -(portail.d - distance))
      }
    }

    // Les projectiles filent vers leur victime, puis délivrent leur effet
    for (const p of projets) {
      if (!p.actif) continue
      const reste = p.fin - time
      if (reste > 0) {
        p.mesh.position.lerpVectors(p.de, p.a, 1 - reste / PROJET_VOL)
        if (STYLES_PROJET[p.kind]?.tournoie) p.mesh.rotation.x += dt * 26
        else p.mesh.lookAt(p.a) // l'aiguille reste pointée sur sa cible
        continue
      }
      // ————— L'arrivée : à chaque sort sa signature —————
      p.actif = false
      p.mesh.visible = false
      if (p.kind === 'kunai') {
        boom(p.a) // 💥 la lame éclate
      } else if (p.cible) {
        // ☠️ et ⛓️ marquent leur victime d'une aura, le temps de leur effet.
        // On retire le vol de la durée : l'aura doit s'éteindre AVEC le sort,
        // pas 0,28 s après — c'est une jauge, elle ne doit pas mentir.
        if (p.kind === 'senbon') poserAura(p.cible, AURA_SENBON, SENBON_DUREE - PROJET_VOL)
        // ⛓️ Le poids touche : les chaînes s'accrochent et retombent au sol
        else if (p.kind === 'kusarigama') poserChaines(p.cible, KUSARIGAMA_DUREE - PROJET_VOL)
      }
    }

    // Les auras collent à leur porteur et battent doucement jusqu'à l'extinction
    for (const a of auras) {
      if (!a.actif) continue
      const reste = a.fin - time
      if (reste <= 0) {
        a.actif = false
        a.mesh.visible = false
        continue
      }
      a.mesh.position.copy(a.cible.position).setY(0.85)
      const k = reste / a.duree // 1 → 0
      const battement = 1 + Math.sin(time * 9) * 0.05
      a.mesh.scale.setScalar(battement)
      // Franche à l'apparition, elle s'efface sur la fin : on voit le sort mourir
      ;(a.mesh.material as THREE.MeshBasicMaterial).opacity = 0.16 + Math.min(1, k * 2.2) * 0.16
    }

    // 🕊️ L'anneau de la Grue : il te ceint et MONTE AVEC TOI quand tu sautes
    const grueOn = time < grueFin
    grueAnneau.visible = grueOn
    if (grueOn) {
      const p = player.mesh.position
      grueAnneau.position.set(p.x, p.y + 0.2, p.z) // p.y : il suit le saut
      grueAnneau.rotation.z += dt * 1.6
      const k = (grueFin - time) / GRUE_DUREE
      ;(grueAnneau.material as THREE.MeshBasicMaterial).opacity =
        (0.5 + Math.sin(time * 7) * 0.14) * Math.min(1, k * 3)
    }

    // 🪞 La glace de la Parade, dressée derrière toi, reflet qui balaie
    const miroirOn = time < miroirFin
    miroirGroup.visible = miroirOn
    if (miroirOn) {
      const p = player.mesh.position
      miroirGroup.position.set(p.x, p.y + 1.25, p.z + 0.75)
      miroirTex.offset.x -= dt * 0.32 // le reflet glisse : c'est ça qui fait « miroir »
      const k = (miroirFin - time) / MIROIR_DUREE
      const fondu = Math.min(1, k * 4) // il s'efface quand la parade expire
      ;(miroirGlace.material as THREE.MeshBasicMaterial).opacity = 0.62 * fondu
      ;(miroirCadre.material as THREE.MeshBasicMaterial).opacity = 0.78 * fondu
    }

    // ⛓️ Les chaînes : accrochées à la hanche, elles retombent au sol derrière
    for (const c of chaines) {
      if (!c.actif) continue
      const reste = c.fin - time
      if (reste <= 0) {
        c.actif = false
        c.group.visible = false
        continue
      }
      const p = c.cible.position
      const sway = Math.sin(time * 4) * 0.12
      c.maillons.forEach((m, i) => {
        const t = i / (CHAINE_MAILLONS - 1) // 0 = la hanche, 1 = le sol
        // La chute est RAPIDE puis traîne : une chaîne pend, elle ne descend
        // pas en ligne droite. L'exposant fait toute la différence.
        m.position.set(
          p.x + sway * t,
          Math.max(0.07, (p.y + 0.85) * Math.pow(1 - t, 1.7) + 0.07),
          p.z + t * 1.9
        )
        m.rotation.z += dt * 0.8
      })
      const dernier = c.maillons[CHAINE_MAILLONS - 1].position
      c.boulet.position.set(dernier.x, 0.17, dernier.z + 0.22) // le poids, posé au sol
    }

    // 💨💥 Le rideau de vitesse : monte avec le martèlement du sprint final,
    // à fond sur un dash 🌀. C'est le même effet pour les deux accélérations.
    const dashing = time < ventFin
    let vitesseInten = 0
    if (sprinting) vitesseInten = 0.3 + 0.7 * sprintCharge
    if (dashing) vitesseInten = Math.max(vitesseInten, 0.9)
    speedEl.style.opacity = `${vitesseInten}`

    // 🌸💥💨 On ne fait plus naître de pétales passé les 2,5 premières secondes ;
    // ceux déjà en l'air finissent de tomber pendant que le cerisier s'éloigne.
    petalesActifs = time < 2.5
    updateEffets(dt, speed * dt)
    // 💨 Après que TOUT LE MONDE a bougé : qui vient de retomber au sol ?
    detecterAtterrissages()

    // 10 fois par seconde suffisent : à 60, on réécrirait le DOM pour rien
    rankTimer += dt
    if (rankTimer >= 0.1) {
      rankTimer = 0
      drawRank()
    }

    // 📜 Ramassage d'un rouleau — on découvre son contenu maintenant
    const trouve = track.ramasse(player.hitbox())
    if (trouve) {
      if (slots.length < SLOTS_MAX) {
        slots.push(trouve)
        revealSlot(slots.length - 1, trouve) // déroulé machine à sous
        toast(`📜 ${PARCHEMINS[trouve].icone} ${PARCHEMINS[trouve].nom}`)
      } else {
        // Les deux mains sont pleines : il faut en lancer un pour reprendre
        toast('✋ Mains pleines — lance un parchemin !')
      }
    }

    // Trébuchement : toucher un obstacle RALENTIT (on ne meurt pas, c'est une course)
    stumble = Math.max(0, stumble - dt)
    const touche = track.hits(player.hitbox())
    if (stumble <= 0 && touche) {
      if (armure > 0) {
        // 🛡️ L'armure avale le choc : on garde toute sa vitesse. Mais un mur
        // la met en pièces d'un coup, là où une barrière ne fait que l'entamer.
        const cout = touche === 'mur' ? ARMURE_COUT_MUR : ARMURE_COUT_PETIT
        armure = Math.max(0, armure - cout)
        stumble = 1.2
        armureEncaisse(armure === 0) // 🛡️ le dôme claque, ou vole en éclats
        toast(
          armure > 0
            ? '🛡️ L\'armure encaisse — une plaque saute'
            : '🛡️ L\'armure vole en éclats !'
        )
      } else {
        speed = Math.max(6, speed * player.grip)
        stumble = 1.2 // brève invincibilité le temps de se relever
        flash()
        boom(new THREE.Vector3(player.mesh.position.x, 0.9, player.mesh.position.z)) // 💥
        toast('💥 Trébuché !')
        // Le rival doit le voir TOUT DE SUITE : sa version de nous ralentit
        // immédiatement (au lieu que son extrapolation nous fasse dépasser à tort)
        if (online) net.sendAction({ t: 'stumble', keep: player.grip })
      }
    }
    // Le perso clignote tant qu'il se relève
    player.mesh.visible = stumble <= 0 || Math.floor(stumble * 12) % 2 === 0

    // 💨 la fumée aveugle, ☠️ le poison fait tanguer la scène
    fumeeEl.classList.toggle('show', time < fumigeneFin)
    canvas.classList.toggle('poison', time < senbonFin)

    // ⚡ Les deux éclairs de Sasuke : ils se TRACENT, puis se dissipent
    if (sparkBolts[0].visible) {
      const t = time - sparkT0
      if (t >= SPARK_TRACE + SPARK_DISSIP) {
        hideSpark()
      } else if (t < SPARK_TRACE) {
        // ————— Création : le plan de coupe file et le zigzag naît derrière lui
        const k = t / SPARK_TRACE // 0 → 1
        const balai = sparkDe + (sparkVers - sparkDe) * k
        if (sparkVers >= sparkDe) sparkPlane.set(SPARK_N_NEG, balai) // garde x < balai
        else sparkPlane.set(SPARK_N_POS, -balai) // garde x > balai
        for (const b of sparkBolts) {
          for (const c of b.children) {
            ;((c as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 1
          }
          b.scale.setScalar(b.userData.base as number)
        }
      } else {
        // ————— Dissipation : plus de coupe, il s'efface en s'étalant (flou)
        sparkPlane.set(SPARK_N_NEG, 1e6) // tout passe
        const k = (t - SPARK_TRACE) / SPARK_DISSIP // 0 → 1
        for (const b of sparkBolts) {
          const base = b.userData.base as number
          b.scale.setScalar(base * (1 + k * 0.45)) // il gonfle en se dissolvant
          const c0 = b.children[0] as THREE.Mesh
          const c1 = b.children[1] as THREE.Mesh
          // Le contour s'efface plus vite : le trait « perd ses bords », ça floute
          ;(c0.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - k * 1.6)
          ;(c1.material as THREE.MeshBasicMaterial).opacity = 1 - k
        }
      }
    }

    // 🔮 Les deux lueurs de l'échange : elles battent et s'éteignent en douceur
    const lueurOn = time < lueurFin
    lueurJoueur.visible = lueurOn
    lueurRival.visible = lueurOn && !!lueurCible
    if (lueurOn) {
      const reste = (lueurFin - time) / LUEUR_DUREE // 1 → 0
      const battement = (1 + Math.sin(time * 22) * 0.09) * (0.75 + reste * 0.45)
      for (const l of [lueurJoueur, lueurRival]) {
        ;(l.material as THREE.MeshBasicMaterial).opacity = 0.45 * reste
        l.scale.setScalar(battement)
      }
      lueurJoueur.position.set(player.mesh.position.x, 0.85, player.mesh.position.z)
      if (lueurCible) lueurRival.position.set(lueurCible.position.x, 0.85, lueurCible.position.z)
    }

    // Interface : chrono + progression
    scoreEl.textContent = `${time.toFixed(1)} s`
    progressEl.style.width = `${Math.min(100, (distance / COURSE_LENGTH) * 100)}%`

    // Interface du sprint : on annonce, puis la jauge suit le martèlement
    if (sprinting) {
      if (!sprintSeen) {
        sprintSeen = true
        sprintEl.classList.remove('hidden')
        toast('🔥 MARTÈLE L\'ÉCRAN !')
      }
      sprintFillEl.style.width = `${sprintCharge * 100}%`
    }

    // En ligne : on envoie notre position 20 fois par seconde
    if (online) {
      netTimer += dt
      if (netTimer >= 0.05) {
        netTimer = 0
        net.sendProgress({
          lane: player.currentLane,
          y: player.mesh.position.y,
          distance,
          sliding: player.isSliding,
        })
      }

      // L'écart vise le rival le plus proche (devant OU derrière) : c'est celui
      // qui compte, parmi les 9. Le classement en direct montre les autres.
      let proche: Rival | null = null
      let minEcart = Infinity
      for (const r of rivals.values()) {
        const diff = Math.abs(r.opp.distanceNow - distance)
        if (diff < minEcart) {
          minEcart = diff
          proche = r
        }
      }
      if (proche) {
        const lead = proche.opp.distanceNow - distance
        // textContent, pas innerHTML : le pseudo vient d'un autre joueur
        gapEl.textContent = `${proche.name} ${lead >= 0 ? '+' : '−'}${Math.abs(lead).toFixed(0)} m`
        gapEl.classList.toggle('ahead', lead >= 0)
      }
    } else {
      // Solo : écart par rapport au robot le plus proche
      let closestBot: Bot | null = null
      let minDiff = Infinity
      for (const b of botsEnCourse()) {
        const diff = b.distance - distance
        if (Math.abs(diff) < minDiff) {
          minDiff = Math.abs(diff)
          closestBot = b
        }
      }
      if (closestBot) {
        const lead = closestBot.distance - distance
        gapEl.textContent = `${closestBot.profil.nom} ${lead >= 0 ? '+' : '−'}${Math.abs(lead).toFixed(0)} m`
        gapEl.classList.toggle('ahead', lead >= 0)
      }
    }

    // ⛩️ Ligne d'arrivée !
    if (distance >= COURSE_LENGTH) crossFinishLine()
  } else {
    // Au menu / en attente / après l'arrivée : le décor défile doucement
    track.update(dt, state === 'fini' ? 3 : 5)
    player.update(dt)
    if (state === 'fini' && online) for (const r of rivals.values()) r.opp.update(dt, distance)
    speedEl.style.opacity = '0' // pas de rideau de vitesse hors course
  }

  // La caméra suit en douceur la ligne du joueur
  camera.position.x += (player.mesh.position.x * 0.55 - camera.position.x) * Math.min(1, dt * 5)

  // ————— Les étiquettes de nom, au-dessus des têtes —————
  // Après le déplacement des persos ET de la caméra, sinon elles auraient une
  // image de retard. Au menu, on les cache : le décor tourne à vide derrière.
  const racing = state === 'depart' || state === 'course' || state === 'fini'
  // player.mesh.visible clignote quand on se relève d'un trébuchement :
  // l'étiquette clignote avec lui, c'est le même personnage.
  player.tag.follow(player.mesh, camera, racing && player.mesh.visible)
  for (const r of rivals.values()) {
    r.opp.tag.follow(r.opp.mesh, camera, racing && r.opp.active && r.opp.mesh.visible)
  }

  renderer.render(scene, camera)
  menu.update(dt) // l'aperçu 3D du guerrier, quand le menu de sélection est ouvert
}

// ————— Adaptation à la taille de l'écran —————
function resize() {
  renderer.setSize(innerWidth, innerHeight)
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
}
addEventListener('resize', resize)
resize()

// ————— Le banc d'essai des sorts (développement uniquement) —————
// Les slots sont internes au module : sans ce petit guichet, aucune page de
// test ne peut mettre un parchemin précis dans la main du joueur.
//
// Vite remplace `import.meta.env.DEV` par `false` au build : tout ce bloc — le
// guichet compris — disparaît du bundle de production. Impossible de s'en
// servir pour tricher dans une vraie partie.
if (import.meta.env.DEV) {
  ;(window as unknown as { __sorts?: unknown }).__sorts = {
    /** Met `kind` en main, à la place de ce qu'on tenait. */
    donner(kind: ParcheminKind) {
      slots = [kind]
      drawSlots()
    },
    /** Le lance tout de suite — comme la touche E. */
    lancer() {
      lancerParchemin()
    },
  }
}

tick()
