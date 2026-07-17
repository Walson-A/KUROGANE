import * as THREE from 'three'
import { ROSTER, buildFighter, clearFighter, type Fighter } from './roster'

/** Les 3 lignes de course (positions X dans le monde 3D) */
export const LANES = [-2.2, 0, 2.2]

/*
 * Les valeurs de RÉFÉRENCE — celles de Yasuke.
 * Chaque guerrier les multiplie par ses propres réglages (cf. roster.ts).
 */
const GRAVITY = 42 // force qui te ramène au sol
const JUMP_SPEED = 14 // impulsion du saut
const SLIDE_TIME = 0.55 // durée d'une glissade (secondes)
const LANE_LERP = 12 // vitesse de glissement vers la ligne visée

/**
 * Le coureur : le guerrier choisi dans le menu.
 * Il ne se déplace QUE sur l'axe X (les 3 lignes) et Y (saut).
 * C'est le décor qui défile vers lui — illusion classique des runners.
 */
export class Player {
  mesh = new THREE.Group()
  private fighter: Fighter = ROSTER[0]
  private lane = 1 // 0 = gauche, 1 = centre, 2 = droite
  private vy = 0 // vitesse verticale
  private sliding = 0 // temps de glissade restant

  constructor(scene: THREE.Scene) {
    scene.add(this.mesh)
    this.setFighter(ROSTER[0])
  }

  /** Change de guerrier (depuis le menu) : nouveau look, nouveaux réglages. */
  setFighter(f: Fighter) {
    this.fighter = f
    clearFighter(this.mesh)
    this.mesh.add(...buildFighter(f))
  }

  /**
   * La part de vitesse gardée quand on trébuche — le passif d'Oni-Maru.
   * C'est main.ts qui applique la perte, parce que c'est lui qui tient la vitesse.
   */
  get grip() {
    return this.fighter.grip
  }

  reset() {
    this.lane = 1
    this.vy = 0
    this.sliding = 0
    this.mesh.position.set(0, 0, 0)
    this.mesh.scale.y = 1
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
    this.lane = Math.max(0, this.lane - 1)
  }

  moveRight() {
    this.lane = Math.min(2, this.lane + 1)
  }

  /** Saute si possible. Renvoie l'impulsion utilisée (0 = pas sauté) — le
   *  réseau s'en sert pour rejouer le même saut chez l'adversaire. */
  jump(): number {
    if (!this.onGround) return 0
    this.vy = JUMP_SPEED * this.fighter.jump
    this.sliding = 0
    return this.vy
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
