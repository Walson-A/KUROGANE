import { Room, Client } from 'colyseus'
import { Schema, MapSchema, type } from '@colyseus/schema'

/**
 * Tout ce que le serveur sait d'un joueur.
 * Ces infos sont synchronisées automatiquement vers les deux téléphones.
 */
export class PlayerState extends Schema {
  @type('number') lane = 1
  @type('number') y = 0
  @type('number') distance = 0
  @type('boolean') sliding = false
  @type('boolean') finished = false
  @type('number') time = 0
  /** Le pseudo choisi dans les options — nettoyé à l'arrivée, cf. onJoin() */
  @type('string') name = ''
  /** Le guerrier choisi (cf. src/roster.ts côté jeu) */
  @type('string') fighter = 'yasuke'
  /** false pendant une coupure : sa place est gardée, il peut revenir (cf. onDrop) */
  @type('boolean') connected = true
  /** Heure SERVEUR (ms) à laquelle sa dernière position a été envoyée */
  @type('number') at = 0
}

/** L'état complet d'une course */
export class RaceState extends Schema {
  /** waiting → countdown → racing → results */
  @type('string') phase = 'waiting'
  /** La graine de la piste : les deux joueurs ont les MÊMES obstacles */
  @type('number') seed = 0
  /** L'identifiant du vainqueur */
  @type('string') winner = ''
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>()
}

/** Durée du décompte 3, 2, 1, GO (ms) — un poil plus long que côté client */
const COUNTDOWN_MS = 3500

/** Les guerriers que le serveur accepte. Tout le reste → Yasuke. */
const FIGHTERS = ['yasuke', 'hana', 'onimaru', 'tamae']
const MAX_NAME = 12

/**
 * Le pseudo et le guerrier viennent du joueur : on ne leur fait PAS confiance.
 * Un client bidouillé peut envoyer n'importe quoi — un pavé de 10 000 lettres,
 * un objet, rien du tout. Le serveur tranche, et n'accepte qu'une petite chaîne.
 *
 * (L'échappement HTML, lui, se fait à l'affichage côté jeu : c'est là que se
 * joue le risque d'injection, pas ici.)
 */
function cleanName(v: unknown): string {
  if (typeof v !== 'string') return ''
  return v.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME)
}

function cleanFighter(v: unknown): string {
  return typeof v === 'string' && FIGHTERS.includes(v) ? v : 'yasuke'
}

/**
 * Une salle de course : 2 joueurs, une piste, un vainqueur.
 * Colyseus crée une nouvelle salle automatiquement dès qu'une est pleine.
 */
export class RaceRoom extends Room<{ state: RaceState }> {
  maxClients = 2
  state = new RaceState()

  onCreate() {
    this.state.seed = Math.floor(Math.random() * 2 ** 31)

    // Diffuse l'état 30 fois/s au lieu de 20 : l'adversaire bouge plus finement
    this.setPatchRate(33)

    // Mesure du ping + synchro d'horloge : on renvoie l'heure du client telle
    // quelle (il en déduit l'aller-retour) ET la nôtre (il en déduit le
    // décalage entre nos horloges — méthode NTP simplifiée).
    this.onMessage('ping', (client, sentAt: number) => {
      client.send('pong', { sentAt: Number(sentAt) || 0, server: Date.now() })
    })

    // Les ACTIONS (saut, changement de ligne, glissade, trébuchement) sont
    // relayées IMMÉDIATEMENT à l'autre joueur — sans attendre le tick de
    // diffusion à 30 Hz. C'est ce qui rend ses esquives nettes à l'écran.
    const ACTIONS = ['lane', 'jump', 'slide', 'stumble']
    this.onMessage('action', (client, data: any) => {
      if (this.state.phase !== 'racing') return
      if (!data || !ACTIONS.includes(data.t)) return
      for (const other of this.clients) {
        if (other.sessionId !== client.sessionId) other.send('action', data)
      }
    })

    // Un joueur nous envoie sa position (~10 fois/s) → on la range dans l'état,
    // Colyseus la transmet tout seul à l'autre joueur.
    this.onMessage('progress', (client, data: any) => {
      const p = this.state.players.get(client.sessionId)
      if (!p || this.state.phase !== 'racing' || p.finished) return
      p.lane = Math.max(0, Math.min(2, Number(data.lane) || 0))
      p.y = Number(data.y) || 0
      p.distance = Number(data.distance) || 0
      p.sliding = !!data.sliding
      p.at = Number(data.at) || 0 // l'heure serveur d'envoi, estimée par le client
    })

    // Un joueur a franchi la ligne !
    this.onMessage('finished', (client, data: any) => {
      const p = this.state.players.get(client.sessionId)
      if (!p || p.finished || this.state.phase !== 'racing') return
      p.finished = true
      p.time = Number(data.time) || 0

      // Le premier arrivé est le vainqueur
      if (!this.state.winner) this.state.winner = client.sessionId

      // Quand les deux ont fini → résultats
      const all = [...this.state.players.values()]
      if (all.every((pl) => pl.finished)) this.state.phase = 'results'
    })
  }

  onJoin(client: Client, options: any) {
    const p = new PlayerState()
    p.name = cleanName(options?.name)
    p.fighter = cleanFighter(options?.fighter)
    this.state.players.set(client.sessionId, p)
    console.log(
      `⚔️  ${p.name || 'anonyme'} (${p.fighter}) rejoint la course (${this.state.players.size}/2)`
    )

    // Deux guerriers présents : on verrouille la salle et c'est parti !
    if (this.state.players.size === 2) {
      this.lock()
      this.state.phase = 'countdown'
      this.clock.setTimeout(() => {
        this.state.phase = 'racing'
      }, COUNTDOWN_MS)
    }
  }

  /**
   * Coupure ANORMALE (écran verrouillé, wifi qui saute, tunnel…) : on garde
   * sa place 30 secondes. S'il revient → onReconnect. Sinon → onLeave.
   * Règle d'or de la doc Colyseus : on ne supprime RIEN ici.
   */
  onDrop(client: Client) {
    const p = this.state.players.get(client.sessionId)
    if (!p) return
    if (this.state.phase === 'countdown' || this.state.phase === 'racing') {
      this.allowReconnection(client, 30)
      p.connected = false
      console.log(`📡 ${p.name || client.sessionId} a coupé — place gardée 30 s`)
    }
  }

  onReconnect(client: Client) {
    const p = this.state.players.get(client.sessionId)
    if (p) p.connected = true
    console.log(`📡 ${client.sessionId} est revenu !`)
  }

  onLeave(client: Client) {
    console.log(`👋 ${client.sessionId} quitte la course`)
    this.state.players.delete(client.sessionId)

    // Abandon en pleine course → victoire par forfait pour celui qui reste
    if (this.state.phase === 'countdown' || this.state.phase === 'racing') {
      const remaining = [...this.state.players.keys()]
      this.state.winner = remaining[0] ?? ''
      this.state.phase = 'results'
    }
  }
}
