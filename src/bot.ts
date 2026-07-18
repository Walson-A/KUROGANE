import * as THREE from 'three'
import { LANES } from './player'
import { mulberry32, type Kind, type PlannedObstacle, type PlannedParchemin } from './track'
import {
  KUSARIGAMA_DUREE,
  KUSARIGAMA_FACTEUR,
  VENT_BOOST,
  VENT_DUREE,
  GRUE_DUREE,
  GRUE_BONUS_ADRESSE,
  ARMURE_SOLIDITE,
  ARMURE_COUT_MUR,
  ARMURE_COUT_PETIT,
  MIROIR_DUREE,
  FUMIGENE_DUREE,
  SENBON_DUREE,
  MALUS_ADRESSE,
  type ParcheminKind,
} from './parchemin'

/**
 * ————— Les rivaux d'entraînement —————
 *
 * En solo, on court contre 1 à 4 bots. Ce ne sont PAS des adversaires réseau :
 * chacun simule sa propre course en local, avec la même formule de vitesse que
 * le joueur, et esquive les obstacles en lisant le plan de la piste.
 *
 * ————— Le principe : esquive SCRIPTÉE, pas physique —————
 * Un bot n'a pas de boîte de collision. À chaque rangée d'obstacles il décide
 * quoi faire (changer de ligne, sauter, glisser) et tire au sort s'il réussit,
 * selon son `adresse`. Un raté déclenche exactement la même pénalité que pour
 * le joueur (vitesse × 0,35). C'est ce qui rend la difficulté RÉGLABLE : on
 * choisit le niveau d'un rival avec deux nombres, pas en bricolant une IA.
 */

const GRAVITY = 42 // identiques au joueur : les bots doivent bouger pareil
const JUMP_SPEED = 14
const SLIDE_TIME = 0.55

/** À partir de quand un bot réagit à la rangée qui arrive (en secondes). */
const REACTION = 1.1
/** Il saute / glisse au dernier moment, sinon il retombe avant l'obstacle. */
const DECLENCHE_SAUT = 0.3
const DECLENCHE_GLISSADE = 0.26

/**
 * Le roster. L'ordre EST la difficulté : 1 bot = Hana seule, 4 bots = jusqu'au
 * boss. On ajoute toujours un rival plus fort, jamais un plus faible.
 *
 *  · `facteur` multiplie la vitesse de croisière. Le temps de course lui est
 *    inversement proportionnel : une course propre du joueur fait 75,07 s,
 *    donc facteur 1,06 → ≈ 70,8 s. C'est le rythme « parfait » du rival.
 *  · `adresse` = ses chances de réussir une esquive. Ses ratés le font dériver
 *    au-dessus de ce rythme parfait — mesuré, le retard vaut ≈ 30 × (1 − adresse)
 *    secondes. C'est ce qui le rend HUMAIN : un bot qui ne se trompe jamais
 *    n'apprend rien au joueur.
 *
 * ————— Le calibrage (200 courses simulées avec ce code) —————
 * Les temps encadrent volontairement les 75,07 s d'une course propre : trois
 * rivaux rattrapables, un boss qui exige un sans-faute AVEC les parchemins.
 * Mesuré rouleaux compris : les ramasser ne déplace un rival que de ~0,1 s,
 * parce qu'il n'en trouve que dans sa ligne et que ses sorts partent surtout
 * dans les pattes du joueur.
 *
 *   Hana      85,2 s (81,7 – 89,0)   la première victoire
 *   Oni-Maru  80,1 s (77,5 – 83,6)   il faut déjà tenir sa ligne
 *   Tamae     76,0 s (74,5 – 79,7)   duel serré : elle gagne 20 % du temps
 *   Kurokumo  71,1 s (70,8 – 73,4)   imbattable en course propre — le boss
 */
export interface Profil {
  nom: string
  corps: number
  bandeau: number
  facteur: number
  adresse: number
}

export const PROFILS: Profil[] = [
  { nom: 'Hana', corps: 0x3c5a86, bandeau: 0xf09ac0, facteur: 0.93, adresse: 0.85 },
  { nom: 'Oni-Maru', corps: 0x6d3030, bandeau: 0xe58a2c, facteur: 0.975, adresse: 0.9 },
  { nom: 'Tamae', corps: 0x2f6050, bandeau: 0x74dba6, facteur: 1.008, adresse: 0.95 },
  { nom: 'Kurokumo', corps: 0x2e2333, bandeau: 0xd6ac5a, facteur: 1.062, adresse: 0.99 },
]

export const BOTS_MAX = PROFILS.length

/** Une rangée : tout ce qui est planté à la même distance, ligne par ligne. */
export interface Rangee {
  d: number
  parLigne: (Kind | null)[]
}

/**
 * Regroupe le plan de piste par distance. Le bot raisonne par RANGÉE et non
 * par obstacle : ce qui l'intéresse, c'est « quelles lignes sont bloquées ici ».
 */
export function construireRangees(plan: readonly PlannedObstacle[]): Rangee[] {
  const parD = new Map<number, Rangee>()
  for (const o of plan) {
    let r = parD.get(o.d)
    if (!r) {
      r = { d: o.d, parLigne: [null, null, null] }
      parD.set(o.d, r)
    }
    r.parLigne[o.lane] = o.kind
  }
  return [...parD.values()].sort((a, b) => a.d - b.d)
}

type Action = 'rien' | 'ligne' | 'saut' | 'glissade'

interface Intention {
  action: Action
  /** Décidé À L'AVANCE : le bot va-t-il se manger la rangée ? */
  rate: boolean
  /** Ce qu'il va percuter s'il rate — son 🛡️ armure n'encaisse pas pareil. */
  kind: Kind | null
}

export class Bot {
  mesh = new THREE.Group()
  readonly profil: Profil
  actif = false
  distance = 0
  speed = 0
  /** Le chrono de son arrivée, ou -1 s'il court encore. */
  tempsArrivee = -1

  private lane = 1
  private vy = 0
  private glissade = 0
  private chute = 0 // il clignote le temps de se relever, comme le joueur
  private rangees: Rangee[] = []
  private idx = 0
  private rouleaux: readonly PlannedParchemin[] = []
  private rIdx = 0
  private intention: Intention | null = null
  private rng: () => number = Math.random

  // ————— Ses parchemins —————
  // Le bot joue avec les mêmes règles que le joueur : 2 slots, file d'attente.
  slots: ParcheminKind[] = []
  private entraveFin = 0 // ⛓️ bridé
  private ventFin = 0 // 🌀 dash
  private grueFin = 0 // 🕊️ esquive mieux
  private aveugleFin = 0 // 💨 / ☠️ il rate ses esquives (il n'a pas d'écran)
  private miroirFin = 0 // 🪞 le prochain sort reçu repart
  private armure = 0 // 🛡️ solidité restante
  private prochainSort = 0 // il lance à cet instant du chrono

  /** Sa ligne actuelle — le portail 🔮 doit savoir s'il est dans l'axe. */
  get ligne() {
    return this.lane
  }

  /** 🪞 Sa parade est-elle levée ? (consulté AVANT de lui envoyer un sort) */
  miroirLeve(time: number) {
    return time < this.miroirFin
  }

  constructor(scene: THREE.Scene, profil: Profil) {
    this.profil = profil

    const corps = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 1.5, 0.8),
      new THREE.MeshStandardMaterial({ color: profil.corps, roughness: 0.55 })
    )
    corps.position.y = 0.75

    const bandeau = new THREE.Mesh(
      new THREE.BoxGeometry(0.84, 0.14, 0.84),
      new THREE.MeshStandardMaterial({ color: profil.bandeau })
    )
    bandeau.position.y = 1.26

    this.mesh.add(corps, bandeau)
    this.mesh.visible = false
    scene.add(this.mesh)
  }

  /**
   * Prépare une course. La graine rend le bot REJOUABLE : même piste + même
   * graine = mêmes esquives et mêmes fautes. On peut donc rejouer une course
   * ratée à l'identique pour la travailler.
   */
  reset(rangees: Rangee[], rouleaux: readonly PlannedParchemin[], seed: number) {
    this.rangees = rangees
    this.rouleaux = rouleaux
    this.rIdx = 0
    this.idx = 0
    this.intention = null
    this.distance = 0
    this.speed = 12 // la vitesse au GO, comme le joueur
    this.tempsArrivee = -1
    this.lane = 1
    this.vy = 0
    this.glissade = 0
    this.chute = 0
    this.slots = []
    this.entraveFin = 0
    this.ventFin = 0
    this.grueFin = 0
    this.aveugleFin = 0
    this.miroirFin = 0
    this.armure = 0
    this.prochainSort = 0
    this.rng = mulberry32(seed)
    this.mesh.position.set(LANES[1], 0, -2)
    this.mesh.scale.y = 1
    this.mesh.visible = false
  }

  cacher() {
    this.mesh.visible = false
  }

  /**
   * Le bot encaisse un sort. Un bot n'a pas d'écran : la fumée et le poison,
   * qui aveuglent un humain, se traduisent en **malus d'adresse** — il rate ses
   * esquives. Même prix payé, par un autre chemin.
   *
   * Renvoie true si sa 🪞 parade a renvoyé le sort : à l'appelant de le
   * retourner à l'envoyeur.
   */
  subir(kind: ParcheminKind, time: number): boolean {
    if (time < this.miroirFin) {
      this.miroirFin = 0 // la parade est à usage unique
      return true
    }
    if (kind === 'kusarigama') this.entraveFin = time + KUSARIGAMA_DUREE
    else if (kind === 'fumigene') this.aveugleFin = time + FUMIGENE_DUREE
    else if (kind === 'senbon') this.aveugleFin = time + SENBON_DUREE
    else if (kind === 'kunai') this.trebucher()
    return false
  }

  /**
   * ⚔️ Il encaisse un coup de lame du joueur.
   *
   * Son 🛡️ armure le protège, comme celle du joueur — c'est une protection
   * physique. Sa 🪞 parade, elle, ne joue PAS : elle renvoie les sorts, pas
   * l'acier. Choix délibéré, pour que chaque défense garde un rôle net.
   *
   * `garde` = la part de vitesse qu'il conserve (cf. PVP_FREIN côté joueur) :
   * un coup fait mal sans décider la course à lui seul.
   */
  encaisseCoup(garde: number) {
    if (this.armure > 0) {
      this.armure = Math.max(0, this.armure - ARMURE_COUT_PETIT)
      this.chute = 0.4 // il vacille, mais garde sa vitesse
      return
    }
    this.speed = Math.max(6, this.speed * garde)
    this.chute = 1.2
  }

  /** Son adresse du moment : la fumée l'aveugle, la Grue l'assure. */
  private adresse(time: number) {
    let a = this.profil.adresse
    if (time < this.aveugleFin) a -= MALUS_ADRESSE
    if (time < this.grueFin) a += GRUE_BONUS_ADRESSE
    return Math.min(1, Math.max(0, a))
  }

  /**
   * Il ramasse les rouleaux qu'il vient de dépasser. On ne teste pas de
   * collision : un bot n'a pas de boîte. Il ramasse s'il est dans la bonne
   * ligne, comme il esquive — de façon scriptée.
   */
  private ramasser() {
    while (this.rIdx < this.rouleaux.length && this.distance > this.rouleaux[this.rIdx].d) {
      const r = this.rouleaux[this.rIdx]
      if (r.lane === this.lane && this.slots.length < 2) this.slots.push(r.kind)
      this.rIdx++
    }
  }

  /**
   * Décide s'il lance son parchemin. Il ne joue pas au millimètre : il attend
   * un petit délai après le ramassage, sinon les 4 rivaux lâcheraient leur sort
   * à la seconde même, tous au même endroit — ça se lirait comme un automate.
   *
   * Renvoie le sort à envoyer chez quelqu'un d'autre (à l'appelant de trouver
   * la cible), ou null s'il l'a gardé pour lui.
   */
  jouerParchemin(time: number): ParcheminKind | null {
    if (!this.slots.length || time < this.prochainSort) return null
    // 1,5 à 4 s entre deux sorts : un rythme humain, pas une mitraillette
    this.prochainSort = time + 1.5 + this.rng() * 2.5

    const kind = this.slots.shift()!
    if (kind === 'vent') this.ventFin = time + VENT_DUREE
    else if (kind === 'grue') this.grueFin = time + GRUE_DUREE
    else if (kind === 'armure') this.armure = ARMURE_SOLIDITE
    else if (kind === 'miroir') this.miroirFin = time + MIROIR_DUREE
    else if (kind === 'the') {
      this.entraveFin = 0
      this.aveugleFin = 0
    } else return kind // offensif ou portail : ce n'est plus son affaire
    return null
  }

  /** Fait courir le bot d'une image. Renvoie true à l'image où il franchit le torii. */
  avance(dt: number, time: number, longueur: number): boolean {
    if (this.tempsArrivee >= 0) return false

    this.piloter(time)
    this.ramasser()

    let cruise = (22 + 8 * (this.distance / longueur)) * this.profil.facteur
    if (time < this.ventFin) cruise *= 1 + VENT_BOOST
    if (time < this.entraveFin) cruise *= KUSARIGAMA_FACTEUR
    this.speed += (cruise - this.speed) * Math.min(1, dt * 1.2)
    this.distance += this.speed * dt

    if (this.distance >= longueur) {
      this.distance = longueur
      this.tempsArrivee = time
      return true
    }
    return false
  }

  /** Décide et exécute l'esquive de la rangée qui arrive. */
  private piloter(time: number) {
    // Les rangées franchies : c'est là qu'un raté se paie enfin.
    while (this.idx < this.rangees.length && this.distance > this.rangees[this.idx].d) {
      if (this.intention?.rate) this.trebucher(this.intention.kind)
      this.idx++
      this.intention = null
    }

    const r = this.rangees[this.idx]
    if (!r) return

    const dans = (r.d - this.distance) / Math.max(this.speed, 1) // secondes avant impact
    if (dans > REACTION) return

    if (!this.intention) this.intention = this.choisir(r, time)
    // Un raté, c'est un bot qui ne fait rien et encaisse : inutile d'animer.
    if (this.intention.rate) return

    const auSol = this.mesh.position.y <= 0.001
    if (this.intention.action === 'saut' && dans < DECLENCHE_SAUT && auSol) {
      this.vy = JUMP_SPEED
      this.glissade = 0
    } else if (this.intention.action === 'glissade' && dans < DECLENCHE_GLISSADE && auSol) {
      this.glissade = SLIDE_TIME
    }
  }

  /** Le choix d'esquive. Le changement de ligne est joué tout de suite. */
  private choisir(r: Rangee, time: number): Intention {
    const ici = r.parLigne[this.lane]
    if (!ici) return { action: 'rien', rate: false, kind: null } // ligne libre

    // Son adresse du MOMENT : aveuglé il rate bien plus, porté par la Grue il
    // assure mieux. C'est là que la fumée et le poison se paient.
    const rate = this.rng() > this.adresse(time)
    const libres = [0, 1, 2].filter((l) => !r.parLigne[l])

    // Un mur barre toute la ligne : ni saut ni glissade, il FAUT s'écarter.
    // Rater, c'est rester planté dans sa ligne.
    if (ici === 'mur') {
      if (!rate && libres.length) this.versLigne(libres)
      return { action: 'ligne', rate, kind: ici }
    }

    // Petit obstacle : franchissable, mais parfois le bot préfère s'écarter —
    // sans ça il sauterait tout le temps et se lirait comme un automate.
    if (libres.length && this.rng() < 0.35) {
      if (!rate) this.versLigne(libres)
      return { action: 'ligne', rate, kind: ici }
    }
    return { action: ici === 'saut' ? 'saut' : 'glissade', rate, kind: ici }
  }

  /** S'écarte vers la ligne libre la plus proche (un pas de côté suffit). */
  private versLigne(libres: number[]) {
    let best = libres[0]
    for (const l of libres) {
      if (Math.abs(l - this.lane) < Math.abs(best - this.lane)) best = l
    }
    this.lane = best
  }

  /**
   * Il encaisse. Son 🛡️ armure joue exactement comme celle du joueur : un mur
   * la met en pièces, une barrière ne l'entame qu'à moitié. `kind` vaut null
   * pour un Kunai — un projectile n'est ni petit ni grand, il coûte une plaque.
   */
  private trebucher(kind: Kind | null = null) {
    if (this.armure > 0) {
      this.armure = Math.max(0, this.armure - (kind === 'mur' ? ARMURE_COUT_MUR : ARMURE_COUT_PETIT))
      this.chute = 0.4 // il vacille, mais garde sa vitesse
      return
    }
    this.speed = Math.max(6, this.speed * 0.35)
    this.chute = 1.2
  }

  /**
   * Le place à l'écran. Sa position sur Z = SA distance moins CELLE du joueur :
   * devant nous s'il mène, derrière s'il est distancé.
   */
  placer(dt: number, distanceJoueur: number) {
    if (!this.actif) {
      this.mesh.visible = false
      return
    }

    this.mesh.position.x += (LANES[this.lane] - this.mesh.position.x) * Math.min(1, dt * 12)

    this.mesh.position.y += this.vy * dt
    if (this.mesh.position.y > 0) {
      this.vy -= GRAVITY * dt
    } else {
      this.mesh.position.y = 0
      this.vy = 0
    }

    this.glissade = Math.max(0, this.glissade - dt)
    const cible = this.glissade > 0 ? 0.45 : 1
    this.mesh.scale.y += (cible - this.mesh.scale.y) * Math.min(1, dt * 18)

    const z = THREE.MathUtils.clamp(-(this.distance - distanceJoueur), -70, 9)
    this.mesh.position.z += (z - this.mesh.position.z) * Math.min(1, dt * 8)

    // Il clignote en se relevant, et se perd dans la brume s'il est trop loin
    this.chute = Math.max(0, this.chute - dt)
    const visible = this.mesh.position.z > -69 && this.mesh.position.z < 9
    this.mesh.visible = visible && (this.chute <= 0 || Math.floor(this.chute * 12) % 2 === 0)
  }
}
