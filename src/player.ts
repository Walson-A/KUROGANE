import * as THREE from 'three'
import { NameTag } from './nametag'
import { ROSTER, buildFighter, clearFighter, cssColor, type Fighter } from './roster'
import { Anim, animerGuerrier, type Action, type Geste } from './anims'

/** Les 3 lignes de course (positions X dans le monde 3D) */
export const LANES = [-2.2, 0, 2.2]

/**
 * À quelle distance du centre courent les parois latérales.
 * Défini ICI et pas dans track.ts : track importe déjà de player, l'inverse
 * créerait une dépendance circulaire entre les deux modules.
 */
export const MUR_X = 3.5

/*
 * Les valeurs de RÉFÉRENCE — celles de Yasuke.
 * Chaque guerrier les multiplie par ses propres réglages (cf. roster.ts).
 */
const GRAVITY = 42 // force qui te ramène au sol
/**
 * L'impulsion du saut.
 *
 * ⚠️ Calibrée sur LE MUR (2,4 m, soit 2,28 m après la tolérance de collision) :
 * il ne doit se franchir que d'une seule façon, en changeant de ligne — sauf
 * pour Hana, la sauteuse, à qui ça donne enfin une raison d'être choisie.
 *
 *   apex = (JUMP_SPEED × saut)² / (2 × GRAVITY),  pieds = apex + 0,05
 *
 * À 14, Yasuke (×1) culminait à 2,33 m et passait le mur de 10 cm — la voie
 * royale qui vidait le mur de son sens. À 13,2 il plafonne à 2,07 m et reste
 * bloqué, quand Hana (×1,18) monte à 2,89 m et passe franchement.
 *
 * On baisse la RÉFÉRENCE plutôt que les multiplicateurs : chaque guerrier garde
 * son identité chiffrée, et Yasuke reste le mètre-étalon à 1,00 partout.
 */
export const JUMP_SPEED = 13.2
const ATTACK_TIME = 0.26 // durée d'un coup : on ne peut pas réenchaîner avant
const MUR_DUREE = 0.95 // combien de temps on tient sur une paroi (secondes)
const MUR_HAUTEUR = 1.6 // à quelle hauteur on y court
const SLIDE_TIME = 0.55 // durée d'une glissade (secondes)
/**
 * Durée de la montée quand on escalade une plateforme sans rampe.
 *
 * C'est le temps du GESTE, pas le coût en course : le freinage, lui, vit dans
 * main.ts et dure plus longtemps que la montée (on repart lancé mollement).
 */
const ESCALADE_MONTEE = 0.45
const LANE_LERP = 12 // vitesse de glissement vers la ligne visée
/**
 * Combien de temps on penche dans le virage.
 *
 * Calé sur le temps de traversée réel : à LANE_LERP = 12, on couvre ~95 % de
 * l'écart entre deux lignes en ~0,25 s. Pencher plus longtemps ferait traîner
 * l'inclinaison après l'arrivée sur la ligne.
 */
export const VIRAGE_TEMPS = 0.25

/**
 * Le coureur : le guerrier choisi dans le menu.
 * Il ne se déplace QUE sur l'axe X (les 3 lignes) et Y (saut).
 * C'est le décor qui défile vers lui — illusion classique des runners.
 */
export class Player {
  mesh = new THREE.Group()
  /** Ton pseudo, qui flotte au-dessus de ta tête. Piloté par main.ts. */
  readonly tag: NameTag
  private fighter: Fighter = ROSTER[0]
  private lane = 1 // 0 = gauche, 1 = centre, 2 = droite
  private vy = 0 // vitesse verticale
  private sliding = 0 // temps de glissade restant
  private attackT = 0 // temps restant du coup en cours (0 = libre de frapper)
  /** 0 = au sol ou en vol ; -1 / +1 = accroché à la paroi de ce côté */
  private mur: -1 | 0 | 1 = 0
  private murT = 0 // temps restant sur la paroi
  /** L'abscisse de la paroi qu'on longe : bord de piste, ou flanc de plateforme. */
  private murX = 0
  private rabSaut = 0 // 🕊️ sauts en réserve pour le vol (Saut de la Grue)
  private racine?: THREE.Object3D // le corps articulé, cf. roster.buildFighter
  private tAnim = 0 // l'horloge de la foulée calculée (repli et flottants)
  private anim = new Anim() // le lecteur des mouvements importés
  /** 🥴 Vrai quand un sort brouille la course : on passe sur la foulée gênée. */
  gene = false
  /** 🔥 Vrai sous le Souffle de Vent ou dans le sprint final : la foulée s'emballe. */
  presse = false
  private vire = 0 // le côté du virage en cours : -1 gauche, +1 droite
  private vireT = 0 // ce qu'il en reste

  /**
   * Le mouvement que réclame l'état courant du coureur.
   * L'ordre compte : la glissade prime sur le saut (on peut plonger en l'air),
   * le saut prime sur le virage, et le virage sur la course.
   */
  private action(): Action {
    if (this.sliding > 0) return 'glissade'
    if (!this.onGround) return 'saut'
    if (this.vireT > 0) return this.vire < 0 ? 'virageG' : 'virageD'
    // La gêne l'emporte sur la hâte : empoisonné, on titube même porté par le
    // vent — sinon un sort offensif se verrait annulé à l'écran.
    if (this.gene) return 'courseGenee'
    return this.presse ? 'courseRapide' : 'course'
  }

  /**
   * Déclenche un geste du haut du corps : le jet d'un sort, une frappe, un
   * encaissement. Les jambes continuent de courir dessous.
   */
  geste(g: Geste) {
    this.anim.declencher(g)
  }

  constructor(scene: THREE.Scene) {
    scene.add(this.mesh)
    this.tag = new NameTag(scene)
    this.setFighter(ROSTER[0])
  }

  /** Change de guerrier (depuis le menu) : nouveau look, nouveaux réglages. */
  setFighter(f: Fighter) {
    this.fighter = f
    clearFighter(this.mesh)
    const parts = buildFighter(f)
    this.racine = parts[0] // c'est elle que la foulée anime
    this.mesh.add(...parts)
  }

  /**
   * Écrit le nom porté au-dessus de la tête, dans la couleur du bandeau.
   * Sans pseudo, on affiche le nom du guerrier plutôt qu'une étiquette vide.
   */
  setName(pseudo: string) {
    this.tag.set(pseudo || this.fighter.name.split(' ')[0], cssColor(this.fighter.band))
  }

  /**
   * La part de vitesse gardée quand on trébuche — le passif d'Oni-Maru.
   * C'est main.ts qui applique la perte, parce que c'est lui qui tient la vitesse.
   */
  get grip() {
    return this.fighter.grip
  }

  /** Le passif de Sasuke : laisse-t-il une traînée d'éclair en changeant de ligne ? */
  get spark() {
    return this.fighter.spark ?? false
  }

  /** Se met en place. `lane` : sa ligne sur la grille de départ (duel). */
  reset(lane = 1) {
    this.lane = lane
    this.vy = 0
    this.sliding = 0
    this.rabSaut = 0
    this.attackT = 0
    this.mur = 0
    this.murT = 0
    this.mesh.position.set(LANES[lane], 0, 0)
    this.mesh.scale.y = 1
    this.mesh.rotation.z = 0
  }

  /**
   * La hauteur du sol SOUS le joueur : 0 sur la piste, le dessus d'une
   * plateforme quand on court dessus.
   *
   * C'est main.ts qui la pose à chaque image, en interrogeant la piste. Le
   * joueur ne connaît pas les plateformes — il ne connaît qu'un sol, qui se
   * trouve parfois être à 1,6 m. Toute la mécanique « courir sur le train »
   * tient dans cette seule valeur.
   */
  sol = 0

  /** Temps restant de l'escalade en cours, et le sommet qu'on vise. */
  private escaladeT = 0
  private escaladeVers = 0

  /** Est-on en train d'escalader ? (main.ts s'en sert pour freiner) */
  get escalade() {
    return this.escaladeT > 0
  }

  /**
   * Se hisser par-dessus une plateforme sans rampe.
   *
   * On ne rebondit pas, on ne trébuche pas : on PASSE, mais lentement. C'est le
   * prix de n'avoir pas pris la ligne de la rampe — et à l'arrivée on se
   * retrouve tout de même en haut, sur la route rapide. La sanction est
   * temporelle, jamais un cul-de-sac : rester bloqué contre un mur dans une
   * course serait insupportable.
   */
  escalader(hauteur: number): boolean {
    if (this.escaladeT > 0) return false
    this.escaladeT = ESCALADE_MONTEE
    this.escaladeVers = hauteur
    return true
  }

  get onGround() {
    return this.mesh.position.y <= this.sol + 0.001
  }

  /** Infos qu'on envoie au serveur pour que l'adversaire nous voie */
  get currentLane() {
    return this.lane
  }

  get isSliding() {
    return this.sliding > 0
  }

  moveLeft() {
    if (this.lane === 0) return // déjà au bord : pas de virage dans le vide
    this.lane--
    this.vire = -1
    this.vireT = VIRAGE_TEMPS
  }

  moveRight() {
    if (this.lane === 2) return
    this.lane++
    this.vire = 1
    this.vireT = VIRAGE_TEMPS
  }

  /**
   * Saute. `grue` = le 🕊️ Saut de la Grue est actif : on garde alors UN saut
   * en réserve, utilisable en plein vol. Le rab est armé au décollage et non
   * au moment du second appui : activer le parchemin en l'air ne sauve pas un
   * saut déjà mal parti.
   *
   * Renvoie l'impulsion utilisée (0 = pas sauté) — le réseau s'en sert pour
   * rejouer le même saut chez l'adversaire.
   */
  jump(grue = false): number {
    if (this.onGround) {
      this.vy = JUMP_SPEED * this.fighter.jump
      this.sliding = 0
      this.rabSaut = grue ? 1 : 0
      return this.vy
    } else if (this.rabSaut > 0) {
      this.rabSaut--
      this.vy = JUMP_SPEED * this.fighter.jump
      this.sliding = 0
      return this.vy
    }
    return 0
  }

  /**
   * ————— Frapper —————
   * L'attaque a une durée : pendant `ATTACK_TIME`, la lame est sortie et on ne
   * peut pas réenchaîner. C'est ce petit verrou qui fait qu'on ne gagne pas la
   * course en martelant l'écran au hasard — il faut viser la jarre suivante.
   *
   * Renvoie false si un coup est déjà en cours (le swipe est alors ignoré).
   */
  attaquer(): boolean {
    if (this.attackT > 0) return false
    this.attackT = ATTACK_TIME
    this.sliding = 0 // on ne frappe pas accroupi
    this.anim.declencher('attaque')
    return true
  }

  /**
   * Le rebond d'un coup porté EN L'AIR : un VRAI saut, exactement celui d'un
   * swipe vers le haut — mais donné automatiquement par le coup.
   *
   * C'est lui qui rend la chaîne possible : on repart de jarre en jarre sans
   * jamais toucher le sol, et tant qu'on vole on survole les obstacles.
   * Un coup donné au sol, lui, ne fait pas rebondir — il faut déjà être en
   * l'air pour enchaîner, donc décider de sauter AVANT d'arriver sur la grappe.
   */
  rebond() {
    this.vy = JUMP_SPEED * this.fighter.jump
  }

  /**
   * Le rebond SUR une cible : on se pose dessus avant de repartir, comme on
   * rebondit sur la tête d'un ennemi.
   *
   * Ce recalage de hauteur est ce qui rend la chaîne stable : chaque bond
   * repart exactement du même niveau, donc décrit exactement le même arc.
   * Sans lui, la moindre différence de hauteur au contact s'accumulerait d'un
   * bond à l'autre et l'on finirait par dériver — vers le ciel ou vers le sol.
   */
  /**
   * Rebondir sur le sommet d'une jarre qu'on vient de briser.
   *
   * ⚠️ L'impulsion est FIXE — surtout pas multipliée par le passif de saut.
   *
   * L'espacement des jarres est calculé par la graine, donc identique pour tout
   * le monde : c'est la règle du multi, les deux joueurs voient la même piste.
   * Mais tant que le rebond suivait `fighter.jump` (0,88 à 1,18 selon le
   * guerrier), la chaîne n'était calibrée que pour Yasuke. Mesuré : Yasuke
   * enchaînait 10 jarres sur 10, **les trois autres AUCUNE** — Hana passait
   * 1,66 m au-dessus de la suivante, hors de portée de lame.
   *
   * Le rebond appartient donc à la JARRE, pas aux jambes : c'est un tremplin, et
   * un tremplin renvoie tout le monde à la même hauteur. Le passif de saut garde
   * tout son sens là où il est né — les sauts ordinaires, et les murs.
   */
  rebondSur(hauteur: number) {
    this.mesh.position.y = hauteur
    this.vy = JUMP_SPEED
  }

  get enAttaque() {
    return this.attackT > 0
  }

  /** Est-on en train de longer une paroi ? (0 = non) */
  get surMur() {
    return this.mur
  }

  /**
   * ————— S'accrocher à la paroi —————
   * Uniquement EN VOL : le mur est une manœuvre aérienne, pas un raccourci
   * qu'on prend au sol. Il faut donc décider de sauter avant d'y arriver.
   *
   * `x` dit à QUELLE abscisse se coller. Par défaut le bord de piste, mais le
   * flanc d'une plateforme est une paroi comme une autre : on n'escalade un mur
   * que de FACE, alors que de côté on doit pouvoir le longer.
   */
  accrocheMur(cote: -1 | 1, x = cote * MUR_X): boolean {
    if (this.mur !== 0 || this.onGround) return false
    this.mur = cote
    this.murX = x
    this.murT = MUR_DUREE
    this.vy = 0 // on se colle : plus de gravité tant qu'on tient
    this.sliding = 0
    return true
  }

  /**
   * On quitte la paroi — et elle nous RENVOIE EN L'AIR. C'est tout l'intérêt :
   * on ressort en vol, donc encore capable de frapper une jarre et d'enchaîner.
   * Le corps retombe ensuite sur sa voie tout seul, par la gravité.
   */
  lacheMur() {
    if (this.mur === 0) return
    this.mur = 0
    this.murT = 0
    this.vy = JUMP_SPEED * this.fighter.jump
  }

  /** Glisse au sol (renvoie la durée) ou plonge en l'air (renvoie 0). */
  slide(): number {
    if (this.onGround) {
      this.sliding = SLIDE_TIME * this.fighter.slide
      return this.sliding
    }
    this.vy = -18 // en l'air : plonge vite vers le sol
    return 0
  }

  update(dt: number) {
    this.tAnim += dt
    this.vireT = Math.max(0, this.vireT - dt)
    // Le mouvement suit l'ÉTAT, pas une horloge : au sol on court, en l'air on
    // joue le saut, au ras du sol la glissade. Le lecteur enchaîne en fondu.
    // (Sur le mur, action() rend 'saut' — pas de clip dédié, mais c'est déjà en l'air.)
    animerGuerrier(this.racine, this.fighter, this.anim, this.action(), dt, this.tAnim)

    // ————— Accroché à la paroi —————
    // La gravité ne s'applique plus : on court à l'horizontale, collé au mur.
    // Quand le temps est écoulé, la paroi nous relance en l'air (lacheMur).
    if (this.mur !== 0) {
      this.murT -= dt
      if (this.murT > 0) {
        const k = Math.min(1, dt * 14)
        this.mesh.position.x += (this.murX - this.mesh.position.x) * k
        this.mesh.position.y += (MUR_HAUTEUR - this.mesh.position.y) * Math.min(1, dt * 12)
        // Le corps bascule vers la paroi : c'est ce qui fait « tenir » au mur
        this.mesh.rotation.z += (this.mur * 0.55 - this.mesh.rotation.z) * k
        this.sliding = 0
        return // ni voie, ni gravité, ni glissade tant qu'on tient
      }
      this.lacheMur()
    }

    // ————— L'escalade —————
    // On se hisse : la gravité ne s'applique plus, on monte jusqu'au sommet.
    // Le corps se redresse contre la paroi le temps de passer.
    if (this.escaladeT > 0) {
      this.escaladeT -= dt
      this.vy = 0
      this.sliding = 0
      const k = Math.min(1, dt * 9)
      this.mesh.position.y += (this.escaladeVers - this.mesh.position.y) * k
      if (this.escaladeT <= 0) this.mesh.position.y = this.escaladeVers
      return // ni voie, ni gravité tant qu'on se hisse
    }

    // Glisse en douceur vers la ligne choisie
    const targetX = LANES[this.lane]
    const k = Math.min(1, dt * LANE_LERP * this.fighter.laneSpeed)
    this.mesh.position.x += (targetX - this.mesh.position.x) * k

    // Gravité + saut — vers `sol`, qui n'est pas toujours la piste
    this.mesh.position.y += this.vy * dt
    if (this.mesh.position.y > this.sol) {
      this.vy -= GRAVITY * dt
    } else {
      this.mesh.position.y = this.sol
      this.vy = 0
    }

    // Glissade : le perso s'aplatit puis se relève
    this.sliding = Math.max(0, this.sliding - dt)
    const targetScale = this.sliding > 0 ? 0.45 : 1
    this.mesh.scale.y += (targetScale - this.mesh.scale.y) * Math.min(1, dt * 18)

    // Le coup : le corps pivote vif à l'impact puis revient. Tout est encore en
    // boîtes, donc l'inclinaison EST l'animation — c'est le seul signal qui dit
    // « ton coup est parti » sans regarder le HUD.
    this.attackT = Math.max(0, this.attackT - dt)
    const penche = this.attackT > 0 ? Math.sin((this.attackT / ATTACK_TIME) * Math.PI) * 0.5 : 0
    this.mesh.rotation.z += (penche - this.mesh.rotation.z) * Math.min(1, dt * 22)
  }

  /**
   * La boîte de collision du joueur (plus petite quand il glisse).
   *
   * ⚠️ Elle est VOLONTAIREMENT identique pour tous les guerriers, alors que
   * leurs corps n'ont pas la même largeur à l'écran. Une hitbox plus fine pour
   * Hana serait un 5ᵉ réglage invisible : personne ne l'aurait choisie en
   * connaissance de cause, et ça fausserait tous les duels.
   */
  hitbox(): THREE.Box3 {
    const p = this.mesh.position
    const h = 1.5 * this.mesh.scale.y
    return new THREE.Box3(
      new THREE.Vector3(p.x - 0.3, p.y + 0.05, p.z - 0.3),
      new THREE.Vector3(p.x + 0.3, p.y + h, p.z + 0.3)
    )
  }
}
