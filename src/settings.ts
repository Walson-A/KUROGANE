import {
  fighterById,
  DEFAULT_CUSTOM,
  HEADS,
  PERSO_ID,
  type CustomSkin,
  type FighterId,
  type Head,
} from './roster'

/**
 * La qualité graphique.
 * · auto   — on devine d'après l'appareil (par défaut)
 * · haut   — « Belle » : plein de pixels
 * · bas    — « Fluide » : moins de pixels, ça rame moins
 */
export type Quality = 'auto' | 'haut' | 'bas'

export interface Settings {
  fighter: FighterId
  /** Le skin du guerrier perso — indépendant du choix courant, gardé sous le coude. */
  custom: CustomSkin
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

/** Une couleur valide : un entier 0xrrggbb. Sinon on retombe sur le défaut. */
function validColor(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 0xffffff ? v : fallback
}

/**
 * Relit le skin perso en validant tout : une couleur bidouillée à la main ou
 * une vieille sauvegarde ne doit pas pouvoir peindre un guerrier illisible ni
 * casser le rendu.
 */
function loadCustom(raw: unknown): CustomSkin {
  const r = (raw ?? {}) as Record<string, unknown>
  return {
    body: validColor(r.body, DEFAULT_CUSTOM.body),
    band: validColor(r.band, DEFAULT_CUSTOM.band),
    head: HEADS.includes(r.head as Head) ? (r.head as Head) : DEFAULT_CUSTOM.head,
  }
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
    // 'perso' n'est pas dans le roster (il se construit) : on le garde tel quel,
    // sinon fighterById le renverrait vers Yasuke et on perdrait le choix.
    fighter: raw.fighter === PERSO_ID ? PERSO_ID : fighterById(raw.fighter as string).id,
    custom: loadCustom(raw.custom),
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
