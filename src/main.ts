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
      r = { opp: libre, id: p.id, name: '', rank: 0, finished: false }
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
 * ————— 🎯 Le kunai en vol —————
 * Un simple rectangle : ici tout est encore en boîtes, Yasuke le premier.
 *
 * Il est PUREMENT décoratif. Le sort a déjà frappé quand la lame part : sa
 * durée de vol ne doit rien coûter à personne, sinon on toucherait au 0,53 s
 * calibré du Kunai. C'est un traceur, pas un projectile.
 *
 * Sans lui, le Kunai était le seul sabotage qu'on encaissait sans jamais RIEN
 * voir — juste un toast et une vitesse qui s'effondre.
 */
const KUNAI_VOL = 0.28 // secondes de vol, quelle que soit la distance
const kunaiMesh = new THREE.Mesh(
  new THREE.BoxGeometry(0.16, 0.16, 1),
  new THREE.MeshStandardMaterial({ color: 0xd8dfec, emissive: 0xe24b3a, emissiveIntensity: 0.35 })
)
kunaiMesh.visible = false
scene.add(kunaiMesh)

/** Le vol en cours, ou null. Un seul maillage : il n'y en a jamais deux. */
let kunaiVol: { fin: number; de: THREE.Vector3; a: THREE.Vector3 } | null = null

function lancerKunaiVisuel(de: THREE.Vector3, a: THREE.Vector3) {
  // On part de positions AU SOL : on relève la lame à hauteur de poitrine une
  // bonne fois, ici, plutôt qu'à chaque image — sinon la 1re s'affiche dans
  // les pieds, le temps que la boucle corrige.
  const poitrine = new THREE.Vector3(0, 0.6, 0)
  kunaiVol = { fin: time + KUNAI_VOL, de: de.clone().add(poitrine), a: a.clone().add(poitrine) }
  kunaiMesh.position.copy(kunaiVol.de)
  kunaiMesh.visible = true
}

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

  if (kind === 'kusarigama') {
    kusarigamaFin = time + KUSARIGAMA_DUREE
    toast('⛓️ Kusarigama ! Tu es entravé…')
  } else if (kind === 'kunai') {
    // La lame arrive du lanceur : le bot qui l'a jetée, le rival en ligne, ou
    // la brume si on ne sait pas d'où. Avant le test d'armure : on doit voir
    // le kunai même quand il éclate dessus.
    const lanceur = deBot?.mesh.position ?? srcMesh?.position ?? null
    lancerKunaiVisuel(lanceur ?? new THREE.Vector3(player.mesh.position.x, 1.2, -22), player.mesh.position)

    // Le seul sort qui fait trébucher sec. L'armure peut encore l'avaler.
    if (armure > 0) {
      armure = Math.max(0, armure - ARMURE_COUT_PETIT)
      toast('🛡️ Le kunai éclate sur l\'armure !')
      return false
    }
    speed = Math.max(6, speed * 0.35)
    stumble = 1.2
    toast('🎯 Kunai en pleine course !')
  } else if (kind === 'fumigene') {
    fumigeneFin = time + FUMIGENE_DUREE
    toast('💨 Tu ne vois plus rien !')
  } else if (kind === 'senbon') {
    senbonFin = time + SENBON_DUREE
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
  if (kind === 'vent') ventFin = time + VENT_DUREE
  else if (kind === 'grue') grueFin = time + GRUE_DUREE
  else if (kind === 'armure') armure = ARMURE_SOLIDITE
  else if (kind === 'miroir') miroirFin = time + MIROIR_DUREE
  else if (kind === 'the') {
    // 🍵 Le thé lave TOUT d'un coup — y compris ce qu'on vient d'encaisser
    kusarigamaFin = 0
    fumigeneFin = 0
    senbonFin = 0
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
      if (kind === 'kunai') lancerKunaiVisuel(player.mesh.position, cible.opp.mesh.position)
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
    if (kind === 'kunai') lancerKunaiVisuel(player.mesh.position, cible.mesh.position)

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
  kunaiVol = null
  kunaiMesh.visible = false
  oppmarkEl.classList.add('hidden')
  rankEl.classList.add('hidden')
  gapEl.classList.add('hidden')
  countEl.classList.remove('show')
  sprintEl.classList.add('hidden')
  menu.showTitle(banner)
}

/** Lance une course. En ligne, la graine vient du serveur : même piste pour les deux ! */
function startRace(seed: number) {
  // En duel : la grille de départ du serveur. En solo : au centre.
  player.reset(online ? net.myStartLane : 1)
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
  kunaiVol = null
  kunaiMesh.visible = false
  lueurFin = 0
  lueurCible = null
  lueurJoueur.visible = false
  lueurRival.visible = false
  fumeeEl.classList.remove('show')
  canvas.classList.remove('poison')
  drawSlots()

  // Les rivaux : uniquement en entraînement (en ligne, l'adversaire est réel).
  // Ils lisent le MÊME plan d'obstacles et de rouleaux que le joueur.
  const rangees = construireRangees(track.obstaclesPrevus())
  const rouleaux = track.parcheminsPrevus()
  bots.forEach((b, i) => {
    b.actif = !online && i < nbBots
    // Graine dérivée : chaque rival tire ses fautes ailleurs dans la suite,
    // sinon les 4 rateraient exactement les mêmes obstacles au même endroit.
    b.reset(rangees, rouleaux, (seed ^ ((i + 1) * 0x9e3779b1)) | 0)
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
    player.moveLeft()
    if (online) net.sendAction({ t: 'lane', lane: player.currentLane })
  },
  right: () => {
    if (state !== 'course') return
    player.moveRight()
    if (online) net.sendAction({ t: 'lane', lane: player.currentLane })
  },
  jump: () => {
    if (state !== 'course') return
    const v = player.jump(time < grueFin)
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

    // 🎯 Le kunai file vers sa victime en tournoyant, puis s'évanouit
    if (kunaiVol) {
      const reste = kunaiVol.fin - time
      if (reste <= 0) {
        kunaiVol = null
        kunaiMesh.visible = false
      } else {
        kunaiMesh.position.lerpVectors(kunaiVol.de, kunaiVol.a, 1 - reste / KUNAI_VOL)
        kunaiMesh.rotation.x += dt * 26 // il tournoie bout par-dessus bout
      }
    }

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
        toast(
          armure > 0
            ? '🛡️ L\'armure encaisse — une plaque saute'
            : '🛡️ L\'armure vole en éclats !'
        )
      } else {
        speed = Math.max(6, speed * player.grip)
        stumble = 1.2 // brève invincibilité le temps de se relever
        flash()
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

tick()
