/** Ce que le jeu doit faire quand le joueur agit */
export interface Handlers {
  left(): void
  right(): void
  jump(): void
  slide(): void
  spell(): void
  /** Un coup de martèlement pendant le sprint final */
  sprint(): void
  /** Sommes-nous dans le sprint final ? Les taps accélèrent au lieu d'esquiver. */
  isSprint(): boolean
}

const SWIPE_MIN = 24 // pixels minimum pour compter comme un swipe
const DOUBLE_TAP_MS = 300 // délai max entre 2 taps

/**
 * Les contrôles : clavier (PC) + swipes et double-tap (mobile).
 * Swipe ⬅️➡️ = changer de ligne, ⬆️ = saut, ⬇️ = glissade, double-tap = sort.
 *
 * Pendant le SPRINT FINAL, tout bascule : chaque tap / clic / barre d'espace
 * devient un coup d'accélération. La cadence est plafonnée côté jeu pour que
 * le PC et le mobile soient à armes égales.
 */
export class Input {
  private touchX = 0
  private touchY = 0
  private lastTap = 0

  constructor(el: HTMLElement, h: Handlers) {
    // — Clavier (flèches + ZQSD pour les claviers français) —
    addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase()

      if (h.isSprint() && (k === ' ' || k === 'enter')) {
        // e.repeat : maintenir la touche enfoncée ne donne RIEN. Sans ça, la
        // répétition automatique du clavier martèlerait toute seule à ~30/s.
        if (!e.repeat) h.sprint()
        return
      }

      switch (k) {
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

    // — Souris (PC) : cliquer pour marteler —
    // pointerType filtre le tactile, qui émet aussi des événements souris
    // de compatibilité : sans ça, un tap mobile compterait double.
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse') return
      if (h.isSprint()) h.sprint()
    })

    // — Tactile —
    el.addEventListener(
      'touchstart',
      (e) => {
        if (h.isSprint()) {
          // Un doigt qui se pose = un coup. On compte CHAQUE doigt : le
          // martèlement à deux pouces doit marcher, et on répond dès la pose
          // plutôt qu'au relâchement (plus nerveux).
          for (let i = 0; i < e.changedTouches.length; i++) h.sprint()
          return
        }
        const t = e.changedTouches[0]
        this.touchX = t.clientX
        this.touchY = t.clientY
      },
      { passive: true }
    )

    el.addEventListener(
      'touchend',
      (e) => {
        // Pendant le sprint, tout est déjà géré au touchstart. Surtout, on ne
        // veut PAS de la logique de swipe ci-dessous : à deux pouces, le départ
        // d'un doigt et l'arrivée de l'autre se mélangent et simulent un swipe.
        if (h.isSprint()) return

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
