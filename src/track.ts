import * as THREE from 'three'
import { LANES, MUR_X } from './player'
import { tirerParchemin, TIRAGE, type ParcheminKind } from './parchemin'

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

/**
 * Un rouleau posé sur la piste : juste une POSITION. Son contenu n'est PAS
 * décidé ici — il est tiré au ramassage, propre à chacun (cf. tirerParchemin).
 */
export interface PlannedParchemin {
  d: number
  lane: number
}

interface Rouleau {
  mesh: THREE.Group
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
 * ————— Les murs qu'on longe —————
 * Des pans de mur bordent la piste par tronçons. On s'y accroche depuis la
 * voie extérieure, on y court quelques instants à l'abri des obstacles, et on
 * en repart avec un saut réarmé.
 *
 * C'est une ROUTE, pas un raccourci : on n'y gagne pas de vitesse, on y gagne
 * un passage sûr et un tremplin. Le prix, c'est de devoir se coller au bord —
 * donc renoncer aux jarres et aux sillages du centre.
 */
export interface PlannedMur {
  d: number // où il commence
  longueur: number
  /** -1 = à gauche de la piste, +1 = à droite */
  cote: -1 | 1
}

interface Mur {
  mesh: THREE.Mesh
  active: boolean
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
  private rouleaux: Rouleau[] = []
  private parcheminPlan: PlannedParchemin[] = []
  private parcheminIdx = 0
  private tempsRouleaux = 0 // horloge d'animation des rouleaux (rotation, flottement)
  private jarres: Jarre[] = []
  private jarrePlan: PlannedJarre[] = []
  private jarreIdx = 0
  private murs: Mur[] = []
  private murPlan: PlannedMur[] = []
  private murIdx = 0
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
    for (const m of this.murs) {
      m.active = false
      m.mesh.visible = false
    }
    this.murPlan = buildMurPlan(length, seed)
    this.murIdx = 0
  }

  /**
   * Le pan de mur qui borde la piste ICI, de ce côté — ou null.
   * Sert à savoir si l'on peut s'y accrocher, et quand il se termine.
   */
  murA(distance: number, cote: number): PlannedMur | null {
    for (const m of this.murPlan) {
      if (m.cote !== cote) continue
      if (distance >= m.d && distance < m.d + m.longueur) return m
    }
    return null
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

    // Les jarres restent posées au sol : rien ne bouge, seule la dorée pivote
    // lentement et RESPIRE pour se signaler de loin. Le battement n'est pas de
    // la décoration : c'est le seul mouvement de la piste qui dise « celle-ci
    // vaut le détour », et il se repère du coin de l'œil, en pleine course.
    for (const j of this.jarres) {
      if (!j.active) continue
      j.mesh.position.z += dz
      if (j.kind === 'doree') {
        j.mesh.rotation.y = this.tempsRouleaux * 1.1
        const battement = 1 + Math.sin(this.tempsRouleaux * 3.4) * 0.14
        // Les deux derniers enfants sont le halo et l'aura (cf. makeJarreMesh)
        const n = j.mesh.children.length
        j.mesh.children[n - 2].scale.setScalar(battement)
        j.mesh.children[n - 1].scale.setScalar(battement)
      }
      if (j.mesh.position.z > DESPAWN_Z) {
        j.active = false
        j.mesh.visible = false
      }
    }

    // Les pans de mur défilent comme le reste du décor
    for (const m of this.murs) {
      if (!m.active) continue
      m.mesh.position.z += dz
      if (m.mesh.position.z > DESPAWN_Z + 60) {
        m.active = false
        m.mesh.visible = false
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
        this.spawnRouleau(p.lane, -(p.d - distance))
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

      // Les murs se voient de plus loin que le reste : ils sont longs, et il
      // faut les repérer assez tôt pour décider de sauter AVANT d'arriver.
      while (
        this.murIdx < this.murPlan.length &&
        this.murPlan[this.murIdx].d <= distance + LOOKAHEAD + 40
      ) {
        const p = this.murPlan[this.murIdx]
        this.spawnMur(p, -(p.d - distance))
        this.murIdx++
      }
    }
  }

  private spawnMur(p: PlannedMur, z: number) {
    let m = this.murs.find((m) => !m.active)
    if (!m) {
      m = { mesh: makeMurMesh(), active: false }
      this.murs.push(m)
      this.scene.add(m.mesh)
    }
    // Un seul maillage recyclé : on l'étire à la longueur voulue. Le pivot est
    // au centre, d'où le décalage d'une demi-longueur.
    m.mesh.scale.z = p.longueur
    m.mesh.position.set(p.cote * MUR_X, 1.5, z - p.longueur / 2)
    m.mesh.visible = true
    m.active = true
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

  /**
   * La lame en mouvement touche-t-elle une jarre ?
   *
   * On teste un vrai CONTACT entre les corps, jamais une portée devant soi :
   * passer au-dessus d'une jarre sans la frôler ne doit rien casser. C'est ce
   * qui rend la montée de rebond en rebond impossible — pour frapper, il faut
   * redescendre au niveau de la jarre, donc payer le temps de chute.
   *
   * La boîte est élargie de 35 cm : on vise au doigt sur un écran qui défile,
   * un coup raté d'un cheveu serait injuste.
   */
  casseAuContact(playerBox: THREE.Box3): {
    touchee: boolean
    parchemin: ParcheminKind | null
    /** Le sommet de la jarre : c'est de LÀ qu'on rebondit. */
    sommet: number
  } {
    const box = new THREE.Box3()
    for (const j of this.jarres) {
      if (!j.active) continue
      if (Math.abs(j.mesh.position.z) > 4) continue
      box.setFromObject(j.mesh)
      const sommet = box.max.y
      box.expandByScalar(0.35)
      if (box.intersectsBox(playerBox)) {
        j.active = false
        j.mesh.visible = false
        return {
          touchee: true,
          parchemin: j.kind === 'doree' ? j.parchemin : null,
          sommet,
        }
      }
    }
    return { touchee: false, parchemin: null, sommet: 0 }
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

  private spawnRouleau(lane: number, z: number) {
    let r = this.rouleaux.find((r) => !r.active)
    if (!r) {
      r = { mesh: makeRouleauMesh(), active: false }
      this.rouleaux.push(r)
      this.scene.add(r.mesh)
    }
    r.mesh.position.x = LANES[lane]
    r.mesh.position.z = z
    r.mesh.visible = true
    r.active = true
  }

  /**
   * Le joueur ramasse-t-il un rouleau ? Renvoie un parchemin TIRÉ AU HASARD
   * (et retire la boîte de la piste), ou null. Le contenu n'est décidé qu'ici :
   * deux joueurs qui prennent la même boîte n'ont pas forcément le même pouvoir.
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
        return tirerParchemin() // Math.random : mon tirage, rien qu'à moi
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
 * sprint. Seules les POSITIONS sont décidées ici (à la graine, donc communes à
 * tous les joueurs) ; le contenu de chaque boîte est tiré au ramassage.
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
    // un dans un mur. Le suivant tombera 130 à 210 m plus loin. Le contenu, lui,
    // n'est pas décidé ici : chacun le tire à son ramassage (cf. tirerParchemin).
    if (lane >= 0) plan.push({ d: pos, lane })
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
 * retomber.
 *
 * ⚠️ L'espacement ne peut PAS être un chiffre fixe : il doit valoir exactement
 * la période du rebond, et celle-ci s'allonge au fil de la course puisque la
 * vitesse de croisière monte (22 → 30 m/s). Un écart constant marcherait au
 * début et raterait à la fin. Voir periodeRebond().
 *
 * Une grappe tient sur UNE ligne : on enchaîne tout droit, et le choix « je
 * prends la grappe ou je garde ma trajectoire » reste lisible en une seconde.
 *
 * Graine décalée (`^`) : sinon les jarres tomberaient toujours sur les mêmes
 * points que les obstacles et les rouleaux.
 */
/**
 * La distance parcourue pendant UN rebond, à cet endroit de la course.
 *
 * Un rebond est un vrai saut : 2 × 14 / 42 = 0,667 s en l'air. La distance
 * couverte dépend donc de la vitesse du moment — et comme on accélère au fil
 * des mètres, elle passe d'environ 15 m au départ à 20 m à l'arrivée.
 *
 * Espacer les jarres de cette distance, c'est garantir qu'on retombe PILE sur
 * la suivante. Un écart plus court fait arriver en pleine montée (et l'on ne
 * touche rien) ; un écart plus long fait retomber au sol avant.
 *
 * ⚠️ La formule de croisière est celle de main.ts. Elle est recopiée ici parce
 * que main importe track (l'inverse ferait un cycle) : si l'une bouge, l'autre
 * doit suivre.
 */
function periodeRebond(d: number, length: number): number {
  const croisiere = 22 + 8 * (d / length)
  return (2 * 14) / 42 * croisiere
}

export function buildJarrePlan(
  length: number,
  seed: number,
  obstacles: PlannedObstacle[]
): PlannedJarre[] {
  const rng = mulberry32(seed ^ 0x2b91e6a7)
  const plan: PlannedJarre[] = []
  /** Les jarres qui POURRAIENT devenir dorées (jamais la 1re d'une grappe). */
  const eligibles: number[] = []

  let d = 90 // le temps d'avoir pris sa vitesse
  while (d < length - SPRINT_ZONE - 30) {
    const taille = 2 + Math.floor(rng() * 3) // 2 à 4 jarres
    // L'écart SUIT la période du rebond à cet endroit de la course : on
    // retombe pile sur la jarre suivante. Comme la vitesse de croisière monte
    // au fil des mètres, l'écart s'élargit avec elle.
    const ecart = periodeRebond(d, length)

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
        if (i > 0) eligibles.push(plan.length - 1)
      }
    }
    d += 90 + rng() * 60
  }

  // Au moins UNE dorée par course. Le tirage à 1 grappe sur 3 en donne 2,9 en
  // moyenne, mais laissait 5 % des courses sans aucune — or c'est l'objet
  // qu'on se dispute en duel : une course sans en compter une seule raterait
  // tout l'intérêt. On en promeut donc une au besoin.
  if (eligibles.length > 0 && !plan.some((j) => j.kind === 'doree')) {
    plan[eligibles[Math.floor(rng() * eligibles.length)]].kind = 'doree'
  }
  return plan
}

/**
 * Place les pans de mur : un tous les 160 à 280 m, de 26 à 42 m de long.
 *
 * Assez rares pour rester un événement qu'on guette, assez longs pour valoir
 * la manœuvre (il faut sauter AVANT d'arriver). Le côté est tiré au sort :
 * on ne peut pas apprendre la piste par cœur, il faut regarder.
 *
 * Graine décalée (`^`) : sans ça les murs tomberaient sur les mêmes points
 * que les obstacles, les rouleaux et les jarres.
 */
export function buildMurPlan(length: number, seed: number): PlannedMur[] {
  const rng = mulberry32(seed ^ 0x7d3e5b19)
  const plan: PlannedMur[] = []

  let d = 140 // le temps d'avoir pris sa vitesse et compris la course
  while (d < length - SPRINT_ZONE - 50) {
    plan.push({
      d,
      longueur: 26 + rng() * 16,
      cote: rng() < 0.5 ? -1 : 1,
    })
    d += 160 + rng() * 120
  }
  return plan
}

/**
 * Le visuel d'un pan de mur : une paroi d'ardoise sombre, veinée de vermillon
 * en haut pour qu'on la repère dans la brume. Étirée en Z au spawn.
 */
function makeMurMesh(): THREE.Mesh {
  const mur = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 3, 1), // 1 m de long : mis à l'échelle au spawn
    new THREE.MeshStandardMaterial({ color: 0x2b3145, roughness: 0.95 })
  )
  // Le liseré du haut : c'est lui qu'on voit arriver de loin
  const liser = new THREE.Mesh(
    new THREE.BoxGeometry(0.56, 0.18, 1),
    new THREE.MeshStandardMaterial({ color: 0xc33a2c, emissive: 0x3a0f0a })
  )
  liser.position.y = 1.45
  mur.add(liser)
  return mur
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

  /*
   * ————— La surbrillance —————
   * Une poterie brune sur un sol brun, dans une nuit indigo, à 30 m/s : on la
   * voyait au moment de la percuter, jamais avant. Or il faut DÉCIDER de
   * frapper une grappe une seconde à l'avance.
   *
   * Deux couches, parce qu'elles répondent à deux questions différentes :
   *  · le halo au SOL dit OÙ elle est — sur quelle ligne, à quelle distance ;
   *  · l'aura autour du corps dit CE QUE c'est — et la dorée s'y distingue
   *    d'un coup d'œil, ce qui vaut le détour qu'elle demande.
   *
   * Additif et sans écriture de profondeur : ça brille dans la nuit sans
   * jamais masquer ce qu'il y a derrière.
   */
  const teinte = doree ? 0xffd98a : 0x9fc4ff
  const halo = new THREE.Mesh(
    new THREE.CircleGeometry(doree ? 0.62 : 0.5, 20),
    new THREE.MeshBasicMaterial({
      color: teinte,
      transparent: true,
      opacity: doree ? 0.4 : 0.22,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  )
  halo.rotation.x = -Math.PI / 2
  halo.position.y = 0.02 // juste au-dessus du sol, sinon il z-fight avec lui

  const aura = new THREE.Mesh(
    new THREE.SphereGeometry(doree ? 0.56 : 0.48, 12, 10),
    new THREE.MeshBasicMaterial({
      color: teinte,
      transparent: true,
      opacity: doree ? 0.3 : 0.14,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  )
  aura.position.y = 0.4

  g.add(halo, aura)
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
