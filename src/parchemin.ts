/**
 * ————— Les parchemins de techniques —————
 *
 * On les ramasse sur la piste. Tous les rouleaux se ressemblent : on ne sait
 * ce qu'on a décroché qu'une fois dans la main (comme les boîtes de Mario Kart).
 *
 * On en porte DEUX au maximum, et on est obligé d'utiliser le plus ancien
 * d'abord : impossible de garder le bon sort au chaud indéfiniment.
 *
 * ————— Le calibrage —————
 * Tous les réglages ci-dessous sont chiffrés par simulation, avec le
 * trébuchement comme étalon : il coûte 0,53 s (≈ 15 m). Les trois parchemins
 * valent volontairement à peu près la même chose (0,52 à 0,60 s) — sinon un
 * seul serait joué et les deux autres feraient de la figuration.
 */

export type ParcheminKind = 'vent' | 'armure' | 'kusarigama'

export interface Parchemin {
  icone: string
  nom: string
  /** Sur soi, ou envoyé dans les pattes de l'adversaire ? */
  cible: 'soi' | 'adversaire'
  /** Ce qu'on annonce au joueur quand il le lance */
  cri: string
}

export const PARCHEMINS: Record<ParcheminKind, Parchemin> = {
  vent: {
    icone: '🌀',
    nom: 'Vent du Nord',
    cible: 'soi',
    cri: '🌀 Vent du Nord !',
  },
  armure: {
    icone: '🛡️',
    nom: 'Armure de Fer',
    cible: 'soi',
    cri: '🛡️ Armure de Fer — 2 barrières ou 1 mur',
  },
  kusarigama: {
    icone: '⛓️',
    nom: 'Kusarigama',
    cible: 'adversaire',
    cri: '⛓️ Kusarigama sur le rival !',
  },
}

/** Les parchemins que la piste peut faire tomber, dans l'ordre du tirage. */
export const TIRAGE: ParcheminKind[] = ['vent', 'armure', 'kusarigama']

/** On ne porte jamais plus de 2 rouleaux : le 3e ramassage est ignoré. */
export const SLOTS_MAX = 2

// 🌀 Vent du Nord : court et violent — un dash doit se ressentir comme une
// explosion, pas comme une pente. +35 % pendant 1,5 s → ~0,52 s gagnées.
export const VENT_BOOST = 0.35
export const VENT_DUREE = 1.5

// ⛓️ Kusarigama : la chaîne bride la victime. ×0,7 pendant 2 s → ~0,60 s
// perdues, soit un poil plus qu'un trébuchement (c'est le prix du sabotage).
export const KUSARIGAMA_FACTEUR = 0.7
export const KUSARIGAMA_DUREE = 2

// 🛡️ Armure de Fer : une jauge de solidité, pas un simple bouclier.
// Elle encaisse DEUX petits obstacles (barrière, barre haute) — ou UN SEUL
// grand mur, qui la met en pièces d'un coup. Tant qu'il reste de la solidité,
// le choc est absorbé : c'est le mur qui coûte cher, pas la dernière plaque.
// Pas de minuteur : la file de 2 slots empêche déjà de la thésauriser.
export const ARMURE_SOLIDITE = 2
export const ARMURE_COUT_MUR = 2 // un mur brise l'armure entière
export const ARMURE_COUT_PETIT = 1 // une barrière ne l'entame qu'à moitié
