import { betterAuth } from 'better-auth'
import { anonymous, bearer } from 'better-auth/plugins'
import { pool } from './db.js'
import { fusionner } from './profil.js'

/**
 * ————— L'AUTHENTIFICATION —————
 *
 * Better Auth est une BIBLIOTHÈQUE, pas un service : elle tourne sur ce
 * serveur et range ses utilisateurs dans NOTRE base Postgres. Aucun tiers,
 * aucune clé dans le navigateur — le jeu ne parle qu'à ce serveur, qui seul
 * ouvre une connexion à la base.
 *
 * On lui délègue tout ce qu'il ne faut jamais écrire soi-même : hachage des
 * mots de passe, sessions, vérification d'email, limitation des tentatives.
 *
 * ————— Le parcours du joueur —————
 *  1. Il arrive → compte ANONYME créé automatiquement. Il joue tout de suite,
 *     aucune inscription, aucune donnée personnelle (les joueurs sont souvent
 *     mineurs). Ses Mon sont déjà en sécurité côté serveur.
 *  2. Il veut jouer sur un autre appareil, ou acheter de l'hisui → il attache
 *     un email et un mot de passe à SON compte. Le plugin `anonymous` s'occupe
 *     de la fusion : il ne perd rien de ce qu'il a gagné.
 */

/**
 * Le secret qui signe les sessions. Sans lui, n'importe qui pourrait fabriquer
 * un jeton valide et se faire passer pour un autre joueur.
 *
 * ⚠️ Il vient d'une variable d'environnement, JAMAIS du dépôt. En local, un
 * secret de développement suffit ; en ligne, Railway doit fournir le vrai.
 */
const secret = process.env.AUTH_SECRET

/**
 * Google est-il configuré ? Il faut les DEUX clés, obtenues dans la Google
 * Cloud Console. Sans elles, le jeu masque simplement le bouton : mieux vaut
 * une option en moins qu'un bouton qui mène à une page d'erreur.
 */
export const GOOGLE_DISPO = Boolean(
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
)

/**
 * Sommes-nous DÉPLOYÉS ? — et surtout, on ne le demande pas à `NODE_ENV`.
 *
 * ⚠️ Le garde-fou ne tenait qu'à `NODE_ENV === 'production'`, une variable que
 * l'hébergeur pose *en général*. Si elle manquait, le serveur démarrait avec le
 * secret de repli ci-dessous — celui qui est écrit en clair dans le dépôt.
 * N'importe qui pouvait alors forger un jeton et se faire passer pour un autre
 * joueur, sans que rien ne le signale.
 *
 * Le commentaire d'origine avait raison : « un serveur qui marche quand même
 * est le pire des cas ». Le garde-fou souffrait exactement de ce défaut, parce
 * qu'il reposait sur une hypothèse invérifiable.
 *
 * On se fie donc à des signes qu'on CONTRÔLE, et un seul suffit :
 *  · `PUBLIC_URL` posée — on nous a donné une adresse publique ;
 *  · une base qui n'est pas sur cette machine ;
 *  · `NODE_ENV` à production, quand l'hébergeur veut bien la poser.
 */
const baseDistante = Boolean(
  process.env.DATABASE_URL &&
    !/(localhost|127\.0\.0\.1)/.test(process.env.DATABASE_URL)
)
const deploye =
  Boolean(process.env.PUBLIC_URL) || baseDistante || process.env.NODE_ENV === 'production'

if (!secret && deploye) {
  throw new Error(
    'AUTH_SECRET manquante alors que le serveur est déployé — refus de démarrer.\n' +
      "  Pose-la dans les variables d'environnement de l'hébergeur. Pour en générer une :\n" +
      '  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
  )
}

/**
 * L'adresse PUBLIQUE de ce serveur.
 *
 * ⚠️ En local, laisser `PUBLIC_URL` vide : y mettre l'adresse de production
 * ferait croire à Better Auth qu'il tourne sur Railway. Il refuserait alors le
 * relais de retour (qui, lui, pointe bien sur localhost) et enverrait Google
 * rediriger vers la production. Symptôme : le bouton Google « ne fait rien ».
 */
export const BASE_URL = process.env.PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 2567}`

export const auth = pool
  ? betterAuth({
      database: pool,
      secret: secret ?? 'secret-de-developpement-local-uniquement',
      baseURL: BASE_URL,

      emailAndPassword: {
        enabled: true,
        minPasswordLength: 8,
        // Pas de vérification d'email tant qu'il n'y a rien à acheter : ça
        // demanderait un service d'envoi d'emails. À activer AVANT de brancher
        // le moindre paiement, pour qu'un joueur puisse récupérer son compte.
        requireEmailVerification: false,
      },

      /**
       * ————— Se connecter avec Google —————
       * Activé SEULEMENT si les deux clés sont fournies. Sans elles, le bouton
       * Google reste masqué côté jeu et tout le reste continue de marcher : un
       * déploiement sans clés ne doit pas tomber en panne, juste proposer moins.
       */
      ...(GOOGLE_DISPO
        ? {
            socialProviders: {
              google: {
                clientId: process.env.GOOGLE_CLIENT_ID!,
                clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
              },
            },
          }
        : {}),

      plugins: [
        /*
         * Le compte invisible : on joue d'abord, on s'inscrit si on veut.
         *
         * `onLinkAccount` est LE moment critique : quand un joueur anonyme se
         * connecte pour de bon, Better Auth crée un nouveau compte et supprime
         * l'ancien. Sans cette reprise, il perdrait ses Mon et ses achats
         * exactement au moment où il décide enfin de s'inscrire.
         */
        anonymous({
          onLinkAccount: async ({ anonymousUser, newUser }: any) => {
            const avant = anonymousUser?.user?.id
            const apres = newUser?.user?.id
            if (!avant || !apres) return
            await fusionner(avant, apres)
          },
        }),
        // Le jeu est une application, pas un site : il garde un jeton et
        // l'envoie en en-tête, plutôt que de dépendre des cookies.
        bearer(),
      ],

      /*
       * Le jeu est servi depuis un autre domaine (Vercel) que le serveur
       * (Railway) : sans cette liste, le navigateur refuserait les échanges.
       *
       * ⚠️ `BASE_URL` en fait partie : le retour de Google passe par notre
       * propre relais (`/api/relais`), donc par NOTRE domaine. Sans lui dans la
       * liste, Better Auth refuse sa propre adresse — « Invalid callbackURL »,
       * et le bouton Google semble ne rien faire.
       */
      trustedOrigins: [
        BASE_URL,
        'http://localhost:5173',
        ...(process.env.ORIGINES_AUTORISEES?.split(',').map((o) => o.trim()) ?? []),
      ],
    })
  : null

/** L'authentification est-elle disponible ? (elle exige la base) */
export function authDispo() {
  return auth !== null
}

/**
 * À quel compte appartient ce jeton ? `null` s'il est absent, expiré ou inventé.
 *
 * Sert au salon de course, qui reçoit le jeton par websocket et non par un
 * en-tête HTTP : on le remet donc en forme d'en-tête `Authorization` pour que
 * Better Auth le vérifie exactement comme n'importe quelle requête — même
 * chemin de code, donc même niveau de contrôle.
 */
export async function compteDe(token: unknown): Promise<string | null> {
  if (!auth || typeof token !== 'string' || !token) return null
  try {
    const session = await auth.api.getSession({
      headers: new Headers({ authorization: `Bearer ${token}` }),
    })
    return session?.user?.id ?? null
  } catch {
    return null
  }
}
