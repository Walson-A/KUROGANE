import * as THREE from 'three'
import { LANES } from './player'

/** Les 3 familles d'obstacles : comment les franchir */
type Kind = 'saut' | 'glissade' | 'mur'

const LOOKAHEAD = 85 // les obstacles apparaissent 85 m devant (cachés par la brume)
const DESPAWN_Z = 8 // et disparaissent derrière la caméra

interface Obstacle {
  mesh: THREE.Mesh
  kind: Kind
  active: boolean
}

/** Un obstacle prévu sur la piste : à quelle distance, quelle ligne, quel type */
interface PlannedObstacle {
  d: number
  lane: number
  kind: Kind
}

/**
 * Générateur de nombres pseudo-aléatoires AVEC GRAINE (algorithme mulberry32).
 * Même graine → même suite de nombres → même piste pour les deux joueurs.
 * C'est LA clé du multijoueur équitable !
 */
export function mulberry32(seed: number) {
  return function () {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * La piste : le sol, les pointillés qui défilent (sensation de vitesse),
 * les torii décoratifs, la ligne d'arrivée et surtout les obstacles.
 */
export class Track {
  private scene: THREE.Scene
  private obstacles: Obstacle[] = []
  private stripes: THREE.Mesh[] = []
  private toriis: THREE.Group[] = []
  private finish: THREE.Group // la ligne d'arrivée : le torii sacré
  private plan: PlannedObstacle[] = [] // tous les obstacles de la course, décidés à l'avance
  private planIdx = 0 // le prochain obstacle à faire apparaître
  private courseLength = 0

  constructor(scene: THREE.Scene) {
    this.scene = scene

    // Le sol
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(14, 240),
      new THREE.MeshStandardMaterial({ color: 0x272d3f, roughness: 1 })
    )
    ground.rotation.x = -Math.PI / 2
    ground.position.z = -90
    scene.add(ground)

    // Pointillés entre les lignes → sensation de vitesse
    const stripeMat = new THREE.MeshBasicMaterial({ color: 0x3d4560 })
    for (let i = 0; i < 30; i++) {
      for (const x of [-1.1, 1.1]) {
        const s = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 1.6), stripeMat)
        s.rotation.x = -Math.PI / 2
        s.position.set(x, 0.01, -i * 6)
        this.stripes.push(s)
        scene.add(s)
      }
    }

    // Des torii rouges enjambent la piste (décor, pas de collision)
    for (let i = 0; i < 3; i++) {
      const t = makeTorii()
      t.position.z = -40 - i * 70
      this.toriis.push(t)
      scene.add(t)
    }

    // Le torii SACRÉ : la ligne d'arrivée, tout en or
    this.finish = makeFinishGate()
    this.finish.position.z = -99999 // caché tant que la course n'a pas commencé
    scene.add(this.finish)
  }

  /**
   * Prépare une nouvelle course de `length` mètres à partir d'une graine.
   * En multi, la graine vient du serveur : les deux joueurs ont LA MÊME piste.
   */
  reset(length: number, seed: number) {
    for (const o of this.obstacles) {
      o.active = false
      o.mesh.visible = false
    }
    this.courseLength = length
    this.finish.position.z = -length
    this.plan = buildPlan(length, seed)
    this.planIdx = 0
  }

  /**
   * Fait défiler le décor. `distance` = mètres parcourus par le joueur
   * (omise au menu : décor seul, pas d'obstacles ni d'arrivée).
   */
  update(dt: number, speed: number, distance = -1) {
    const dz = speed * dt // tout le décor avance de dz vers le joueur

    for (const s of this.stripes) {
      s.position.z += dz
      if (s.position.z > 6) s.position.z -= 180
    }

    for (const t of this.toriis) {
      t.position.z += dz
      if (t.position.z > 12) t.position.z -= 210
    }

    for (const o of this.obstacles) {
      if (!o.active) continue
      o.mesh.position.z += dz
      if (o.mesh.position.z > DESPAWN_Z) {
        o.active = false
        o.mesh.visible = false
      }
    }

    if (distance >= 0) {
      // La ligne d'arrivée est TOUJOURS placée d'après la distance parcourue :
      // impossible qu'elle se désynchronise.
      this.finish.position.z = -(this.courseLength - distance)

      // Fait apparaître les obstacles prévus qui entrent dans notre champ de vision
      while (
        this.planIdx < this.plan.length &&
        this.plan[this.planIdx].d <= distance + LOOKAHEAD
      ) {
        const p = this.plan[this.planIdx]
        this.spawn(p.kind, p.lane, -(p.d - distance))
        this.planIdx++
      }
    }
  }

  private spawn(kind: Kind, lane: number, z: number) {
    // On réutilise un obstacle éteint du même type si possible (recyclage)
    let o = this.obstacles.find((o) => !o.active && o.kind === kind)
    if (!o) {
      o = { mesh: makeObstacleMesh(kind), kind, active: false }
      this.obstacles.push(o)
      this.scene.add(o.mesh)
    }
    o.mesh.position.x = LANES[lane]
    o.mesh.position.z = z
    o.mesh.visible = true
    o.active = true
  }

  /** Est-ce que le joueur touche un obstacle ? */
  hits(playerBox: THREE.Box3): boolean {
    const box = new THREE.Box3()
    for (const o of this.obstacles) {
      if (!o.active) continue
      if (Math.abs(o.mesh.position.z) > 2.5) continue // trop loin, on ne teste pas
      box.setFromObject(o.mesh)
      box.expandByScalar(-0.12) // un peu de tolérance, plus sympa à jouer
      if (box.intersectsBox(playerBox)) return true
    }
    return false
  }
}

/**
 * Décide de TOUS les obstacles de la course à l'avance, à partir de la graine.
 * 1 ou 2 obstacles par rangée, jamais 3 : il y a toujours un passage !
 * Les 60 derniers mètres sont dégagés : sprint final.
 */
function buildPlan(length: number, seed: number): PlannedObstacle[] {
  const rng = mulberry32(seed)
  const kinds: Kind[] = ['saut', 'glissade', 'mur']
  const plan: PlannedObstacle[] = []

  let d = 45 // premiers mètres tranquilles pour se chauffer
  while (d < length - 60) {
    const lanes = [0, 1, 2].sort(() => rng() - 0.5)
    const count = rng() < 0.6 ? 1 : 2
    for (let i = 0; i < count; i++) {
      plan.push({ d, lane: lanes[i], kind: kinds[Math.floor(rng() * kinds.length)] })
    }
    d += 10 + rng() * 7
  }
  return plan
}

/** Fabrique le visuel d'un obstacle selon son type */
function makeObstacleMesh(kind: Kind): THREE.Mesh {
  let geo: THREE.BoxGeometry
  let color: number
  let y: number

  if (kind === 'saut') {
    // Barrière basse → il faut sauter
    geo = new THREE.BoxGeometry(1.7, 0.6, 0.5)
    color = 0xc33a2c
    y = 0.3
  } else if (kind === 'glissade') {
    // Barre en hauteur → il faut glisser dessous
    geo = new THREE.BoxGeometry(1.7, 0.5, 0.5)
    color = 0xd6ac5a
    y = 1.55
  } else {
    // Mur complet → il faut changer de ligne
    geo = new THREE.BoxGeometry(1.7, 2.4, 0.5)
    color = 0x3a4258
    y = 1.2
  }

  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ color, roughness: 0.7 })
  )
  mesh.position.y = y
  return mesh
}

/** Le torii sacré de l'arrivée : plus grand, tout en OR, avec la ligne au sol */
function makeFinishGate(): THREE.Group {
  const g = new THREE.Group()
  const gold = new THREE.MeshStandardMaterial({
    color: 0xd6ac5a,
    roughness: 0.35,
    emissive: 0x5a4310, // il brille légèrement dans la nuit
  })

  for (const x of [-4, 4]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.6, 5.6, 0.6), gold)
    pillar.position.set(x, 2.8, 0)
    g.add(pillar)
  }
  const top = new THREE.Mesh(new THREE.BoxGeometry(10.4, 0.65, 0.9), gold)
  top.position.y = 5.8
  const mid = new THREE.Mesh(new THREE.BoxGeometry(8.6, 0.45, 0.7), gold)
  mid.position.y = 4.7
  g.add(top, mid)

  // La ligne d'arrivée peinte au sol
  const line = new THREE.Mesh(
    new THREE.PlaneGeometry(7.4, 1.2),
    new THREE.MeshBasicMaterial({ color: 0xd6ac5a })
  )
  line.rotation.x = -Math.PI / 2
  line.position.y = 0.02
  g.add(line)

  return g
}

/** Un torii : deux piliers + deux linteaux, tout en rouge vermillon */
function makeTorii(): THREE.Group {
  const g = new THREE.Group()
  const mat = new THREE.MeshStandardMaterial({ color: 0xc33a2c, roughness: 0.6 })

  for (const x of [-3.6, 3.6]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.5, 4.4, 0.5), mat)
    pillar.position.set(x, 2.2, 0)
    g.add(pillar)
  }
  const top = new THREE.Mesh(new THREE.BoxGeometry(9, 0.55, 0.8), mat)
  top.position.y = 4.6
  const mid = new THREE.Mesh(new THREE.BoxGeometry(7.6, 0.4, 0.6), mat)
  mid.position.y = 3.7
  g.add(top, mid)

  return g
}
