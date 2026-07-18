import { WS_URL } from './net'

/**
 * ————— LE COMPTE DU JOUEUR —————
 *
 * Le jeu ne parle QU'À NOTRE SERVEUR. Il n'a aucune clé, aucune adresse de base
 * de données, et ne sait rien de la façon dont les comptes sont rangés : il
 * envoie un jeton, il reçoit un solde.
 *
 * ⚠️ Le solde affiché ici n'est qu'un REFLET. Le vrai vit dans la base, et lui
 * seul compte : bidouiller `profil.mon` dans la console ne change rien à ce
 * qu'on peut acheter, puisque le serveur relit tout au moment de l'achat.
 *
 * ————— Le parcours —————
 * Au tout premier lancement, on crée un compte ANONYME sans rien demander : le
 * joueur court dès la première seconde, sans inscription ni email (ils sont
 * souvent mineurs). Le jeton est gardé sur l'appareil ; il suffit à le
 * reconnaître aux lancements suivants.
 */

/**
 * L'adresse HTTP du serveur, déduite de celle du websocket : les deux vivent
 * sur le même port. `wss://` → `https://`, `ws://` → `http://`.
 */
const API = WS_URL.replace(/^ws/, 'http')

const CLE_JETON = 'kurogane-jeton'

export interface Profil {
  joueur: string
  pseudo: string
  mon: number
  hisui: number
  guerrier: string
}

export interface Article {
  code: string
  nom: string
  categorie: string
  prix_mon: number | null
  prix_hisui: number | null
  valeur: string | null
  possede: boolean
}

let jeton: string | null = null
let profil: Profil | null = null
let articles: Article[] = []

/** Le solde connu — `null` tant qu'on n'a pas réussi à joindre le serveur. */
export function monProfil(): Profil | null {
  return profil
}

/** Le catalogue connu (vide tant qu'on n'a pas ouvert la boutique). */
export function mesArticles(): Article[] {
  return articles
}

/** Les couleurs achetées, en '#rrggbb' — c'est ce que lit le vestiaire. */
export function couleursDebloquees(): string[] {
  return articles.filter((a) => a.possede && a.categorie === 'couleur' && a.valeur).map((a) => a.valeur!)
}

/**
 * Le jeton de session, à envoyer au salon de course pour que le serveur sache
 * quel portefeuille créditer à l'arrivée.
 */
export function monJeton(): string | null {
  return jeton
}

/** Un appel à notre serveur, avec le jeton s'il y en a un. */
async function appel(route: string, corps?: unknown): Promise<any> {
  const r = await fetch(API + route, {
    method: corps === undefined ? 'GET' : 'POST',
    headers: {
      'content-type': 'application/json',
      ...(jeton ? { authorization: `Bearer ${jeton}` } : {}),
    },
    body: corps === undefined ? undefined : JSON.stringify(corps),
  })
  const data = await r.json().catch(() => null)
  if (!r.ok) throw Object.assign(new Error(data?.erreur ?? 'erreur'), { statut: r.status, data })
  return data
}

/** Crée un compte anonyme et garde son jeton sur l'appareil. */
async function creerCompteAnonyme(): Promise<boolean> {
  try {
    const r = await fetch(`${API}/api/auth/sign-in/anonymous`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    const data = await r.json()
    if (!data?.token) return false
    jeton = data.token
    try {
      localStorage.setItem(CLE_JETON, data.token)
    } catch {
      // Navigation privée : on jouera quand même, mais sans être reconnu au
      // prochain lancement. Mieux vaut ça que pas de jeu du tout.
    }
    return true
  } catch {
    return false
  }
}

/**
 * Se connecte au démarrage : on réutilise le jeton de l'appareil s'il est
 * encore valable, sinon on ouvre un compte anonyme.
 *
 * Ne lève JAMAIS : serveur éteint, hors-ligne, base en panne — le jeu doit
 * rester jouable. On se retrouve simplement sans solde ni boutique.
 */
export async function connecter(): Promise<Profil | null> {
  try {
    jeton = localStorage.getItem(CLE_JETON)
  } catch {
    jeton = null
  }

  if (jeton) {
    try {
      profil = await appel('/api/profil')
      return profil
    } catch (e: any) {
      // 401 = jeton périmé ou révoqué : on repart d'un compte neuf. Toute autre
      // panne (serveur éteint) n'est PAS une raison de jeter le jeton — il
      // resservira au prochain lancement.
      if (e?.statut !== 401) return null
      jeton = null
    }
  }

  if (!(await creerCompteAnonyme())) return null
  try {
    profil = await appel('/api/profil')
  } catch {
    profil = null
  }
  return profil
}

/** Relit le solde (après une course, par exemple). */
export async function rafraichirProfil(): Promise<Profil | null> {
  if (!jeton) return null
  try {
    profil = await appel('/api/profil')
  } catch {
    // On garde l'ancien solde à l'écran plutôt que d'afficher un vide anxiogène
  }
  return profil
}

/** Ouvre la boutique : le catalogue ET le solde, d'un seul appel. */
export async function chargerBoutique(): Promise<Article[]> {
  if (!jeton) return []
  try {
    const r = await appel('/api/boutique')
    profil = r.profil
    articles = r.articles
  } catch {
    // On laisse le catalogue précédent : mieux qu'un écran vide
  }
  return articles
}

/**
 * Achète un article. On n'envoie QUE son code — le prix, la monnaie et le solde
 * sont l'affaire du serveur, qui les relit dans la base.
 *
 * Renvoie le motif du refus, que la boutique traduit en message lisible.
 */
export async function acheter(
  code: string
): Promise<{ ok: true } | { ok: false; raison: string }> {
  if (!jeton) return { ok: false, raison: 'hors-ligne' }
  try {
    const r = await appel('/api/acheter', { code })
    profil = r.profil
    articles = r.articles
    return { ok: true }
  } catch (e: any) {
    return { ok: false, raison: e?.message ?? 'erreur' }
  }
}
