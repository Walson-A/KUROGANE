/**
 * ————— La musique —————
 * Trois pistes, une par moment du jeu : les menus, le salon, la course.
 *
 * Trois contraintes ont dessiné ce fichier :
 *
 * 1. **Les navigateurs interdisent le son** tant que le joueur n'a rien
 *    touché. Impossible de lancer la musique au chargement : on note ce
 *    qu'on VEUT jouer, et on le lance à son premier geste.
 *
 * 2. **Chaque piste pèse ~5 Mo.** On ne précharge rien (`preload = 'none'`) :
 *    un fichier n'est téléchargé qu'au moment où on le joue, et le navigateur
 *    le diffuse en flux — la musique démarre bien avant la fin du transfert.
 *    Précharger les trois, ce serait 15 Mo imposés à un joueur en 4G.
 *
 * 3. **Couper net est brutal.** On fond d'une piste à l'autre en 0,6 s.
 */

export type Piste = 'menu' | 'lobby' | 'race'

/** Servis depuis public/ : Vite les livre tels quels, sans les empaqueter. */
const FICHIERS: Record<Piste, string> = {
  menu: 'audio/music/menu.mp3',
  lobby: 'audio/music/lobby.mp3',
  race: 'audio/music/race.mp3',
}

/** Assez présente pour porter la course, assez basse pour laisser vivre le reste. */
const VOLUME = 0.55

/** Durée du fondu entre deux pistes (secondes). */
const FONDU = 0.6

/** Les gestes qui valent autorisation de jouer, aux yeux du navigateur. */
const GESTES = ['pointerdown', 'keydown', 'touchstart'] as const

export class Musique {
  private elements = new Map<Piste, HTMLAudioElement>()
  private courante: Piste | null = null
  /** Ce qu'on veut entendre — même si le navigateur nous fait encore attendre. */
  private voulue: Piste | null = null
  private active: boolean
  private debloque = false

  constructor(active: boolean) {
    this.active = active

    // On réessaie à CHAQUE geste tant que la lecture n'a pas vraiment démarré.
    //
    // Se contenter du premier geste était un piège : le navigateur peut très
    // bien le refuser quand même (geste déjà consommé ailleurs, politique plus
    // stricte, onglet en arrière-plan…). En cessant d'écouter dès le premier
    // essai, un seul refus condamnait le jeu au silence pour toute la partie.
    const essai = () => {
      this.debloque = true
      this.demarrer(this.voulue).then((ok) => {
        if (ok) for (const g of GESTES) removeEventListener(g, essai)
      })
    }
    for (const g of GESTES) addEventListener(g, essai, { passive: true })

    // Écran verrouillé ou onglet en arrière-plan : on se tait. Le jeu lui-même
    // est mis en pause par le navigateur (il gèle requestAnimationFrame), donc
    // une musique qui continuerait seule n'aurait plus rien à accompagner.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.elements.forEach((a) => a.pause())
      else if (this.active && this.courante) this.demarrer(this.courante)
    })
  }

  /** Crée l'élément à la première écoute seulement — jamais avant. */
  private element(p: Piste): HTMLAudioElement {
    let a = this.elements.get(p)
    if (!a) {
      a = new Audio(FICHIERS[p])
      a.loop = true
      a.preload = 'none'
      a.volume = 0 // il montera par le fondu
      this.elements.set(p, a)
    }
    return a
  }

  /**
   * Lance la piste. Renvoie si la lecture a VRAIMENT démarré — c'est cette
   * réponse qui dit à l'écouteur de gestes s'il peut enfin se taire.
   * Ne rejette jamais : un refus du navigateur n'est pas une panne.
   */
  private demarrer(p: Piste | null): Promise<boolean> {
    this.courante = p
    if (!p || !this.active) return Promise.resolve(false)
    return this.element(p)
      .play()
      .then(() => true)
      .catch(() => false)
  }

  /**
   * Demande une piste (ou le silence avec `null`). Sans effet si c'est déjà
   * elle qui joue : relancer couperait la musique en plein milieu à chaque
   * aller-retour dans les menus.
   */
  jouer(p: Piste | null) {
    if (p === this.voulue && p === this.courante) return
    this.voulue = p
    if (this.debloque) this.demarrer(p)
  }

  /** Le réglage du joueur (options). Coupe ou relance sans perdre le fil. */
  setActive(on: boolean) {
    if (on === this.active) return
    this.active = on
    if (on) this.demarrer(this.voulue)
    // Sinon : `update` fait descendre le volume puis met en pause.
  }

  /**
   * Le fondu, appelé à chaque image par la boucle de jeu. On fait varier le
   * volume à la main plutôt qu'avec un minuteur : ça suit exactement le rythme
   * du jeu, et ça s'arrête avec lui quand l'onglet passe en arrière-plan.
   */
  update(dt: number) {
    const pas = (dt / FONDU) * VOLUME
    for (const [p, a] of this.elements) {
      const cible = p === this.courante && this.active ? VOLUME : 0
      if (a.volume === cible) continue
      a.volume =
        cible > a.volume ? Math.min(cible, a.volume + pas) : Math.max(cible, a.volume - pas)
      // Éteinte pour de bon : on rend la main au navigateur (et au réseau).
      if (a.volume <= 0.0001 && cible === 0 && !a.paused) a.pause()
    }
  }
}
