/**
 * ————— Le classement des temps —————
 *
 * ⚠️ Rien n'entre ici depuis le navigateur. Il n'existe AUCUNE route qui
 * écrive un score : seul RaceRoom en enregistre, à la fin d'une course en
 * ligne, avec le temps qu'il a lui-même borné (cf. 003_classement.sql).
 *
 * C'est la seule façon d'avoir un tableau qu'on puisse regarder. Une route
 * « j'ai fait 42 s » serait remplie de 0,1 s le jour de sa mise en ligne, et un
 * classement où le premier est intouchable ne motive plus personne — il
 * décourage exactement les joueurs qu'il devrait retenir.
 */
import { pool } from './db.js'

export interface Score {
  pseudo: string
  temps_ms: number
  fighter: string
  partants: number
  rang: number
  cree_le: string
  /** Vrai si cette ligne est celle du joueur qui consulte. */
  moi?: boolean
}

/** Une ligne telle qu'elle sort de la base — sans le drapeau `moi`, ajouté après. */
type Ligne = Omit<Score, 'moi'> & { joueur?: string }

/** Le nombre de lignes servies. Au-delà, plus personne ne lit. */
const LIMITE = 20

/**
 * Enregistre une course terminée. Appelé UNIQUEMENT par RaceRoom.
 *
 * Ne lève jamais : un classement est un agrément, il ne doit pas pouvoir faire
 * échouer la fin d'une course ni la paie qui l'accompagne.
 */
export async function enregistrer(s: {
  joueur: string
  pseudo: string
  temps: number
  longueur: number
  fighter: string
  partants: number
  rang: number
}): Promise<void> {
  if (!pool) return
  // Un temps aberrant (0, négatif, NaN, ou plus long qu'une heure) n'a rien à
  // faire dans la table : la contrainte SQL le refuserait, autant l'écarter ici
  // et garder la trace en journal.
  const ms = Math.round(s.temps * 1000)
  if (!Number.isFinite(ms) || ms <= 0 || ms > 3_600_000) {
    console.warn(`classement : temps ignoré (${s.temps}) pour ${s.joueur}`)
    return
  }
  try {
    await pool.query(
      `insert into scores (joueur, pseudo, temps_ms, longueur, fighter, partants, rang)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [s.joueur, s.pseudo.slice(0, 12), ms, s.longueur, s.fighter, s.partants, s.rang]
    )
  } catch (e) {
    console.error('classement :', e)
  }
}

/**
 * 🌍 Le classement mondial : le meilleur temps de CHAQUE joueur.
 *
 * `distinct on (joueur)` plutôt qu'un simple tri : sans ça, un joueur très
 * régulier occuperait les vingt lignes avec ses vingt meilleures courses, et le
 * tableau ne dirait plus rien de la communauté. Une ligne par personne.
 */
export async function mondial(longueur: number, moi?: string): Promise<Score[]> {
  if (!pool) return []
  const { rows } = await pool.query<Ligne>(
    `select * from (
       select distinct on (joueur)
              joueur, pseudo, temps_ms, fighter, partants, rang, cree_le
         from scores
        where longueur = $1
        order by joueur, temps_ms asc
     ) meilleurs
     order by temps_ms asc
     limit $2`,
    [longueur, LIMITE]
  )
  return rows.map((r: Ligne) => ({ ...r, moi: !!moi && r.joueur === moi }))
}

/** 🕓 Les dernières courses du joueur, la plus fraîche d'abord. */
export async function recentes(joueur: string, longueur: number): Promise<Score[]> {
  if (!pool) return []
  const { rows } = await pool.query<Ligne>(
    `select pseudo, temps_ms, fighter, partants, rang, cree_le
       from scores
      where joueur = $1 and longueur = $2
      order by cree_le desc
      limit $3`,
    [joueur, longueur, LIMITE]
  )
  return rows.map((r: Ligne) => ({ ...r, moi: true }))
}
