import { Client, Room } from '@colyseus/sdk'

/** Ce qu'on sait de l'adversaire à un instant donné */
export interface RemotePlayer {
  lane: number
  y: number
  distance: number
  sliding: boolean
  finished: boolean
  time: number
  /** Son pseudo. ⚠️ Saisi par un autre joueur : à échapper avant tout affichage ! */
  name: string
  /** Le guerrier qu'il a choisi (cf. roster.ts) */
  fighter: string
}

/** Les événements réseau que le jeu doit gérer */
export interface NetCallbacks {
  onWaiting(): void // connecté, on attend un adversaire
  onCountdown(seed: number): void // adversaire trouvé ! 3, 2, 1…
  onGo(): void // GO officiel du serveur
  onOpponent(op: RemotePlayer | null): void // nouvelles infos sur l'adversaire
  onResults(iWon: boolean, oppTime: number): void // fin de course
  onError(message: string): void // serveur injoignable, déconnexion…
}

/**
 * L'adresse du serveur de jeu EN PRODUCTION (Railway).
 * ⚠️ À remplir après la mise en ligne du serveur — ex : 'wss://kurogane.up.railway.app'
 */
const PROD_SERVER_URL = ''

/**
 * L'adresse du serveur de jeu :
 * - en local / sur le wifi : même machine que le site, port 2567
 * - en production (site en https) : l'adresse Railway ci-dessus
 * - la variable VITE_SERVER_URL, si définie, gagne toujours
 */
const WS_URL: string =
  import.meta.env.VITE_SERVER_URL ??
  (location.protocol === 'https:' ? PROD_SERVER_URL : `ws://${location.hostname}:2567`)

/**
 * La connexion au serveur Colyseus.
 * Le serveur est LE CHEF : c'est lui qui apparie les joueurs, donne la graine
 * de la piste, lance le départ et déclare le vainqueur.
 */
export class Net {
  private room: Room | null = null
  private cb: NetCallbacks
  private lastPhase = ''
  private resultsSent = false
  private pingTimer: ReturnType<typeof setInterval> | null = null
  myFinished = false
  /**
   * Le ping (aller-retour, en secondes), mesuré en continu.
   * Sert à compenser le temps de trajet des positions de l'adversaire.
   */
  rtt = 0

  constructor(cb: NetCallbacks) {
    this.cb = cb
  }

  get connected() {
    return this.room !== null
  }

  /**
   * Rejoint une course (ou en crée une et attend un adversaire).
   * On donne notre identité au serveur dès l'arrivée : il la range dans l'état
   * de la salle, et l'autre joueur la reçoit automatiquement.
   */
  async join(identity: { name: string; fighter: string }) {
    this.lastPhase = ''
    this.resultsSent = false
    this.myFinished = false

    try {
      const client = new Client(WS_URL)
      this.room = await client.joinOrCreate('race', identity)
    } catch {
      this.cb.onError('Serveur injoignable. Il tourne ? (cf DEPLOY.md)')
      return
    }

    this.cb.onWaiting()

    this.room.onStateChange((state: any) => this.readState(state))
    this.room.onError(() => this.cb.onError('Erreur de connexion.'))
    this.room.onLeave(() => {
      this.stopPing()
      this.room = null
    })

    // ————— La mesure du ping —————
    // Toutes les 2 s on envoie l'heure ; le serveur la renvoie telle quelle ;
    // le temps écoulé = l'aller-retour. Moyenne glissante : un à-coup isolé
    // ne fait pas sursauter l'estimation.
    this.room.onMessage('pong', (sentAt: number) => {
      const sample = (performance.now() - sentAt) / 1000
      this.rtt = this.rtt === 0 ? sample : this.rtt * 0.7 + sample * 0.3
    })
    this.room.send('ping', performance.now())
    this.pingTimer = setInterval(() => this.room?.send('ping', performance.now()), 2000)
  }

  private stopPing() {
    if (this.pingTimer !== null) clearInterval(this.pingTimer)
    this.pingTimer = null
  }

  /** Lit l'état envoyé par le serveur et prévient le jeu de ce qui change */
  private readState(state: any) {
    if (!this.room) return

    // Changement de phase : attente → décompte → course → résultats
    if (state.phase !== this.lastPhase) {
      this.lastPhase = state.phase
      if (state.phase === 'countdown') this.cb.onCountdown(state.seed)
      if (state.phase === 'racing') this.cb.onGo()
    }

    // Les infos de l'adversaire (tous les joueurs sauf moi)
    let opp: RemotePlayer | null = null
    state.players.forEach((p: any, id: string) => {
      if (id !== this.room!.sessionId) {
        opp = {
          lane: p.lane,
          y: p.y,
          distance: p.distance,
          sliding: p.sliding,
          finished: p.finished,
          time: p.time,
          name: p.name ?? '',
          fighter: p.fighter ?? '',
        }
      }
    })
    this.cb.onOpponent(opp)

    // Résultats : dès qu'un vainqueur est connu ET que j'ai fini
    // (ou que la phase est terminée : abandon de l'adversaire par ex.)
    const over = state.phase === 'results' || (state.winner && this.myFinished)
    if (over && state.winner && !this.resultsSent) {
      this.resultsSent = true
      this.cb.onResults(state.winner === this.room.sessionId, opp ? (opp as RemotePlayer).time : 0)
    }
  }

  /** Envoie ma position au serveur (appelé ~10 fois par seconde) */
  sendProgress(p: { lane: number; y: number; distance: number; sliding: boolean }) {
    this.room?.send('progress', p)
  }

  /** Prévient le serveur : j'ai franchi la ligne ! */
  sendFinished(time: number) {
    this.myFinished = true
    this.room?.send('finished', { time })
  }

  /** Quitte la course en cours */
  leave() {
    this.stopPing()
    this.room?.leave()
    this.room = null
  }
}
