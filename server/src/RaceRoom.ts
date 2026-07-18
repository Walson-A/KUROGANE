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
  /**
   * Sa ligne sur la GRILLE DE DÉPART (0 = gauche, 2 = droite) : fini les deux
   * coureurs empilés au centre au coup d'envoi. Les obstacles ne commençant
   * qu'à 45 m, chacun a largement le temps de se replacer — pas d'iniquité.
   */
  @type('number') startLane = 1
  /** Heure SERVEUR (ms) à laquelle sa dernière position a été envoyée */
  @type('number') at = 0
}

/** L'état complet d'une course */
export class RaceState extends Schema {
  /** waiting → countdown → racing → results */
  @type('string') phase = 'waiting'
  /**
   * L'heure SERVEUR (ms) du GO. Les deux clients démarrent à cet instant
   * PRÉCIS (via la synchro d'horloge) — sinon, chacun partirait à la
   * réception du signal, et le mieux connecté partirait toujours en premier.
   */
  @type('number') startAt = 0
  /** La graine de la piste : les deux joueurs ont les MÊMES obstacles */
  @type('number') seed = 0
  /** L'identifiant du vainqueur */
  @type('string') winner = ''
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>()
}

/** Durée du décompte 3, 2, 1, GO (ms) — un poil plus long que côté client */
const COUNTDOWN_MS = 3500

/** ⚠️ À garder en phase avec COURSE_LENGTH dans src/main.ts */
const COURSE_LENGTH = 1920

/**
 * Au-delà de TOUT ce que le jeu permet : croisière max 30 m/s × sprint 1,15
 * ≈ 34,5. La marge évite de punir un client honnête ; un tricheur, lui,
 * voudra annoncer bien plus que 45.
 */
const MAX_SPEED = 45

/** Profondeur de l'historique des positions (ms) — cf. positionAt() */
const HISTORY_MS = 2000

/** Portée d'un coup porté au rival, en mètres (⚠️ à garder égale au client) */
const PVP_PORTEE = 5

/** On ne matraque pas un joueur à terre : il a ce répit avant d'être frappable. */
const PVP_REPOS_MS = 1500

/**
 * On n'accepte pas un coup daté de plus loin que ça dans le passé. C'est le
 * garde-fou de la lag compensation : sans lui, un client bidouillé pourrait
 * dater son coup d'une seconde plus tôt pour frapper là où l'autre ÉTAIT.
 */
const PVP_RECUL_MAX_MS = 400

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
 * Les seuls sorts qu'un client a le droit de relayer.
 * Le serveur ne connaît pas les effets — juste la liste de ce qui est légal.
 * Doit rester aligné sur OFFENSIFS dans src/parchemin.ts.
 */
const SORTS_OFFENSIFS = ['kunai', 'kusarigama', 'fumigene', 'senbon', 'onmyoji']

/**
 * Une salle de course : 2 joueurs, une piste, un vainqueur.
 * Colyseus crée une nouvelle salle automatiquement dès qu'une est pleine.
 */
export class RaceRoom extends Room<{ state: RaceState }> {
  maxClients = 2
  state = new RaceState()

  /** Heure (Date.now) du GO — la référence de TOUTES les validations anti-triche */
  private raceStartAt = 0

  /**
   * L'historique des positions de chaque joueur sur les 2 dernières secondes
   * — la fondation de la LAG COMPENSATION (cf. positionAt, pour les sorts).
   */
  private history = new Map<
    string,
    { t: number; distance: number; lane: number; y: number }[]
  >()

  /** Quand chaque joueur a encaissé son dernier coup (anti-matraquage) */
  private dernierCoupSubi = new Map<string, number>()

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
      p.sliding = !!data.sliding
      p.at = Number(data.at) || 0 // l'heure serveur d'envoi, estimée par le client

      // ————— Anti-triche : la distance annoncée doit être crédible —————
      // Elle ne peut ni reculer, ni dépasser ce qui est physiquement possible
      // depuis le GO. Un client modifié qui crie « 600 m ! » à la 3ᵉ seconde
      // est ramené au plafond — silencieusement, sans le déconnecter.
      const elapsed = (Date.now() - this.raceStartAt) / 1000
      const claimed = Number(data.distance) || 0
      p.distance = Math.min(Math.max(claimed, p.distance), elapsed * MAX_SPEED)

      // ————— L'historique des positions (lag compensation) —————
      const h = this.history.get(client.sessionId)
      if (h) {
        const t = Date.now()
        h.push({ t, distance: p.distance, lane: p.lane, y: p.y })
        while (h.length > 0 && h[0].t < t - HISTORY_MS) h.shift()
      }
    })

    // Un joueur lance un sort offensif sur l'autre. Le serveur ne fait que
    // relayer : il ne simule pas l'effet, c'est la victime qui l'applique.
    this.onMessage('spell', (client, data: any) => {
      const p = this.state.players.get(client.sessionId)
      if (!p || this.state.phase !== 'racing' || p.finished) return

      // On ne relaie que des sorts connus : un client bricole est vite arrive
      if (!SORTS_OFFENSIFS.includes(String(data?.kind))) return

      // `distance` ne sert qu'au portail : c'est la place de l'envoyeur, que
      // la victime va prendre. Le serveur ne l'interprete pas, il la transmet.
      this.broadcast(
        'spell',
        { kind: String(data.kind), distance: Number(data?.distance) || 0 },
        { except: client }
      )
    })

    /**
     * ————— ⚔️ Un coup porté au rival —————
     * C'est LE cas d'usage de la lag compensation. Le client dit « j'ai frappé
     * la ligne L à l'instant T » ; on rejuge la scène telle qu'elle était à T,
     * pas telle qu'elle est à l'arrivée du message. Sans ça, un joueur au ping
     * élevé raterait des coups pourtant justes sur son écran — sa cible aurait
     * « bougé » pendant le trajet du message.
     *
     * Le serveur tranche seul : le client ne fait que demander.
     */
    this.onMessage('pvp', (client, data: any) => {
      if (this.state.phase !== 'racing') return
      const moi = this.state.players.get(client.sessionId)
      if (!moi || moi.finished) return

      // La cible, c'est l'autre joueur de la salle
      let cibleId = ''
      this.state.players.forEach((_p, id) => {
        if (id !== client.sessionId) cibleId = id
      })
      const cible = this.state.players.get(cibleId)
      if (!cible || cible.finished) return

      const now = Date.now()
      if (now - (this.dernierCoupSubi.get(cibleId) ?? 0) < PVP_REPOS_MS) return

      // L'instant du coup, borné : ni dans le futur, ni trop loin dans le passé
      const brut = Number(data?.at) || now
      const at = Math.max(now - PVP_RECUL_MAX_MS, Math.min(now, brut))
      const lane = Math.max(0, Math.min(2, Number(data?.lane) || 0))

      // On remonte le temps pour les DEUX : où étaient-ils à cet instant ?
      const posMoi = this.positionAt(client.sessionId, at)
      const posCible = this.positionAt(cibleId, at)
      if (!posMoi || !posCible) return
      if (posCible.lane !== lane) return

      const ecart = posCible.distance - posMoi.distance
      if (ecart < -2 || ecart > PVP_PORTEE) return

      this.dernierCoupSubi.set(cibleId, now)
      this.broadcast('pvp', { par: client.sessionId, sur: cibleId })
      console.log(`⚔️  ${moi.name || client.sessionId} touche ${cible.name || cibleId}`)
    })

    // Un joueur a franchi la ligne !
    this.onMessage('finished', (client, data: any) => {
      const p = this.state.players.get(client.sessionId)
      if (!p || p.finished || this.state.phase !== 'racing') return

      // ————— Anti-triche : un « j'ai fini ! » doit être crédible —————
      const serverElapsed = (Date.now() - this.raceStartAt) / 1000
      // Finir plus vite que la vitesse max le permet ? Physiquement impossible.
      if (serverElapsed < COURSE_LENGTH / MAX_SPEED) return
      // Et il faut avoir réellement parcouru la course (positions à l'appui).
      if (p.distance < COURSE_LENGTH * 0.95) return

      p.finished = true
      // Le chrono retenu : celui du client s'il colle à NOTRE horloge (l'écart
      // normal, c'est juste la latence) — sinon le nôtre, qui ne ment pas.
      const claimed = Number(data.time) || 0
      p.time = Math.abs(claimed - serverElapsed) < 1.5 ? claimed : serverElapsed

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
    // La grille de départ : le premier arrivé à gauche, l'autre à droite
    const taken = [...this.state.players.values()].map((pl) => pl.startLane)
    p.startLane = taken.includes(0) ? 2 : 0
    p.lane = p.startLane // sinon les patchs d'état le renverraient au centre
    this.state.players.set(client.sessionId, p)
    this.history.set(client.sessionId, [])
    console.log(
      `⚔️  ${p.name || 'anonyme'} (${p.fighter}) rejoint la course (${this.state.players.size}/2)`
    )

    // Deux guerriers présents : on verrouille la salle et c'est parti !
    if (this.state.players.size === 2) {
      this.lock()
      this.state.phase = 'countdown'
      this.state.startAt = Date.now() + COUNTDOWN_MS // GO programmé, à la ms près
      this.clock.setTimeout(() => {
        this.state.phase = 'racing'
        this.raceStartAt = this.state.startAt // la référence anti-triche = le GO programmé
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

  /**
   * ————— LAG COMPENSATION : l'API des futurs sorts 📜 —————
   * Où était ce joueur à l'heure serveur `t` (ms) ? Interpolé entre les deux
   * échantillons qui encadrent t, sur 2 s d'historique.
   *
   * Pourquoi : quand un kunai « touche ce que le lanceur voyait », il faut
   * juger le coup À L'INSTANT DE LA VISÉE (l'horodatage `at` du lanceur, qui
   * partage notre horloge grâce à la synchro NTP) — pas à l'instant où son
   * message nous parvient, 30 à 100 ms plus tard. C'est la technique des
   * shooters (Valve) appliquée à notre course.
   */
  positionAt(sessionId: string, t: number): { distance: number; lane: number; y: number } | null {
    const h = this.history.get(sessionId)
    if (!h || h.length === 0) return null
    if (t <= h[0].t) return h[0]
    const last = h[h.length - 1]
    if (t >= last.t) return last
    for (let i = 1; i < h.length; i++) {
      if (h[i].t >= t) {
        const a = h[i - 1]
        const b = h[i]
        const k = (t - a.t) / Math.max(1, b.t - a.t)
        return {
          distance: a.distance + (b.distance - a.distance) * k,
          lane: k < 0.5 ? a.lane : b.lane, // la ligne ne s'interpole pas : on prend la plus proche
          y: a.y + (b.y - a.y) * k,
        }
      }
    }
    return last
  }

  onLeave(client: Client) {
    console.log(`👋 ${client.sessionId} quitte la course`)
    this.state.players.delete(client.sessionId)
    this.history.delete(client.sessionId)
    this.dernierCoupSubi.delete(client.sessionId)

    // Abandon en pleine course → victoire par forfait pour celui qui reste
    if (this.state.phase === 'countdown' || this.state.phase === 'racing') {
      const remaining = [...this.state.players.keys()]
      this.state.winner = remaining[0] ?? ''
      this.state.phase = 'results'
    }
  }
}
