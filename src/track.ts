import * as THREE from 'three'
import { LANES } from './player'
import { TIRAGE, type ParcheminKind } from './parchemin'

/**
 * Les 3 familles d'obstacles : comment les franchir.
 * `mur` est le GRAND obstacle (2,4 m de haut, il barre toute la ligne) ;
 * `saut` et `glissade` sont les petits. L'Armure de Fer fait la différence.
 */
export type Kind = 'saut' | 'glissade' | 'mur'

const LOOKAHEAD = 85 // les obstacles apparaissent 85 m devant (cachés par la brume)
const DESPAWN_Z = 8 // et disparaissent derrière la caméra

/**
 * Les derniers mètres de la course : le SPRINT FINAL.
 * Aucun obstacle n'y est placé — sur mobile, on ne peut pas swiper pour
 * esquiver ET marteler l'écran pour accélérer en même temps.
 */
export const SPRINT_ZONE = 120

interface Obstacle {
  mesh: THREE.Mesh
  kind: Kind
  active: boolean
}

/** Un obstacle prévu sur la piste : à quelle distance, quelle ligne, quel type */
export interface PlannedObstacle {
  d: number
  lane: number
  kind: Kind
}

/** Un rouleau posé sur la piste. Le `kind` est déjà tiré, mais invisible. */
export interface PlannedParchemin {
  d: number
  lane: number
  kind: ParcheminKind
}

interface Rouleau {
  mesh: THREE.Group
  kind: ParcheminKind
  active: boolean
}

/**
 * ————— Les jarres : les cibles du combat —————
 * `vide` ne donne que de l'élan et un maillon de chaîne ; `doree` cache un
 * parchemin. Comme tout naît de la graine partagée, les deux joueurs voient
 * les MÊMES jarres : la dorée devient un point de friction — on ne court plus
 * seulement contre le chrono, on se bat pour un objet que l'autre convoite.
 */
export type JarreKind = 'vide' | 'doree'

export interface PlannedJarre {
  d: number
  lane: number
  kind: JarreKind
  /** Ce que la dorée recèle (ignoré pour une jarre vide) */
  parchemin: ParcheminKind
}

interface Jarre {
  mesh: THREE.Group
  kind: JarreKind
  parchemin: ParcheminKind
  active: boolean
}

/**
 * La portée de frappe, en mètres devant soi. Généreuse exprès : une attaque
 * ratée de peu est bien plus frustrante qu'une attaque un peu assistée, et on
 * vise au doigt sur un écran qui bouge.
 */
const PORTEE_FRAPPE = 5.5

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
  private rouleaux: Rouleau[] = []
  private parcheminPlan: PlannedParchemin[] = []
  private parcheminIdx = 0
  private tempsRouleaux = 0 // horloge d'animation des rouleaux (rotation, flottement)
  private jarres: Jarre[] = []
  private jarrePlan: PlannedJarre[] = []
  private jarreIdx = 0
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
    for (const r of this.rouleaux) {
      r.active = false
      r.mesh.visible = false
    }
    for (const j of this.jarres) {
      j.active = false
      j.mesh.visible = false
    }
    this.courseLength = length
    this.finish.position.z = -length
    this.plan = buildPlan(length, seed)
    this.planIdx = 0
    // Les rouleaux sont places APRES les obstacles : ils doivent s'en ecarter
    this.parcheminPlan = buildParcheminPlan(length, seed, this.plan)
    this.parcheminIdx = 0
    this.jarrePlan = buildJarrePlan(length, seed, this.plan)
    this.jarreIdx = 0
  }

  /**
   * Le plan complet de la course. Les bots le LISENT pour esquiver : ils ne
   * voient pas la piste, ils la connaissent — comme un pilote son circuit.
   */
  obstaclesPrevus(): readonly PlannedObstacle[] {
    return this.plan
  }

  /**
   * Le plan des rouleaux. Les bots le lisent aussi : ils ramassent en passant
   * dans la bonne ligne. Chacun a son propre exemplaire du parchemin — prendre
   * un rouleau ne le vole à personne, sinon le joueur devrait courir DERRIÈRE
   * les bots pour espérer un sort.
   */
  parcheminsPrevus(): readonly PlannedParchemin[] {
    return this.parcheminPlan
  }

  /**
   * Le premier MUR qui barre la ligne `lane` entre `d1` et `d2`, ou null.
   *
   * C'est le garde-fou du portail 🔮 Onmyōji : il file tout droit et meurt au
   * premier mur. Comme un mur bouche une ligne donnée environ 1 rangée sur 6 et
   * que les rangées tombent tous les 13 m, sa portée s'auto-limite à quelques
   * dizaines de mètres. La piste fait la règle — pas un plafond arbitraire.
   */
  premierMur(lane: number, d1: number, d2: number): number | null {
    let plusProche: number | null = null
    for (const o of this.plan) {
      if (o.kind !== 'mur' || o.lane !== lane) continue
      if (o.d > d1 && o.d <= d2 && (plusProche === null || o.d < plusProche)) {
        plusProche = o.d
      }
    }
    return plusProche
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

    // Les rouleaux tournent et flottent : impossible de les rater du regard
    this.tempsRouleaux += dt
    for (const r of this.rouleaux) {
      if (!r.active) continue
      r.mesh.position.z += dz
      r.mesh.rotation.y = this.tempsRouleaux * 2.2
      r.mesh.position.y = 1.15 + Math.sin(this.tempsRouleaux * 3) * 0.12
      if (r.mesh.position.z > DESPAWN_Z) {
        r.active = false
        r.mesh.visible = false
      }
    }

    // Les jarres, elles, restent posées au sol : rien ne bouge, seule la dorée
    // pivote lentement pour se signaler de loin.
    for (const j of this.jarres) {
      if (!j.active) continue
      j.mesh.position.z += dz
      if (j.kind === 'doree') j.mesh.rotation.y = this.tempsRouleaux * 1.1
      if (j.mesh.position.z > DESPAWN_Z) {
        j.active = false
        j.mesh.visible = false
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

      // Idem pour les rouleaux
      while (
        this.parcheminIdx < this.parcheminPlan.length &&
        this.parcheminPlan[this.parcheminIdx].d <= distance + LOOKAHEAD
      ) {
        const p = this.parcheminPlan[this.parcheminIdx]
        this.spawnRouleau(p.kind, p.lane, -(p.d - distance))
        this.parcheminIdx++
      }

      // Idem pour les jarres
      while (
        this.jarreIdx < this.jarrePlan.length &&
        this.jarrePlan[this.jarreIdx].d <= distance + LOOKAHEAD
      ) {
        const p = this.jarrePlan[this.jarreIdx]
        this.spawnJarre(p, -(p.d - distance))
        this.jarreIdx++
      }
    }
  }

  private spawnJarre(p: PlannedJarre, z: number) {
    // Les deux sortes n'ont pas le même corps : on recycle par sorte.
    let j = this.jarres.find((j) => !j.active && j.kind === p.kind)
    if (!j) {
      j = { mesh: makeJarreMesh(p.kind), kind: p.kind, parchemin: p.parchemin, active: false }
      this.jarres.push(j)
      this.scene.add(j.mesh)
    }
    j.parchemin = p.parchemin
    j.mesh.position.x = LANES[p.lane]
    j.mesh.position.z = z
    j.mesh.rotation.y = 0
    j.mesh.visible = true
    j.active = true
  }

  /** La jarre à portée de frappe sur cette ligne, s'il y en a une. */
  private jarreAPortee(lane: number): Jarre | null {
    for (const j of this.jarres) {
      if (!j.active) continue
      if (Math.abs(j.mesh.position.x - LANES[lane]) > 1.1) continue
      const z = j.mesh.position.z
      if (z > -PORTEE_FRAPPE && z < 1.5) return j
    }
    return null
  }

  /**
   * Y a-t-il quelque chose à frapper sur cette ligne ?
   * C'est CE test qui décide si un swipe est un déplacement ou une attaque.
   */
  jarreDevant(lane: number): boolean {
    return this.jarreAPortee(lane) !== null
  }

  /**
   * Le joueur PERCUTE-t-il une jarre au lieu de la frapper ? La poterie
   * éclate, mais on se prend le choc.
   *
   * C'est ce qui donne son poids au combat : sans collision, ignorer une
   * grappe ne coûtait rien et frapper n'était qu'un bonus facultatif.
   * Maintenant une grappe sur sa ligne pose une vraie question — la frapper,
   * la contourner, ou payer. Et en vol on passe au-dessus : une chaîne bien
   * menée traverse tout sans jamais toucher une seule jarre.
   */
  heurteJarre(playerBox: THREE.Box3): boolean {
    const box = new THREE.Box3()
    for (const j of this.jarres) {
      if (!j.active) continue
      if (Math.abs(j.mesh.position.z) > 2.5) continue
      box.setFromObject(j.mesh)
      box.expandByScalar(-0.1) // un peu de tolérance : on frôle sans casser
      if (box.intersectsBox(playerBox)) {
        j.active = false
        j.mesh.visible = false
        return true
      }
    }
    return false
  }

  /**
   * Casse la jarre à portée sur cette ligne. Renvoie ce qu'elle contenait :
   * `null` si rien à frapper, sinon le parchemin libéré (ou `null` pour une
   * jarre vide, qui ne donne que l'élan et le maillon de chaîne).
   */
  casseJarre(lane: number): { touchee: boolean; parchemin: ParcheminKind | null } {
    const j = this.jarreAPortee(lane)
    if (!j) return { touchee: false, parchemin: null }
    j.active = false
    j.mesh.visible = false
    return { touchee: true, parchemin: j.kind === 'doree' ? j.parchemin : null }
  }

  private spawnRouleau(kind: ParcheminKind, lane: number, z: number) {
    let r = this.rouleaux.find((r) => !r.active)
    if (!r) {
      r = { mesh: makeRouleauMesh(), kind, active: false }
      this.rouleaux.push(r)
      this.scene.add(r.mesh)
    }
    r.kind = kind // recyclé : le rouleau change de contenu, pas d'apparence
    r.mesh.position.x = LANES[lane]
    r.mesh.position.z = z
    r.mesh.visible = true
    r.active = true
  }

  /**
   * Le joueur ramasse-t-il un rouleau ? Renvoie le parchemin décroché (et le
   * retire de la piste), ou null. On ne sait ce qu'on a gagné qu'ici.
   */
  ramasse(playerBox: THREE.Box3): ParcheminKind | null {
    const box = new THREE.Box3()
    for (const r of this.rouleaux) {
      if (!r.active) continue
      if (Math.abs(r.mesh.position.z) > 2.5) continue
      box.setFromObject(r.mesh)
      box.expandByScalar(0.25) // genereux : ramasser doit etre un plaisir, pas un test
      if (box.intersectsBox(playerBox)) {
        r.active = false
        r.mesh.visible = false
        return r.kind
      }
    }
    return null
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

  /**
   * Le joueur touche-t-il un obstacle ? Renvoie LEQUEL (ou null) : l'Armure de
   * Fer n'encaisse pas de la même façon une barrière et un mur.
   */
  hits(playerBox: THREE.Box3): Kind | null {
    const box = new THREE.Box3()
    for (const o of this.obstacles) {
      if (!o.active) continue
      if (Math.abs(o.mesh.position.z) > 2.5) continue // trop loin, on ne teste pas
      box.setFromObject(o.mesh)
      box.expandByScalar(-0.12) // un peu de tolérance, plus sympa à jouer
      if (box.intersectsBox(playerBox)) return o.kind
    }
    return null
  }
}

/**
 * Décide de TOUS les obstacles de la course à l'avance, à partir de la graine.
 * 1 ou 2 obstacles par rangée, jamais 3 : il y a toujours un passage !
 * La zone de sprint final est dégagée.
 */
export function buildPlan(length: number, seed: number): PlannedObstacle[] {
  const rng = mulberry32(seed)
  const kinds: Kind[] = ['saut', 'glissade', 'mur']
  const plan: PlannedObstacle[] = []

  let d = 45 // premiers mètres tranquilles pour se chauffer
  while (d < length - SPRINT_ZONE) {
    const lanes = [0, 1, 2].sort(() => rng() - 0.5)
    const count = rng() < 0.6 ? 1 : 2
    for (let i = 0; i < count; i++) {
      plan.push({ d, lane: lanes[i], kind: kinds[Math.floor(rng() * kinds.length)] })
    }
    d += 10 + rng() * 7
  }
  return plan
}

/**
 * Place les rouleaux : environ un tous les 130 à 210 m, jamais dans la zone de
 * sprint. Le contenu est tiré ici, mais reste invisible jusqu'au ramassage.
 *
 * L'espacement vise **un ramassage toutes les ~6,5 s** (on court à ~26 m/s) :
 * assez pour que les parchemins rythment vraiment la course, assez peu pour
 * qu'on ne soit pas les deux mains pleines en permanence. Un rouleau toutes les
 * 4 s rendait le système bavard et sans enjeu.
 *
 * On décale la graine (`^`) : sans ça les rouleaux suivraient exactement le
 * même tirage que les obstacles et retomberaient toujours au même endroit.
 */
function buildParcheminPlan(
  length: number,
  seed: number,
  obstacles: PlannedObstacle[]
): PlannedParchemin[] {
  const rng = mulberry32(seed ^ 0x5f3a7c1d)
  const plan: PlannedParchemin[] = []

  let d = 120 // on laisse le temps de prendre sa vitesse
  while (d < length - SPRINT_ZONE - 15) {
    // Un rouleau collé à une barrière serait un piège : il faudrait se blesser
    // pour l'attraper. On ne cherche PAS un trou vide — les rangées tombent
    // tous les 10-17 m, il n'en existe pas toujours. On cherche une LIGNE que
    // personne n'occupe autour de ce point : une rangée n'ayant jamais 3
    // obstacles, il y en a presque toujours une de libre.
    let pos = d
    let lane = -1
    for (let essai = 0; essai < 14; essai++) {
      const occupees = new Set(
        obstacles.filter((o) => Math.abs(o.d - pos) < 6).map((o) => o.lane)
      )
      const libres = [0, 1, 2].filter((l) => !occupees.has(l))
      if (libres.length > 0) {
        lane = libres[Math.floor(rng() * libres.length)]
        break
      }
      pos += 3 // deux rangées serrées bouchent les 3 lignes : on avance un peu
    }
    // Vraiment aucune ligne libre : on saute ce rouleau plutôt que d'en poser
    // un dans un mur. Le suivant tombera 130 à 210 m plus loin.
    if (lane >= 0) {
      plan.push({ d: pos, lane, kind: TIRAGE[Math.floor(rng() * TIRAGE.length)] })
    }
    d += 130 + rng() * 80
  }
  return plan
}

/**
 * Place les jarres — en GRAPPES, et c'est tout l'enjeu du réglage.
 *
 * Une jarre isolée ne vaut rien : frapper coûte de la vitesse, et un coup seul
 * ne la rembourse pas. Ce qui paie, c'est la CHAÎNE. Il faut donc que les
 * cibles se suivent d'assez près pour qu'on aille de l'une à l'autre sans
 * retomber : un rebond est un vrai saut, donc ~0,67 s en l'air, soit environ
 * 17 m à vitesse de croisière. D'où l'espacement de 12 à 15 m — on atteint la
 * suivante avec un peu de marge, mais frapper trop tôt fait retomber court.
 *
 * Une grappe tient sur UNE ligne : on enchaîne tout droit, et le choix « je
 * prends la grappe ou je garde ma trajectoire » reste lisible en une seconde.
 *
 * Graine décalée (`^`) : sinon les jarres tomberaient toujours sur les mêmes
 * points que les obstacles et les rouleaux.
 */
export function buildJarrePlan(
  length: number,
  seed: number,
  obstacles: PlannedObstacle[]
): PlannedJarre[] {
  const rng = mulberry32(seed ^ 0x2b91e6a7)
  const plan: PlannedJarre[] = []

  let d = 90 // le temps d'avoir pris sa vitesse
  while (d < length - SPRINT_ZONE - 30) {
    const taille = 2 + Math.floor(rng() * 3) // 2 à 4 jarres
    const ecart = 12 + rng() * 3

    // On cherche une ligne libre sur TOUTE la longueur de la grappe : une
    // grappe coupée par un mur serait un piège, pas un choix.
    //
    // ⚠️ La fin est recalculée à CHAQUE essai : quand on décale la grappe, sa
    // fin se décale avec elle. L'oublier laissait passer des jarres dans les
    // murs — et comme les rangées d'obstacles bouchent souvent les 3 lignes
    // sur une fenêtre aussi large, ce décalage arrive tout le temps.
    let lane = -1
    for (let essai = 0; essai < 10; essai++) {
      const fin = d + ecart * (taille - 1)
      const occupees = new Set(
        obstacles.filter((o) => o.d > d - 8 && o.d < fin + 8).map((o) => o.lane)
      )
      const libres = [0, 1, 2].filter((l) => !occupees.has(l))
      if (libres.length > 0) {
        lane = libres[Math.floor(rng() * libres.length)]
        break
      }
      d += 6 // ce tronçon est bouché : on décale la grappe un peu plus loin
    }

    // La grappe doit tenir ENTIÈREMENT dans le 2ᵉ acte. Une jarre posée dans
    // la zone de sprint serait incassable — le combat y est éteint — donc on
    // arrête d'en poser dès que la grappe déborderait.
    if (d + ecart * (taille - 1) >= length - SPRINT_ZONE) break

    if (lane >= 0) {
      // Une grappe sur trois cache une dorée, jamais en première position :
      // il faut avoir commencé la chaîne pour la cueillir.
      const doree = rng() < 0.34 ? 1 + Math.floor(rng() * (taille - 1)) : -1
      for (let i = 0; i < taille; i++) {
        plan.push({
          d: d + ecart * i,
          lane,
          kind: i === doree ? 'doree' : 'vide',
          parchemin: TIRAGE[Math.floor(rng() * TIRAGE.length)],
        })
      }
    }
    d += 90 + rng() * 60
  }
  return plan
}

/**
 * Le visuel d'une jarre. La dorée doit se repérer de TRÈS loin (on décide de
 * changer de ligne pour elle) : d'où l'or émissif, qui perce la brume.
 */
function makeJarreMesh(kind: JarreKind): THREE.Group {
  const g = new THREE.Group()
  const doree = kind === 'doree'

  const mat = doree
    ? new THREE.MeshStandardMaterial({
        color: 0xd6ac5a,
        roughness: 0.3,
        emissive: 0x6a4f12, // elle brille dans la nuit
      })
    : new THREE.MeshStandardMaterial({ color: 0x8a6a52, roughness: 0.9 })

  // Le ventre : plus large en bas qu'en haut, comme une vraie poterie
  const ventre = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.36, 0.62, 12), mat)
  ventre.position.y = 0.31

  // Le col
  const col = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.14, 10), mat)
  col.position.y = 0.69

  g.add(ventre, col)
  return g
}

/**
 * Le visuel d'un rouleau : le MÊME pour les trois parchemins.
 * On ne découvre son contenu qu'en le ramassant — comme une boîte de Mario Kart.
 */
function makeRouleauMesh(): THREE.Group {
  const g = new THREE.Group()

  // Le papier : un cylindre couche en travers de la piste
  const papier = new THREE.Mesh(
    new THREE.CylinderGeometry(0.17, 0.17, 0.78, 12),
    new THREE.MeshStandardMaterial({ color: 0xf0e8d8, roughness: 0.85 })
  )
  papier.rotation.z = Math.PI / 2

  // Les deux embouts vermillon, et le lien rouge au centre
  const bois = new THREE.MeshStandardMaterial({ color: 0xc33a2c, roughness: 0.5 })
  for (const x of [-0.42, 0.42]) {
    const embout = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.09, 12), bois)
    embout.rotation.z = Math.PI / 2
    embout.position.x = x
    g.add(embout)
  }
  const lien = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.1, 12), bois)
  lien.rotation.z = Math.PI / 2

  // Une lueur doree : le rouleau doit accrocher l'oeil dans la nuit
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 10, 10),
    new THREE.MeshBasicMaterial({ color: 0xd6ac5a, transparent: true, opacity: 0.12 })
  )

  g.add(papier, lien, halo)
  g.position.y = 1.15
  return g
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
