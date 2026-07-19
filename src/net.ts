import { Client, Room } from '@colyseus/sdk'

/** Ce qu'on sait d'un joueur du salon (nous compris) à un instant donné */
export interface RemotePlayer {
  /** L'identifiant Colyseus — la clé qui distingue les 10 coureurs */
  id: string
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
  /** Son skin, si c'est le perso « + » : `corps:bandeau:ornement`. Sinon vide. */
  skin: string
  /** false = il a coupé (écran verrouillé…) mais peut revenir sous 30 s */
  connected: boolean
  /** S'est-il déclaré prêt dans le lobby ? */
  ready: boolean
  /** Sa place à l'arrivée (1 = premier), 0 = pas encore fini */
  rank: number
  /** Heure serveur (ms) à laquelle il a envoyé cette position — 0 si inconnue */
  at: number
  /** Sa ligne sur la grille de départ (0, 1, 2) */
  startLane: number
}

/**
 * Une action du rival, relayée IMMÉDIATEMENT par le serveur (hors du flux
 * d'état à 30 Hz) : c'est ce qui rend ses esquives nettes à l'écran.
 * `from` = qui l'a faite (parmi les 10).
 */
export type OppAction =
  | { from: string; t: 'lane'; lane: number }
  | { from: string; t: 'jump'; v: number }
  | { from: string; t: 'slide'; d: number }
  | { from: string; t: 'stumble'; keep: number }
  // 🧱 Il s'accroche a une paroi : `cote` -1 gauche, +1 droite
  | { from: string; t: 'mur'; cote: number }

/** Un salon vu depuis la liste publique (getAvailableRooms) */
export interface SalonInfo {
  roomId: string
  code: string
  host: string
  count: number
  max: number
}

/**
 * Une vue complète du salon : qui est là, qui est prêt, qui est l'hôte, où on
 * en est. C'est ce que le lobby affiche.
 */
export interface LobbyView {
  code: string
  isPublic: boolean
  hostId: string
  phase: string // lobby | countdown | racing | results
  startAt: number
  /** MON identifiant */
  me: string
  isHost: boolean
  /** TOUS les joueurs (moi compris), dans l'ordre d'arrivée */
  players: RemotePlayer[]
}

/** Les événements réseau que le jeu doit gérer */
export interface NetCallbacks {
  /** Le salon a changé (arrivée, départ, prêt, hôte…) — hors course */
  onLobby(view: LobbyView): void
  /** La partie est lancée : décompte de 10 s, avec la graine de la piste */
  onCountdown(seed: number): void
  /** GO officiel du serveur */
  onGo(): void
  /** Positions de tous les AUTRES coureurs (pendant décompte + course) */
  onPlayers(others: RemotePlayer[]): void
  /** Un joueur nous a lancé un sort ! `distance` = sa place (portail seul) */
  onSpell(from: string, kind: string, distance: number): void
  /** Un rival vient de sauter / esquiver / trébucher */
  onAction(a: OppAction): void
  /** ⚔️ Un coup a porté, tranché par le serveur. par = attaquant, sur = victime. */
  onPvp(par: string, sur: string): void
  /** Message de chat (du lobby) */
  onChat(from: string, name: string, text: string): void
  /** La course est finie : le classement est dans la vue */
  onResults(view: LobbyView): void
  /** NOTRE connexion : coupée (false) / rétablie (true) */
  onLink(up: boolean): void
  /** Serveur injoignable, déconnexion définitive… */
  onError(message: string): void
}

/**
 * L'adresse du serveur de jeu EN PRODUCTION (Railway).
 * ⚠️ `wss://` et non `ws://` : le jeu est servi en https, un navigateur refuse
 * d'ouvrir une connexion non chiffrée depuis une page sécurisée.
 */
const PROD_SERVER_URL = 'wss://kurogane-production.up.railway.app'

export interface Identity {
  name: string
  fighter: string
  /**
   * Le skin du perso « + », en `corps:bandeau:ornement`. Vide pour les autres.
   * Le « + » n'est pas un guerrier de la fiche mais un guerrier PLUS un skin :
   * sans cette chaine, les autres ne verraient qu'un corps sans ses couleurs.
   */
  skin?: string
  /** Le jeton de session : dit au serveur quel compte crediter. */
  token?: string | null
}

export const WS_URL: string =
  import.meta.env.VITE_SERVER_URL ??
  (location.protocol === 'https:' ? PROD_SERVER_URL : `ws://${location.hostname}:2567`)

/** Génère un code de salon lisible : 4 lettres, sans voyelles (pas de gros mots). */
function genCode(): string {
  const L = 'BCDFGHJKLMNPQRSTVWXZ'
  let c = ''
  for (let i = 0; i < 4; i++) c += L[Math.floor(Math.random() * L.length)]
  return c
}

/**
 * La connexion au serveur Colyseus.
 * Le serveur est LE CHEF : il héberge le salon, donne la graine de la piste,
 * lance le départ et tient le classement.
 */
export class Net {
  private room: Room | null = null
  private cb: NetCallbacks
  private lastPhase = ''
  private resultsSent = false
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private leaving = false // on part volontairement (≠ coupure subie)
  myFinished = false

  /** MON identifiant dans le salon */
  get id() {
    return this.room?.sessionId ?? ''
  }
  /** Le code du salon courant */
  code = ''
  /** L'heure serveur (ms) du GO programmé — 0 tant que la partie n'est pas lancée */
  startAt = 0
  /** Ma ligne de départ, décidée par le serveur */
  myStartLane = 1

  /** La synchro d'horloge est-elle prête ? */
  get clockReady() {
    return this.offsetReady
  }
  /** Le ping (aller-retour, en secondes), mesuré en continu. */
  rtt = 0

  // ————— Synchro d'horloge (NTP simplifié) —————
  private offset = 0
  private offsetReady = false

  /** L'heure du serveur, estimée (ms) — la référence commune à tous */
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

  // ————— Entrer dans un salon —————

  /** Crée un salon PRIVÉ et renvoie son code à partager. */
  async createSalon(identity: Identity): Promise<string> {
    const code = genCode()
    await this.enter((client) =>
      client.create('race', { ...identity, code, isPublic: false })
    )
    return code
  }

  /** Rejoint (ou crée) le salon qui porte ce code. */
  async joinByCode(identity: Identity, code: string) {
    const c = code.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6)
    await this.enter((client) => client.joinOrCreate('race', { ...identity, code: c }))
  }

  /** Partie rapide : remplit un salon PUBLIC (code 'PUBLIC'), départ à l'hôte/minuteur. */
  async joinQuick(identity: Identity) {
    await this.enter((client) =>
      client.joinOrCreate('race', { ...identity, code: 'PUBLIC', isPublic: true })
    )
  }

  /** Rejoint un salon précis de la liste publique (par son roomId). */
  async joinRoom(identity: Identity, roomId: string) {
    await this.enter((client) => client.joinById(roomId, identity))
  }

  /**
   * La liste des salons publics en attente (pour l'écran « rejoindre »).
   * On se connecte le temps d'un instant à la salle « lobby » de Colyseus, qui
   * tient la liste des salons à jour en temps réel, on lit sa 1re photo, puis on
   * repart. En cas d'échec, liste vide — le code et la partie rapide marchent.
   */
  async listSalons(): Promise<SalonInfo[]> {
    let lobby: Room | null = null
    try {
      const client = new Client(WS_URL)
      lobby = await client.joinOrCreate('lobby')
      const rooms: any[] = await new Promise((resolve) => {
        const t = setTimeout(() => resolve([]), 1500)
        // 'rooms' = la photo complète envoyée à l'arrivée
        lobby!.onMessage('rooms', (list: any[]) => {
          clearTimeout(t)
          resolve(Array.isArray(list) ? list : [])
        })
      })
      return rooms
        .filter((r) => r.metadata?.public && r.metadata?.phase === 'lobby')
        .map((r) => ({
          roomId: r.roomId,
          code: r.metadata?.code ?? '????',
          host: r.metadata?.host ?? '',
          count: r.metadata?.count ?? r.clients ?? 0,
          max: r.metadata?.max ?? 10,
        }))
    } catch {
      return []
    } finally {
      lobby?.leave()
    }
  }

  /** Le tronc commun d'une connexion : on branche tous les écouteurs. */
  private async enter(open: (client: Client) => Promise<Room>) {
    this.lastPhase = ''
    this.resultsSent = false
    this.myFinished = false
    this.leaving = false
    this.rtt = 0
    this.offset = 0
    this.offsetReady = false
    this.startAt = 0

    try {
      const client = new Client(WS_URL)
      this.room = await open(client)
    } catch {
      this.cb.onError('Serveur injoignable. Il tourne ? (cf DEPLOY.md)')
      return
    }

    this.room.onStateChange((state: any) => this.readState(state))
    this.room.onError(() => this.cb.onError('Erreur de connexion.'))
    this.room.onLeave(() => {
      this.stopPing()
      this.room = null
      if (!this.leaving && !this.resultsSent) this.cb.onError('Connexion perdue.')
    })

    // Un sort nous arrive dessus (relayé depuis son lanceur)
    this.room.onMessage('spell', (m: any) =>
      this.cb.onSpell(String(m?.from ?? ''), String(m?.kind ?? ''), Number(m?.distance) || 0)
    )
    // Les actions du rival, relayées immédiatement (hors flux 30 Hz)
    this.room.onMessage('action', (a: OppAction) => this.cb.onAction(a))
    // Le chat du lobby
    this.room.onMessage('chat', (m: any) =>
      this.cb.onChat(String(m?.from ?? ''), String(m?.name ?? ''), String(m?.text ?? ''))
    )

    // ⚔️ Le verdict d'un coup. Le serveur a déjà tranché : on l'applique.
    this.room.onMessage('pvp', (r: { par: string; sur: string }) => {
      if (!this.room) return
      this.cb.onPvp(r.par, r.sur)
    })

    // Reconnexion automatique (écran verrouillé, wifi qui saute)
    this.room.onDrop(() => this.cb.onLink(false))
    this.room.onReconnect(() => this.cb.onLink(true))

    // Ping + synchro d'horloge
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

  /** Lit l'état du salon et prévient le jeu de ce qui change. */
  private readState(state: any) {
    if (!this.room) return
    const myId = this.room.sessionId
    this.code = state.code ?? ''
    this.startAt = state.startAt ?? 0

    const all: RemotePlayer[] = []
    const others: RemotePlayer[] = []
    state.players.forEach((p: any, id: string) => {
      const rp: RemotePlayer = {
        id,
        lane: p.lane,
        y: p.y,
        distance: p.distance,
        sliding: p.sliding,
        finished: p.finished,
        time: p.time,
        name: p.name ?? '',
        fighter: p.fighter ?? '',
        skin: p.skin ?? '',
        connected: p.connected ?? true,
        ready: p.ready ?? false,
        rank: p.rank ?? 0,
        at: p.at ?? 0,
        startLane: p.startLane ?? 1,
      }
      all.push(rp)
      if (id === myId) this.myStartLane = rp.startLane
      else others.push(rp)
    })

    const view: LobbyView = {
      code: state.code ?? '',
      isPublic: state.isPublic ?? false,
      hostId: state.hostId ?? '',
      phase: state.phase ?? 'lobby',
      startAt: state.startAt ?? 0,
      me: myId,
      isHost: state.hostId === myId,
      players: all,
    }

    // Changement de phase
    if (state.phase !== this.lastPhase) {
      this.lastPhase = state.phase
      if (state.phase === 'countdown') this.cb.onCountdown(state.seed)
      if (state.phase === 'racing') this.cb.onGo()
    }

    // Le lobby (liste des joueurs, prêts, hôte, code) : uniquement en phase
    // lobby. En 'results', c'est onResults qui tient l'écran ; pendant la course,
    // le lobby n'a rien à afficher.
    if (state.phase === 'lobby') this.cb.onLobby(view)
    // Les positions des autres : pendant le décompte (grille) et la course
    if (state.phase === 'countdown' || state.phase === 'racing') {
      this.cb.onPlayers(others)
    }
    // Le classement final
    if (state.phase === 'results' && !this.resultsSent) {
      this.resultsSent = true
      this.cb.onResults(view)
    }
  }

  // ————— Envoyer —————

  /** Se déclarer prêt (ou pas) dans le lobby */
  sendReady(ready: boolean) {
    this.room?.send('ready', ready)
  }

  /**
   * Le joueur a changé de guerrier (ou de pseudo) depuis le salon.
   * Le serveur ne l'accepte que tant qu'on n'a pas démarré : on ne change pas
   * d'armure en pleine course.
   */
  sendIdentity(identity: Identity) {
    // Le jeton est délibérément RETIRÉ ici : il n'est utile qu'à l'entrée dans
    // le salon, où le serveur l'échange une fois contre l'identifiant du compte.
    // Le renvoyer à chaque changement de guerrier le ferait circuler pour rien.
    this.room?.send('identity', {
      name: identity.name,
      fighter: identity.fighter,
      skin: identity.skin ?? '',
    })
  }

  /** L'hôte lance la partie */
  sendStart() {
    this.room?.send('start')
  }

  /** Envoyer un message de chat */
  sendChat(text: string) {
    this.room?.send('chat', { text })
  }

  /** Après la course, l'hôte rouvre le salon pour rejouer */
  sendToLobby() {
    this.resultsSent = false
    this.room?.send('tolobby')
  }

  /** Envoie ma position au serveur (~20 fois/s), horodatée */
  sendProgress(p: { lane: number; y: number; distance: number; sliding: boolean }) {
    this.room?.send('progress', { ...p, at: this.offsetReady ? this.serverNow() : 0 })
  }

  /** Envoie une action (saut, esquive, trébuchement) — relayée immédiatement */
  sendAction(a: { t: 'lane' | 'jump' | 'slide' | 'stumble' | 'mur'; [k: string]: any }) {
    this.room?.send('action', a)
  }

  /**
   * ⚔️ Demande à porter un coup sur cette ligne. On HORODATE le coup : c'est
   * cet instant que le serveur rejouera pour juger s'il touche (lag
   * compensation). Le serveur décide, nous ne faisons que demander.
   */
  sendPvp(lane: number) {
    this.room?.send('pvp', { lane, at: this.offsetReady ? this.serverNow() : Date.now() })
  }

  /**
   * Envoie un sort offensif. `target` = à qui (le plus proche devant, choisi
   * côté jeu). `distance` ne sert qu'au 🔮 portail : c'est NOTRE place.
   */
  sendSpell(kind: string, target = '', distance = 0) {
    this.room?.send('spell', { kind, target, distance })
  }

  /** Prévient le serveur : j'ai franchi la ligne ! */
  sendFinished(time: number) {
    this.myFinished = true
    this.room?.send('finished', { time })
  }

  /** Quitte le salon (volontairement) */
  leave() {
    this.leaving = true
    this.stopPing()
    this.room?.leave()
    this.room = null
  }
}
