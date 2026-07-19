/**
 * ————— Le banc d'essai du CATALOGUE —————
 *
 * Tout ce que le jeu sait fabriquer, posé côte à côte sur une planche.
 *
 * Les trois autres bancs répondent à « comment ça bouge » (animations), « qu'est-ce
 * que ça fait » (sorts) et « comment ça sonne » (bruitages). Celui-ci répond à la
 * question qui restait : « qu'est-ce qui existe, au juste ? »
 *
 * Ce n'était pas une question théorique. Les habillages de biome font qu'un même
 * obstacle a quatre apparences, et rien ne permettait de les voir ensemble — il
 * fallait courir 1 920 m en regardant défiler. Une planche de contact les met
 * côte à côte, et les écarts sautent aux yeux.
 *
 * ⚠️ Cette page ne fabrique AUCUN maillage elle-même. Elle appelle les fabriques
 * du jeu (track.ts, biomes.ts, roster.ts). C'est toute la règle : une planche qui
 * redessinerait ses propres objets finirait par montrer autre chose que le jeu,
 * et mentirait d'autant plus qu'on lui ferait confiance.
 */
import * as THREE from 'three'
import {
  TAILLE_OBSTACLE,
  PLATEFORME_H,
  PLATEFORME_LARG,
  makeObstacleMesh,
  makeJarreMesh,
  makeRouleauMesh,
  makeMurMesh,
  makePlateformeMesh,
  makeTorii,
  makeFinishGate,
  mulberry32,
  type Kind,
} from './track'
import { BIOMES } from './biomes'
import { ROSTER, buildFighter, customFighter, SKIN_PALETTE, HEADS } from './roster'
import { PROFILS } from './bot'

// ————————————————————————————————————————————————————————————————
//  La scène
// ————————————————————————————————————————————————————————————————

const canvas = document.getElementById('vue') as HTMLCanvasElement
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.setPixelRatio(Math.min(2, devicePixelRatio))

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x151a2c)

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400)

// Un éclairage NEUTRE, volontairement différent de celui du jeu : ici on vient
// juger des formes et des couleurs de matériau, pas une ambiance. La brume et
// la nuit du jeu masqueraient précisément ce qu'on vient regarder.
scene.add(new THREE.HemisphereLight(0xffffff, 0x404860, 2.1))
const key = new THREE.DirectionalLight(0xffffff, 1.5)
key.position.set(4, 9, 6)
scene.add(key)
const fill = new THREE.DirectionalLight(0x9fc4ff, 0.5)
fill.position.set(-6, 3, -4)
scene.add(fill)

/** Le damier : sans repère au sol, on ne voit pas qu'un objet flotte. */
const sol = new THREE.GridHelper(120, 120, 0x3d4560, 0x272d3f)
;(sol.material as THREE.Material).transparent = true
;(sol.material as THREE.Material).opacity = 0.5
scene.add(sol)

/** Tout ce qui appartient à la planche courante — vidé à chaque changement. */
const planche = new THREE.Group()
scene.add(planche)

// ————————————————————————————————————————————————————————————————
//  Les étiquettes : du HTML projeté, pas du texte 3D
// ————————————————————————————————————————————————————————————————

/*
 * Du texte en 3D coûterait une géométrie par étiquette et resterait illisible de
 * biais. On projette donc des <div> aux coordonnées écran de chaque objet —
 * c'est ce que fait déjà nametag.ts pour les pseudos en course.
 */
interface Etiquette {
  el: HTMLElement
  ancre: THREE.Vector3
}
const etiquettes: Etiquette[] = []
const couche = document.getElementById('etiquettes')!

function poserEtiquette(x: number, z: number, titre: string, detail: string) {
  const el = document.createElement('div')
  el.className = 'etiq3d'
  const b = document.createElement('b')
  b.textContent = titre
  const s = document.createElement('small')
  s.textContent = detail
  el.append(b, s)
  couche.append(el)
  etiquettes.push({ el, ancre: new THREE.Vector3(x, 0, z) })
}

function viderEtiquettes() {
  for (const e of etiquettes) e.el.remove()
  etiquettes.length = 0
}

// ————————————————————————————————————————————————————————————————
//  Le nettoyage
// ————————————————————————————————————————————————————————————————

/*
 * On change de planche des dizaines de fois par session, et chaque objet du jeu
 * fabrique ses PROPRES géométries et matériaux (c'est voulu : un matériau
 * partagé teinterait d'un coup tous les murs à l'écran, cf. makeMurMesh). Sans
 * libération explicite, la mémoire GPU monterait sans jamais redescendre — le
 * ramasse-miettes de JavaScript ne sait rien des ressources WebGL.
 */
function libere(o: THREE.Object3D) {
  o.traverse((n) => {
    const m = n as THREE.Mesh
    if (m.geometry) m.geometry.dispose()
    const mat = m.material
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose())
    else if (mat) (mat as THREE.Material).dispose()
  })
}

function viderPlanche() {
  for (const enfant of [...planche.children]) {
    planche.remove(enfant)
    libere(enfant)
  }
  viderEtiquettes()
}

// ————————————————————————————————————————————————————————————————
//  Le catalogue
// ————————————————————————————————————————————————————————————————

/** Une pièce du catalogue : ce qu'on pose, et ce qu'on en dit. */
interface Piece {
  titre: string
  detail: string
  faire: () => THREE.Object3D
}

interface Rayon {
  nom: string
  /** Le rayon change-t-il d'un biome à l'autre ? */
  parBiome: boolean
  pieces: (biome: number) => Piece[]
}

/** Un tirage à graine FIXE : la planche doit être identique d'une visite à l'autre. */
const rng = () => mulberry32(0x5eed)

const KINDS: Kind[] = ['saut', 'glissade', 'mur']

const RAYONS: Rayon[] = [
  {
    nom: 'Obstacles',
    parBiome: true,
    pieces: (b) => {
      const biome = BIOMES[b]
      return KINDS.map((k) => {
        const t = TAILLE_OBSTACLE[k]
        return {
          titre: k,
          // La cote de collision, pas celle du maillage : c'est elle qui joue.
          detail: `${t.larg} × ${t.haut} × ${t.prof} m`,
          faire: () => biome.fabriqueObstacle?.(k, rng()) ?? makeObstacleMesh(k),
        }
      })
    },
  },
  {
    nom: 'Ramassages',
    parBiome: false,
    pieces: () => [
      { titre: 'jarre vide', detail: 'élan + un maillon', faire: () => makeJarreMesh('vide') },
      { titre: 'jarre dorée', detail: 'cache un parchemin', faire: () => makeJarreMesh('doree') },
      { titre: 'pot vert', detail: '1–10 Mon, ou 1–6 Jade', faire: () => makeJarreMesh('verte') },
      { titre: 'rouleau', detail: 'le même pour les 10 sorts', faire: () => makeRouleauMesh() },
    ],
  },
  {
    nom: 'Structures',
    parBiome: true,
    pieces: (b) => {
      const biome = BIOMES[b]
      return [
        {
          titre: 'pan de mur',
          detail: 'on s\'y accroche — liseré vermillon',
          faire: () => {
            // `makeMurMesh` prend le biome : sa matière en dépend. On le lui
            // passe plutôt que de repeindre après coup.
            const m = makeMurMesh(b)
            // Le mur est bâti sur 1 m et étiré au spawn : sans ça, on jugerait
            // une tranche de 1 m alors qu'ils font 18 à 30 m en piste.
            m.scale.z = 14
            return m
          },
        },
        {
          titre: 'plateforme',
          detail: `${PLATEFORME_H} m — trop haut pour un saut`,
          faire: () => {
            // La largeur n'est passée qu'à la fabrique du BIOME : biomes.ts ne
            // peut pas importer de valeur depuis track.ts sans créer un cycle.
            // Le repli, lui, vit dans track.ts et lit PLATEFORME_LARG tout seul.
            const p =
              biome.fabriquePlateforme?.(PLATEFORME_H, PLATEFORME_LARG) ??
              makePlateformeMesh(PLATEFORME_H)
            p.scale.z = 12
            return p
          },
        },
        { titre: 'torii', detail: 'décor, aucune collision', faire: () => makeTorii() },
        { titre: 'torii sacré', detail: 'la ligne d\'arrivée', faire: () => makeFinishGate() },
      ]
    },
  },
  {
    nom: 'Décor',
    parBiome: true,
    pieces: (b) => {
      const biome = BIOMES[b]
      // Le décor est TIRÉ AU HASARD à chaque appel : une seule pièce ne dirait
      // rien de la variété. On en montre huit, avec des graines différentes.
      return Array.from({ length: 8 }, (_, i) => ({
        titre: `bordure ${i + 1}`,
        detail: `tous les ${biome.ecartDecor} m`,
        faire: () => biome.fabriqueDecor(mulberry32(0x5eed + i * 977)),
      }))
    },
  },
  {
    nom: 'Guerriers',
    parBiome: false,
    pieces: () =>
      ROSTER.map((f) => ({
        titre: f.name,
        detail: f.pickable ? f.role : `${f.role} — non jouable`,
        faire: () => groupeDe(buildFighter(f)),
      })),
  },
  {
    nom: 'Skins perso',
    parBiome: false,
    pieces: () => {
      // Les trois ornements × quelques couleurs : de quoi voir que le vestiaire
      // produit bien trois silhouettes distinctes et non un seul corps recoloré.
      const out: Piece[] = []
      for (const head of HEADS) {
        for (let i = 0; i < 4; i++) {
          const body = SKIN_PALETTE[(i * 5) % SKIN_PALETTE.length]
          const band = SKIN_PALETTE[(i * 5 + 7) % SKIN_PALETTE.length]
          out.push({
            titre: head,
            detail: `#${body.toString(16).padStart(6, '0')}`,
            faire: () => groupeDe(buildFighter(customFighter({ body, band, head }))),
          })
        }
      }
      return out
    },
  },
  {
    nom: 'Bots',
    parBiome: false,
    pieces: () =>
      PROFILS.map((p) => ({
        titre: p.nom,
        detail: `allure ×${p.facteur} · adresse ${Math.round(p.adresse * 100)} %`,
        // Le bot n'a pas de fabrique publique : son corps est bâti dans son
        // constructeur, qui exige une scène. On refait donc ici les deux formes
        // que Bot pose — c'est la seule entorse à la règle « ne rien redessiner »,
        // et elle est signalée pour qu'on la corrige si le bot change de look.
        faire: () => {
          const g = new THREE.Group()
          const corps = new THREE.Mesh(
            new THREE.CapsuleGeometry(0.28, 0.72, 4, 12),
            new THREE.MeshStandardMaterial({ color: p.corps, roughness: 0.55 })
          )
          corps.position.y = 0.64
          const bandeau = new THREE.Mesh(
            new THREE.TorusGeometry(0.27, 0.05, 8, 16),
            new THREE.MeshStandardMaterial({ color: p.bandeau })
          )
          bandeau.position.y = 1.12
          bandeau.rotation.x = Math.PI / 2
          g.add(corps, bandeau)
          return g
        },
      })),
  },
]

/** buildFighter rend un TABLEAU de pièces : on les réunit sous un seul objet. */
function groupeDe(pieces: THREE.Object3D[]): THREE.Group {
  const g = new THREE.Group()
  g.add(...pieces)
  return g
}

// ————————————————————————————————————————————————————————————————
//  Le montage de la planche
// ————————————————————————————————————————————————————————————————

let rayon = 0
let biome = 0

/** L'écart entre deux pièces. Large : les décors sont volumineux. */
const PAS = 7

function monter() {
  viderPlanche()
  const r = RAYONS[rayon]
  const pieces = r.pieces(biome)

  // Une grille aussi carrée que possible : sur un rayon de 12 pièces, une seule
  // rangée obligerait à dézoomer au point de ne plus rien distinguer.
  const colonnes = Math.ceil(Math.sqrt(pieces.length))
  const rangees = Math.ceil(pieces.length / colonnes)

  pieces.forEach((p, i) => {
    const cx = (i % colonnes) - (colonnes - 1) / 2
    const cz = Math.floor(i / colonnes) - (rangees - 1) / 2
    const x = cx * PAS
    const z = cz * PAS

    let objet: THREE.Object3D
    try {
      objet = p.faire()
    } catch (e) {
      // Une fabrique qui casse ne doit pas emporter toute la planche : on pose
      // un cube rouge à sa place, et on dit lequel dans la console.
      console.error(`[catalogue] ${r.nom} / ${p.titre} :`, e)
      objet = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({ color: 0xe24b3a })
      )
      objet.position.y = 0.5
    }
    objet.position.x += x
    objet.position.z += z
    planche.add(objet)
    poserEtiquette(x, z, p.titre, p.detail)
  })

  majPanneaux(pieces.length)
}

// ————————————————————————————————————————————————————————————————
//  Les panneaux
// ————————————————————————————————————————————————————————————————

const listeRayons = document.getElementById('rayons')!
const listeBiomes = document.getElementById('biomes')!
const compteur = document.getElementById('compteur')!

function construirePanneaux() {
  RAYONS.forEach((r, i) => {
    const l = document.createElement('div')
    l.className = 'ligne'
    l.textContent = r.nom
    l.addEventListener('click', () => {
      rayon = i
      monter()
    })
    listeRayons.append(l)
  })

  BIOMES.forEach((b, i) => {
    const l = document.createElement('div')
    l.className = 'ligne'
    l.textContent = `${b.kanji} ${b.nom}`
    l.addEventListener('click', () => {
      biome = i
      monter()
    })
    listeBiomes.append(l)
  })
}

function majPanneaux(n: number) {
  const r = RAYONS[rayon]
  listeRayons.querySelectorAll('.ligne').forEach((l, i) => {
    l.classList.toggle('on', i === rayon)
  })
  // Le panneau des biomes s'éteint sur un rayon qui n'en dépend pas : le laisser
  // actif ferait croire qu'appuyer sur p/m change quelque chose.
  listeBiomes.classList.toggle('inerte', !r.parBiome)
  listeBiomes.querySelectorAll('.ligne').forEach((l, i) => {
    l.classList.toggle('on', r.parBiome && i === biome)
  })
  compteur.textContent = `${n} pièce${n > 1 ? 's' : ''}`
}

// ————————————————————————————————————————————————————————————————
//  La caméra : on tourne autour de la planche
// ————————————————————————————————————————————————————————————————

let angle = 0.6
let hauteur = 0.55 // 0 = à ras du sol, 1 = à la verticale
let recul = 26

addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase()
  if (k === 'o') rayon = (rayon + RAYONS.length - 1) % RAYONS.length
  else if (k === 'i') rayon = (rayon + 1) % RAYONS.length
  else if (k === 'p') biome = (biome + BIOMES.length - 1) % BIOMES.length
  else if (k === 'm') biome = (biome + 1) % BIOMES.length
  else if (k === 'j') return void (angle -= 0.12)
  else if (k === 'k') return void (angle += 0.12)
  else if (k === 'g') return void (recul = Math.max(6, recul - 2))
  else if (k === 'b') return void (recul = Math.min(90, recul + 2))
  else return
  monter()
})

// Glisser à la souris ou au doigt : c'est le geste qu'on essaie d'instinct
let saisi = false
let dernierX = 0
let dernierY = 0
canvas.addEventListener('pointerdown', (e) => {
  saisi = true
  dernierX = e.clientX
  dernierY = e.clientY
  canvas.setPointerCapture(e.pointerId)
})
canvas.addEventListener('pointerup', () => (saisi = false))
canvas.addEventListener('pointermove', (e) => {
  if (!saisi) return
  angle -= (e.clientX - dernierX) * 0.006
  hauteur = Math.min(0.98, Math.max(0.06, hauteur + (e.clientY - dernierY) * 0.004))
  dernierX = e.clientX
  dernierY = e.clientY
})
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault()
    recul = Math.min(90, Math.max(6, recul + Math.sign(e.deltaY) * 2))
  },
  { passive: false }
)

// ————————————————————————————————————————————————————————————————
//  La boucle
// ————————————————————————————————————————————————————————————————

const cible = new THREE.Vector3(0, 1, 0)
const proj = new THREE.Vector3()

function redimensionner() {
  const l = innerWidth
  const h = innerHeight
  renderer.setSize(l, h, false)
  camera.aspect = l / h
  camera.updateProjectionMatrix()
}
addEventListener('resize', redimensionner)

function boucle() {
  requestAnimationFrame(boucle)

  const y = Math.sin(hauteur * Math.PI * 0.5)
  const plat = Math.cos(hauteur * Math.PI * 0.5)
  camera.position.set(
    Math.sin(angle) * recul * plat,
    y * recul + 1,
    Math.cos(angle) * recul * plat
  )
  camera.lookAt(cible)

  renderer.render(scene, camera)

  // Les étiquettes suivent leur pièce. On les cache derrière la caméra, sinon
  // elles réapparaissent en miroir de l'autre côté de l'écran.
  for (const e of etiquettes) {
    proj.copy(e.ancre).project(camera)
    const devant = proj.z < 1
    e.el.style.display = devant ? 'block' : 'none'
    if (!devant) continue
    e.el.style.left = `${((proj.x + 1) / 2) * innerWidth}px`
    e.el.style.top = `${((-proj.y + 1) / 2) * innerHeight}px`
  }
}

construirePanneaux()
redimensionner()
monter()
boucle()

/*
 * La planche, ouverte à l'inspection depuis la console.
 *
 * Aucun garde `import.meta.env.DEV` ici, contrairement au guichet des sorts de
 * main.ts : celui-là s'ouvrait dans le JEU, où il aurait servi à tricher en
 * ligne. Cette page-ci n'est jamais construite (Vite ne bâtit qu'index.html),
 * elle n'existe donc qu'en développement de toute façon.
 */
;(window as unknown as { __catalogue?: unknown }).__catalogue = {
  scene,
  planche,
  camera,
  /** Combien de maillages RÉELS porte la planche courante, tout compris. */
  compter() {
    let n = 0
    planche.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) n++
    })
    return n
  },
}
