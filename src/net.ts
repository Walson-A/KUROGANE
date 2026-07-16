import { Client, Room } from '@colyseus/sdk'

/** Ce qu'on sait de l'adversaire à un instant donné */
export interface RemotePlayer {
  lane: number
  y: number
  distance: number
  sliding: boolean
  finished: boolean
  time: number
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
 * L'adresse du serveur de jeu :
 * - en local / sur le wifi : même machine que le site, port 2567
 * - en production : l'adresse donnée à la mise en ligne (variable VITE_SERVER_URL)
 */
const WS_URL: string =
  import.meta.env.VITE_SERVER_URL ?? `ws://${location.hostname}:2567`

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
  myFinished = false

  constructor(cb: NetCallbacks) {
    this.cb = cb
  }

  get connected() {
    return this.room !== null
  }

  /** Rejoint une course (ou en crée une et attend un adversaire) */
  async join() {
    this.lastPhase = ''
    this.resultsSent = false
    this.myFinished = false

    try {
      const client = new Client(WS_URL)
      this.room = await client.joinOrCreate('race')
    } catch {
      this.cb.onError('Serveur injoignable. Il tourne ? (cf DEPLOY.md)')
      return
    }

    this.cb.onWaiting()

    this.room.onStateChange((state: any) => this.readState(state))
    this.room.onError(() => this.cb.onError('Erreur de connexion.'))
    this.room.onLeave(() => {
      this.room = null
    })
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
    this.room?.leave()
    this.room = null
  }
}
