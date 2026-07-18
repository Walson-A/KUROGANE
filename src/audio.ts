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

/**
 * Durée d'un fondu complet (0 → plein volume) en secondes. Un fondu partiel
 * est donc proportionnellement plus court — et surtout, le calcul ne dépend
 * PAS du volume réglé : couper le son ne doit pas figer le fondu de sortie.
 */
const FONDU = 0.6

/** Les gestes qui valent autorisation de jouer, aux yeux du navigateur. */
const GESTES = ['pointerdown', 'keydown', 'touchstart'] as const

export class Musique {
  private elements = new Map<Piste, HTMLAudioElement>()
  private courante: Piste | null = null
  /** Ce qu'on veut entendre — même si le navigateur nous fait encore attendre. */
  private voulue: Piste | null = null
  /** Le volume réglé par le joueur, de 0 (coupée) à 1. */
  private volume: number
  private debloque = false

  /** Le son est-il demandé ? (0 = coupé depuis les options) */
  private get active() {
    return this.volume > 0
  }

  constructor(volume: number) {
    this.volume = volume

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
      // On REPREND où on en était : verrouiller son téléphone une seconde ne
      // doit pas relancer le thème depuis le début.
      else if (this.active && this.courante) this.demarrer(this.courante, true)
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
  private demarrer(p: Piste | null, reprendre = false): Promise<boolean> {
    this.courante = p
    if (!p || !this.active) return Promise.resolve(false)
    const a = this.element(p)
    // Une piste qu'on relance après l'avoir quittée repart de son DÉBUT :
    // un thème qui redémarre en plein milieu s'entend comme un bug. On ne
    // reprend en cours que dans un seul cas — le retour d'un onglet en veille.
    if (!reprendre) a.currentTime = 0
    return a
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

  /**
   * Le volume réglé depuis les options (0 → 1), appliqué en direct pour qu'on
   * s'entende régler. Repasser au-dessus de zéro relance la piste en cours —
   * en la reprenant où elle en était, puisqu'on n'a pas changé d'écran.
   */
  setVolume(v: number) {
    const avant = this.active
    this.volume = Math.min(1, Math.max(0, v))
    if (this.active && !avant) this.demarrer(this.voulue, true)
    // Passé à zéro : `update` fait descendre le son puis met en pause.
  }

  /**
   * Le fondu, appelé à chaque image par la boucle de jeu. On fait varier le
   * volume à la main plutôt qu'avec un minuteur : ça suit exactement le rythme
   * du jeu, et ça s'arrête avec lui quand l'onglet passe en arrière-plan.
   */
  update(dt: number) {
    const pas = dt / FONDU
    for (const [p, a] of this.elements) {
      const cible = p === this.courante ? this.volume : 0
      if (a.volume === cible) continue
      a.volume =
        cible > a.volume ? Math.min(cible, a.volume + pas) : Math.max(cible, a.volume - pas)
      // Éteinte pour de bon : on rend la main au navigateur (et au réseau).
      if (a.volume <= 0.0001 && cible === 0 && !a.paused) a.pause()
    }
  }
}
