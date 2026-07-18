import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { Server, LobbyRoom, WebSocketTransport } from 'colyseus'
import { toNodeHandler } from 'better-auth/node'
import { RaceRoom } from './RaceRoom.js'
import { auth, GOOGLE_DISPO, BASE_URL } from './auth.js'
import { baseDispo, migrer } from './db.js'
import { assureProfil } from './profil.js'
import { acheter, catalogue } from './boutique.js'

/**
 * Le serveur de jeu KUROGANE.
 *
 * Il fait deux métiers sur le MÊME port :
 *  · le websocket des courses (Colyseus), comme avant ;
 *  · quelques routes HTTP sous /api/auth pour les comptes.
 *
 * Un seul port, donc un seul service à déployer sur Railway et une seule
 * adresse à configurer côté jeu.
 */
const port = Number(process.env.PORT ?? 2567)

// La base d'abord : si des migrations manquent, on les applique avant
// d'accepter le moindre joueur. Un serveur qui tourne sur un schéma périmé
// échoue de façon incompréhensible, plusieurs minutes plus tard.
if (baseDispo()) {
  await migrer()
}

const authHandler = auth ? toNodeHandler(auth) : null

/**
 * Traduit les en-têtes Node vers l'objet `Headers` standard attendu par
 * Better Auth — c'est là qu'il va lire le jeton de session.
 */
function enTetes(req: IncomingMessage): Headers {
  const h = new Headers()
  for (const [nom, valeur] of Object.entries(req.headers)) {
    if (typeof valeur === 'string') h.set(nom, valeur)
    else if (Array.isArray(valeur)) for (const v of valeur) h.append(nom, v)
  }
  return h
}

/**
 * ————— CORS : autoriser le jeu à parler au serveur —————
 *
 * Le jeu (Vercel, ou localhost:5173 en dev) et le serveur (Railway) vivent sur
 * deux domaines différents. Sans ces en-têtes, le navigateur BLOQUE l'appel —
 * et il le bloque en silence, après une requête préparatoire « OPTIONS » à
 * laquelle il faut savoir répondre. (curl, lui, ne fait pas ce préalable :
 * c'est pourquoi un test en ligne de commande peut réussir là où le vrai jeu
 * échoue.)
 *
 * ⚠️ On renvoie l'origine EXACTE de l'appelant, jamais `*` : avec `*`, un
 * navigateur refuse d'envoyer les identifiants, et surtout n'importe quel site
 * pourrait interroger l'API au nom d'un joueur connecté.
 */
const ORIGINES = new Set(
  [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    ...(process.env.ORIGINES_AUTORISEES?.split(',').map((o) => o.trim()) ?? []),
  ].filter(Boolean)
)

function entetesCors(req: IncomingMessage): Record<string, string> {
  const origine = req.headers.origin
  // Une origine inconnue ne reçoit AUCUN en-tête : le navigateur bloquera.
  if (!origine || !ORIGINES.has(origine)) return {}
  return {
    'access-control-allow-origin': origine,
    'access-control-allow-credentials': 'true',
    // `vary` : sans lui, un cache pourrait resservir la réponse d'une origine
    // à une autre, ce qui reviendrait à ouvrir l'API à tout le monde.
    vary: 'Origin',
  }
}

function repondre(res: ServerResponse, code: number, corps: unknown, req?: IncomingMessage) {
  res.writeHead(code, {
    'content-type': 'application/json',
    ...(req ? entetesCors(req) : {}),
  })
  res.end(JSON.stringify(corps))
}

/** Lit un corps JSON, borné : personne ne nous fera avaler 100 Mo. */
async function lireCorps(req: IncomingMessage): Promise<any> {
  const morceaux: Buffer[] = []
  let taille = 0
  for await (const m of req) {
    taille += m.length
    if (taille > 4096) throw new Error('corps trop gros')
    morceaux.push(m as Buffer)
  }
  if (!morceaux.length) return {}
  try {
    return JSON.parse(Buffer.concat(morceaux).toString('utf8'))
  } catch {
    return {}
  }
}

/**
 * Lit un formulaire envoyé en POST (`application/x-www-form-urlencoded`).
 *
 * C'est ainsi que le jeu lance la connexion Google : l'envoi d'un formulaire
 * est une navigation de premier niveau (indispensable pour que le cookie de
 * protection soit accepté), tout en gardant le jeton hors de l'adresse.
 */
async function lireFormulaire(req: IncomingMessage): Promise<Record<string, string>> {
  const morceaux: Buffer[] = []
  let taille = 0
  for await (const m of req) {
    taille += (m as Buffer).length
    if (taille > 8192) throw new Error('formulaire trop gros')
    morceaux.push(m as Buffer)
  }
  const params = new URLSearchParams(Buffer.concat(morceaux).toString('utf8'))
  return Object.fromEntries(params.entries())
}

/**
 * Exécute `suite` seulement si la requête porte une session valide.
 *
 * Le refus ne dit jamais POURQUOI (jeton absent, expiré, inventé…) : un
 * message précis n'aiderait que celui qui essaie des jetons au hasard.
 */
function avecSession(
  req: IncomingMessage,
  res: ServerResponse,
  suite: (joueur: string, nom: string | undefined, user: any) => Promise<void>
) {
  if (!auth) {
    repondre(res, 503, { erreur: 'comptes indisponibles' }, req)
    return
  }
  auth.api
    .getSession({ headers: enTetes(req) })
    .then(async (session) => {
      if (!session?.user) {
        repondre(res, 401, { erreur: 'non connecté' }, req)
        return
      }
      await suite(session.user.id, session.user.name, session.user)
    })
    .catch((e) => {
      console.error('api :', e)
      repondre(res, 500, { erreur: 'erreur serveur' }, req)
    })
}

/**
 * Le serveur HTTP est créé NU, sans gestionnaire.
 *
 * ⚠️ Colyseus ajoute ses PROPRES routes HTTP (son API de matchmaking) sur ce
 * même serveur au moment du listen(). Or Node appelle tous les écouteurs
 * « request » à la suite, sans jamais attendre qu'un gestionnaire asynchrone
 * ait fini : le nôtre partait interroger la base pour Better Auth, et pendant
 * ce temps celui de Colyseus répondait déjà 404. Résultat, une réponse vide
 * puis un « headers already sent » à l'arrivée de la vraie réponse.
 *
 * On installe donc UN SEUL aiguilleur après le listen() (cf. plus bas), qui
 * traite lui-même /api/auth et ne passe la main à Colyseus que pour le reste.
 */
const httpServer = createServer()

// On donne NOTRE serveur HTTP à Colyseus au lieu de le laisser créer le sien :
// c'est ce qui permet aux courses et aux comptes de cohabiter sur un seul port.
const gameServer = new Server({ transport: new WebSocketTransport({ server: httpServer }) })

// La salle « lobby » : le jeu s'y connecte le temps de LIRE la liste des salons
// publics ouverts (cf. Net.listSalons). Colyseus la tient à jour en temps réel.
gameServer.define('lobby', LobbyRoom)

// filterBy(['code']) : joinOrCreate('race', { code }) route vers le salon qui
// porte CE code — ou en crée un. C'est ce qui fait marcher les codes privés ET
// la partie rapide (tous les publics partagent le code 'PUBLIC' et se remplissent).
// enableRealtimeListing() : le salon se signale à la salle « lobby » ci-dessus.
gameServer.define('race', RaceRoom).filterBy(['code']).enableRealtimeListing()

gameServer.listen(port).then(() => {
  // ————— L'aiguilleur HTTP —————
  // Colyseus vient d'installer ses écouteurs : on les met de côté, on vide la
  // liste, et on remet UN seul gestionnaire qui décide qui répond. Comme il est
  // désormais le seul, plus personne ne peut répondre par-dessus lui.
  const routesColyseus = httpServer.listeners('request') as ((
    req: IncomingMessage,
    res: ServerResponse
  ) => void)[]
  httpServer.removeAllListeners('request')

  httpServer.on('request', (req, res) => {
    // ————— La requête préparatoire du navigateur —————
    // Elle précède tout appel un peu riche (en-tête Authorization, JSON…) et
    // demande « ai-je le droit ? ». Y répondre est la condition pour que le
    // vrai appel parte ensuite.
    if (req.method === 'OPTIONS' && req.url?.startsWith('/api/')) {
      res.writeHead(204, {
        ...entetesCors(req),
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers': 'content-type, authorization',
        'access-control-max-age': '86400', // 24 h : on évite un aller-retour par appel
      })
      res.end()
      return
    }

    // ————— Les comptes —————
    if (req.url?.startsWith('/api/auth')) {
      if (!authHandler) {
        res.writeHead(503, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ erreur: 'comptes indisponibles (pas de base)' }))
        return
      }
      // Better Auth ecrit lui-meme sa reponse : on pose les en-teres CORS
      // AVANT de lui passer la main (setHeader survit a son writeHead).
      for (const [k, v] of Object.entries(entetesCors(req))) res.setHeader(k, v)
      authHandler(req, res)
      return
    }

    // ————— Le profil de jeu : les deux monnaies —————
    // Le jeu ne fait que LIRE ici. Aucun solde n'est jamais accepté depuis le
    // navigateur : c'est le serveur qui crédite, à la fin d'une course.
    if (req.url === '/api/profil') {
      avecSession(req, res, async (joueur, nom, user) => {
        const profil = await assureProfil(joueur, nom)
        // On joint l'identite : le jeu doit savoir s'il s'agit d'un compte
        // anonyme (donc perdable) pour proposer de le securiser.
        repondre(
          res,
          200,
          { ...profil, anonyme: user?.isAnonymous === true, email: user?.email ?? null },
          req
        )
      })
      return
    }

    // ————— La boutique : le catalogue —————
    // On renvoie AUSSI ce que le joueur possède déjà : le jeu a besoin des deux
    // pour griser ce qui est acquis et débloquer les couleurs au vestiaire.
    if (req.url === '/api/boutique') {
      avecSession(req, res, async (joueur, nom) => {
        // assureProfil d'abord : un compte tout neuf n'a pas encore de ligne,
        // et la boutique doit pouvoir s'ouvrir dès la première seconde de jeu.
        const profil = await assureProfil(joueur, nom)
        repondre(res, 200, { profil, articles: await catalogue(joueur) }, req)
      })
      return
    }

    // ————— La boutique : acheter —————
    if (req.url === '/api/acheter' && req.method === 'POST') {
      avecSession(req, res, async (joueur) => {
        const corps = await lireCorps(req)
        const code = typeof corps?.code === 'string' ? corps.code : ''
        // ⚠️ On ne reçoit QUE le code. Le prix, la monnaie et le solde sont
        // relus dans la base — un client modifié n'a rien à négocier ici.
        const r = await acheter(joueur, code)
        if (!r.ok) {
          repondre(res, 400, { erreur: r.raison }, req)
          return
        }
        repondre(res, 200, { profil: r.profil, articles: await catalogue(joueur) }, req)
      })
      return
    }

    /*
     * ————— Le DÉPART vers Google —————
     *
     * Le jeu ne lance PAS la connexion lui-même : il envoie le navigateur ici,
     * en navigation de premier niveau. C'est indispensable.
     *
     * Pourquoi : Better Auth protège l'échange par un jeton « state » qu'il
     * dépose dans un COOKIE au moment du départ, et qu'il revérifie au retour.
     * Lancé depuis le jeu par un simple `fetch`, ce cookie arrivait sur une
     * réponse d'un AUTRE domaine — le navigateur ne le gardait pas, et le
     * retour échouait sur « state_mismatch ».
     *
     * Ici, le navigateur est sur le domaine du serveur : le cookie est de
     * première partie, posé et renvoyé sans difficulté. On recopie donc les
     * en-têtes de Better Auth sur notre réponse, puis on redirige vers Google.
     */
    if (req.url?.startsWith('/api/connexion-google')) {
      // Le jeu envoie un FORMULAIRE : destination et jeton anonyme sont dans le
      // corps, pas dans l'adresse (un jeton n'a rien a faire dans l'historique
      // du navigateur ni dans les journaux du serveur).
      void (async () => {
        let cible: URL | null = null
        try {
          const champs = await lireFormulaire(req)

          // Meme liste blanche que le relais : la destination doit etre a nous.
          try {
            cible = new URL(champs.vers ?? '')
          } catch {
            repondre(res, 400, { erreur: 'destination invalide' })
            return
          }
          if (!ORIGINES.has(cible.origin) || !auth) {
            repondre(res, 400, { erreur: 'destination non autorisee' })
            return
          }

          // Le jeton anonyme redevient un en-tete `Authorization` : c'est ainsi
          // que Better Auth reconnait le compte a fusionner dans le nouveau.
          const entetes = enTetes(req)
          if (champs.jeton) entetes.set('authorization', `Bearer ${champs.jeton}`)

          const relais = `${BASE_URL}/api/relais?vers=${encodeURIComponent(cible.origin + cible.pathname)}`
          const reponse: Response = await auth.api.signInSocial({
            body: { provider: 'google', callbackURL: relais },
            headers: entetes,
            asResponse: true, // on veut la reponse ENTIERE, cookies compris
          })

          // Les cookies de Better Auth (dont le fameux « state ») passent sur
          // NOTRE reponse : c'est tout l'interet de ce detour.
          for (const [nom, valeur] of reponse.headers.entries()) {
            if (nom.toLowerCase() === 'set-cookie') res.appendHeader('set-cookie', valeur)
          }

          const data: any = await reponse.json().catch(() => null)
          res.writeHead(302, {
            location: data?.url ?? `${cible.origin}${cible.pathname}#connexion=echec`,
          })
          res.end()
        } catch (e) {
          console.error('connexion google :', e)
          const repli = cible ? `${cible.origin}${cible.pathname}#connexion=echec` : '/'
          res.writeHead(302, { location: repli })
          res.end()
        }
      })()
      return
    }

    /*
     * ————— Le relais de retour de Google —————
     *
     * Le problème : après un aller-retour chez Google, Better Auth crée la
     * session et pose un COOKIE sur le domaine du serveur. Or le jeu vit sur un
     * AUTRE domaine (Vercel) et fonctionne au jeton, pas au cookie — et les
     * navigateurs bloquent de plus en plus les cookies tiers.
     *
     * La parade : Google ne renvoie pas directement vers le jeu, mais ICI.
     * À cet instant précis, le navigateur est sur le domaine du serveur, donc le
     * cookie est de première partie et parfaitement lisible. On lit la session,
     * et on renvoie vers le jeu avec le jeton dans le FRAGMENT de l'adresse
     * (`#jeton=…`).
     *
     * Le fragment plutôt qu'un paramètre `?` : il n'est jamais envoyé aux
     * serveurs, n'apparaît donc ni dans les journaux ni dans les en-têtes
     * `Referer`. Le jeu le lit puis l'efface aussitôt de la barre d'adresse.
     */
    if (req.url?.startsWith('/api/relais')) {
      const url = new URL(req.url, 'http://x')
      const vers = url.searchParams.get('vers') ?? ''

      /*
       * ⚠️ LA vérification qui compte : la destination doit figurer dans la
       * liste blanche. Sans elle, n'importe qui pourrait forger un lien
       * `/api/relais?vers=https://site-pirate` et repartir avec le jeton de
       * session d'un joueur — donc son compte et ses achats.
       */
      let cible: URL
      try {
        cible = new URL(vers)
      } catch {
        repondre(res, 400, { erreur: 'destination invalide' })
        return
      }
      if (!ORIGINES.has(cible.origin)) {
        console.warn(`⚠️  relais refusé vers une origine inconnue : ${cible.origin}`)
        repondre(res, 400, { erreur: 'destination non autorisée' })
        return
      }

      if (!auth) {
        res.writeHead(302, { location: cible.origin })
        res.end()
        return
      }

      auth.api
        .getSession({ headers: enTetes(req) })
        .then((session) => {
          // Pas de session = la connexion a échoué ou a été annulée. On renvoie
          // au jeu sans jeton : il repartira simplement en anonyme.
          const jeton = session?.session?.token
          const dest = jeton
            ? `${cible.origin}${cible.pathname}#jeton=${encodeURIComponent(jeton)}`
            : `${cible.origin}${cible.pathname}#connexion=echec`
          res.writeHead(302, { location: dest })
          res.end()
        })
        .catch(() => {
          res.writeHead(302, { location: `${cible.origin}#connexion=echec` })
          res.end()
        })
      return
    }

    // ————— Un point de santé —————
    // Permet de vérifier d'un coup d'œil, depuis un navigateur, que le
    // déploiement répond et si les comptes sont bien actifs.
    if (req.url === '/sante') {
      // Le jeu interroge cette route pour savoir ce que le serveur sait faire
      // (Google configuré ?). Elle a donc besoin des en-têtes CORS comme les
      // autres — sans eux, le navigateur bloque et le jeu croit Google absent.
      repondre(
        res,
        200,
        { ok: true, base: baseDispo(), comptes: authHandler !== null, google: GOOGLE_DISPO },
        req
      )
      return
    }

    // Tout le reste appartient à Colyseus (son API de matchmaking)
    for (const route of routesColyseus) route(req, res)
  })

  console.log(`⛩️  Serveur KUROGANE prêt sur ws://localhost:${port}`)
  console.log(`   comptes : ${authHandler ? '✅ actifs' : '⚠️  inactifs (pas de DATABASE_URL)'}`)
})
