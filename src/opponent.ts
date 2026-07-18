import * as THREE from 'three'
import { LANES, VIRAGE_TEMPS } from './player'
import { NameTag } from './nametag'
import { buildFighter, clearFighter, cssColor, fighterById, type Fighter } from './roster'
import { Anim, animerGuerrier, type Action } from './anims'
import type { OppAction } from './net'

/** Ce que le réseau nous apprend sur l'adversaire à chaque message */
export interface NetInfo {
  lane: number
  y: number
  distance: number
  sliding: boolean
}

/**
 * L'adversaire : le guerrier que L'AUTRE joueur a choisi (son identité arrive
 * par le réseau). Tant qu'on ne la connaît pas, il porte les couleurs de
 * Kurokumo — le rival de toujours.
 *
 * Il est affiché en FANTÔME semi-transparent : au départ et à chaque
 * dépassement, les deux coureurs se superposent — il faut voir à travers.
 * C'est aussi ce qui permet de le reconnaître si les deux joueurs ont choisi
 * le même guerrier.
 *
 * ————— Le problème du retard réseau —————
 * Ses positions n'arrivent que ~20 fois/s, après un temps de trajet. Afficher
 * bêtement la dernière position reçue = le voir TOUJOURS en retard (5 à 8 m
 * à pleine vitesse !) : on croirait le doubler à tort.
 *
 * La solution des vrais jeux de course : l'EXTRAPOLATION (dead reckoning).
 * On mesure sa vitesse entre deux messages, et on l'affiche là où il DOIT
 * être maintenant = dernière position + vitesse × (âge du message + latence).
 */
export class Opponent {
  mesh = new THREE.Group()
  active = false
  /** Latence aller simple estimée (secondes) — mesurée par net.ts (ping) */
  latency = 0

  private lane = 1
  private targetY = 0
  private sliding = false
  private lastDistance = 0 // la dernière position REÇUE
  private lastMsgAt = 0 // quand elle a été ENVOYÉE, dans notre horloge (s)
  private stamped = false // était-elle horodatée ? (sinon on ajoute `latency`)
  private netSpeed = 0 // sa vitesse, déduite des deux derniers messages
  private estDistance = 0 // où on l'affiche : notre meilleure estimation

  // Les actions instantanées (cf. applyAction)
  private vy = 0 // son saut, rejoué en physique locale
  private slideTimer = 0 // sa glissade, déclenchée à l'instant
  private stumbleT = 0 // il se relève d'un trébuchement (clignote)

  private fighter: Fighter = fighterById('kurokumo')
  private racine?: THREE.Object3D // son corps articulé
  private tAnim = 0 // l'horloge de SA foulée calculée (repli et flottants)
  /** Son lecteur, décalé au hasard pour ne pas courir au pas avec les autres */
  private anim = new Anim(Math.random() * 3)

  private vire = 0 // le côté de son virage : -1 gauche, +1 droite
  private vireT = 0 // ce qu'il en reste

  /**
   * 🔥 Vrai dans le sprint final. On le déduit de SA distance, pas de la
   * nôtre : dans un peloton de dix, chacun entre dans le sprint à son tour.
   * Le vent, lui, ne transite pas par le réseau — on ne peut pas le savoir.
   */
  presse = false

  /** Le mouvement que réclame son état courant (cf. Player.action). */
  private action(): Action {
    if (this.stumbleT > 0) return 'courseGenee'
    if (this.sliding || this.slideTimer > 0) return 'glissade'
    if (this.mesh.position.y > 0.001) return 'saut'
    if (this.vireT > 0) return this.vire < 0 ? 'virageG' : 'virageD'
    return this.presse ? 'courseRapide' : 'course'
  }

  /** Son pseudo, qui flotte au-dessus de sa tête. Piloté par main.ts. */
  readonly tag: NameTag

  constructor(scene: THREE.Scene) {
    this.mesh.visible = false
    scene.add(this.mesh)
    this.tag = new NameTag(scene)
    this.build()
  }

  /**
   * Habille le rival avec le guerrier qu'il a choisi.
   * Appelé quand le réseau nous l'apprend — donc on ne refait le corps que si
   * ça change vraiment, pas 30 fois par seconde.
   */
  setFighter(id: string) {
    const f = fighterById(id)
    if (f.id === this.fighter.id) return
    this.fighter = f
    this.build()
  }

  /**
   * Écrit son nom au-dessus de sa tête, dans la couleur de SON bandeau.
   * Appelé à chaque état reçu : NameTag.set() ne redessine que si ça change.
   */
  setName(pseudo: string) {
    this.tag.set(pseudo, cssColor(this.fighter.band))
  }

  private build() {
    clearFighter(this.mesh)
    const parts = buildFighter(this.fighter, true) // true = fantôme
    this.racine = parts[0]
    this.mesh.add(...parts)
  }

  /** Se met en place. `lane` : sa ligne sur la grille de départ. */
  reset(lane = 1) {
    this.lane = lane
    this.targetY = 0
    this.sliding = false
    this.lastDistance = 0
    this.lastMsgAt = 0
    this.stamped = false
    this.netSpeed = 0
    this.estDistance = 0
    this.vy = 0
    this.slideTimer = 0
    this.stumbleT = 0
    this.vireT = 0
    // Sur SA ligne de la grille, à la même hauteur que nous : une vraie ligne de départ
    this.mesh.position.set(LANES[lane], 0, 0)
    this.mesh.scale.y = 1
    this.mesh.visible = false
  }

  /**
   * Un message réseau vient d'arriver : on met à jour ce qu'on sait de lui.
   * `age` = ancienneté RÉELLE du message en secondes, connue grâce à la synchro
   * d'horloge (net.ageOf). −1 si pas encore synchronisé → on se rabat sur
   * l'heure d'arrivée + la latence estimée.
   */
  onNetUpdate(op: NetInfo, age = -1) {
    const now = performance.now() / 1000
    this.stamped = age >= 0
    const sentAt = this.stamped ? now - age : now

    const gap = sentAt - this.lastMsgAt
    if (this.lastMsgAt > 0 && gap > 0.001) {
      const v = (op.distance - this.lastDistance) / gap
      // On borne à une vitesse humaine : un à-coup réseau ne le téléporte pas
      if (v >= 0 && v < 45) this.netSpeed = v
    }
    this.lastMsgAt = Math.max(this.lastMsgAt, sentAt)
    this.lastDistance = op.distance
    this.lane = op.lane
    this.targetY = op.y
    this.sliding = op.sliding
  }

  /**
   * Une action du rival, relayée IMMÉDIATEMENT par le serveur (hors 30 Hz) :
   * on la rejoue tout de suite, sans attendre de la déduire des positions.
   */
  applyAction(a: OppAction) {
    if (a.t === 'lane') {
      const vise = Math.max(0, Math.min(2, Math.round(a.lane)))
      // Il penche du côté où il part — on le déduit de sa ligne précédente,
      // le réseau ne transmet que la ligne d'arrivée.
      if (vise !== this.lane) {
        this.vire = vise < this.lane ? -1 : 1
        this.vireT = VIRAGE_TEMPS
      }
      this.lane = vise
    } else if (a.t === 'jump') {
      // On rejoue son saut en physique locale : mêmes règles que player.ts
      this.vy = Math.min(20, Math.max(5, a.v))
    } else if (a.t === 'slide') {
      this.slideTimer = Math.min(1.5, Math.max(0, a.d))
    } else if (a.t === 'stumble') {
      // Il trébuche : sa vitesse chute TOUT DE SUITE dans notre extrapolation
      // (au lieu d'attendre de la mesurer sur ses prochaines positions)…
      this.netSpeed *= Math.min(1, Math.max(0, a.keep))
      // …et il clignote le temps de se relever, comme chez lui
      this.stumbleT = 1.2
      this.anim.declencher('impact') // 😖 on le voit encaisser
    }
  }

  /**
   * Le GO vient de sonner : il court forcément (~12 m/s minimum).
   * Sans ça, l'extrapolation part de vitesse 0 et attend ses deux premiers
   * messages pour le mettre en mouvement → il semblait mou au départ.
   */
  go() {
    if (this.netSpeed < 12) this.netSpeed = 12
  }

  /** Sa ligne actuelle — pour savoir si on peut le frapper. */
  get laneNow() {
    return this.lane
  }

  /**
   * Notre meilleure estimation de sa distance EN CE MOMENT.
   * C'est ELLE qu'il faut utiliser pour « qui est devant ? » (HUD, marqueur…),
   * jamais la position brute reçue, qui est toujours en retard.
   */
  get distanceNow() {
    return this.estDistance
  }

  get currentLane() {
    return this.lane
  }

  get currentFighter() {
    return this.fighter
  }

  update(dt: number, myDistance: number) {
    if (!this.active) {
      this.mesh.visible = false
      return
    }

    // Sa foulée tourne avec SA propre horloge : sans ça, les deux coureurs
    // seraient au pas cadencé comme des soldats.
    this.tAnim += dt
    this.vireT = Math.max(0, this.vireT - dt)
    animerGuerrier(this.racine, this.fighter, this.anim, this.action(), dt, this.tAnim)

    // ————— L'extrapolation —————
    // L'âge du message : exact si horodaté (synchro d'horloge), sinon estimé
    // via la latence. Si les messages s'arrêtent (gros lag), on n'invente pas
    // plus de 0,5 s de course : mieux vaut le voir freiner que traverser un mur.
    const now = performance.now() / 1000
    const raw = now - this.lastMsgAt + (this.stamped ? 0 : this.latency)
    const age = this.lastMsgAt > 0 ? Math.min(raw, 0.5) : 0
    const predicted = this.lastDistance + this.netSpeed * age

    // On glisse vers la prédiction ; en cas d'erreur énorme, on saute dessus
    if (Math.abs(predicted - this.estDistance) > 10) {
      this.estDistance = predicted
    } else {
      this.estDistance += (predicted - this.estDistance) * Math.min(1, dt * 12)
    }

    // Ligne
    const k = Math.min(1, dt * 10)
    this.mesh.position.x += (LANES[this.lane] - this.mesh.position.x) * k

    // Hauteur : si un événement « saut » est arrivé, on rejoue sa physique
    // nous-mêmes (net et immédiat) ; sinon on suit la hauteur reçue du réseau
    if (this.vy !== 0 || this.mesh.position.y > 0.001) {
      this.mesh.position.y += this.vy * dt
      if (this.mesh.position.y > 0) {
        this.vy -= 42 * dt // même gravité que player.ts
      } else {
        this.mesh.position.y = 0
        this.vy = 0
      }
    } else {
      this.mesh.position.y += (this.targetY - this.mesh.position.y) * Math.min(1, dt * 14)
    }

    // Son avance par rapport à nous : devant (z négatif) ou derrière (z positif)
    const zTarget = THREE.MathUtils.clamp(-(this.estDistance - myDistance), -70, 9)
    this.mesh.position.z += (zTarget - this.mesh.position.z) * Math.min(1, dt * 10)

    // Glissade : l'événement instantané d'abord, le flux d'état en secours
    this.slideTimer = Math.max(0, this.slideTimer - dt)
    const targetScale = this.sliding || this.slideTimer > 0 ? 0.45 : 1
    this.mesh.scale.y += (targetScale - this.mesh.scale.y) * Math.min(1, dt * 18)

    // Invisible s'il est trop loin (brume) ; il clignote s'il se relève
    this.stumbleT = Math.max(0, this.stumbleT - dt)
    const blink = this.stumbleT <= 0 || Math.floor(this.stumbleT * 12) % 2 === 0
    this.mesh.visible = this.mesh.position.z > -69 && blink
  }
}
