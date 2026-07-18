/**
 * ————— Le tableau des meilleurs temps —————
 *
 * Dix lignes, gardées sur l'appareil. Pas de serveur : un classement en ligne
 * demanderait des comptes, et surtout une défense contre les temps trafiqués —
 * or le chrono est calculé par le CLIENT. Un tableau local ne prétend rien
 * d'autre que ce qu'il est : ta progression à toi.
 *
 * ⚠️ La clé porte la LONGUEUR de la course, comme le record simple. Un tableau
 * qui mélangerait des courses de 600 m et de 1 920 m classerait les plus
 * courtes en tête à jamais, et les temps n'y voudraient plus rien dire.
 */

export interface Score {
  /** Le chrono, en secondes */
  temps: number
  nom: string
  /** L'identifiant du guerrier (cf. roster.ts) — jamais son nom affiché */
  fighter: string
  mode: 'solo' | 'ligne'
  /** Le nombre d'adversaires : un temps seul et un temps à 4 ne se valent pas */
  rivaux: number
  /** Date en ms epoch */
  date: number
}

/** On n'en garde que dix : au-delà, plus personne ne lit. */
export const MAX_SCORES = 10

const cle = (longueur: number) => `kurogane-scores-${longueur}`

/**
 * Relit le tableau. Tout est revalidé ligne par ligne, sans confiance :
 * localStorage est modifiable à la main, et surtout il SURVIT aux mises à jour.
 * Un tableau écrit par une version précédente doit se dégrader proprement, pas
 * faire planter l'écran des scores.
 */
export function chargerScores(longueur: number): Score[] {
  let brut: unknown
  try {
    brut = JSON.parse(localStorage.getItem(cle(longueur)) ?? '[]')
  } catch {
    return []
  }
  if (!Array.isArray(brut)) return []

  const scores: Score[] = []
  for (const s of brut) {
    if (!s || typeof s !== 'object') continue
    const o = s as Record<string, unknown>
    const temps = Number(o.temps)
    // Un temps non fini ou négatif casserait le tri ET l'affichage
    if (!Number.isFinite(temps) || temps <= 0) continue
    scores.push({
      temps,
      nom: typeof o.nom === 'string' ? o.nom.slice(0, 12) : 'Guerrier anonyme',
      fighter: typeof o.fighter === 'string' ? o.fighter : 'yasuke',
      mode: o.mode === 'ligne' ? 'ligne' : 'solo',
      rivaux: Number.isFinite(Number(o.rivaux)) ? Math.max(0, Math.floor(Number(o.rivaux))) : 0,
      date: Number.isFinite(Number(o.date)) ? Number(o.date) : 0,
    })
  }
  // On retrie à la lecture plutôt que de faire confiance à l'ordre stocké.
  scores.sort((a, b) => a.temps - b.temps)
  return scores.slice(0, MAX_SCORES)
}

/**
 * Ajoute un temps et renvoie le tableau à jour, plus le RANG obtenu (1 = 1re
 * place, 0 = pas entré dans les dix). Le rang sert à féliciter le joueur sur
 * l'écran de fin : « 3ᵉ meilleur temps » se lit mieux qu'un tableau muet.
 */
export function ajouterScore(
  longueur: number,
  s: Score
): { scores: Score[]; rang: number } {
  const scores = chargerScores(longueur)
  scores.push(s)
  scores.sort((a, b) => a.temps - b.temps)
  const rang = scores.indexOf(s) + 1
  const gardes = scores.slice(0, MAX_SCORES)
  try {
    localStorage.setItem(cle(longueur), JSON.stringify(gardes))
  } catch {
    // Mode privé, quota plein : on ne garde rien, mais la course reste jouable.
  }
  return { scores: gardes, rang: rang <= MAX_SCORES ? rang : 0 }
}

/** Efface le tableau — l'écran des scores propose de repartir de zéro. */
export function effacerScores(longueur: number) {
  try {
    localStorage.removeItem(cle(longueur))
  } catch {
    /* rien à faire : il n'y avait déjà rien à effacer */
  }
}

/** « 75.07 » → « 1:15.07 » dès qu'on dépasse la minute. */
export function formaterTemps(t: number): string {
  if (t < 60) return `${t.toFixed(2)} s`
  const m = Math.floor(t / 60)
  const s = (t - m * 60).toFixed(2).padStart(5, '0')
  return `${m}:${s}`
}
