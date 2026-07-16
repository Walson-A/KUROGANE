import * as THREE from 'three'
import { LANES } from './player'

/**
 * L'adversaire (Kurokumo, « nuage noir » : armure sombre + bandeau OR).
 * On ne le contrôle pas : on reçoit sa position par le réseau (~10 fois/s)
 * et on GLISSE en douceur vers elle entre deux nouvelles (interpolation).
 * Sa position sur la piste = SA distance parcourue moins LA NÔTRE.
 */
export class Opponent {
  mesh = new THREE.Group()

  /** Les dernières infos reçues du réseau */
  target = { lane: 1, y: 0, distance: 0, sliding: false }
  active = false

  constructor(scene: THREE.Scene) {
    // Armure sombre, presque noire
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 1.5, 0.8),
      new THREE.MeshStandardMaterial({ color: 0x2e2333, roughness: 0.55 })
    )
    body.position.y = 0.75

    // Le bandeau doré du champion
    const band = new THREE.Mesh(
      new THREE.BoxGeometry(0.84, 0.14, 0.84),
      new THREE.MeshStandardMaterial({ color: 0xd6ac5a })
    )
    band.position.y = 1.26

    this.mesh.add(body, band)
    this.mesh.visible = false
    scene.add(this.mesh)
  }

  reset() {
    this.target = { lane: 1, y: 0, distance: 0, sliding: false }
    this.mesh.position.set(0, 0, -2)
    this.mesh.scale.y = 1
    this.mesh.visible = false
  }

  update(dt: number, myDistance: number) {
    if (!this.active) {
      this.mesh.visible = false
      return
    }

    const k = Math.min(1, dt * 8) // vitesse de l'interpolation

    // Ligne et hauteur (saut)
    this.mesh.position.x += (LANES[this.target.lane] - this.mesh.position.x) * k
    this.mesh.position.y += (this.target.y - this.mesh.position.y) * Math.min(1, dt * 14)

    // Son avance par rapport à nous : devant (z négatif) ou derrière (z positif)
    const zTarget = THREE.MathUtils.clamp(-(this.target.distance - myDistance), -70, 9)
    this.mesh.position.z += (zTarget - this.mesh.position.z) * k

    // Glissade
    const targetScale = this.target.sliding ? 0.45 : 1
    this.mesh.scale.y += (targetScale - this.mesh.scale.y) * Math.min(1, dt * 18)

    // Invisible s'il est trop loin (perdu dans la brume)
    this.mesh.visible = this.mesh.position.z > -69
  }
}
