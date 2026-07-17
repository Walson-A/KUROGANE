import * as THREE from 'three'

/**
 * L'étiquette de nom qui flotte au-dessus de la tête d'un coureur.
 *
 * C'est un SPRITE : un petit panneau qui fait toujours face à la caméra, quoi
 * qu'il arrive. On y colle une image dessinée par nos soins (un canvas 2D avec
 * une pastille et du texte) — pas de police 3D à charger, pas d'asset : ça pèse
 * zéro octet au téléchargement.
 */

/** Hauteur de l'étiquette dans le monde 3D, en mètres */
const TAG_HEIGHT = 0.34

/**
 * La distance à laquelle l'étiquette a sa taille naturelle. Au-delà, on
 * l'agrandit pour compenser la perspective (cf. follow).
 */
const REF_DIST = 9
/** Jusqu'où on compense — au-delà, le rival est trop loin, tant pis */
const MAX_GROW = 3.2

/** Hauteur du corps d'un guerrier (cf. roster.ts) — l'étiquette se pose dessus */
const BODY_HEIGHT = 1.55
/** L'espace entre le sommet du crâne et l'étiquette */
const GAP = 0.42

export class NameTag {
  private sprite: THREE.Sprite
  private canvas = document.createElement('canvas')
  private ctx = this.canvas.getContext('2d')!
  private texture: THREE.CanvasTexture
  private aspect = 4
  private text = ''
  private color = ''

  constructor(scene: THREE.Scene) {
    this.texture = new THREE.CanvasTexture(this.canvas)
    this.texture.colorSpace = THREE.SRGBColorSpace

    this.sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.texture,
        transparent: true,
        depthWrite: false, // ne masque pas ce qui est derrière
        // Pas de brume sur le texte : un nom à moitié effacé ne sert à rien.
        // Le rival lointain reste identifiable même quand son corps s'estompe.
        fog: false,
      })
    )
    this.sprite.visible = false
    scene.add(this.sprite)
  }

  /**
   * Écrit le nom sur l'étiquette. `color` est une couleur CSS ('#rrggbb').
   * Ne redessine QUE si quelque chose a changé : l'appelant peut taper dedans
   * 30 fois par seconde (le réseau nous répète le nom du rival à chaque état)
   * sans qu'on refabrique une texture pour rien.
   */
  set(text: string, color: string) {
    if (text === this.text && color === this.color) return
    this.text = text
    this.color = color

    if (!text) {
      this.sprite.visible = false
      return
    }

    // ×2 : on dessine en double résolution, sinon le texte bave une fois
    // étiré sur le sprite.
    const S = 2
    const font = `700 ${34 * S}px system-ui, -apple-system, "Segoe UI", sans-serif`
    this.ctx.font = font
    const w = Math.ceil(this.ctx.measureText(text).width) + 30 * S
    const h = 52 * S

    // ⚠️ Redimensionner un canvas le vide ET remet son contexte à zéro :
    // la police doit être re-déclarée APRÈS, sinon le texte sort en 10px Sans.
    this.canvas.width = w
    this.canvas.height = h
    const c = this.ctx
    c.font = font
    c.textAlign = 'center'
    c.textBaseline = 'middle'

    // La pastille sombre, pour rester lisible sur n'importe quel décor
    c.fillStyle = 'rgba(13, 16, 28, 0.74)'
    c.beginPath()
    c.roundRect(0, 0, w, h, 15 * S)
    c.fill()

    // Le liseré : la couleur du bandeau du guerrier
    c.strokeStyle = color
    c.lineWidth = 2 * S
    c.beginPath()
    c.roundRect(S, S, w - 2 * S, h - 2 * S, 14 * S)
    c.stroke()

    c.fillStyle = color
    c.fillText(text, w / 2, h / 2 + S)

    this.aspect = w / h
    this.texture.needsUpdate = true
  }

  /**
   * Colle l'étiquette au-dessus de la tête du coureur.
   * À appeler à chaque image : elle a besoin de la caméra, d'où le fait que ce
   * soit main.ts qui la pilote et pas Player.update().
   */
  follow(mesh: THREE.Object3D, camera: THREE.Camera, visible: boolean) {
    this.sprite.visible = visible && this.text !== ''
    if (!this.sprite.visible) return

    // La tête descend quand le perso s'écrase pour glisser (scale.y = 0.45) :
    // l'étiquette suit, sinon elle flotte toute seule au-dessus du vide.
    this.sprite.position.set(
      mesh.position.x,
      mesh.position.y + BODY_HEIGHT * mesh.scale.y + GAP,
      mesh.position.z
    )

    // ————— Compensation de la perspective —————
    // Sans elle, le rival à 70 m aurait une étiquette de 3 pixels de haut,
    // donc illisible — exactement quand on a le plus besoin de savoir qui
    // c'est. On l'agrandit avec la distance pour garder une taille à l'écran
    // à peu près constante, en plafonnant pour ne pas obtenir un panneau
    // publicitaire au fond de la piste.
    const d = camera.position.distanceTo(this.sprite.position)
    const grow = THREE.MathUtils.clamp(d / REF_DIST, 1, MAX_GROW)
    const h = TAG_HEIGHT * grow
    this.sprite.scale.set(h * this.aspect, h, 1)
  }
}
