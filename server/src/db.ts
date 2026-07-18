import { Pool } from 'pg'
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * La connexion à Postgres.
 *
 * ⚠️ L'adresse de la base vit dans une VARIABLE D'ENVIRONNEMENT, jamais dans
 * le dépôt. En local : un fichier `server/.env` (ignoré par git). En ligne :
 * les variables d'environnement de Railway.
 *
 * ⚠️ Seul CE serveur ouvre une connexion ici. Le navigateur ne voit ni cette
 * adresse ni ce mot de passe : le jeu parle au serveur, le serveur parle à la
 * base. C'est ce qui permet de ne rien exposer.
 */
const url = process.env.DATABASE_URL

if (!url) {
  console.warn(
    '⚠️  DATABASE_URL absente : le jeu tournera SANS comptes ni monnaie.\n' +
      '    Pour les activer, crée server/.env avec :\n' +
      '    DATABASE_URL=postgresql://…'
  )
}

export const pool = url
  ? new Pool({
      connectionString: url,
      // Railway (comme la plupart des hébergeurs) impose TLS, mais présente un
      // certificat que Node ne reconnaît pas d'office. En local, pas de TLS.
      ssl: url.includes('localhost') ? false : { rejectUnauthorized: false },
      max: 8,
    })
  : null

/** La base est-elle branchée ? Le jeu doit tourner même si elle ne l'est pas. */
export function baseDispo() {
  return pool !== null
}

/**
 * Applique les migrations qui manquent, dans l'ordre des noms de fichiers.
 *
 * Chaque fichier n'est joué QU'UNE FOIS : on garde la liste de ceux qui sont
 * déjà passés dans une table. C'est ce qui permet de relancer le serveur sans
 * rien casser, et de déployer une nouvelle version sans intervention manuelle.
 */
export async function migrer() {
  if (!pool) return

  await pool.query(`
    create table if not exists migrations (
      nom        text primary key,
      applique_le timestamptz not null default now()
    )
  `)

  // Le serveur est en ESM : pas de `__dirname`, on le reconstruit. En dev le
  // chemin pointe sur src/, une fois compilé sur dist/ — d'où le « .. ».
  const ici = dirname(fileURLToPath(import.meta.url))
  const dossier = join(ici, '..', 'migrations')
  const fichiers = readdirSync(dossier).filter((f) => f.endsWith('.sql')).sort()

  const { rows } = await pool.query<{ nom: string }>('select nom from migrations')
  const deja = new Set(rows.map((r) => r.nom))

  for (const f of fichiers) {
    if (deja.has(f)) continue
    const sql = readFileSync(join(dossier, f), 'utf8')
    // Une migration passe ENTIÈREMENT ou pas du tout : sans transaction, une
    // erreur au milieu laisserait la base à moitié modifiée, dans un état que
    // personne ne saurait rattraper.
    const client = await pool.connect()
    try {
      await client.query('begin')
      await client.query(sql)
      await client.query('insert into migrations (nom) values ($1)', [f])
      await client.query('commit')
      console.log(`🗃️  migration appliquée : ${f}`)
    } catch (e) {
      await client.query('rollback')
      console.error(`❌ migration ${f} échouée :`, e)
      throw e
    } finally {
      client.release()
    }
  }
}
