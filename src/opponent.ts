import * as THREE from 'three'
import { LANES } from './player'
import { buildFighter, clearFighter, fighterById, type Fighter } from './roster'

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
  private lastMsgAt = 0 // quand on l'a reçue (secondes)
  private netSpeed = 0 // sa vitesse, déduite des deux derniers messages
  private estDistance = 0 // où on l'affiche : notre meilleure estimation

  private fighter: Fighter = fighterById('kurokumo')

  constructor(scene: THREE.Scene) {
    this.mesh.visible = false
    scene.add(this.mesh)
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

  private build() {
    clearFighter(this.mesh)
    this.mesh.add(...buildFighter(this.fighter, true)) // true = fantôme
  }

  reset() {
    this.lane = 1
    this.targetY = 0
    this.sliding = false
    this.lastDistance = 0
    this.lastMsgAt = 0
    this.netSpeed = 0
    this.estDistance = 0
    this.mesh.position.set(0, 0, -2)
    this.mesh.scale.y = 1
    this.mesh.visible = false
  }

  /** Un message réseau vient d'arriver : on met à jour ce qu'on sait de lui */
  onNetUpdate(op: NetInfo) {
    const now = performance.now() / 1000
    const gap = now - this.lastMsgAt
    if (this.lastMsgAt > 0 && gap > 0.001) {
      const v = (op.distance - this.lastDistance) / gap
      // On borne à une vitesse humaine : un à-coup réseau ne le téléporte pas
      if (v >= 0 && v < 45) this.netSpeed = v
    }
    this.lastMsgAt = now
    this.lastDistance = op.distance
    this.lane = op.lane
    this.targetY = op.y
    this.sliding = op.sliding
  }

  /**
   * Notre meilleure estimation de sa distance EN CE MOMENT.
   * C'est ELLE qu'il faut utiliser pour « qui est devant ? » (HUD, marqueur…),
   * jamais la position brute reçue, qui est toujours en retard.
   */
  get distanceNow() {
    return this.estDistance
  }

  update(dt: number, myDistance: number) {
    if (!this.active) {
      this.mesh.visible = false
      return
    }

    // ————— L'extrapolation —————
    // Si les messages s'arrêtent (gros lag), on n'invente pas plus de 0,5 s
    // de course : mieux vaut le voir freiner que le voir traverser un mur.
    const now = performance.now() / 1000
    const age = this.lastMsgAt > 0 ? Math.min(now - this.lastMsgAt + this.latency, 0.5) : 0
    const predicted = this.lastDistance + this.netSpeed * age

    // On glisse vers la prédiction ; en cas d'erreur énorme, on saute dessus
    if (Math.abs(predicted - this.estDistance) > 10) {
      this.estDistance = predicted
    } else {
      this.estDistance += (predicted - this.estDistance) * Math.min(1, dt * 12)
    }

    // Ligne et hauteur (saut)
    const k = Math.min(1, dt * 10)
    this.mesh.position.x += (LANES[this.lane] - this.mesh.position.x) * k
    this.mesh.position.y += (this.targetY - this.mesh.position.y) * Math.min(1, dt * 14)

    // Son avance par rapport à nous : devant (z négatif) ou derrière (z positif)
    const zTarget = THREE.MathUtils.clamp(-(this.estDistance - myDistance), -70, 9)
    this.mesh.position.z += (zTarget - this.mesh.position.z) * Math.min(1, dt * 10)

    // Glissade
    const targetScale = this.sliding ? 0.45 : 1
    this.mesh.scale.y += (targetScale - this.mesh.scale.y) * Math.min(1, dt * 18)

    // Invisible s'il est trop loin (perdu dans la brume)
    this.mesh.visible = this.mesh.position.z > -69
  }
}
