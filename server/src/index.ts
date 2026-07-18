import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { Server, LobbyRoom, WebSocketTransport } from 'colyseus'
import { toNodeHandler } from 'better-auth/node'
import { RaceRoom } from './RaceRoom.js'
import { auth } from './auth.js'
import { baseDispo, migrer } from './db.js'
import { assureProfil } from './profil.js'

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
    // ————— Les comptes —————
    if (req.url?.startsWith('/api/auth')) {
      if (!authHandler) {
        res.writeHead(503, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ erreur: 'comptes indisponibles (pas de base)' }))
        return
      }
      authHandler(req, res)
      return
    }

    // ————— Le profil de jeu : les deux monnaies —————
    // Le jeu ne fait que LIRE ici. Aucun solde n'est jamais accepté depuis le
    // navigateur : c'est le serveur qui crédite, à la fin d'une course.
    if (req.url === '/api/profil') {
      if (!auth) {
        res.writeHead(503, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ erreur: 'comptes indisponibles' }))
        return
      }
      auth.api
        .getSession({ headers: enTetes(req) })
        .then(async (session) => {
          // Pas de session valide = pas de profil. On ne dit pas POURQUOI :
          // un message précis aiderait surtout qui essaie des jetons au hasard.
          if (!session?.user) {
            res.writeHead(401, { 'content-type': 'application/json' })
            res.end(JSON.stringify({ erreur: 'non connecté' }))
            return
          }
          const profil = await assureProfil(session.user.id, session.user.name)
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify(profil))
        })
        .catch((e) => {
          console.error('profil :', e)
          res.writeHead(500, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ erreur: 'erreur serveur' }))
        })
      return
    }

    // ————— Un point de santé —————
    // Permet de vérifier d'un coup d'œil, depuis un navigateur, que le
    // déploiement répond et si les comptes sont bien actifs.
    if (req.url === '/sante') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true, base: baseDispo(), comptes: authHandler !== null }))
      return
    }

    // Tout le reste appartient à Colyseus (son API de matchmaking)
    for (const route of routesColyseus) route(req, res)
  })

  console.log(`⛩️  Serveur KUROGANE prêt sur ws://localhost:${port}`)
  console.log(`   comptes : ${authHandler ? '✅ actifs' : '⚠️  inactifs (pas de DATABASE_URL)'}`)
})
