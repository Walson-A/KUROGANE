import { Room, Client, updateLobby } from 'colyseus'
import { Schema, MapSchema, type } from '@colyseus/schema'
import { compteDe } from './auth.js'
import { assureProfil, crediter, GAIN_COURSE } from './profil.js'

/**
 * ————— Le salon de course KUROGANE —————
 *
 * Une salle accueille jusqu'à 10 joueurs. Deux façons d'y entrer :
 *  · un CODE à 4 lettres qu'on se partage entre amis (salon privé) ;
 *  · la liste des salons PUBLICS, ou la « partie rapide » qui remplit
 *    automatiquement un salon public.
 *
 * Le départ est à la « Among Us » : chacun se déclare PRÊT, et l'hôte lance
 * la partie dès qu'au moins la moitié des joueurs le sont. Un décompte de
 * 10 secondes, commun à tous, précède le GO.
 */

/** Tout ce que le serveur sait d'un joueur, synchronisé vers tous les autres. */
export class PlayerState extends Schema {
  @type('number') lane = 1
  @type('number') y = 0
  @type('number') distance = 0
  @type('boolean') sliding = false
  @type('boolean') finished = false
  @type('number') time = 0
  /** Le pseudo choisi dans les options — nettoyé à l'arrivée, cf. cleanName() */
  @type('string') name = ''
  /** Le guerrier choisi (cf. src/roster.ts côté jeu) */
  @type('string') fighter = 'yasuke'
  /** false pendant une coupure : sa place est gardée, il peut revenir (cf. onDrop) */
  @type('boolean') connected = true
  /** S'est-il déclaré PRÊT dans le lobby ? */
  @type('boolean') ready = false
  /** Sa place à l'arrivée (1 = premier). 0 = pas encore fini. */
  @type('number') rank = 0
  /** Sa ligne sur la grille de départ (0, 1, 2), répartie — cf. onJoin */
  @type('number') startLane = 1
  /** Heure SERVEUR (ms) à laquelle sa dernière position a été envoyée */
  @type('number') at = 0
}

/** L'état complet d'un salon */
export class RaceState extends Schema {
  /** lobby → countdown → racing → results → (retour) lobby */
  @type('string') phase = 'lobby'
  /** L'heure SERVEUR (ms) du GO. Tous démarrent à cet instant précis. */
  @type('number') startAt = 0
  /** La graine de la piste : tous les joueurs ont les MÊMES obstacles */
  @type('number') seed = 0
  /** Le code du salon (privé, ou 'PUBLIC' pour la partie rapide) */
  @type('string') code = ''
  /** L'hôte : le seul qui lance la partie. Réattribué s'il part. */
  @type('string') hostId = ''
  /** Salon listé publiquement ? (sinon on n'y entre que par le code) */
  @type('boolean') isPublic = false
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>()
}

/** Le salon accueille jusqu'à 10 guerriers. */
const MAX_CLIENTS = 10

/** Décompte avant le GO, une fois la partie lancée (ms). */
const COUNTDOWN_MS = 10_000
/**
 * 👻 La trêve du départ : 5 s après le GO, aucune attaque ne passe — ni sort,
 * ni coup. Le client affiche la même fenêtre ; ICI elle est appliquée pour de
 * vrai, car un client trafiqué peut envoyer ce qu'il veut. Même valeur que
 * FANTOME_DUREE côté client (main.ts) : les deux doivent bouger ensemble.
 */
const FANTOME_MS = 5_000

/** ⚠️ À garder en phase avec COURSE_LENGTH dans src/main.ts */
const COURSE_LENGTH = 1920

/**
 * Au-delà de TOUT ce que le jeu permet : croisière 30 × sprint 1,15 × dash 1,35
 * ≈ 46,5. La marge évite de punir un client honnête ; un tricheur voudra
 * annoncer bien plus.
 */
const MAX_SPEED = 55

/** Profondeur de l'historique des positions (ms) — cf. positionAt() */
const HISTORY_MS = 2000

/** Une fois le 1ᵉʳ arrivé, on laisse ce délai aux autres avant de clore. */
const GRACE_MS = 25_000

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

/** Les guerriers que le serveur accepte. Tout le reste → Yasuke.
 * ('perso' n'y est pas : son look custom ne transite pas — l'adversaire le
 * verrait en Yasuke de toute façon.) */
const FIGHTERS = ['yasuke', 'hana', 'onimaru', 'tamae']
const MAX_NAME = 12
const MAX_CHAT = 120

/**
 * Les seuls sorts qu'un client a le droit de relayer.
 * Le serveur ne connaît pas les effets — juste la liste de ce qui est légal.
 * Doit rester aligné sur OFFENSIFS dans src/parchemin.ts.
 */
const SORTS_OFFENSIFS = ['kunai', 'kusarigama', 'fumigene', 'senbon', 'onmyoji']

/**
 * Le pseudo et le guerrier viennent du joueur : on ne leur fait PAS confiance.
 * Un client bidouillé peut envoyer n'importe quoi. Le serveur tranche.
 * (L'échappement HTML se fait à l'affichage côté jeu, pas ici.)
 */
function cleanName(v: unknown): string {
  if (typeof v !== 'string') return ''
  return v.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME)
}

function cleanFighter(v: unknown): string {
  return typeof v === 'string' && FIGHTERS.includes(v) ? v : 'yasuke'
}

/** Un code de salon : lettres majuscules. 'PUBLIC' est réservé à la partie rapide. */
function cleanCode(v: unknown): string {
  if (typeof v !== 'string') return ''
  return v.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6)
}

export class RaceRoom extends Room<{ state: RaceState }> {
  maxClients = MAX_CLIENTS
  state = new RaceState()

  /** Heure (Date.now) du GO — la référence de TOUTES les validations anti-triche */
  private raceStartAt = 0
  /** Le minuteur de grâce, armé quand le premier franchit la ligne */
  private graceTimer: { clear: () => void } | null = null

  /**
   * L'historique des positions de chaque joueur sur les 2 dernières secondes
   * — la fondation de la LAG COMPENSATION (cf. positionAt).
   */
  private history = new Map<
    string,
    { t: number; distance: number; lane: number; y: number }[]
  >()

  /** Quand chaque joueur a encaissé son dernier coup (anti-matraquage) */
  private dernierCoupSubi = new Map<string, number>()

  /**
   * sessionId Colyseus → identifiant du compte Better Auth.
   * PRIVÉE, jamais synchronisée : le compte d'un joueur ne regarde que lui.
   */
  private comptes = new Map<string, string>()

  onCreate(options: any) {
    this.state.seed = Math.floor(Math.random() * 2 ** 31)
    this.state.code = cleanCode(options?.code) || 'PUBLIC'
    this.state.isPublic = this.state.code === 'PUBLIC' || options?.isPublic === true

    // Diffuse l'état 30 fois/s : les adversaires bougent finement
    this.setPatchRate(33)
    this.refreshMetadata()

    // Ping + synchro d'horloge (NTP simplifié) : on renvoie l'heure du client
    // telle quelle ET la nôtre. Il en déduit l'aller-retour ET le décalage.
    this.onMessage('ping', (client, sentAt: number) => {
      client.send('pong', { sentAt: Number(sentAt) || 0, server: Date.now() })
    })

    // ————— Le lobby : se déclarer prêt —————
    this.onMessage('ready', (client, val: any) => {
      const p = this.state.players.get(client.sessionId)
      if (!p || this.state.phase !== 'lobby') return
      p.ready = !!val
      this.refreshMetadata()
    })

    // ————— L'hôte lance la partie —————
    this.onMessage('start', (client) => {
      if (client.sessionId !== this.state.hostId || this.state.phase !== 'lobby') return
      const joueurs = [...this.state.players.values()].filter((p) => p.connected)
      if (joueurs.length < 2) return
      // Règle « à la moitié » : l'hôte peut lancer dès que la moitié est prête.
      const prets = joueurs.filter((p) => p.ready).length
      if (prets < Math.ceil(joueurs.length / 2)) return
      this.lancer()
    })

    // ————— Le chat du lobby —————
    this.onMessage('chat', (client, data: any) => {
      const p = this.state.players.get(client.sessionId)
      if (!p) return
      const text = String(data?.text ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_CHAT)
      if (!text) return
      // On relaie à TOUS, l'auteur compris : son message s'affiche pareil.
      this.broadcast('chat', { from: client.sessionId, name: p.name, text })
    })

    /**
     * Changement de guerrier depuis le salon.
     *
     * Sans ça, le bouton « vestiaire » du lobby mentirait : le joueur se
     * verrait changer, les autres continueraient à voir son ancien guerrier —
     * et la course partirait avec le mauvais.
     *
     * Refusé HORS salon : on ne change pas d'armure au milieu d'une course.
     * Et on repasse par les mêmes validations qu'à l'arrivée, parce qu'un
     * message vient toujours d'un client auquel on ne fait pas confiance.
     */
    this.onMessage('identity', (client, data: any) => {
      if (this.state.phase !== 'lobby') return
      const p = this.state.players.get(client.sessionId)
      if (!p) return
      p.fighter = cleanFighter(data?.fighter)
      p.name = cleanName(data?.name)
    })

    // Retour au salon après une course, pour rejouer ensemble (hôte seul).
    this.onMessage('tolobby', (client) => {
      if (client.sessionId !== this.state.hostId || this.state.phase !== 'results') return
      this.retourLobby()
    })

    // ————— Les ACTIONS (saut, ligne, glissade, trébuchement) —————
    // Relayées IMMÉDIATEMENT à tous les autres, avec l'identité de l'auteur.
    const ACTIONS = ['lane', 'jump', 'slide', 'stumble', 'mur']
    this.onMessage('action', (client, data: any) => {
      if (this.state.phase !== 'racing') return
      if (!data || !ACTIONS.includes(data.t)) return
      this.broadcast('action', { ...data, from: client.sessionId }, { except: client })
    })

    // ————— La position (~20 fois/s) —————
    this.onMessage('progress', (client, data: any) => {
      const p = this.state.players.get(client.sessionId)
      if (!p || this.state.phase !== 'racing' || p.finished) return
      p.lane = Math.max(0, Math.min(2, Number(data.lane) || 0))
      p.y = Number(data.y) || 0
      p.sliding = !!data.sliding
      p.at = Number(data.at) || 0

      // Anti-triche : la distance ne peut ni reculer, ni dépasser le possible.
      const elapsed = (Date.now() - this.raceStartAt) / 1000
      const claimed = Number(data.distance) || 0
      p.distance = Math.min(Math.max(claimed, p.distance), elapsed * MAX_SPEED)

      const h = this.history.get(client.sessionId)
      if (h) {
        const t = Date.now()
        h.push({ t, distance: p.distance, lane: p.lane, y: p.y })
        while (h.length > 0 && h[0].t < t - HISTORY_MS) h.shift()
      }
    })

    // ————— Un sort offensif —————
    // Le lanceur désigne sa cible (le plus proche devant, calculé côté client).
    // Le serveur relaie au SEUL visé — ou à tous en secours si la cible a filé.
    this.onMessage('spell', (client, data: any) => {
      const p = this.state.players.get(client.sessionId)
      if (!p || this.state.phase !== 'racing' || p.finished) return
      // 👻 Trêve du départ : le serveur jette le sort, quoi qu'en dise le client
      if (Date.now() < this.state.startAt + FANTOME_MS) return
      if (!SORTS_OFFENSIFS.includes(String(data?.kind))) return

      const msg = {
        from: client.sessionId,
        kind: String(data.kind),
        distance: Number(data?.distance) || 0, // le portail seul s'en sert
      }
      const target = typeof data?.target === 'string' ? data.target : ''
      const cible = target ? this.clients.find((c) => c.sessionId === target) : undefined
      if (cible && target !== client.sessionId) cible.send('spell', msg)
      else this.broadcast('spell', msg, { except: client }) // secours : tout le monde
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
      // 👻 Trêve du départ : pas de coup non plus
      if (Date.now() < this.state.startAt + FANTOME_MS) return
      const moi = this.state.players.get(client.sessionId)
      if (!moi || moi.finished) return

      const now = Date.now()
      const brut = Number(data?.at) || now
      const at = Math.max(now - PVP_RECUL_MAX_MS, Math.min(now, brut))
      const lane = Math.max(0, Math.min(2, Number(data?.lane) || 0))

      const posMoi = this.positionAt(client.sessionId, at)
      if (!posMoi) return

      let cibleId = ''
      let minEcart = Infinity

      this.state.players.forEach((p, id) => {
        if (id === client.sessionId || p.finished) return
        if (now - (this.dernierCoupSubi.get(id) ?? 0) < PVP_REPOS_MS) return

        const posCible = this.positionAt(id, at)
        if (!posCible || posCible.lane !== lane) return

        const ecart = posCible.distance - posMoi.distance
        if (ecart >= -2 && ecart <= PVP_PORTEE) {
          const distAbs = Math.abs(ecart)
          if (distAbs < minEcart) {
            minEcart = distAbs
            cibleId = id
          }
        }
      })

      if (!cibleId) return
      const cible = this.state.players.get(cibleId)
      if (!cible) return

      this.dernierCoupSubi.set(cibleId, now)
      this.broadcast('pvp', { par: client.sessionId, sur: cibleId })
      console.log(`⚔️  ${moi.name || client.sessionId} touche ${cible.name || cibleId}`)
    })

    // ————— Un joueur franchit la ligne —————
    this.onMessage('finished', (client, data: any) => {
      const p = this.state.players.get(client.sessionId)
      if (!p || p.finished || this.state.phase !== 'racing') return

      // Anti-triche : finir plus vite que la vitesse max l'autorise = impossible.
      const serverElapsed = (Date.now() - this.raceStartAt) / 1000
      if (serverElapsed < COURSE_LENGTH / MAX_SPEED) return
      if (p.distance < COURSE_LENGTH * 0.95) return

      p.finished = true
      p.rank = [...this.state.players.values()].filter((x) => x.finished).length
      const claimed = Number(data.time) || 0
      p.time = Math.abs(claimed - serverElapsed) < 1.5 ? claimed : serverElapsed

      // Le premier arrivé arme le minuteur de grâce pour les autres.
      if (p.rank === 1 && !this.graceTimer) {
        this.graceTimer = this.clock.setTimeout(() => this.clore(), GRACE_MS)
      }
      // Tout le monde a fini → résultats tout de suite.
      if ([...this.state.players.values()].filter((x) => x.connected).every((x) => x.finished)) {
        this.clore()
      }
    })
  }

  async onJoin(client: Client, options: any) {
    const p = new PlayerState()
    p.name = cleanName(options?.name)
    p.fighter = cleanFighter(options?.fighter)

    /*
     * ————— À quel COMPTE appartient ce joueur ? —————
     *
     * Colyseus l'identifie par un `sessionId` qui ne vaut que le temps de la
     * connexion. Pour créditer le bon portefeuille, il faut son identifiant
     * Better Auth : on vérifie donc ici le jeton qu'il a envoyé.
     *
     * ⚠️ L'identifiant reste dans une Map PRIVÉE, jamais dans l'état
     * synchronisé : les autres joueurs du salon n'ont rien à savoir du compte
     * de leurs adversaires.
     *
     * Un jeton absent ou invalide ne REFUSE PAS l'entrée : on peut courir sans
     * compte, on ne gagne simplement rien. Mieux vaut une course sans gain
     * qu'un joueur bloqué à la porte parce que la base a hoqueté.
     */
    const joueur = await compteDe(options?.token)
    if (joueur) this.comptes.set(client.sessionId, joueur)
    // Grille de départ : on répartit sur les 3 lignes (10 joueurs → chevauchement)
    p.startLane = this.state.players.size % 3
    p.lane = p.startLane
    this.state.players.set(client.sessionId, p)
    this.history.set(client.sessionId, [])

    // Le premier arrivé est l'hôte.
    if (!this.state.hostId) this.state.hostId = client.sessionId

    console.log(
      `⚔️  ${p.name || 'anonyme'} rejoint ${this.state.code} (${this.state.players.size}/${MAX_CLIENTS})`
    )
    this.refreshMetadata()
  }

  /** Lance la partie : verrou, décompte de 10 s commun, puis GO. */
  private lancer() {
    this.lock()
    this.state.phase = 'countdown'
    this.state.startAt = Date.now() + COUNTDOWN_MS
    this.refreshMetadata()
    this.clock.setTimeout(() => {
      this.state.phase = 'racing'
      this.raceStartAt = this.state.startAt
      this.refreshMetadata()
    }, COUNTDOWN_MS)
  }

  /** Clôt la course : ceux qui n'ont pas fini restent sans rang (DNF). */
  private clore() {
    if (this.state.phase !== 'racing') return
    if (this.graceTimer) {
      this.graceTimer.clear()
      this.graceTimer = null
    }
    this.state.phase = 'results'
    this.refreshMetadata()
    void this.payer()
  }

  /**
   * ————— La paie —————
   * Les Mon sont crédités ICI, par le serveur, à la clôture de la course. Le
   * jeu ne demande jamais « donne-moi 100 Mon » : il ne fait que constater son
   * solde ensuite. C'est la seule façon d'empêcher un client modifié de
   * s'enrichir tout seul.
   *
   * Seuls ceux qui ont FRANCHI la ligne touchent quelque chose : abandonner à
   * mi-parcours pour relancer une course ne rapporte rien, donc rien à gagner à
   * enchaîner les faux départs. Et comme le serveur a déjà refusé toute arrivée
   * plus rapide que physiquement possible (cf. 'finished'), une course payée
   * coûte forcément ses ~75 secondes.
   */
  private async payer() {
    for (const [sessionId, p] of this.state.players.entries()) {
      if (!p.finished) continue
      const joueur = this.comptes.get(sessionId)
      if (!joueur) continue // il court sans compte : pas de portefeuille à créditer

      const gain = p.rank === 1 ? GAIN_COURSE.victoire : GAIN_COURSE.participation
      try {
        /*
         * ⚠️ On s'assure que la ligne de profil EXISTE avant de créditer.
         *
         * `crediter` fait un `update` : sans ligne, il ne remonterait aucune
         * erreur et ne créditerait simplement rien. Or un joueur peut très bien
         * arriver ici sans jamais avoir appelé /api/profil (un client qui va
         * droit à la course). La paie ne doit dépendre d'aucun effet de bord
         * survenu ailleurs.
         */
        await assureProfil(joueur, p.name)
        await crediter(joueur, 'mon', gain, p.rank === 1 ? 'course:victoire' : 'course')
        console.log(`💰 ${p.name || sessionId} : +${gain} Mon (${p.rank}ᵉ)`)
      } catch (e) {
        // Une panne de base ne doit pas faire tomber le salon : la course est
        // finie et jouée, seul le gain est perdu.
        console.error('paie :', e)
      }
    }
  }

  /** Rouvre le salon pour rejouer ensemble : on repart d'un lobby propre. */
  private retourLobby() {
    this.state.phase = 'lobby'
    this.state.startAt = 0
    this.state.seed = Math.floor(Math.random() * 2 ** 31)
    this.raceStartAt = 0
    for (const p of this.state.players.values()) {
      p.finished = false
      p.rank = 0
      p.ready = false
      p.distance = 0
      p.time = 0
      p.lane = p.startLane
      p.y = 0
      p.sliding = false
    }
    for (const h of this.history.values()) h.length = 0
    this.unlock()
    this.refreshMetadata()
  }

  /**
   * Coupure ANORMALE (écran verrouillé, wifi qui saute…) : on garde la place
   * 30 s. Revient → onReconnect. Sinon → onLeave. On ne supprime RIEN ici.
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
    console.log(`👋 ${client.sessionId} quitte ${this.state.code}`)
    this.state.players.delete(client.sessionId)
    this.history.delete(client.sessionId)
    this.dernierCoupSubi.delete(client.sessionId)
    this.comptes.delete(client.sessionId)

    // L'hôte est parti : on confie le salon à quelqu'un d'autre.
    if (client.sessionId === this.state.hostId) {
      this.state.hostId = [...this.state.players.keys()][0] ?? ''
    }

    // En course, si tous les restants ont fini, on clôt.
    if (this.state.phase === 'racing') {
      const restants = [...this.state.players.values()].filter((x) => x.connected)
      if (restants.length > 0 && restants.every((x) => x.finished)) this.clore()
    }
    this.refreshMetadata()
  }

  /**
   * Les métadonnées, lues par la liste publique côté client (getAvailableRooms).
   * C'est ici que se décide ce qu'on voit dans « salons ouverts ».
   */
  private refreshMetadata() {
    const host = this.state.hostId
      ? this.state.players.get(this.state.hostId)?.name || 'anonyme'
      : ''
    this.setMetadata({
      code: this.state.code,
      public: this.state.isPublic,
      phase: this.state.phase,
      count: this.state.players.size,
      max: MAX_CLIENTS,
      host,
    }).then(() => updateLobby(this)) // pousse la mise à jour vers la salle « lobby »
  }

  /**
   * ————— LAG COMPENSATION —————
   * Où était ce joueur à l'heure serveur `t` (ms) ? Interpolé sur 2 s d'historique.
   * Réservé aux futurs sorts jugés côté serveur.
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
          lane: k < 0.5 ? a.lane : b.lane,
          y: a.y + (b.y - a.y) * k,
        }
      }
    }
    return last
  }
}
