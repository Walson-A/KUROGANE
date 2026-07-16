/** Ce que le jeu doit faire quand le joueur agit */
export interface Handlers {
  left(): void
  right(): void
  jump(): void
  slide(): void
  spell(): void
}

const SWIPE_MIN = 24 // pixels minimum pour compter comme un swipe
const DOUBLE_TAP_MS = 300 // délai max entre 2 taps

/**
 * Les contrôles : clavier (PC) + swipes et double-tap (mobile).
 * Swipe ⬅️➡️ = changer de ligne, ⬆️ = saut, ⬇️ = glissade, double-tap = sort.
 */
export class Input {
  private touchX = 0
  private touchY = 0
  private lastTap = 0

  constructor(el: HTMLElement, h: Handlers) {
    // — Clavier (flèches + ZQSD pour les claviers français) —
    addEventListener('keydown', (e) => {
      switch (e.key.toLowerCase()) {
        case 'arrowleft':
        case 'q':
          h.left()
          break
        case 'arrowright':
        case 'd':
          h.right()
          break
        case 'arrowup':
        case 'z':
        case ' ':
          h.jump()
          break
        case 'arrowdown':
        case 's':
          h.slide()
          break
        case 'e':
          h.spell()
          break
      }
    })

    // — Tactile —
    el.addEventListener(
      'touchstart',
      (e) => {
        const t = e.changedTouches[0]
        this.touchX = t.clientX
        this.touchY = t.clientY
      },
      { passive: true }
    )

    el.addEventListener(
      'touchend',
      (e) => {
        const t = e.changedTouches[0]
        const dx = t.clientX - this.touchX
        const dy = t.clientY - this.touchY
        const now = performance.now()

        // Petit mouvement = un tap → deux taps rapprochés = sort !
        if (Math.abs(dx) < SWIPE_MIN && Math.abs(dy) < SWIPE_MIN) {
          if (now - this.lastTap < DOUBLE_TAP_MS) {
            h.spell()
            this.lastTap = 0
          } else {
            this.lastTap = now
          }
          return
        }

        // Sinon : swipe dans la direction dominante
        if (Math.abs(dx) > Math.abs(dy)) {
          dx > 0 ? h.right() : h.left()
        } else {
          dy < 0 ? h.jump() : h.slide()
        }
      },
      { passive: true }
    )
  }
}
