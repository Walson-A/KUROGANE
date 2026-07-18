import { pool } from './db.js'
import type { Monnaie, Profil } from './profil.js'

/**
 * ————— LA BOUTIQUE —————
 *
 * ⚠️ RÈGLE INTANGIBLE : on ne vend QUE de l'apparence. La table `articles` ne
 * connaît que des catégories cosmétiques, et le catalogue (migration 002) ne
 * contient que des couleurs — surtout pas les ornements de tête, qui décident
 * du style de jeu du guerrier perso.
 *
 * ⚠️ LE CLIENT N'ENVOIE QU'UN CODE. Jamais un prix, jamais une monnaie, jamais
 * un solde. Tout le reste est relu dans la base au moment de l'achat : c'est la
 * seule façon d'empêcher un client modifié de s'offrir Kin à 0 Mon.
 */

export interface Article {
  code: string
  nom: string
  categorie: string
  prix_mon: number | null
  prix_hisui: number | null
  valeur: string | null
  possede: boolean
}

/** Ce que l'achat peut refuser — chaque cas a son message côté jeu. */
export type EchecAchat = 'inconnu' | 'possede' | 'fonds' | 'indisponible'

/**
 * Le catalogue, avec pour CE joueur ce qu'il possède déjà.
 * Les articles retirés de la vente (`actif = false`) restent visibles s'il les
 * possède : on ne fait pas disparaître de l'inventaire ce qui a été payé.
 */
export async function catalogue(joueur: string): Promise<Article[]> {
  if (!pool) return []
  const { rows } = await pool.query<Article>(
    `select a.code, a.nom, a.categorie, a.prix_mon, a.prix_hisui, a.valeur,
            (d.joueur is not null) as possede
       from articles a
       left join deblocages d on d.article = a.code and d.joueur = $1
      where a.actif or d.joueur is not null
      order by a.rang, a.code`,
    [joueur]
  )
  return rows
}

/** Ce que le joueur possède — juste les codes, pour appliquer ses déblocages. */
export async function possessions(joueur: string): Promise<string[]> {
  if (!pool) return []
  const { rows } = await pool.query<{ article: string }>(
    'select article from deblocages where joueur = $1',
    [joueur]
  )
  return rows.map((r) => r.article)
}

/**
 * Achète un article.
 *
 * TOUT se joue dans une seule transaction, et c'est la BASE qui arbitre :
 *  · le prix est RELU ici, jamais reçu du client ;
 *  · `where mon >= prix` refuse le paiement si les fonds manquent ;
 *  · la clé primaire (joueur, article) refuse le doublon.
 *
 * Conséquence voulue : deux achats lancés en même temps (double-tap) ne peuvent
 * pas débiter deux fois. Le second bute sur l'une des deux barrières.
 */
export async function acheter(
  joueur: string,
  code: string
): Promise<{ ok: true; profil: Profil } | { ok: false; raison: EchecAchat }> {
  if (!pool) return { ok: false, raison: 'indisponible' }

  const client = await pool.connect()
  try {
    await client.query('begin')

    // Le prix vient de la base, point. `for update` verrouille la ligne le
    // temps de la transaction.
    const { rows: arts } = await client.query<{
      prix_mon: number | null
      prix_hisui: number | null
      actif: boolean
    }>('select prix_mon, prix_hisui, actif from articles where code = $1 for update', [code])

    const art = arts[0]
    if (!art) {
      await client.query('rollback')
      return { ok: false, raison: 'inconnu' }
    }
    if (!art.actif) {
      await client.query('rollback')
      return { ok: false, raison: 'indisponible' }
    }

    // Déjà possédé ? On sort AVANT de débiter quoi que ce soit.
    const { rows: deja } = await client.query(
      'select 1 from deblocages where joueur = $1 and article = $2',
      [joueur, code]
    )
    if (deja[0]) {
      await client.query('rollback')
      return { ok: false, raison: 'possede' }
    }

    // Un article peut avoir deux prix ; on paie en Mon dès que c'est possible,
    // pour ne jamais entamer le jade quand la monnaie de jeu suffit.
    const monnaie: Monnaie = art.prix_mon !== null ? 'mon' : 'hisui'
    const prix = art.prix_mon ?? art.prix_hisui
    if (prix === null) {
      await client.query('rollback')
      return { ok: false, raison: 'indisponible' }
    }

    // ⚠️ Le cœur de la sécurité : c'est ce `and ${col} >= $1` qui refuse, pas
    // un `if` en amont. Deux achats concurrents ne peuvent pas passer tous deux.
    const col = monnaie === 'mon' ? 'mon' : 'hisui'
    const { rows: apres } = await client.query<Profil>(
      `update profils set ${col} = ${col} - $1
        where joueur = $2 and ${col} >= $1
        returning joueur, pseudo, mon, hisui, guerrier`,
      [prix, joueur]
    )
    if (!apres[0]) {
      await client.query('rollback')
      return { ok: false, raison: 'fonds' }
    }

    await client.query('insert into deblocages (joueur, article) values ($1, $2)', [joueur, code])
    await client.query(
      'insert into mouvements (joueur, monnaie, montant, motif) values ($1, $2, $3, $4)',
      [joueur, monnaie, -prix, `achat:${code}`]
    )

    await client.query('commit')
    return { ok: true, profil: apres[0] }
  } catch (e) {
    await client.query('rollback')
    throw e
  } finally {
    client.release()
  }
}
