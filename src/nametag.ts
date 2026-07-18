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
const TAG_HEIGHT = 0.3

/**
 * La distance à laquelle l'étiquette a sa taille naturelle. Au-delà, on
 * l'agrandit pour compenser la perspective (cf. follow).
 *
 * MAX_GROW était à 3,2 : un rival au fond de la piste se retrouvait coiffé
 * d'un panneau plus large que lui. 2,4 suffit à garder le nom lisible sans
 * qu'il écrase la scène.
 */
const REF_DIST = 10
const MAX_GROW = 2.4

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

    /*
     * ————— Le dessin de l'étiquette —————
     *
     * Le texte est en IVOIRE, jamais à la couleur du guerrier. C'était le
     * défaut du modèle précédent : un bandeau sombre (l'acier de Kurokumo, un
     * skin perso presque noir) donnait un nom illisible sur une pastille déjà
     * sombre. La couleur identifie, elle ne doit pas porter la lisibilité.
     *
     * Elle passe donc dans deux ACCENTS qui ne gênent jamais la lecture :
     * une pastille ronde à gauche et un trait sous le nom — exactement le
     * liseré coloré des vignettes du vestiaire. Même langage, partout.
     */
    const S = 2 // double résolution : sinon le texte bave une fois étiré
    const POLICE = 30
    const font = `700 ${POLICE * S}px system-ui, -apple-system, "Segoe UI", sans-serif`
    this.ctx.font = font

    const pastille = 11 * S // le rayon du point de couleur
    const marge = 13 * S
    const ecart = 9 * S // entre la pastille et le texte
    const largeurTexte = Math.ceil(this.ctx.measureText(text).width)
    const w = marge + pastille * 2 + ecart + largeurTexte + marge
    const h = 46 * S

    // ⚠️ Redimensionner un canvas le vide ET remet son contexte à zéro :
    // la police doit être re-déclarée APRÈS, sinon le texte sort en 10px Sans.
    this.canvas.width = w
    this.canvas.height = h
    const c = this.ctx
    c.font = font
    c.textAlign = 'left'
    c.textBaseline = 'middle'

    // Le fond, franchement opaque : l'étiquette passe devant des décors très
    // variés (sol sombre, torii doré, brume claire) et doit tenir sur tous.
    c.fillStyle = 'rgba(13, 16, 28, 0.82)'
    c.beginPath()
    c.roundRect(0, 0, w, h, 12 * S)
    c.fill()

    // Accent 1 — le trait sous le nom, comme les vignettes du vestiaire
    c.fillStyle = color
    c.beginPath()
    c.roundRect(0, h - 3.5 * S, w, 3.5 * S, [0, 0, 12 * S, 12 * S])
    c.fill()

    // Accent 2 — la pastille de couleur, à gauche
    const cx = marge + pastille
    c.beginPath()
    c.arc(cx, h / 2 - S, pastille, 0, Math.PI * 2)
    c.fill()

    // Le nom : ivoire, avec un contour sombre. Le contour est ce qui le sauve
    // quand l'étiquette passe devant une jarre dorée ou le torii.
    const x = cx + pastille + ecart
    const y = h / 2 - S
    c.lineWidth = 3 * S
    c.strokeStyle = 'rgba(6, 8, 14, 0.9)'
    c.lineJoin = 'round'
    c.strokeText(text, x, y)
    c.fillStyle = '#f4eedf'
    c.fillText(text, x, y)

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
