import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
// Type seul : effacé à la compilation, donc aucun cycle d'import avec track.ts.
import type { Kind } from './track'

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
 *
 *
 * ————— Pourquoi tout est FUSIONNÉ —————
 *
 * Première version : chaque tige, chaque anneau, chaque braise était un mesh.
 * Mesuré sur une course complète, ça donnait **403 meshes** dans les bambous —
 * pour seulement 9 600 triangles. Sur mobile, le coût n'est pas le nombre de
 * triangles (9 600, c'est trois fois rien) mais le nombre d'APPELS DE DESSIN :
 * ~150 est confortable, ~300 la limite.
 *
 * D'où `assemble()` : toutes les pièces d'un élément de décor sont soudées en
 * UN seul maillage, la couleur voyageant dans les sommets. Un massif de bambous
 * entier coûte désormais 1 appel au lieu de 25 — et comme la couleur est par
 * sommet, on n'a rien perdu en variété.
 *
 * Corollaire : on peut être BEAUCOUP plus généreux en détail qu'avant. Le plan
 * lointain ci-dessous serait impensable sans ça.
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
   * Le corps des pans de mur qu'on longe.
   *
   * ⚠️ Leur liseré, lui, reste vermillon dans TOUS les biomes — il n'est pas
   * décoratif : c'est le signal « ici tu peux t'accrocher ». Un repère d'action
   * doit rester identique d'un bout à l'autre de la course, sinon le joueur doit
   * réapprendre à le lire à chaque changement de décor. Seule la matière change.
   */
  murCorps: number

  /**
   * Un élément de bordure (massif, masure, rocher…). Appelé avec le tirage à
   * graine : deux joueurs voient EXACTEMENT le même décor, comme le reste.
   */
  fabriqueDecor: (rng: () => number) => THREE.Group
  /** Un élément tous les combien de mètres, de chaque côté. */
  ecartDecor: number

  /**
   * L'habillage des obstacles, propre au biome. Facultatif : sans lui, le biome
   * garde les blocs génériques.
   *
   * ⚠️ Ce n'est QUE de l'apparence. La boîte de collision vient de
   * `TAILLE_OBSTACLE` dans track.ts et ne dépend jamais du maillage — un
   * habillage peut donc déborder, pencher ou s'orner sans rien changer au jeu.
   * L'origine du groupe est AU SOL.
   */
  fabriqueObstacle?: (kind: Kind, rng: () => number) => THREE.Group

  /**
   * L'habillage d'une plateforme (le « train » sur lequel on court).
   *
   * ⚠️ Le maillage doit être bâti sur 1 m de long, CENTRÉ en z, et sera étiré à
   * la longueur voulue. Tout ce qui s'étire mal en Z est donc à proscrire : on
   * privilégie les formes qui courent le long de la plateforme (des perches),
   * puisque les allonger est justement ce qu'on veut.
   */
  fabriquePlateforme?: (hauteur: number) => THREE.Group
}

/**
 * La transition : sur cette fraction de la course avant chaque frontière, les
 * couleurs se fondent d'un biome à l'autre. ~5 % = une centaine de mètres,
 * environ 4 s — assez long pour qu'on ne voie jamais un décor « claquer », assez
 * court pour qu'on sente quand même le changement de monde.
 */
const FONDU = 0.05

/* ————————————————————————————————————————————————————————————————
 *  L'outillage : souder des pièces en un seul maillage
 * ———————————————————————————————————————————————————————————————— */

interface Piece {
  geo: THREE.BufferGeometry
  couleur: number | THREE.Color
  x: number
  y: number
  z: number
  /** Inclinaisons, en radians */
  rx?: number
  ry?: number
  rz?: number
}

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _v = new THREE.Vector3()
const _un = new THREE.Vector3(1, 1, 1)
const _c = new THREE.Color()

/**
 * Soude des pièces en UN maillage, la couleur passant dans les sommets.
 *
 * Chaque géométrie est déplacée à sa place définitive puis fusionnée : on perd
 * la possibilité de bouger les morceaux indépendamment (on n'en a pas besoin,
 * un bambou ne s'anime pas) et on gagne un facteur ~25 sur les appels de dessin.
 *
 * ⚠️ Les couleurs sont écrites en LINÉAIRE (`THREE.Color` convertit depuis le
 * sRGB tout seul) : c'est ce que l'attribut `color` attend. Y mettre du sRGB
 * brut donnerait un décor délavé.
 */
function assemble(pieces: Piece[], materiau: THREE.Material): THREE.Mesh | null {
  if (pieces.length === 0) return null
  const geos: THREE.BufferGeometry[] = []

  for (const p of pieces) {
    /*
     * ⚠️ On dégroupe l'index AVANT de fusionner.
     *
     * Les géométries de Three ne sont pas toutes bâties pareil : Cylinder, Box
     * et Cone sont INDEXÉES, Dodecahedron ne l'est pas. `mergeGeometries` refuse
     * de mélanger les deux et renvoie null — c'est-à-dire un décor qui disparaît
     * en silence, sans la moindre exception. C'est exactement ce qui était
     * arrivé au Fuji : plus un seul rocher, plus un seul pin.
     *
     * `toNonIndexed()` ramène tout le monde à la même forme. Ça duplique
     * quelques sommets, ce qui est sans importance ici (~19 000 triangles pour
     * toute la course, là où le vrai coût est le nombre d'appels de dessin).
     */
    const source = p.geo.getIndex() ? p.geo.toNonIndexed() : p.geo
    const g = source.clone()
    if (source !== p.geo) source.dispose()
    _e.set(p.rx ?? 0, p.ry ?? 0, p.rz ?? 0)
    _q.setFromEuler(_e)
    _v.set(p.x, p.y, p.z)
    g.applyMatrix4(_m.compose(_v, _q, _un))

    // La couleur, sommet par sommet — c'est ce qui permet de tout souder tout
    // en gardant des tiges de teintes différentes.
    _c.set(p.couleur as THREE.ColorRepresentation)
    const n = g.getAttribute('position').count
    const couleurs = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      couleurs[i * 3] = _c.r
      couleurs[i * 3 + 1] = _c.g
      couleurs[i * 3 + 2] = _c.b
    }
    g.setAttribute('color', new THREE.BufferAttribute(couleurs, 3))
    geos.push(g)
  }

  const fusion = mergeGeometries(geos, false)
  for (const g of geos) g.dispose()
  if (!fusion) {
    // Un échec de fusion fait DISPARAÎTRE tout un pan de décor sans lever
    // d'exception : on ne le voit qu'en comptant les maillages. On refuse de
    // le laisser passer sous silence.
    console.error(
      `[biomes] Fusion impossible pour ${pieces.length} pièces — ce décor sera absent.`
    )
    return null
  }
  return new THREE.Mesh(fusion, materiau)
}

/**
 * Les géométries de base, créées UNE fois et réutilisées partout.
 *
 * `assemble` les clone avant de les transformer, donc les partager ne coûte
 * rien — et évite de reconstruire un cylindre à chaque touffe de bambous.
 */
const GEO = {
  tige: new THREE.CylinderGeometry(0.8, 1, 1, 6),
  anneau: new THREE.CylinderGeometry(1, 1, 1, 6),
  /*
   * La même tige, mais SANS ses deux bouchons.
   *
   * Un cylindre à 6 pans coûte 12 triangles de paroi et 12 de bouchons : la
   * moitié du prix part dans des disques qu'on ne voit jamais, puisqu'une tige
   * de bambou est plantée dans le sol et se perd dans la brume. Sur les
   * cinquante tiges d'un massif, l'économie est franche.
   *
   * ⚠️ Réservée au DÉCOR. Les troncs couchés en travers d'une ligne, eux,
   * montrent leur section au joueur — ouverts, ils paraîtraient creux.
   */
  tigeCreuse: new THREE.CylinderGeometry(0.8, 1, 1, 6, 1, true),
  /**
   * La tige du LOINTAIN : 4 pans au lieu de 6, et creuse.
   *
   * À vingt mètres et dans la brume, on ne lit qu'une silhouette verticale —
   * personne ne comptera jamais ses arêtes. Comme ces tiges-là forment le gros
   * du décor (jusqu'à 70 par massif), leur faire économiser un tiers de leurs
   * triangles est le seul geste qui pèse vraiment.
   */
  tigeLoin: new THREE.CylinderGeometry(0.8, 1, 1, 4, 1, true),
  bloc: new THREE.BoxGeometry(1, 1, 1),
  cone: new THREE.ConeGeometry(1, 1, 4),
  sapin: new THREE.ConeGeometry(1, 1, 6),
  caillou: new THREE.DodecahedronGeometry(1, 0),
  feuille: new THREE.PlaneGeometry(1, 1),
}

/**
 * Les matériaux, partagés par tous les décors d'un même type. Deux familles
 * seulement, et c'est volontaire :
 *  · MAT_SOLIDE  — éclairé par la scène, prend la brume ;
 *  · MAT_LUMIERE — s'éclaire tout seul (braises, lanternes), prend la brume
 *    aussi, sinon un feu resterait net à 90 m alors que tout s'estompe.
 */
const MAT_SOLIDE = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 })
const MAT_FACETTE = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 1,
  flatShading: true,
})
const MAT_LUMIERE = new THREE.MeshBasicMaterial({ vertexColors: true, fog: true })
/** Le feuillage : des plans, donc à rendre des DEUX côtés — sinon la moitié
 *  des feuilles disparaît selon l'angle de la caméra. */
const MAT_FEUILLE = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 1,
  side: THREE.DoubleSide,
})

/** Regroupe les maillages soudés d'un élément de décor. */
function groupe(...meshes: (THREE.Mesh | null)[]): THREE.Group {
  const g = new THREE.Group()
  for (const m of meshes) if (m) g.add(m)
  return g
}

/** Tire une couleur entre deux teintes. */
function teinte(a: number, b: number, t: number): THREE.Color {
  return new THREE.Color(a).lerp(new THREE.Color(b), t)
}

/* ————————————————————————————————————————————————————————————————
 *  1 · FORÊT DE BAMBOUS 竹 — l'aube verte
 * ———————————————————————————————————————————————————————————————— */

/**
 * On démarre ici : c'est le biome qui doit être le PLUS lisible, parce que le
 * joueur apprend encore où sont les lignes. D'où la brume la plus claire des
 * trois biomes sombres, et un décor vertical (les tiges) qui souligne la fuite
 * de la piste au lieu de la brouiller.
 *
 * Le massif est bâti en TROIS PLANS, et c'est ce qui fait la profondeur :
 *
 *  · le plan RAPPROCHÉ (x 0→4) — tiges claires, avec nœuds et feuillage. C'est
 *    le seul plan où l'on distingue les détails, donc le seul qui en porte ;
 *  · le plan LOINTAIN (x 5→16) — tiges deux fois plus hautes et bien plus
 *    sombres. À cette distance l'œil ne lit qu'une silhouette : lui donner des
 *    détails serait payer pour rien. Leur hauteur double est ce qui fait dire
 *    « forêt » plutôt que « haie » ;
 *  · le SOL (x 0→5) — litière et jeunes pousses, qui empêchent les tiges d'avoir
 *    l'air plantées dans du vide.
 *
 * Le tout soudé en 2 maillages (le solide, et le feuillage). Sans la fusion, un
 * massif pareil coûterait ~60 appels de dessin ; il en coûte 2.
 */
const BAMBOUS: Biome = {
  nom: 'Forêt de bambous',
  kanji: '竹',
  brume: 0x1c2e24,
  brumeNear: 32,
  brumeFar: 88,
  sol: 0x24301f,
  ligne: 0x40573f,
  murCorps: 0x2c3a23, // une palissade de bambou serré, sombre
  /*
   * 9 m entre deux massifs, et chaque massif s'étale sur ~18 m de profondeur :
   * ils se CHEVAUCHENT donc largement.
   *
   * C'est le point qui manquait. Avec des massifs espacés de 12 m mais larges
   * de 7, on voyait le vide entre eux — une haie de bosquets, pas une forêt.
   * Le recouvrement est ce qui ferme complètement le regard.
   *
   * Et il ne coûte rien : chaque massif reste UN appel de dessin quel que soit
   * le nombre de tiges, puisque tout est soudé. Le seul vrai coût, c'est le
   * nombre de massifs — d'où le choix de charger chacun plutôt que d'en
   * multiplier.
   */
  /*
   * ⚠️ La densité au mètre ne dépend QUE du rapport tiges/écartement.
   *
   * Chaque massif apporte ses tiges tous les `ecartDecor` mètres : la densité
   * vaut donc `proches / ecartDecor`, et l'étalement en z ne joue que sur
   * l'uniformité. Serrer les massifs (6 → 4 m) faisait grimper les appels de
   * dessin d'un tiers — 175, au-dessus du confortable — pour le même résultat
   * que charger chaque massif, qui lui ne coûte RIEN de plus (tout est soudé).
   *
   * On garde donc 6 m, et l'on remplit.
   */
  ecartDecor: 6,
  fabriqueDecor: (rng) => {
    const corps: Piece[] = []
    const feuilles: Piece[] = []

    // ————— Plan rapproché : les tiges qu'on voit vraiment —————
    const proches = 40 + Math.floor(rng() * 20)
    for (let i = 0; i < proches; i++) {
      const h = 7 + rng() * 7
      const r = 0.085 + rng() * 0.05
      const x = rng() * 5.5
      const z = (rng() - 0.5) * 22
      // Plus la tige est loin, plus elle est sombre : la profondeur se lit à la
      // valeur avant de se lire à la taille.
      const recul = Math.min(1, x / 5.5)
      const vert = teinte(0x6d8a42, 0x2f4423, recul * 0.65 + rng() * 0.2)
      const penche = (rng() - 0.5) * 0.14

      // ⚠️ Les géométries de base font 1 m et `assemble` ne gère pas l'échelle :
      // c'est la géométrie clonée qui porte la taille.
      corps.push({
        geo: GEO.tigeCreuse.clone().scale(r, h, r),
        couleur: vert,
        x, y: h / 2, z,
        rz: penche,
        rx: (rng() - 0.5) * 0.08,
      })

      // Les nœuds : c'est ce détail qui fait lire « bambou » et pas « tube vert ».
      const noeuds = 2 + Math.floor(rng() * 3)
      for (let k = 1; k <= noeuds; k++) {
        const hy = (h / (noeuds + 1)) * k
        corps.push({
          geo: GEO.anneau.clone().scale(r * 1.3, 0.1, r * 1.3),
          couleur: teinte(0x93a95c, 0x4a5c30, recul * 0.6),
          x: x + Math.sin(penche) * hy,
          y: hy,
          z,
          rz: penche,
        })
      }

      // Le feuillage : quelques lames en haut de tige. Sans ça, une forêt de
      // bambous ressemble à un parking à poteaux.
      const lames = 2 + Math.floor(rng() * 3)
      for (let k = 0; k < lames; k++) {
        const hy = h * (0.68 + rng() * 0.3)
        feuilles.push({
          geo: GEO.feuille.clone().scale(1.1 + rng() * 0.9, 0.16 + rng() * 0.12, 1),
          couleur: teinte(0x7fa04a, 0x35502a, rng() * 0.8),
          x: x + Math.sin(penche) * hy + (rng() - 0.5) * 0.9,
          y: hy,
          z: z + (rng() - 0.5) * 0.9,
          ry: rng() * Math.PI,
          rz: (rng() - 0.5) * 1.1,
        })
      }
    }

    // ————— Plan lointain : la masse de la forêt —————
    // Deux fois plus hautes, quasi noires, sans le moindre détail. C'est elles
    // qui ferment l'horizon et donnent l'impression qu'on traverse quelque chose.
    // Elles sont NOMBREUSES : c'est le rideau du fond, et le moindre trou
    // dedans se voit comme un manque. Une tige lointaine ne coûte que quelques
    // triangles, alors on en met beaucoup.
    const loin = 60 + Math.floor(rng() * 30)
    for (let i = 0; i < loin; i++) {
      const h = 13 + rng() * 11
      const r = 0.11 + rng() * 0.08
      corps.push({
        geo: GEO.tigeLoin.clone().scale(r, h, r),
        couleur: teinte(0x2b3d22, 0x141d12, rng()),
        // Jusqu'à 26 m : le rideau doit dépasser la portée de la brume (88 m),
        // sinon on devine son bord en tournant la caméra.
        x: 5.5 + rng() * 20,
        y: h / 2,
        z: (rng() - 0.5) * 24,
        rz: (rng() - 0.5) * 0.1,
      })
    }

    // ————— Le sol : litière et jeunes pousses —————
    const litiere = 7 + Math.floor(rng() * 6)
    for (let i = 0; i < litiere; i++) {
      feuilles.push({
        geo: GEO.feuille.clone().scale(0.5 + rng() * 1.3, 0.3 + rng() * 0.6, 1),
        couleur: teinte(0x4a4a24, 0x26301a, rng()),
        x: rng() * 6,
        y: 0.03, // à ras du sol, sinon ça scintille contre lui
        z: (rng() - 0.5) * 18,
        rx: -Math.PI / 2,
        ry: rng() * Math.PI,
      })
    }
    const pousses = 5 + Math.floor(rng() * 5)
    for (let i = 0; i < pousses; i++) {
      const h = 0.8 + rng() * 1.8
      corps.push({
        geo: GEO.tigeCreuse.clone().scale(0.05, h, 0.05),
        couleur: teinte(0x86a352, 0x4e6a30, rng()),
        x: rng() * 6,
        y: h / 2,
        z: (rng() - 0.5) * 18,
        rz: (rng() - 0.5) * 0.4,
      })
    }

    return groupe(assemble(corps, MAT_SOLIDE), assemble(feuilles, MAT_FEUILLE))
  },

  /*
   * ————— Les obstacles de la forêt —————
   *
   * La règle qui prime sur tout le reste : **la couleur reste sémantique**.
   * Le vermillon dit « saute », l'or dit « glisse », le sombre dit « change de
   * ligne ». À 28 m/s, on lit la couleur avant la forme — un joueur n'a pas le
   * temps d'analyser une silhouette. Tout habiller en vert bambou aurait été
   * plus joli et beaucoup moins jouable.
   *
   * Le bambou apporte donc la MATIÈRE (tiges, nœuds, ligatures), et l'accent de
   * couleur d'origine reste bien visible sur chacun.
   */
  fabriqueObstacle: (kind, rng) => {
    const p: Piece[] = []

    if (kind === 'saut') {
      // Un gros tronc couché en travers de la ligne : ça se saute.
      const r = 0.26
      p.push({
        geo: GEO.tige.clone().scale(r, 1.75, r),
        couleur: teinte(0x8a9a52, 0x5d6b34, rng()),
        x: 0, y: 0.3, z: 0,
        rz: Math.PI / 2, // le cylindre est vertical par défaut : on le couche
      })
      // Les nœuds du tronc
      for (const nx of [-0.5, 0, 0.5]) {
        p.push({
          geo: GEO.anneau.clone().scale(r * 1.15, 0.09, r * 1.15),
          couleur: 0x9fb268,
          x: nx, y: 0.3, z: 0, rz: Math.PI / 2,
        })
      }
      // Les ligatures VERMILLON : c'est elles qu'on voit arriver de loin.
      for (const nx of [-0.68, 0.68]) {
        p.push({
          geo: GEO.anneau.clone().scale(r * 1.3, 0.16, r * 1.3),
          couleur: 0xc33a2c,
          x: nx, y: 0.3, z: 0, rz: Math.PI / 2,
        })
      }
      // Deux billots qui le calent : sans eux, le tronc a l'air de flotter.
      for (const nx of [-0.8, 0.8]) {
        p.push({
          geo: GEO.tige.clone().scale(0.13, 0.3, 0.13),
          couleur: 0x4a4028,
          x: nx, y: 0.15, z: 0.2,
        })
      }
    } else if (kind === 'glissade') {
      // Une perche tendue en hauteur : on passe DESSOUS.
      const r = 0.19
      p.push({
        geo: GEO.tige.clone().scale(r, 1.75, r),
        couleur: teinte(0x8a9a52, 0x64703a, rng()),
        x: 0, y: 1.55, z: 0,
        rz: Math.PI / 2,
      })
      // Les cordages DORÉS, l'accent de couleur du « glisse »
      for (const nx of [-0.55, 0.55]) {
        p.push({
          geo: GEO.anneau.clone().scale(r * 1.45, 0.2, r * 1.45),
          couleur: 0xd6ac5a,
          x: nx, y: 1.55, z: 0, rz: Math.PI / 2,
        })
      }
      /*
       * Les deux montants qui la portent.
       *
       * Volontairement FINS, et plantés au bord exact de la ligne (±0,85 m) :
       * ils expliquent pourquoi la perche tient en l'air, sans jamais se
       * trouver sur la trajectoire d'un joueur — qui court au centre de sa
       * ligne. Ils ne sont pas dans la boîte de collision : un montant épais
       * aurait été un mensonge visuel.
       */
      for (const nx of [-0.85, 0.85]) {
        p.push({
          geo: GEO.tige.clone().scale(0.07, 1.95, 0.07),
          couleur: 0x5a6636,
          x: nx, y: 0.97, z: 0,
        })
      }
    } else {
      // Une palissade dense : infranchissable, il faut changer de ligne.
      const n = 7
      for (let i = 0; i < n; i++) {
        const x = -0.75 + (1.5 / (n - 1)) * i
        const h = 2.4 - rng() * 0.18 // des hauteurs inégales : c'est bâti à la main
        // Du bambou vieilli, presque noir : dans une forêt verte, une palissade
        // bleu-ardoise jurait. C'est la VALEUR (très sombre) qui dit
        // « infranchissable », pas la teinte — on peut donc rester dans le bois.
        p.push({
          geo: GEO.tige.clone().scale(0.12, h, 0.12),
          couleur: teinte(0x36432a, 0x1b2416, rng()),
          x, y: h / 2, z: 0,
          rz: (rng() - 0.5) * 0.05,
        })
        // Une pointe taillée en haut de chaque pieu
        p.push({
          geo: GEO.sapin.clone().scale(0.13, 0.26, 0.13),
          couleur: 0x222c1b,
          x, y: h + 0.11, z: 0,
        })
      }
      // Les deux traverses de ligature qui tiennent l'ensemble
      for (const hy of [0.7, 1.85]) {
        p.push({
          geo: GEO.tige.clone().scale(0.08, 1.68, 0.08),
          couleur: 0x574a33,
          x: 0, y: hy, z: -0.16,
          rz: Math.PI / 2,
        })
      }
    }

    return groupe(assemble(p, MAT_SOLIDE))
  },

  /*
   * ————— Le radeau de bambou —————
   *
   * L'équivalent forestier du wagon : un train de perches liées, qu'on
   * charriait sur les chemins. La forme est choisie pour l'étirement — ce sont
   * des perches COUCHÉES DANS LE SENS DE LA LONGUEUR, donc les rallonger est
   * exactement ce qu'on veut quand la plateforme s'étire. Un tonneau ou une
   * caisse se seraient déformés en bouillie.
   *
   * Le liseré vermillon du dessus reprend celui des pans de mur : c'est devenu
   * le langage des surfaces qu'on UTILISE, par opposition aux obstacles qu'on
   * subit.
   */
  fabriquePlateforme: (hauteur) => {
    const p: Piece[] = []

    // Le corps : quatre perches côte à côte, couchées en long.
    for (let i = 0; i < 4; i++) {
      const x = -0.62 + 0.41 * i
      p.push({
        geo: GEO.tige.clone().scale(0.22, 1, 0.22),
        couleur: i % 2 ? 0x4d5c30 : 0x3e4b27,
        x, y: hauteur - 0.55, z: 0,
        rx: Math.PI / 2, // couchée le long de la plateforme
      })
    }

    // Le tablier du dessus, sur lequel on court.
    p.push({
      geo: GEO.bloc.clone().scale(1.7, 0.22, 1),
      couleur: 0x6b7d3f,
      x: 0, y: hauteur - 0.11, z: 0,
    })

    // Les montants sous le tablier, jusqu'au sol : la plateforme doit avoir
    // l'air posée sur quelque chose, pas de léviter.
    for (const x of [-0.7, 0.7]) {
      p.push({
        geo: GEO.bloc.clone().scale(0.16, hauteur - 0.66, 1),
        couleur: 0x2b3320,
        x, y: (hauteur - 0.66) / 2, z: 0,
      })
    }

    // Le liseré vermillon : « on peut monter là-dessus ».
    p.push({
      geo: GEO.bloc.clone().scale(1.76, 0.1, 1),
      couleur: 0xc33a2c,
      x: 0, y: hauteur, z: 0,
    })

    return groupe(assemble(p, MAT_SOLIDE))
  },
}

/* ————————————————————————————————————————————————————————————————
 *  2 · VILLAGE EN FLAMMES 火 — le chaos orange
 * ———————————————————————————————————————————————————————————————— */

/**
 * Le biome le plus dense en fumée (brumeFar tombe à 72) : on y voit moins loin,
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
  murCorps: 0x241610, // un mur de torchis noirci par le feu
  ecartDecor: 15,
  fabriqueDecor: (rng) => {
    const corps: Piece[] = []
    const feux: Piece[] = []

    // Une masure : un corps sombre et un toit. Volontairement simple — à 28 m/s
    // on ne lit qu'une silhouette.
    const h = 3 + rng() * 2.5
    const larg = 3.2 + rng() * 1.6
    const x = rng() * 2.2
    corps.push({
      geo: GEO.bloc.clone().scale(larg, h, 3.4 + rng() * 1.8),
      couleur: teinte(0x2a1a13, 0x150d09, rng()),
      x, y: h / 2, z: 0,
    })
    corps.push({
      geo: GEO.cone.clone().scale(larg * 0.95, 1.6, larg * 0.95),
      couleur: 0x1a100c,
      x, y: h + 0.8, z: 0,
      ry: Math.PI / 4,
    })

    // Des poutres effondrées : c'est ce qui dit « en ruine » plutôt que « maison ».
    const poutres = 1 + Math.floor(rng() * 3)
    for (let i = 0; i < poutres; i++) {
      corps.push({
        geo: GEO.bloc.clone().scale(0.18, 0.18, 2.5 + rng() * 2),
        couleur: 0x1c120d,
        x: x + (rng() - 0.5) * 4,
        y: 0.3 + rng() * 1.5,
        z: (rng() - 0.5) * 4,
        rx: (rng() - 0.5) * 1.2,
        ry: rng() * Math.PI,
      })
    }

    // Un second rang de maisons, plus loin et plus sombre : le village a une
    // profondeur, ce n'est pas une rangée de façades.
    if (rng() < 0.7) {
      const h2 = 2.5 + rng() * 3
      corps.push({
        geo: GEO.bloc.clone().scale(4 + rng() * 3, h2, 4),
        couleur: 0x140c08,
        x: 7 + rng() * 6,
        y: h2 / 2,
        z: (rng() - 0.5) * 8,
      })
    }

    /*
     * Les braises : des blocs émissifs, SANS lumière réelle.
     * Une vraie PointLight par maison coûterait une passe d'ombre à chaque
     * image — ici c'est gratuit, et à cette vitesse l'œil ne fait pas la
     * différence. Elles gardent la brume : un feu qui resterait net à 90 m
     * alors que tout s'estompe trahirait le truc.
     */
    const nFeux = 2 + Math.floor(rng() * 4)
    for (let i = 0; i < nFeux; i++) {
      const t = rng()
      feux.push({
        geo: GEO.bloc.clone().scale(0.25 + rng() * 0.4, 0.5 + rng() * 1.1, 0.3),
        couleur: teinte(0xffc25c, 0xbf2f1e, t),
        x: x + (rng() - 0.5) * 4,
        y: 0.4 + rng() * h,
        z: (rng() - 0.5) * 3.5,
        rz: (rng() - 0.5) * 0.5,
      })
    }

    return groupe(assemble(corps, MAT_SOLIDE), assemble(feux, MAT_LUMIERE))
  },
}

/* ————————————————————————————————————————————————————————————————
 *  3 · PONT AU CLAIR DE LUNE 月 — le vide bleu
 * ———————————————————————————————————————————————————————————————— */

/**
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
  murCorps: 0x2b3145, // la rambarde d'ardoise du pont — la teinte d'origine
  ecartDecor: 8,
  fabriqueDecor: (rng) => {
    const corps: Piece[] = []
    const lueurs: Piece[] = []

    // Poteau + lisse. Serrés (8 m) : c'est leur défilement rapide qui donne la
    // sensation de vitesse au-dessus du vide.
    corps.push({
      geo: GEO.bloc.clone().scale(0.22, 1.5, 0.22),
      couleur: 0x4a3a4e, x: 0, y: 0.75, z: 0,
    })
    corps.push({
      geo: GEO.bloc.clone().scale(0.14, 0.14, 8.2),
      couleur: 0x53425a, x: 0, y: 1.35, z: 0,
    })
    // La poutre de tablier, sous le niveau du sol : on devine la structure qui
    // nous porte, et donc le vide en dessous.
    corps.push({
      geo: GEO.bloc.clone().scale(0.3, 0.4, 8.2),
      couleur: 0x342a3a, x: 0, y: -0.25, z: 0,
    })

    // Un haubanage de loin en loin : le pont a l'air tenu par quelque chose.
    if (rng() < 0.25) {
      const h = 4 + rng() * 3
      corps.push({
        geo: GEO.bloc.clone().scale(0.26, h, 0.26),
        couleur: 0x3e3145, x: 0, y: h / 2, z: 0,
      })
    }

    // Une lanterne : le seul point chaud du biome le plus froid.
    if (rng() < 0.28) {
      lueurs.push({
        geo: GEO.bloc.clone().scale(0.42, 0.6, 0.42),
        couleur: 0xffcf87, x: 0, y: 1.95, z: 0,
      })
    }

    return groupe(assemble(corps, MAT_SOLIDE), assemble(lueurs, MAT_LUMIERE))
  },
}

/* ————————————————————————————————————————————————————————————————
 *  4 · FLANCS DU FUJI 雪 — le blanc final
 * ———————————————————————————————————————————————————————————————— */

/**
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
  murCorps: 0x5a6478, // une congère tassée, sombre pour trancher sur la neige
  ecartDecor: 13,
  fabriqueDecor: (rng) => {
    const corps: Piece[] = []

    // Un rocher coiffé de neige. La roche SOMBRE est indispensable : sur un sol
    // clair, un décor clair disparaîtrait complètement.
    const r = 1.2 + rng() * 1.8
    const rot = { rx: rng() * 3, ry: rng() * 3, rz: rng() * 3 }
    const x = rng() * 2.6
    corps.push({
      geo: GEO.caillou.clone().scale(r, r * 0.8, r),
      couleur: teinte(0x59647a, 0x333c4d, rng()),
      x, y: r * 0.5, z: 0, ...rot,
    })
    corps.push({
      geo: GEO.caillou.clone().scale(r * 0.72, r * 0.5, r * 0.72),
      couleur: 0xf2f6fb,
      x, y: r * 1.0, z: 0, ...rot,
    })

    // Un pin rabougri : la limite des arbres, en altitude.
    if (rng() < 0.4) {
      const px = rng() * 4
      const pz = (rng() - 0.5) * 4
      corps.push({
        geo: GEO.tige.clone().scale(0.16, 2.4, 0.16),
        couleur: 0x33291f, x: px, y: 1.2, z: pz,
      })
      corps.push({
        geo: GEO.sapin.clone().scale(1.1, 2.6, 1.1),
        couleur: teinte(0x354c3e, 0x1e2e26, rng()),
        x: px, y: 3, z: pz,
      })
      // La neige accrochée dessus : sans elle, le pin a l'air d'un été égaré.
      corps.push({
        geo: GEO.sapin.clone().scale(0.85, 1.1, 0.85),
        couleur: 0xe8eef6, x: px, y: 3.7, z: pz,
      })
    }

    // Une crête lointaine : c'est elle qui dit qu'on est en montagne et pas
    // dans une plaine enneigée.
    if (rng() < 0.55) {
      const hc = 6 + rng() * 9
      corps.push({
        geo: GEO.cone.clone().scale(7 + rng() * 6, hc, 7),
        couleur: teinte(0x8496ad, 0xb9c6d6, rng()),
        x: 12 + rng() * 9,
        y: hc / 2,
        z: (rng() - 0.5) * 14,
        ry: rng() * Math.PI,
      })
    }

    // Facettes : sur de la roche et de la neige, l'arête franche vaut mieux
    // qu'un dégradé lisse.
    return groupe(assemble(corps, MAT_FACETTE))
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
const _solC = new THREE.Color()
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
  _solC.copy(_a.setHex(A.sol)).lerp(_b.setHex(B.sol), melange)
  _ligne.copy(_a.setHex(A.ligne)).lerp(_b.setHex(B.ligne), melange)

  return {
    brume: _brume,
    brumeNear: A.brumeNear + (B.brumeNear - A.brumeNear) * melange,
    brumeFar: A.brumeFar + (B.brumeFar - A.brumeFar) * melange,
    sol: _solC,
    ligne: _ligne,
    // On bascule le décor à mi-fondu : avant, on plante encore du biome A ;
    // après, du B. Comme le décor apparaît 85 m devant, la bascule se voit
    // arriver au loin pendant que les couleurs, elles, glissent déjà.
    index: melange > 0.5 ? suivant : i,
  }
}
