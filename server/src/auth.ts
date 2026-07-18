import { betterAuth } from 'better-auth'
import { anonymous, bearer } from 'better-auth/plugins'
import { pool } from './db.js'

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

if (!secret && process.env.NODE_ENV === 'production') {
  // En production on refuse de démarrer plutôt que de tourner avec un secret
  // par défaut : un serveur qui marche « quand même » est le pire des cas,
  // parce que personne ne remarque le trou.
  throw new Error('AUTH_SECRET manquante — refus de démarrer en production.')
}

export const auth = pool
  ? betterAuth({
      database: pool,
      secret: secret ?? 'secret-de-developpement-local-uniquement',
      baseURL: process.env.PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 2567}`,

      emailAndPassword: {
        enabled: true,
        minPasswordLength: 8,
        // Pas de vérification d'email tant qu'il n'y a rien à acheter : ça
        // demanderait un service d'envoi d'emails. À activer AVANT de brancher
        // le moindre paiement, pour qu'un joueur puisse récupérer son compte.
        requireEmailVerification: false,
      },

      plugins: [
        // Le compte invisible : on joue d'abord, on s'inscrit si on veut.
        anonymous(),
        // Le jeu est une application, pas un site : il garde un jeton et
        // l'envoie en en-tête, plutôt que de dépendre des cookies.
        bearer(),
      ],

      // Le jeu est servi depuis un autre domaine (Vercel) que le serveur
      // (Railway) : sans cette liste, le navigateur refuserait les échanges.
      trustedOrigins: [
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
