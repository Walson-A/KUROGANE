import { fighterById, type FighterId } from './roster'

/**
 * La qualité graphique.
 * · auto   — on devine d'après l'appareil (par défaut)
 * · haut   — « Belle » : plein de pixels
 * · bas    — « Fluide » : moins de pixels, ça rame moins
 */
export type Quality = 'auto' | 'haut' | 'bas'

export interface Settings {
  fighter: FighterId
  /** Le pseudo, vu par l'adversaire pendant le duel. Vide = anonyme. */
  name: string
  quality: Quality
}

const KEY = 'kurogane-settings'
export const MAX_NAME = 12

/** Un pseudo sûr : pas de retour à la ligne, pas de pavé, 12 caractères max. */
export function cleanName(v: unknown): string {
  return String(v ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME)
}

/**
 * Relit les réglages du téléphone.
 * Tout est validé au passage : une vieille sauvegarde ou un localStorage
 * bidouillé à la main ne doit pas pouvoir casser le jeu.
 */
export function loadSettings(): Settings {
  let raw: Record<string, unknown> = {}
  try {
    raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {}
  } catch {
    // JSON abîmé, ou localStorage interdit (navigation privée) : on repart des défauts
  }
  return {
    fighter: fighterById(raw.fighter as string).id,
    name: cleanName(raw.name),
    quality: raw.quality === 'haut' || raw.quality === 'bas' ? raw.quality : 'auto',
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    // Quota plein ou stockage interdit : tant pis, le jeu marche quand même
  }
}
