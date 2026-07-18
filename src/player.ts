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
const JUMP_SPEED = 13.2
const ATTACK_TIME = 0.26 // durée d'un coup : on ne peut pas réenchaîner avant
/** Combien de temps on tient sur une paroi (secondes). Exporté : le rival
 *  rejoue la même durée chez nous (cf. opponent.ts). */
export const MUR_DUREE = 0.95
const MUR_HAUTEUR = 1.6 // à quelle hauteur on y court
/**
 * Le RESTE d'inclinaison qu'ajoute le jeu par-dessus le clip de course sur mur.
 * Exporté : le rival penche pareil chez nous (cf. opponent.ts).
 * C'est le chiffre à retoucher si la pose au mur ne plaît pas — le clip, lui,
 * apporte déjà 0,48 rad.
 */
export const MUR_PENCHE = 0.18
const SLIDE_TIME = 0.55 // durée d'une glissade (secondes)
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
    // 🧱 La paroi prime sur tout : on y court à l'horizontale, ce n'est ni un
    // saut ni une glissade. Le clip dure 0,93 s pour un passage de 0,95 s.
    if (this.mur !== 0) return 'mur'
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

  get onGround() {
    return this.mesh.position.y <= 0.001
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
  rebondSur(hauteur: number) {
    this.mesh.position.y = hauteur
    this.vy = JUMP_SPEED * this.fighter.jump
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
   */
  accrocheMur(cote: -1 | 1): boolean {
    if (this.mur !== 0 || this.onGround) return false
    this.mur = cote
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
    // joue le saut, au ras du sol la glissade, sur la paroi la course de mur.
    // Le lecteur enchaîne en fondu.
    animerGuerrier(this.racine, this.fighter, this.anim, this.action(), dt, this.tAnim)

    // ————— Accroché à la paroi —————
    // La gravité ne s'applique plus : on court à l'horizontale, collé au mur.
    // Quand le temps est écoulé, la paroi nous relance en l'air (lacheMur).
    if (this.mur !== 0) {
      this.murT -= dt
      if (this.murT > 0) {
        const k = Math.min(1, dt * 14)
        this.mesh.position.x += (this.mur * MUR_X - this.mesh.position.x) * k
        this.mesh.position.y += (MUR_HAUTEUR - this.mesh.position.y) * Math.min(1, dt * 12)
        // Le corps bascule vers la paroi : c'est ce qui fait « tenir » au mur.
        //
        // ⚠️ Volontairement DISCRET depuis qu'il y a un vrai clip de course sur
        // mur : celui-ci penche déjà le buste de 0,48 rad à lui seul. Les 0,55
        // d'origine, calés à l'époque où le corps restait droit, portaient le
        // total à 59° — le coureur basculait presque à l'horizontale.
        this.mesh.rotation.z += (this.mur * MUR_PENCHE - this.mesh.rotation.z) * k
        this.sliding = 0
        return // ni voie, ni gravité, ni glissade tant qu'on tient
      }
      this.lacheMur()
    }

    // Glisse en douceur vers la ligne choisie
    const targetX = LANES[this.lane]
    const k = Math.min(1, dt * LANE_LERP * this.fighter.laneSpeed)
    this.mesh.position.x += (targetX - this.mesh.position.x) * k

    // Gravité + saut
    this.mesh.position.y += this.vy * dt
    if (this.mesh.position.y > 0) {
      this.vy -= GRAVITY * dt
    } else {
      this.mesh.position.y = 0
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
