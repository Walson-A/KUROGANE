import * as THREE from 'three'

/**
 * ————— Les quatre biomes du Tournoi des Voies —————
 *
 * La fiche de jeu décrit la course comme « une traversée des forêts de bambous,
 * villages en flammes, ponts au clair de lune et flancs enneigés du Fuji ».
 * Ce fichier en fait une réalité : la piste change de peau quatre fois.
 *
 * Pourquoi ça compte au-delà du joli : sur 1 920 m de couloir uniforme, on perd
 * la notion d'avancement. Le chrono dit qu'on progresse, l'œil dit qu'on fait du
 * surplace. Quatre décors, c'est quatre repères — « je suis dans les flammes,
 * donc à la moitié » — et un final qui EXPLOSE en blanc après trois biomes
 * sombres. La lisibilité de la course passe par là.
 *
 * ⚠️ Les frontières sont des FRACTIONS, pas des mètres : la longueur de course
 * peut bouger (menu, mode entraînement), le découpage doit suivre tout seul.
 */

export interface Biome {
  nom: string
  kanji: string

  /** La brume : sa couleur EST le ciel, puisqu'on ne voit jamais l'horizon. */
  brume: number
  /** À partir d'où ça s'estompe, et où l'on ne voit plus rien. */
  brumeNear: number
  brumeFar: number

  /** Le sol, et les pointillés qui défilent dessus. */
  sol: number
  ligne: number

  /**
   * Un élément de bordure (arbre, poteau, rocher…). Appelé avec le tirage à
   * graine : deux joueurs voient EXACTEMENT le même décor, comme le reste.
   */
  fabriqueDecor: (rng: () => number) => THREE.Group
  /** Un élément tous les combien de mètres, de chaque côté. */
  ecartDecor: number
}

/**
 * La transition : sur cette fraction de la course avant chaque frontière, les
 * couleurs se fondent d'un biome à l'autre. ~5 % = une centaine de mètres,
 * environ 4 s — assez long pour qu'on ne voie jamais un décor « claquer », assez
 * court pour qu'on sente quand même le changement de monde.
 */
const FONDU = 0.05

/**
 * 1 · FORÊT DE BAMBOUS 竹 — l'aube verte
 *
 * On démarre ici : c'est le biome qui doit être le PLUS lisible, parce que le
 * joueur apprend encore où sont les lignes. D'où la brume la plus claire des
 * trois biomes sombres, et un décor vertical (les tiges) qui souligne la fuite
 * de la piste au lieu de la brouiller.
 */
const BAMBOUS: Biome = {
  nom: 'Forêt de bambous',
  kanji: '竹',
  brume: 0x1c2e24,
  brumeNear: 32,
  brumeFar: 88,
  sol: 0x24301f,
  ligne: 0x40573f,
  ecartDecor: 11,
  fabriqueDecor: (rng) => {
    const g = new THREE.Group()
    const n = 3 + Math.floor(rng() * 4) // une touffe de 3 à 6 tiges

    for (let i = 0; i < n; i++) {
      const hauteur = 7 + rng() * 6
      const rayon = 0.09 + rng() * 0.05
      // Les tiges du fond sont plus sombres : ça creuse la profondeur sans
      // coûter une seule lumière de plus.
      const profondeur = rng()
      const tige = new THREE.Mesh(
        new THREE.CylinderGeometry(rayon * 0.8, rayon, hauteur, 6),
        new THREE.MeshStandardMaterial({
          color: new THREE.Color(0x5f7a3c).lerp(new THREE.Color(0x1e2b18), profondeur * 0.7),
          roughness: 0.9,
        })
      )
      tige.position.set((rng() - 0.5) * 3.4, hauteur / 2, (rng() - 0.5) * 5)
      // Un bambou ne pousse jamais parfaitement droit : ce léger désordre suffit
      // à tuer l'effet « forêt de poteaux téléphoniques ».
      tige.rotation.z = (rng() - 0.5) * 0.16
      tige.rotation.x = (rng() - 0.5) * 0.1
      g.add(tige)

      // Les nœuds : deux ou trois anneaux plus clairs le long de la tige. C'est
      // ce détail-là qui fait lire « bambou » plutôt que « tube vert ».
      const noeuds = 2 + Math.floor(rng() * 2)
      for (let k = 1; k <= noeuds; k++) {
        const anneau = new THREE.Mesh(
          new THREE.CylinderGeometry(rayon * 1.25, rayon * 1.25, 0.12, 6),
          new THREE.MeshStandardMaterial({ color: 0x7d9450, roughness: 0.8 })
        )
        anneau.position.set(
          tige.position.x,
          (hauteur / (noeuds + 1)) * k,
          tige.position.z
        )
        g.add(anneau)
      }
    }
    return g
  },
}

/**
 * 2 · VILLAGE EN FLAMMES 火 — le chaos orange
 *
 * Le biome le plus dense en fumée (brumeFar tombe à 70) : on y voit moins loin,
 * donc on y réagit plus vite. C'est voulu — c'est le pic de tension de la course,
 * placé pile au moment où le joueur maîtrise ses contrôles.
 *
 * 🚧 C'est ici que viendront les TOITS (le chemin qui monte) et les culs-de-sac
 * à escalader. Pour l'instant : le décor et la palette seulement.
 */
const VILLAGE: Biome = {
  nom: 'Village en flammes',
  kanji: '火',
  brume: 0x2e1a12,
  brumeNear: 26,
  brumeFar: 72,
  sol: 0x36251a,
  ligne: 0x6b3a20,
  ecartDecor: 15,
  fabriqueDecor: (rng) => {
    const g = new THREE.Group()

    // Une masure : un corps sombre et un toit incliné. Volontairement simple —
    // à 28 m/s on ne lit qu'une silhouette.
    const h = 3 + rng() * 2.5
    const corps = new THREE.Mesh(
      new THREE.BoxGeometry(3.2 + rng() * 1.6, h, 3.4 + rng() * 1.8),
      new THREE.MeshStandardMaterial({ color: 0x241611, roughness: 1 })
    )
    corps.position.set((rng() - 0.5) * 2.2, h / 2, 0)

    const toit = new THREE.Mesh(
      new THREE.ConeGeometry(3.4, 1.6, 4),
      new THREE.MeshStandardMaterial({ color: 0x1a100c, roughness: 1 })
    )
    toit.position.set(corps.position.x, h + 0.7, 0)
    toit.rotation.y = Math.PI / 4
    g.add(corps, toit)

    // Les braises : des blocs émissifs sans lumière réelle. Une vraie PointLight
    // par maison coûterait une passe d'ombre à chaque image — ici c'est gratuit,
    // et à cette vitesse l'œil ne fait pas la différence.
    const feux = 1 + Math.floor(rng() * 3)
    for (let i = 0; i < feux; i++) {
      const t = rng()
      const braise = new THREE.Mesh(
        new THREE.BoxGeometry(0.3 + rng() * 0.4, 0.5 + rng() * 0.9, 0.3),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(0xff9a3c).lerp(new THREE.Color(0xc33a2c), t),
        })
      )
      braise.position.set(
        corps.position.x + (rng() - 0.5) * 3,
        0.4 + rng() * h,
        (rng() - 0.5) * 3
      )
      g.add(braise)
    }
    return g
  },
}

/**
 * 3 · PONT AU CLAIR DE LUNE 月 — le vide bleu
 *
 * C'est la palette d'origine du jeu, conservée telle quelle : elle marchait, et
 * elle prend tout son sens maintenant qu'elle n'occupe plus toute la course mais
 * un acte précis — le calme tendu entre les flammes et le sommet.
 *
 * Ici le décor est BAS et clairsemé : rien ne borde la piste que des poteaux de
 * rambarde. Le vide autour est le sujet.
 */
const PONT: Biome = {
  nom: 'Pont au clair de lune',
  kanji: '月',
  brume: 0x151a2c,
  brumeNear: 30,
  brumeFar: 92,
  sol: 0x272d3f,
  ligne: 0x3d4560,
  ecartDecor: 7,
  fabriqueDecor: (rng) => {
    const g = new THREE.Group()
    const bois = new THREE.MeshStandardMaterial({ color: 0x4a3a4e, roughness: 0.85 })

    // Un poteau de rambarde + sa lisse. Serrés (7 m) : c'est leur défilement
    // rapide qui donne la sensation de vitesse au-dessus du vide.
    const poteau = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.5, 0.22), bois)
    poteau.position.y = 0.75
    const lisse = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 7.2), bois)
    lisse.position.y = 1.35
    g.add(poteau, lisse)

    // Une lanterne de loin en loin : le seul point chaud du biome le plus froid.
    if (rng() < 0.3) {
      const lanterne = new THREE.Mesh(
        new THREE.BoxGeometry(0.42, 0.6, 0.42),
        new THREE.MeshBasicMaterial({ color: 0xffcf87 })
      )
      lanterne.position.y = 1.95
      g.add(lanterne)
    }
    return g
  },
}

/**
 * 4 · FLANCS DU FUJI 雪 — le blanc final
 *
 * Le seul biome CLAIR, et c'est tout l'effet : après trois actes dans le noir,
 * l'arrivée sur la neige est un coup de projecteur. Il couvre la zone de sprint
 * final — le moment où l'on martèle l'écran sans plus rien à esquiver — donc la
 * récompense visuelle tombe pile sur la récompense de jeu.
 *
 * brumeFar monte à 105 : on voit LOIN, et donc on voit le torii sacré arriver.
 * C'est la seule fois de la course où la brume cesse de cacher l'horizon.
 */
const FUJI: Biome = {
  nom: 'Flancs du Fuji',
  kanji: '雪',
  brume: 0x8fa4bf,
  brumeNear: 38,
  brumeFar: 105,
  sol: 0xc9d4e0,
  ligne: 0x9aa9bd,
  ecartDecor: 13,
  fabriqueDecor: (rng) => {
    const g = new THREE.Group()

    // Un rocher coiffé de neige. La roche sombre est indispensable : sur un sol
    // clair, un décor clair disparaîtrait complètement.
    const r = 1.2 + rng() * 1.8
    const roche = new THREE.Mesh(
      new THREE.DodecahedronGeometry(r, 0),
      new THREE.MeshStandardMaterial({ color: 0x4a5568, roughness: 1, flatShading: true })
    )
    roche.position.set((rng() - 0.5) * 2.6, r * 0.55, 0)
    roche.rotation.set(rng() * 3, rng() * 3, rng() * 3)

    const neige = new THREE.Mesh(
      new THREE.DodecahedronGeometry(r * 0.72, 0),
      new THREE.MeshStandardMaterial({ color: 0xf2f6fb, roughness: 0.95, flatShading: true })
    )
    neige.position.set(roche.position.x, r * 1.15, 0)
    neige.rotation.copy(roche.rotation)
    g.add(roche, neige)

    // Un pin rabougri de temps en temps : la limite des arbres, en altitude.
    if (rng() < 0.35) {
      const tronc = new THREE.Mesh(
        new THREE.CylinderGeometry(0.14, 0.2, 2.4, 6),
        new THREE.MeshStandardMaterial({ color: 0x33291f, roughness: 1 })
      )
      tronc.position.set((rng() - 0.5) * 4, 1.2, (rng() - 0.5) * 3)
      const feuillage = new THREE.Mesh(
        new THREE.ConeGeometry(1.1, 2.6, 6),
        new THREE.MeshStandardMaterial({ color: 0x2c4034, roughness: 1, flatShading: true })
      )
      feuillage.position.set(tronc.position.x, 3, tronc.position.z)
      g.add(tronc, feuillage)
    }
    return g
  },
}

/** Dans l'ordre de la course. */
export const BIOMES: readonly Biome[] = [BAMBOUS, VILLAGE, PONT, FUJI]

/** L'ambiance à un instant donné : deux biomes et le fondu entre eux. */
export interface Ambiance {
  brume: THREE.Color
  brumeNear: number
  brumeFar: number
  sol: THREE.Color
  ligne: THREE.Color
  /** Le biome dominant — celui dont on affiche le nom, et dont on tire le décor. */
  index: number
}

// Réutilisés d'une image à l'autre : allouer quatre THREE.Color par frame
// remplirait le ramasse-miettes pour rien.
const _brume = new THREE.Color()
const _sol = new THREE.Color()
const _ligne = new THREE.Color()
const _a = new THREE.Color()
const _b = new THREE.Color()

/** Dans quel biome tombe cette distance ? (sans fondu — index brut) */
export function indexBiome(distance: number, length: number): number {
  const t = length > 0 ? distance / length : 0
  return Math.min(BIOMES.length - 1, Math.max(0, Math.floor(t * BIOMES.length)))
}

/**
 * L'ambiance à cette distance, fondu compris.
 *
 * On mélange sur les derniers `FONDU` de chaque biome. L'objet renvoyé est
 * TOUJOURS le même : ne pas le stocker, le lire tout de suite.
 */
export function ambianceA(distance: number, length: number): Ambiance {
  const n = BIOMES.length
  const t = length > 0 ? Math.min(0.9999, Math.max(0, distance / length)) : 0
  const part = 1 / n // la part de course d'un biome
  const i = Math.min(n - 1, Math.floor(t / part))

  // Où en est-on DANS ce biome, de 0 à 1 ?
  const dedans = (t - i * part) / part
  // Le fondu occupe la fin du biome. `FONDU` est une fraction de la COURSE,
  // ramenée ici à une fraction du biome.
  const seuil = 1 - FONDU / part
  const suivant = Math.min(n - 1, i + 1)
  const melange = dedans <= seuil || i === n - 1 ? 0 : (dedans - seuil) / (1 - seuil)

  const A = BIOMES[i]
  const B = BIOMES[suivant]

  _brume.copy(_a.setHex(A.brume)).lerp(_b.setHex(B.brume), melange)
  _sol.copy(_a.setHex(A.sol)).lerp(_b.setHex(B.sol), melange)
  _ligne.copy(_a.setHex(A.ligne)).lerp(_b.setHex(B.ligne), melange)

  return {
    brume: _brume,
    brumeNear: A.brumeNear + (B.brumeNear - A.brumeNear) * melange,
    brumeFar: A.brumeFar + (B.brumeFar - A.brumeFar) * melange,
    sol: _sol,
    ligne: _ligne,
    // On bascule le décor à mi-fondu : avant, on plante encore du biome A ;
    // après, du B. Comme le décor apparaît 85 m devant, la bascule se voit
    // arriver au loin pendant que les couleurs, elles, glissent déjà.
    index: melange > 0.5 ? suivant : i,
  }
}
