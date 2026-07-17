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
  /** false = il a coupé (écran verrouillé…) mais peut revenir sous 30 s */
  connected: boolean
  /** Heure serveur (ms) à laquelle il a envoyé cette position — 0 si inconnue */
  at: number
  /** Sa ligne sur la grille de départ (0 = gauche, 2 = droite) */
  startLane: number
}

/**
 * Une action du rival, relayée IMMÉDIATEMENT par le serveur (hors du flux
 * d'état à 30 Hz) : c'est ce qui rend ses esquives nettes à l'écran.
 */
export type OppAction =
  | { t: 'lane'; lane: number }
  | { t: 'jump'; v: number }
  | { t: 'slide'; d: number }
  | { t: 'stumble'; keep: number }

/** Les événements réseau que le jeu doit gérer */
export interface NetCallbacks {
  onWaiting(): void // connecté, on attend un adversaire
  onCountdown(seed: number): void // adversaire trouvé ! 3, 2, 1…
  onGo(): void // GO officiel du serveur
  onOpponent(op: RemotePlayer | null): void // nouvelles infos sur l'adversaire
  onAction(a: OppAction): void // le rival vient de sauter/esquiver/trébucher
  onLink(up: boolean): void // NOTRE connexion : coupée (false) / rétablie (true)
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
  private leaving = false // on part volontairement (≠ coupure subie)
  myFinished = false
  /** Nos lignes sur la grille de départ, décidées par le serveur */
  myStartLane = 1
  oppStartLane = 1
  /** L'heure serveur (ms) du GO programmé — 0 tant que le duel n'est pas lancé */
  startAt = 0

  /** La synchro d'horloge est-elle prête ? (quelques pongs suffisent) */
  get clockReady() {
    return this.offsetReady
  }
  /**
   * Le ping (aller-retour, en secondes), mesuré en continu.
   * Sert à compenser le temps de trajet des positions de l'adversaire.
   */
  rtt = 0

  // ————— Synchro d'horloge (NTP simplifié) —————
  // L'heure du serveur correspond au MILIEU de l'aller-retour d'un ping.
  // En comparant, on estime le décalage entre son horloge et la nôtre :
  // les deux joueurs partagent alors une référence de temps commune.
  private offset = 0 // heure serveur − notre performance.now(), en ms
  private offsetReady = false

  /** L'heure du serveur, estimée (ms) — la référence commune aux 2 joueurs */
  serverNow(): number {
    return performance.now() + this.offset
  }

  /** L'âge d'un horodatage serveur, en secondes. −1 si pas encore synchronisé. */
  ageOf(at: number): number {
    if (!at || !this.offsetReady) return -1
    return Math.max(0, (this.serverNow() - at) / 1000)
  }

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
    this.leaving = false
    this.rtt = 0
    this.offset = 0
    this.offsetReady = false

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
      // Coupure DÉFINITIVE (reconnexion épuisée) en pleine course : ni un
      // départ volontaire, ni une fin normale → on prévient le jeu.
      if (!this.leaving && !this.resultsSent) this.cb.onError('Connexion perdue.')
    })

    // Les actions du rival, relayées immédiatement (hors flux 30 Hz)
    this.room.onMessage('action', (a: OppAction) => this.cb.onAction(a))

    // ————— Reconnexion automatique —————
    // Écran verrouillé, wifi qui saute : le SDK retente tout seul (et met nos
    // messages en tampon), le serveur nous garde la place 30 s (RaceRoom.onDrop).
    this.room.onDrop(() => this.cb.onLink(false))
    this.room.onReconnect(() => this.cb.onLink(true))

    // ————— La mesure du ping + la synchro d'horloge —————
    // Toutes les 2 s on envoie notre heure ; le serveur renvoie la sienne en
    // face. Le temps écoulé = l'aller-retour (rtt). Et l'heure serveur datant
    // du MILIEU du trajet, on en déduit le décalage entre nos horloges.
    // Moyennes glissantes ; les pings anormalement lents mentent → écartés.
    this.room.onMessage('pong', (p: { sentAt: number; server: number }) => {
      const now = performance.now()
      const sample = (now - p.sentAt) / 1000
      const clean = this.rtt === 0 || sample < this.rtt * 2
      this.rtt = this.rtt === 0 ? sample : this.rtt * 0.7 + sample * 0.3
      if (clean) {
        const est = p.server - (p.sentAt + now) / 2
        this.offset = this.offsetReady ? this.offset * 0.7 + est * 0.3 : est
        this.offsetReady = true
      }
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

    // On lit les joueurs D'ABORD : le callback du décompte (qui lance la
    // course) a besoin des lignes de la grille de départ.
    let opp: RemotePlayer | null = null
    state.players.forEach((p: any, id: string) => {
      if (id === this.room!.sessionId) {
        this.myStartLane = p.startLane ?? 1
      } else {
        opp = {
          lane: p.lane,
          y: p.y,
          distance: p.distance,
          sliding: p.sliding,
          finished: p.finished,
          time: p.time,
          name: p.name ?? '',
          fighter: p.fighter ?? '',
          connected: p.connected ?? true,
          at: p.at ?? 0,
          startLane: p.startLane ?? 1,
        }
      }
    })
    if (opp) this.oppStartLane = (opp as RemotePlayer).startLane
    this.startAt = state.startAt ?? 0

    // Changement de phase : attente → décompte → course → résultats
    if (state.phase !== this.lastPhase) {
      this.lastPhase = state.phase
      if (state.phase === 'countdown') this.cb.onCountdown(state.seed)
      if (state.phase === 'racing') this.cb.onGo()
    }

    this.cb.onOpponent(opp)

    // Résultats : dès qu'un vainqueur est connu ET que j'ai fini
    // (ou que la phase est terminée : abandon de l'adversaire par ex.)
    const over = state.phase === 'results' || (state.winner && this.myFinished)
    if (over && state.winner && !this.resultsSent) {
      this.resultsSent = true
      this.cb.onResults(state.winner === this.room.sessionId, opp ? (opp as RemotePlayer).time : 0)
    }
  }

  /** Envoie ma position au serveur (appelé 20 fois par seconde), horodatée */
  sendProgress(p: { lane: number; y: number; distance: number; sliding: boolean }) {
    this.room?.send('progress', { ...p, at: this.offsetReady ? this.serverNow() : 0 })
  }

  /** Envoie une action (saut, esquive, trébuchement) — relayée immédiatement */
  sendAction(a: OppAction) {
    this.room?.send('action', a)
  }

  /** Prévient le serveur : j'ai franchi la ligne ! */
  sendFinished(time: number) {
    this.myFinished = true
    this.room?.send('finished', { time })
  }

  /** Quitte la course en cours (volontairement) */
  leave() {
    this.leaving = true
    this.stopPing()
    this.room?.leave()
    this.room = null
  }
}
