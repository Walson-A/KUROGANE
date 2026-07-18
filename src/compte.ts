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
  /** Compte anonyme = perdable : le jeu propose de le securiser. */
  anonyme?: boolean
  email?: string | null
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

/** Google est-il configuré côté serveur ? (sinon on masque le bouton) */
let googleDispo = false
export function googleActif() {
  return googleDispo
}

/** Es-tu un compte anonyme (donc perdable) ou un vrai compte ? */
let anonyme = true
export function estAnonyme() {
  return anonyme
}

/** L'email du compte, s'il y en a un. */
let email: string | null = null
export function monEmail() {
  return email
}

/**
 * ————— Le retour de Google —————
 *
 * Le serveur nous renvoie avec le jeton dans le FRAGMENT (`#jeton=…`). On le
 * récupère, on le garde, puis on NETTOIE la barre d'adresse : un jeton de
 * session n'a rien à faire dans l'historique du navigateur, ni dans un lien
 * qu'on partagerait par mégarde.
 *
 * Renvoie 'ok', 'echec' ou null (retour normal, sans connexion en cours).
 */
function lireRetourConnexion(): 'ok' | 'echec' | null {
  const h = location.hash
  if (!h || h.length < 2) return null

  const params = new URLSearchParams(h.slice(1))
  const recu = params.get('jeton')
  const echec = params.get('connexion') === 'echec'
  if (!recu && !echec) return null

  // On efface le fragment SANS recharger la page ni ajouter une entrée à
  // l'historique — sinon le bouton « précédent » ramènerait sur le jeton.
  history.replaceState(null, '', location.pathname + location.search)

  if (echec || !recu) return 'echec'
  jeton = recu
  try {
    localStorage.setItem(CLE_JETON, recu)
  } catch {
    /* navigation privée : on jouera cette session-ci, sans être reconnu ensuite */
  }
  return 'ok'
}

/**
 * Range ce que le serveur vient de dire de l'identité du joueur.
 *
 * Par défaut on se considère ANONYME : en cas de doute, le jeu proposera de
 * sécuriser un compte qui l'était déjà — sans gravité. L'erreur inverse
 * laisserait un joueur croire ses Mon à l'abri alors qu'ils sont perdables.
 */
function retenirIdentite() {
  anonyme = profil?.anonyme !== false
  email = profil?.email ?? null
}

/** Demande au serveur ce qu'il sait faire (Google configuré ou non). */
async function sonderServeur() {
  try {
    const r = await fetch(`${API}/sante`)
    const d = await r.json()
    googleDispo = d?.google === true
  } catch {
    googleDispo = false
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
  // Un retour de Google l'emporte sur le jeton déjà en mémoire : c'est le
  // nouveau compte, éventuellement fusionné avec l'ancien anonyme.
  const retour = lireRetourConnexion()
  void sonderServeur()

  if (retour !== 'ok') {
    try {
      jeton = localStorage.getItem(CLE_JETON)
    } catch {
      jeton = null
    }
  }

  if (jeton) {
    try {
      profil = await appel('/api/profil')
      retenirIdentite()
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
    retenirIdentite()
  } catch {
    profil = null
  }
  return profil
}

/**
 * ————— Se connecter avec Google —————
 *
 * On ne quitte PAS le jeu vers Google directement : on passe par le relais du
 * serveur (`/api/relais`), qui seul saura récupérer le jeton après l'aller-retour
 * — cf. le commentaire détaillé dans server/src/index.ts.
 *
 * Si le joueur était anonyme, Better Auth fusionne son ancien compte dans le
 * nouveau : ses Mon et ses achats le suivent.
 */
export async function connexionGoogle(): Promise<{ ok: boolean; raison?: string }> {
  try {
    // Où Google devra nous ramener : le relais du serveur, qui renverra ensuite
    // ici même avec le jeton.
    const relais = `${API}/api/relais?vers=${encodeURIComponent(location.origin + location.pathname)}`

    const r = await fetch(`${API}/api/auth/sign-in/social`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // Le jeton anonyme actuel : c'est LUI qui permet à Better Auth de
        // savoir quel compte fusionner dans le nouveau.
        ...(jeton ? { authorization: `Bearer ${jeton}` } : {}),
      },
      body: JSON.stringify({ provider: 'google', callbackURL: relais }),
    })
    const data = await r.json().catch(() => null)
    // Le CODE d'abord (stable, traduisible), le message ensuite — comme pour
    // l'inscription par email.
    if (!r.ok || !data?.url) {
      return { ok: false, raison: data?.code ?? data?.message ?? 'indisponible' }
    }

    // On quitte le jeu vers Google. Le retour se fera par le relais.
    location.href = data.url
    return { ok: true }
  } catch {
    return { ok: false, raison: 'hors-ligne' }
  }
}

/**
 * ————— S'inscrire ou se connecter par email —————
 *
 * Pour qui n'a pas de compte Google — ou n'en veut pas.
 *
 * Contrairement à Google, tout se joue en UN appel : pas de redirection, donc
 * le serveur nous rend directement le jeton dans sa réponse. C'est le même
 * chemin que le compte anonyme.
 *
 * Si le joueur était anonyme, Better Auth fusionne son ancien compte dans le
 * nouveau (cf. `onLinkAccount`) : ses Mon et ses achats le suivent.
 */
async function authEmail(
  route: 'sign-up/email' | 'sign-in/email',
  corps: Record<string, unknown>
): Promise<{ ok: boolean; raison?: string }> {
  try {
    const r = await fetch(`${API}/api/auth/${route}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // Le jeton anonyme courant : il dit à Better Auth quel compte reprendre
        ...(jeton ? { authorization: `Bearer ${jeton}` } : {}),
      },
      body: JSON.stringify(corps),
    })
    const data = await r.json().catch(() => null)

    if (!r.ok || !data?.token) {
      /*
       * On remonte le CODE en priorité, pas le message.
       *
       * Le code est stable et fait pour être lu par du code
       * (« USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL ») ; le message, lui, est de
       * la prose anglaise qui peut changer d'une version à l'autre. Traduire
       * sur le message, c'est afficher de l'anglais au premier reformulage.
       */
      return { ok: false, raison: data?.code ?? data?.message ?? 'echec' }
    }

    jeton = data.token
    try {
      localStorage.setItem(CLE_JETON, data.token)
    } catch {
      /* navigation privée */
    }
    profil = await appel('/api/profil')
    retenirIdentite()
    return { ok: true }
  } catch {
    return { ok: false, raison: 'hors-ligne' }
  }
}

/** Crée un compte avec un email et un mot de passe. */
export function inscriptionEmail(email: string, motDePasse: string, pseudo: string) {
  // `name` est demandé par Better Auth ; on y met le pseudo du joueur, ce qui
  // évite un champ de plus à remplir.
  return authEmail('sign-up/email', { email, password: motDePasse, name: pseudo || 'Guerrier' })
}

/** Retrouve un compte existant. */
export function connexionEmail(email: string, motDePasse: string) {
  return authEmail('sign-in/email', { email, password: motDePasse })
}

/**
 * Se déconnecte : on oublie le jeton et on repart sur un compte anonyme neuf.
 *
 * ⚠️ Les Mon restent attachés au compte QUITTÉ, pas à l'appareil. Se
 * déconnecter d'un compte anonyme revient donc à l'abandonner pour de bon —
 * c'est au jeu de prévenir avant.
 */
export async function deconnecter(): Promise<void> {
  try {
    await appel('/api/auth/sign-out', {})
  } catch {
    /* même si le serveur ne répond pas, on oublie le jeton localement */
  }
  jeton = null
  profil = null
  articles = []
  anonyme = true
  email = null
  try {
    localStorage.removeItem(CLE_JETON)
  } catch {
    /* rien à faire */
  }
}

/** Relit le solde (après une course, par exemple). */
export async function rafraichirProfil(): Promise<Profil | null> {
  if (!jeton) return null
  try {
    profil = await appel('/api/profil')
    retenirIdentite()
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
