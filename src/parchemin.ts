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
 * Tous les réglages sont chiffrés par simulation, avec le trébuchement comme
 * étalon : il coûte 0,53 s (≈ 15 m). Les sorts valent volontairement à peu près
 * la même chose — sinon un seul serait joué et les autres feraient de la
 * figuration. Onmyōji est la seule exception assumée (voir plus bas).
 */

export type ParcheminKind =
  | 'vent'
  | 'grue'
  | 'armure'
  | 'miroir'
  | 'the'
  | 'kunai'
  | 'kusarigama'
  | 'fumigene'
  | 'senbon'
  | 'onmyoji'

export interface Parchemin {
  icone: string
  nom: string
  /**
   * soi        → effet immédiat sur le lanceur
   * adversaire → part chez la victime (relayé par le serveur en ligne)
   * projectile → part tout droit et touche ce qu'il rencontre
   */
  cible: 'soi' | 'adversaire' | 'projectile'
  /** Ce qu'on annonce au joueur quand il le lance */
  cri: string
}

export const PARCHEMINS: Record<ParcheminKind, Parchemin> = {
  vent: { icone: '🌀', nom: 'Vent du Nord', cible: 'soi', cri: '🌀 Vent du Nord !' },
  grue: { icone: '🕊️', nom: 'Saut de la Grue', cible: 'soi', cri: '🕊️ Saut de la Grue — double saut !' },
  armure: { icone: '🛡️', nom: 'Armure de Fer', cible: 'soi', cri: '🛡️ Armure de Fer — 2 barrières ou 1 mur' },
  miroir: { icone: '🪞', nom: 'Parade Miroir', cible: 'soi', cri: '🪞 Parade Miroir — le prochain sort repart !' },
  the: { icone: '🍵', nom: 'Thé Purificateur', cible: 'soi', cri: '🍵 Thé Purificateur — te voilà net' },
  kunai: { icone: '🎯', nom: 'Kunai Explosif', cible: 'adversaire', cri: '🎯 Kunai explosif !' },
  kusarigama: { icone: '⛓️', nom: 'Kusarigama', cible: 'adversaire', cri: '⛓️ Kusarigama sur le rival !' },
  fumigene: { icone: '💨', nom: 'Bombe Fumigène', cible: 'adversaire', cri: '💨 Bombe fumigène !' },
  senbon: { icone: '☠️', nom: 'Senbon Empoisonné', cible: 'adversaire', cri: '☠️ Senbon empoisonné !' },
  // 🔮 et non 🌀 : la fiche donne le même emoji qu'au Vent du Nord, or deux
  // slots identiques dans le HUD seraient illisibles en pleine course.
  onmyoji: { icone: '🔮', nom: 'Onmyōji', cible: 'projectile', cri: '🔮 Le portail file droit !' },
}

/** Les parchemins que la piste peut faire tomber. */
export const TIRAGE: ParcheminKind[] = [
  'vent',
  'grue',
  'armure',
  'miroir',
  'the',
  'kunai',
  'kusarigama',
  'fumigene',
  'senbon',
  'onmyoji',
]

/**
 * Le tirage d'un parchemin, AU MOMENT DU RAMASSAGE — pas à la génération de la
 * piste. C'est ce qui évite que tout le monde décroche le même pouvoir sur la
 * même boîte : les rouleaux sont aux mêmes endroits pour tous (piste partagée),
 * mais leur contenu est propre à chacun, comme une boîte de Mario Kart.
 *
 * `rng` : Math.random pour un vrai joueur (chacun son tirage) ; le générateur
 * à graine d'un bot, pour qu'il reste rejouable tout en tirant AILLEURS.
 */
export function tirerParchemin(rng: () => number = Math.random): ParcheminKind {
  return TIRAGE[Math.floor(rng() * TIRAGE.length)]
}

/** Les sorts qui partent chez quelqu'un d'autre — les seuls que le serveur relaie. */
export const OFFENSIFS: ParcheminKind[] = ['kunai', 'kusarigama', 'fumigene', 'senbon', 'onmyoji']

/** Les afflictions que le 🍵 Thé Purificateur nettoie. */
export const AFFLICTIONS: ParcheminKind[] = ['kusarigama', 'fumigene', 'senbon']

/** On ne porte jamais plus de 2 rouleaux : le 3e ramassage est ignoré. */
export const SLOTS_MAX = 2

// ————— 🌀 Vent du Nord —————
// Court et violent : un dash doit se ressentir comme une explosion, pas comme
// une pente. +35 % pendant 1,5 s → ~0,53 s gagnées.
export const VENT_BOOST = 0.35
export const VENT_DUREE = 1.5

// ————— 🕊️ Saut de la Grue —————
// Un second saut en plein vol, pendant quelques secondes. Ça ne fait pas gagner
// de vitesse : ça rattrape les esquives ratées. Pour un bot, qui n'a pas de
// boîte de collision, ça se traduit en adresse : il esquive mieux.
export const GRUE_DUREE = 7
export const GRUE_BONUS_ADRESSE = 0.1

// ————— 🛡️ Armure de Fer —————
// Une jauge de solidité, pas un bouclier à usage unique. Elle encaisse DEUX
// petits obstacles — ou UN SEUL grand mur, qui la met en pièces d'un coup.
export const ARMURE_SOLIDITE = 2
export const ARMURE_COUT_MUR = 2
export const ARMURE_COUT_PETIT = 1

// ————— 🪞 Parade Miroir —————
// Le prochain sort reçu repart chez son auteur. Elle ne dure pas éternellement,
// sinon on la garderait allumée toute la course : c'est un pari, pas un abri.
export const MIROIR_DUREE = 8

// ————— 🎯 Kunai Explosif —————
// Le seul sort qui fait directement trébucher : 0,53 s sèches, sans esquive
// possible. C'est le sabotage franc.

// ————— ⛓️ Kusarigama —————
// La chaîne bride la victime. ×0,7 pendant 2 s → ~0,60 s perdues.
export const KUSARIGAMA_FACTEUR = 0.7
export const KUSARIGAMA_DUREE = 2

// ————— 💨 Bombe Fumigène · ☠️ Senbon Empoisonné —————
// Ces deux-là ne ralentissent pas : ils empêchent de VOIR. La fumée noircit
// l'écran, le poison le fait onduler. Coût réel ≈ un trébuchement, mais un bon
// joueur peut s'en sortir — c'est leur intérêt face au Kusarigama, inévitable.
// Un bot n'a pas d'écran : on traduit en malus d'adresse, il rate ses esquives.
export const FUMIGENE_DUREE = 2.5
export const SENBON_DUREE = 3
export const MALUS_ADRESSE = 0.35

// ————— 🔮 Onmyōji —————
// LE sort à part : il échange les places, sans plafond. Ce qui le rend légitime,
// c'est qu'il ne vise pas — il file tout droit dans ta ligne et s'arrête au
// premier mur. Or un mur bouche une ligne donnée environ 1 rangée sur 6, et les
// rangées tombent tous les 13 m : le projectile n'a que ~29 % de chances de
// franchir 100 m. La PISTE est le garde-fou, pas un chiffre arbitraire.
// Il faut donc aligner sa ligne sur le rival ET avoir la voie dégagée.
// Sa PORTÉE EST INFINIE : aucun plafond de distance, il vole tant qu'il ne
// rencontre rien. Seuls un rival ou un mur l'arrêtent.
export const ONMYOJI_VITESSE = 55 // m/s, en plus de la vitesse du lanceur

/** La lueur jaune autour des deux échangés. Assez longue pour qu'on comprenne. */
export const LUEUR_DUREE = 1.4
