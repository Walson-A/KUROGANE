import * as THREE from 'three'

/** Les 3 lignes de course (positions X dans le monde 3D) */
export const LANES = [-2.2, 0, 2.2]

const GRAVITY = 42 // force qui te ramène au sol
const JUMP_SPEED = 14 // impulsion du saut
const SLIDE_TIME = 0.55 // durée d'une glissade (secondes)

/**
 * Le coureur (Yasuke en version placeholder : une armure noire + bandeau rouge).
 * Il ne se déplace QUE sur l'axe X (les 3 lignes) et Y (saut).
 * C'est le décor qui défile vers lui — illusion classique des runners.
 */
export class Player {
  mesh = new THREE.Group()
  private lane = 1 // 0 = gauche, 1 = centre, 2 = droite
  private vy = 0 // vitesse verticale
  private sliding = 0 // temps de glissade restant

  constructor(scene: THREE.Scene) {
    // Le corps : l'armure d'acier noir
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 1.5, 0.8),
      new THREE.MeshStandardMaterial({ color: 0x23252d, roughness: 0.55 })
    )
    body.position.y = 0.75

    // Le bandeau rouge — le panache du samouraï
    const band = new THREE.Mesh(
      new THREE.BoxGeometry(0.84, 0.14, 0.84),
      new THREE.MeshStandardMaterial({ color: 0xc33a2c })
    )
    band.position.y = 1.26

    this.mesh.add(body, band)
    scene.add(this.mesh)
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

  moveLeft() {
    this.lane = Math.max(0, this.lane - 1)
  }

  moveRight() {
    this.lane = Math.min(2, this.lane + 1)
  }

  jump() {
    if (this.onGround) {
      this.vy = JUMP_SPEED
      this.sliding = 0
    }
  }

  slide() {
    if (this.onGround) this.sliding = SLIDE_TIME
    else this.vy = -18 // en l'air : plonge vite vers le sol
  }

  update(dt: number) {
    // Glisse en douceur vers la ligne choisie
    const targetX = LANES[this.lane]
    this.mesh.position.x += (targetX - this.mesh.position.x) * Math.min(1, dt * 12)

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

  /** La boîte de collision du joueur (plus petite quand il glisse) */
  hitbox(): THREE.Box3 {
    const p = this.mesh.position
    const h = 1.5 * this.mesh.scale.y
    return new THREE.Box3(
      new THREE.Vector3(p.x - 0.3, p.y + 0.05, p.z - 0.3),
      new THREE.Vector3(p.x + 0.3, p.y + h, p.z + 0.3)
    )
  }
}
