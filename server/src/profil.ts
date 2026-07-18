import { pool } from './db.js'

/**
 * ————— LE PROFIL DE JEU : les deux monnaies —————
 *
 * Better Auth s'occupe de QUI tu es. Ce fichier s'occupe de CE QUE TU AS.
 *
 *  · 文 Mon    — la monnaie qui se gagne en courant. Le mon est la vraie pièce
 *                percée d'un trou carré de l'ère Sengoku : elle existe déjà
 *                dans l'univers du jeu.
 *  · 翡翠 Hisui — le jade. La monnaie qui s'achète.
 *
 * ⚠️ RÈGLE INTANGIBLE : les soldes ne vivent QUE dans cette base. Le jeu ne
 * fait jamais que les AFFICHER. Un client modifié peut mentir sur tout ce qu'il
 * envoie — s'il pouvait annoncer son propre solde, la boutique serait gratuite.
 */

export type Monnaie = 'mon' | 'hisui'

export interface Profil {
  joueur: string
  pseudo: string
  mon: number
  hisui: number
  guerrier: string
}

/** Le gain d'une course, décidé ICI et jamais par le client. */
export const GAIN_COURSE = { victoire: 100, participation: 25 }

/**
 * Le nom de la colonne, VÉRIFIÉ à l'exécution.
 *
 * ⚠️ Le nom d'une colonne ne peut pas être passé en paramètre SQL ($1) : il
 * faut l'écrire dans la requête. Le type `Monnaie` de TypeScript disparaît à la
 * compilation et ne protège donc rien ici — si une valeur venait un jour d'un
 * message réseau, on écrirait du SQL dicté par le client. Cette liste blanche
 * est la seule barrière qui tienne à l'exécution.
 */
function colonne(monnaie: Monnaie): 'mon' | 'hisui' {
  if (monnaie !== 'mon' && monnaie !== 'hisui') {
    throw new Error(`monnaie inconnue : ${String(monnaie)}`)
  }
  return monnaie
}

/**
 * Trouve le profil du joueur, ou le crée s'il arrive pour la première fois.
 *
 * `on conflict do nothing` puis relecture : deux connexions simultanées du même
 * joueur (deux onglets) ne peuvent pas créer deux profils ni se marcher dessus.
 */
export async function assureProfil(joueur: string, pseudo?: string): Promise<Profil | null> {
  if (!pool) return null

  await pool.query(
    `insert into profils (joueur, pseudo) values ($1, coalesce($2, 'Guerrier'))
     on conflict (joueur) do nothing`,
    [joueur, pseudo?.slice(0, 12) || null]
  )

  const { rows } = await pool.query<Profil>(
    `update profils set vu_le = now() where joueur = $1
     returning joueur, pseudo, mon, hisui, guerrier`,
    [joueur]
  )
  return rows[0] ?? null
}

/**
 * Ajoute (ou retire) de la monnaie, et laisse une trace dans le journal.
 *
 * Tout se fait en UNE requête : le solde et le journal ne peuvent pas se
 * désynchroniser, et deux gains simultanés ne peuvent pas s'écraser l'un
 * l'autre — c'est la base qui fait l'addition, pas nous.
 */
export async function crediter(
  joueur: string,
  monnaie: Monnaie,
  montant: number,
  motif: string
): Promise<Profil | null> {
  if (!pool || montant === 0) return null
  const col = colonne(monnaie)

  const client = await pool.connect()
  try {
    await client.query('begin')
    const { rows } = await client.query<Profil>(
      `update profils set ${col} = ${col} + $1 where joueur = $2
       returning joueur, pseudo, mon, hisui, guerrier`,
      [montant, joueur]
    )
    if (!rows[0]) {
      await client.query('rollback')
      return null
    }
    await client.query(
      'insert into mouvements (joueur, monnaie, montant, motif) values ($1, $2, $3, $4)',
      [joueur, monnaie, montant, motif]
    )
    await client.query('commit')
    return rows[0]
  } catch (e) {
    await client.query('rollback')
    throw e
  } finally {
    client.release()
  }
}

/**
 * Dépense. Renvoie `null` si le joueur n'a pas de quoi payer.
 *
 * Le `and ${col} >= $1` est le cœur de la sécurité : c'est la BASE qui
 * refuse, pas un `if` dans le code. Deux achats lancés en même temps (double
 * tap) ne peuvent donc pas passer tous les deux avec le solde d'un seul.
 */
export async function debiter(
  joueur: string,
  monnaie: Monnaie,
  montant: number,
  motif: string
): Promise<Profil | null> {
  if (!pool || montant <= 0) return null
  const col = colonne(monnaie)

  const client = await pool.connect()
  try {
    await client.query('begin')
    const { rows } = await client.query<Profil>(
      `update profils set ${col} = ${col} - $1
       where joueur = $2 and ${col} >= $1
       returning joueur, pseudo, mon, hisui, guerrier`,
      [montant, joueur]
    )
    if (!rows[0]) {
      await client.query('rollback')
      return null // solde insuffisant, ou profil inconnu
    }
    await client.query(
      'insert into mouvements (joueur, monnaie, montant, motif) values ($1, $2, $3, $4)',
      [joueur, monnaie, -montant, motif]
    )
    await client.query('commit')
    return rows[0]
  } catch (e) {
    await client.query('rollback')
    throw e
  } finally {
    client.release()
  }
}
