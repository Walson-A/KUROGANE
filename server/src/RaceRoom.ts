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

/**
 * Les seuls sorts qu'un client a le droit de relayer.
 * Le serveur ne connaît pas les effets — juste la liste de ce qui est légal.
 */
const SORTS_OFFENSIFS = ['kusarigama']

/**
 * Une salle de course : 2 joueurs, une piste, un vainqueur.
 * Colyseus crée une nouvelle salle automatiquement dès qu'une est pleine.
 */
export class RaceRoom extends Room<{ state: RaceState }> {
  maxClients = 2
  state = new RaceState()

  onCreate() {
    this.state.seed = Math.floor(Math.random() * 2 ** 31)

    // Un joueur nous envoie sa position (~10 fois/s) → on la range dans l'état,
    // Colyseus la transmet tout seul à l'autre joueur.
    this.onMessage('progress', (client, data: any) => {
      const p = this.state.players.get(client.sessionId)
      if (!p || this.state.phase !== 'racing' || p.finished) return
      p.lane = Math.max(0, Math.min(2, Number(data.lane) || 0))
      p.y = Number(data.y) || 0
      p.distance = Number(data.distance) || 0
      p.sliding = !!data.sliding
    })

    // Un joueur lance un sort offensif sur l'autre. Le serveur ne fait que
    // relayer : il ne simule pas l'effet, c'est la victime qui l'applique.
    this.onMessage('spell', (client, data: any) => {
      const p = this.state.players.get(client.sessionId)
      if (!p || this.state.phase !== 'racing' || p.finished) return

      // On ne relaie que des sorts connus : un client bricole est vite arrive
      if (!SORTS_OFFENSIFS.includes(String(data?.kind))) return

      this.broadcast('spell', { kind: String(data.kind) }, { except: client })
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

  onJoin(client: Client) {
    this.state.players.set(client.sessionId, new PlayerState())
    console.log(`⚔️  ${client.sessionId} rejoint la course (${this.state.players.size}/2)`)

    // Deux guerriers présents : on verrouille la salle et c'est parti !
    if (this.state.players.size === 2) {
      this.lock()
      this.state.phase = 'countdown'
      this.clock.setTimeout(() => {
        this.state.phase = 'racing'
      }, COUNTDOWN_MS)
    }
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
