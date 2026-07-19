import * as THREE from 'three'
import { LANES, MUR_X, ECART_LIGNE, JUMP_SPEED } from './player'
import { tirerParchemin, TIRAGE, type ParcheminKind } from './parchemin'
import { BIOMES, ambianceA, indexBiome, LONG_BARRIERE, MUR_HAUT } from './biomes'
import type { Ambiance } from './biomes'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/**
 * Les 3 familles d'obstacles : comment les franchir.
 * `mur` est le GRAND obstacle (2,4 m de haut, il barre toute la ligne) ;
 * `saut` et `glissade` sont les petits. L'Armure de Fer fait la différence.
 */
export type Kind = 'saut' | 'glissade' | 'mur'

/**
 * ————— Les dimensions de collision, et elles seules —————
 *
 * La boîte de chaque obstacle était déduite de son maillage (`setFromObject`).
 * Tant qu'il n'existait qu'un seul décor, ça marchait. Dès que chaque biome
 * habille ses obstacles à sa façon, ça devient un piège : un tronc de bambou un
 * peu plus épais qu'une barrière peinte, et la difficulté change en cours de
 * course — sans que rien ne le signale, et en emportant toute la calibration
 * (un trébuchement coûte 0,53 s ; ce chiffre suppose des boîtes fixes).
 *
 * Le visuel et la collision sont donc SÉPARÉS ici pour de bon. Ces valeurs sont
 * celles d'origine, au centimètre près : le jeu se comporte exactement comme
 * avant. Les habillages de biome peuvent désormais déborder, se tordre ou
 * s'orner sans jamais toucher à l'équilibrage.
 *
 * `y` est la hauteur du CENTRE de la boîte au-dessus du sol.
 */
export const TAILLE_OBSTACLE: Record<Kind, { larg: number; haut: number; prof: number; y: number }> = {
  saut: { larg: 2.15, haut: 0.6, prof: 0.5, y: 0.3 }, // barrière basse → sauter
  glissade: { larg: 2.15, haut: 0.5, prof: 0.5, y: 1.55 }, // barre haute → glisser dessous
  mur: { larg: 2.15, haut: 2.4, prof: 0.5, y: 1.2 }, // bloc complet → changer de ligne
}
/*
 * ⚠️ `larg` a suivi l'élargissement des lignes (1,70 → 2,15 m quand l'écart est
 * passé de 2,20 à 2,80 m). Ce qui compte n'est pas la largeur absolue mais la
 * PART DU PAS qu'un obstacle couvre : 77 % avant, 77 % après. Laisser 1,70 m
 * aurait ramené cette part à 61 % et rendu toutes les esquives sensiblement
 * plus faciles — un changement d'équilibrage déguisé en changement de décor.
 *
 * ⚠️ `haut` du `mur`, lui, ne bouge SURTOUT pas : 2,40 m est la valeur sur
 * laquelle `JUMP_SPEED` est calibrée (Yasuke plafonne à 2,07 m et reste bloqué,
 * Hana monte à 2,89 m et passe). Y toucher redistribuerait le roster.
 */

/**
 * La largeur du ruban de sol.
 *
 * Élargie de 14 à 16 m en même temps que les lignes : le décor de bordure est
 * planté à 5,6 m du centre avec jusqu'à 1,4 m de dispersion, donc il touche
 * 7,0 m. À 14 m de large (soit ±7), les touffes les plus écartées se seraient
 * retrouvées pile au bord, une racine dans le vide.
 */
const LARGEUR_SOL = 16

const LOOKAHEAD = 85 // les obstacles apparaissent 85 m devant (cachés par la brume)
/** L'écart entre deux pointillés — et donc la période de leur défilement. */
const PAS_POINTILLE = 6
const DESPAWN_Z = 8 // et disparaissent derrière la caméra

/**
 * La longueur de la course, en mètres. Départ → torii sacré.
 * Calibrée pour qu'une course propre — aucun parchemin, aucun trébuchement,
 * aucun martèlement — dure 75 s à la vitesse de croisière.
 *
 * Elle vit ici, avec la piste qu'elle décrit, et non dans main.ts : l'écran des
 * meilleurs temps range ses tableaux SOUS cette valeur (un classement qui
 * mêlerait deux longueurs ne voudrait rien dire), et il ne peut pas importer
 * main.ts sans créer une boucle.
 */
export const COURSE_LENGTH = 1920

/**
 * Les derniers mètres de la course : le SPRINT FINAL.
 * Aucun obstacle n'y est placé — sur mobile, on ne peut pas swiper pour
 * esquiver ET marteler l'écran pour accélérer en même temps.
 */
export const SPRINT_ZONE = 120

interface Obstacle {
  mesh: THREE.Object3D
  kind: Kind
  /** Le biome dont il porte l'habillage : on recycle par type ET par biome. */
  biome: number
  active: boolean
}

/** Un obstacle prévu sur la piste : à quelle distance, quelle ligne, quel type */
export interface PlannedObstacle {
  d: number
  lane: number
  kind: Kind
}

/**
 * Un rouleau posé sur la piste : juste une POSITION. Son contenu n'est PAS
 * décidé ici — il est tiré au ramassage, propre à chacun (cf. tirerParchemin).
 */
export interface PlannedParchemin {
  d: number
  lane: number
}

interface Rouleau {
  mesh: THREE.Group
  active: boolean
}

/**
 * ————— Les jarres : les cibles du combat —————
 * `vide` ne donne que de l'élan et un maillon de chaîne ; `doree` cache un
 * parchemin. Comme tout naît de la graine partagée, les deux joueurs voient
 * les MÊMES jarres : la dorée devient un point de friction — on ne court plus
 * seulement contre le chrono, on se bat pour un objet que l'autre convoite.
 */
export type JarreKind = 'vide' | 'doree' | 'verte'

/**
 * 🟢 Le pot vert : la trouvaille. Il donne des Mon, entre 1 et 10.
 *
 * Deux au maximum par course, et rarement tirés — voir buildJarrePlan. Ces deux
 * chiffres tiennent l'économie du jeu : ils sont ici, côte à côte, pour qu'on ne
 * puisse pas en changer un en oubliant l'autre.
 */
export const POTS_VERTS_MAX = 2
/**
 * La rareté, écrite en clair. Un seul tirage `de` les départage :
 *   de < 0,03            → deux pots   (3 % des courses)
 *   de < 0,20            → un pot      (17 %)
 *   sinon                → aucun       (80 %)
 * Quatre courses sur cinq n'en voient donc aucun — c'est ce qui rend le vert
 * remarquable quand il apparaît.
 */
export const CHANCE_DEUX_POTS = 0.03
export const CHANCE_UN_POT = 0.2

/**
 * ————— Ce que le pot contient —————
 *
 * Une fois sur cinq, du JADE plutôt que des pièces. Le jade est la monnaie rare
 * du jeu : trouver un pot est déjà peu fréquent (une course sur cinq), et un
 * pot sur cinq porte du jade — soit une course sur vingt-cinq environ. C'est ce
 * cumul qui en fait un vrai événement, et non le chiffre pris isolément.
 *
 * Le jade se compte plus petit (1 à 6) que les pièces (1 à 10) : une monnaie
 * rare qui tomberait par poignées ne serait plus rare, juste renommée.
 */
export const CHANCE_JADE = 0.2
export const MON_MAX = 10
export const JADE_MAX = 6

export interface PlannedJarre {
  d: number
  lane: number
  kind: JarreKind
  /** Ce que la dorée recèle (ignoré pour une jarre vide) */
  parchemin: ParcheminKind
  /** Ce que le pot vert recèle (ignoré pour les autres sortes) */
  tresor?: Tresor
}

/**
 * ————— Ce qu'on trouve dans un pot vert —————
 *
 * Deux monnaies, et non une seule quantité : le jade est la monnaie rare du
 * jeu, il ne se compte pas dans la même unité que les pièces. Un pot donne
 * l'une OU l'autre, jamais les deux — sinon « rare » ne veut plus rien dire,
 * puisqu'on en aurait à chaque fois.
 */
export interface Tresor {
  monnaie: 'mon' | 'hisui'
  quantite: number
}

interface Jarre {
  mesh: THREE.Group
  kind: JarreKind
  parchemin: ParcheminKind
  tresor: Tresor | null
  active: boolean
}

/**
 * ————— Les murs qu'on longe —————
 * Des pans de mur bordent la piste par tronçons. On s'y accroche depuis la
 * voie extérieure, on y court quelques instants à l'abri des obstacles, et on
 * en repart avec un saut réarmé.
 *
 * C'est une ROUTE, pas un raccourci : on n'y gagne pas de vitesse, on y gagne
 * un passage sûr et un tremplin. Le prix, c'est de devoir se coller au bord —
 * donc renoncer aux jarres et aux sillages du centre.
 */
export interface PlannedMur {
  d: number // où il commence
  longueur: number
  /** -1 = à gauche de la piste, +1 = à droite */
  cote: -1 | 1
}

interface Mur {
  mesh: THREE.Object3D
  /** Recyclé par biome : un mur de bambou ne se réincarne pas en congère. */
  biome: number
  active: boolean
}

/**
 * ————— Les plateformes : les « trains » —————
 *
 * De longues structures sur lesquelles on ATTERRIT et on court, à la manière
 * des wagons de Subway Surfers. C'est le seul élément de la piste qui change la
 * hauteur du sol.
 *
 * Elles répondent à la question que les obstacles ne posaient pas : jusqu'ici
 * sauter servait uniquement à ÉVITER. Ici sauter sert à ALLER quelque part —
 * en hauteur on est à l'abri de tout ce qui traîne au sol, et une seconde
 * plateforme plus haute peut prolonger la route en l'air.
 *
 * Le marché, tel que décidé : c'est un RACCOURCI RISQUÉ. On y gagne un passage
 * sûr ; on y perd si l'on rate le saut, puisqu'on percute alors le flanc.
 */
export interface PlannedPlateforme {
  d: number // où elle commence (le bord qu'on atteint en premier)
  longueur: number
  lane: number
  hauteur: number
  /** Longueur de la rampe d'accès, en mètres. 0 = pas de rampe : il faut grimper. */
  rampe: number
}

interface Plateforme {
  mesh: THREE.Object3D
  /**
   * La rampe a SON maillage, jamais un enfant du plateau : celui-ci est étiré
   * en Z à la longueur du wagon, et un enfant hériterait de cet étirement — une
   * rampe de 6 m deviendrait une rampe de 25 m.
   */
  rampe: THREE.Mesh
  plan: PlannedPlateforme
  biome: number
  active: boolean
}

/** Largeur d'une plateforme : une ligne, exactement comme un obstacle. */
export const PLATEFORME_LARG = 2.15
/**
 * La hauteur d'une plateforme : **2,70 m**.
 *
 * Ce n'est pas un chiffre décoratif, c'est la règle du jeu tout entière. À
 * JUMP_SPEED = 13,2 et g = 42, l'apex du saut vaut 13,2² / 84 = **2,07 m**.
 * Yasuke ne peut donc PAS sauter sur une plateforme.
 *
 * Il ne lui reste que deux façons de monter :
 *  · la RAMPE, quand il y en a une — on court dessus, c'est gratuit ;
 *  · l'ESCALADE, sinon — on lui rentre dedans et on passe par-dessus, en
 *    payant une seconde pleine.
 *
 * ⚠️ **2,70 m est un PLAFOND, pas un chiffre libre.** Hana (saut ×1,18) culmine
 * à 2,89 m, pieds à 2,94 m : elle est la seule du roster à pouvoir se poser
 * directement sur une plateforme, et c'est précisément ce qui donne une raison
 * de la choisir. Il ne reste que 24 cm de marge. Monter à 3 m ne rendrait pas
 * les plateformes « plus hautes » — ça effacerait le passif de Hana.
 *
 * ⚠️ Et ce n'est plus `TAILLE_OBSTACLE.mur.haut`, dont elle était recopiée.
 * Les deux valeurs répondaient à deux questions différentes qui se trouvaient
 * avoir la même réponse : l'obstacle `mur` est calé sur le saut de Yasuke (il
 * doit être infranchissable), la plateforme sur celui de Hana (elle doit être
 * atteignable par elle seule). Les garder liées aurait fait bouger la
 * calibration du saut en voulant simplement surélever les wagons.
 */
export const PLATEFORME_H = 2.7

/**
 * Un élément de bordure (touffe de bambous, masure en flammes, rocher…).
 * Il ne touche à RIEN : pas de collision, pas de réseau. C'est du paysage pur —
 * ce qui veut dire qu'on peut en mettre beaucoup sans rien risquer.
 *
 * On recycle PAR BIOME (`biome`), comme les obstacles le font par type : une
 * touffe de bambous ne peut pas se réincarner en rocher enneigé.
 */
interface Decor {
  mesh: THREE.Group
  biome: number
  active: boolean
}

/**
 * Un tronçon de barrière. Recyclé par biome, comme le décor.
 *
 * Pas besoin de retenir son côté : contrairement au décor, la barrière est
 * bâtie autour de x = 0 et donc symétrique — la même pièce va à gauche comme
 * à droite sans retournement.
 */
interface Barriere {
  mesh: THREE.Group
  biome: number
  active: boolean
}


/**
 * Générateur de nombres pseudo-aléatoires AVEC GRAINE (algorithme mulberry32).
 * Même graine → même suite de nombres → même piste pour les deux joueurs.
 * C'est LA clé du multijoueur équitable !
 */
export function mulberry32(seed: number) {
  return function () {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * La piste : le sol, les pointillés qui défilent (sensation de vitesse),
 * les torii décoratifs, la ligne d'arrivée et surtout les obstacles.
 */
export class Track {
  private scene: THREE.Scene
  private obstacles: Obstacle[] = []
  /** Le ruban de pointillés, soudé en un seul maillage (cf. constructeur). */
  private pointilles: THREE.Mesh
  private toriis: THREE.Group[] = []
  private finish: THREE.Group // la ligne d'arrivée : le torii sacré
  private plan: PlannedObstacle[] = [] // tous les obstacles de la course, décidés à l'avance
  private planIdx = 0 // le prochain obstacle à faire apparaître
  private rouleaux: Rouleau[] = []
  private parcheminPlan: PlannedParchemin[] = []
  private parcheminIdx = 0
  private tempsRouleaux = 0 // horloge d'animation des rouleaux (rotation, flottement)
  private jarres: Jarre[] = []
  private jarrePlan: PlannedJarre[] = []
  private jarreIdx = 0
  private murs: Mur[] = []
  private murPlan: PlannedMur[] = []
  private murIdx = 0
  private plateformes: Plateforme[] = []
  private plateformePlan: PlannedPlateforme[] = []
  private plateformeIdx = 0
  /**
   * Ce que LISENT les bots : les obstacles, plus les plateformes converties en
   * murs fictifs. Un bot n'a pas de boîte de collision — sans ça, il traverserait
   * un wagon de part en part sous les yeux du joueur.
   */
  private planBots: PlannedObstacle[] = []
  private courseLength = 0

  // ————— Les biomes —————
  private decors: Decor[] = []
  private barrieres: Barriere[] = []
  /** Où poser le prochain tronçon de barrière. 0 = pas encore commencé. */
  private prochaineBarriere = 0
  /** La prochaine distance où planter du décor (indépendante par côté). */
  private prochainDecor = 0
  /**
   * Le compteur du HORS-COURSE (menu, écran de fin), où `distance` n'existe pas.
   * La course, elle, ne s'en sert jamais : elle a sa distance réelle.
   */
  private odo = 0
  /** Étions-nous en course à l'image précédente ? (pour resemer au bon moment) */
  private enCoursePrec = false
  private graineDecor: () => number = () => 0.5
  /** Les matériaux qu'on repeint au fil des biomes. */
  private matSol: THREE.MeshStandardMaterial
  /** Le sol du biome vers lequel on va, qu'on fait apparaître par-dessus. */
  private matSolHaut: THREE.MeshStandardMaterial
  /**
   * Le sol de FORÊT : le monde au-delà de la piste, 260 m de large.
   * Sans lui, tout le décor planté au-delà de 7 m flottait au-dessus du vide.
   */
  private matSolForet: THREE.MeshStandardMaterial
  /** Les copies de texture du sol de forêt, une par biome (cf. texForet). */
  private texturesForet = new Map<number, THREE.Texture | null>()
  /** Le défilement de la matière du sol, en tuiles. Gardé dans [0, 1[. */
  private defileSol = 0
  private matLigne: THREE.MeshBasicMaterial
  private brume: THREE.Fog
  private fond: THREE.Color

  constructor(scene: THREE.Scene) {
    this.scene = scene

    /*
     * La brume appartient à la PISTE, pas à la scène de main.ts.
     *
     * C'est elle qui porte l'identité de chaque biome — sa couleur EST le ciel,
     * puisqu'on ne voit jamais l'horizon. La piste sait où l'on se trouve sur la
     * course ; elle est donc la seule à pouvoir la repeindre au bon moment.
     * main.ts n'a rien à savoir de tout ça.
     */
    this.brume = new THREE.Fog(BIOMES[0].brume, BIOMES[0].brumeNear, BIOMES[0].brumeFar)
    scene.fog = this.brume

    /*
     * Le fond de scène suit la brume à l'identique — et ce n'est pas un détail.
     *
     * Là où la brume s'achève (brumeFar), tout est déjà de sa couleur ; si le
     * fond en avait une autre, on verrait une ligne d'horizon nette barrer
     * l'écran. En les gardant égaux, le décor se dissout dans le vide sans
     * couture, et la piste semble n'avoir pas de fin.
     */
    this.fond = new THREE.Color(BIOMES[0].brume)
    scene.background = this.fond

    /*
     * ————— Le sol : DEUX plans superposés —————
     *
     * Un seul aurait suffi pour la couleur, qui se mélange toute seule. Mais
     * chaque biome a désormais une MATIÈRE (`texSol`), et une matière ne se
     * mélange pas : on ne passe pas de la litière de bambou aux cendres par
     * interpolation. Échanger la texture d'un coup, sur la surface qui occupe
     * la moitié de l'écran et défile sous les pieds, se verrait claquer.
     *
     * D'où la superposition : le plan du DESSOUS porte le biome qu'on quitte,
     * celui du DESSUS le biome où l'on va, et son opacité monte de 0 à 1 le
     * long du fondu. Deux appels de dessin pour un vrai fondu enchaîné — et
     * hors transition, le plan du dessus est simplement éteint.
     */
    this.matSol = new THREE.MeshStandardMaterial({ color: BIOMES[0].sol, roughness: 1 })
    this.matSolHaut = new THREE.MeshStandardMaterial({
      color: BIOMES[0].sol,
      roughness: 1,
      transparent: true,
      opacity: 0,
      // Il est collé au plan du dessous : sans ça, les deux se disputent le
      // tampon de profondeur et le sol se met à grésiller sur toute sa surface.
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    })
    const geoSol = new THREE.PlaneGeometry(LARGEUR_SOL, 240)
    for (const m of [this.matSol, this.matSolHaut]) {
      const g = new THREE.Mesh(geoSol, m)
      g.rotation.x = -Math.PI / 2
      g.position.z = -90
      g.renderOrder = m === this.matSol ? 0 : 1
      scene.add(g)
    }
    this.matSolHaut.visible = false

    /*
     * ————— LE SOL DE FORÊT : le monde au-delà de la piste —————
     *
     * ⚠️ Le sol de la piste ne fait que 14 m de large — sept mètres de part et
     * d'autre du centre. Or le décor est planté jusqu'à 28 m. Tout ce qui
     * dépassait flottait donc AU-DESSUS DU VIDE, et entre deux tiges on ne
     * voyait pas de la forêt mais le néant : ni sol, ni horizon.
     *
     * C'était ça, le fond de l'affaire. Trois passes à ajouter des bambous n'y
     * pouvaient rien — le problème n'était pas ce qu'on plantait, c'était qu'il
     * n'y avait pas de terre sous les pieds. Un massif dense au-dessus du vide
     * reste un massif au-dessus du vide.
     *
     * D'où ce second plan, 260 m de large : il porte toute la forêt et va se
     * perdre dans la brume, ce qui crée enfin une ligne d'horizon. Il est posé
     * 3 cm plus bas pour ne jamais se disputer la profondeur avec la piste, et
     * garde son propre matériau — la piste, elle, appartient au chantier des
     * textures et reste intacte.
     *
     * Coût : UN appel de dessin pour tout le monde au-delà de la piste.
     */
    this.matSolForet = new THREE.MeshStandardMaterial({ color: BIOMES[0].sol, roughness: 1 })
    const foret = new THREE.Mesh(new THREE.PlaneGeometry(260, 300), this.matSolForet)
    foret.rotation.x = -Math.PI / 2
    foret.position.set(0, -0.03, -110)
    foret.renderOrder = -1 // toujours dessiné avant la piste
    scene.add(foret)

    /*
     * Les quatre matières sont peintes MAINTENANT, au chargement.
     *
     * Les créer à la demande semblait plus économe, mais ça revenait à peindre
     * un canvas et à téléverser une texture au moment exact où le joueur entre
     * dans un nouveau biome — un à-coup, en pleine course, à chaque frontière.
     * Quatre tuiles de 256², c'est ~1 Mo : on paie d'avance, une fois.
     */
    for (const b of BIOMES) b.texSol?.()

    /*
     * Les repères entre les lignes → la sensation de vitesse.
     *
     * Ils étaient 60 maillages indépendants qui défilaient chacun leur tour :
     * à eux seuls, plus du tiers du budget d'appels de dessin d'un téléphone.
     * Ils sont désormais SOUDÉS en un seul, qu'on fait glisser d'un bloc.
     *
     * Le motif se répète tous les 6 m : ramener la position dans [0, 6[ suffit
     * donc à donner un ruban infini, sans que rien ne saute à l'œil.
     *
     * ⚠️ Ce sont des DALLES, plus des traits — et le changement n'est pas
     * cosmétique. Deux bandes fines, longues, parfaitement alignées et
     * régulièrement espacées, c'est le dessin exact d'un marquage routier :
     * quel que soit le décor planté autour, l'œil lisait « route ». Des pierres
     * de gué larges, courtes, décalées et de travers disent « chemin » tout en
     * gardant EXACTEMENT la même fonction — borner les lignes et donner le
     * défilement.
     *
     * Leur irrégularité vient de la couleur par sommet : la variété ne coûte
     * donc rien, tout reste soudé en un seul maillage.
     */
    this.matLigne = new THREE.MeshBasicMaterial({ color: BIOMES[0].ligne, vertexColors: true })
    const traits: THREE.BufferGeometry[] = []
    // Un tirage FIXE : les dalles doivent être posées pareil pour les 2 joueurs
    // (et d'une partie à l'autre — un chemin ne se redessine pas).
    let graine = 0x1f2e3d
    const r = () => {
      graine = (graine * 1664525 + 1013904223) >>> 0
      return graine / 4294967296
    }
    for (let i = 0; i < 30; i++) {
      // Deux dalles par période plutôt qu'une : le pas est plus court, donc le
      // défilement plus lisible, sans que la ligne redevienne continue.
      for (const dz of [0, PAS_POINTILLE / 2]) {
        // À MI-CHEMIN entre deux lignes : les dalles bornent les couloirs, donc
        // elles suivent l'écartement. Restées à ±1,1 m, elles auraient marqué
        // des couloirs plus étroits que ceux où l'on court vraiment.
        for (const x of [-ECART_LIGNE / 2, ECART_LIGNE / 2]) {
          const t = new THREE.PlaneGeometry(0.34 + r() * 0.2, 0.42 + r() * 0.26)
          t.rotateX(-Math.PI / 2)
          t.rotateY((r() - 0.5) * 0.7) // de travers : posée à la main
          t.translate(
            x + (r() - 0.5) * 0.14, // et jamais tout à fait alignée
            0.012,
            -i * PAS_POINTILLE - dz + (r() - 0.5) * 0.5
          )
          // La teinte de chaque dalle : de la pierre usée, pas de la peinture.
          const v = 0.66 + r() * 0.42
          const n = t.getAttribute('position').count
          const couleurs = new Float32Array(n * 3)
          for (let k = 0; k < n * 3; k++) couleurs[k] = v
          t.setAttribute('color', new THREE.BufferAttribute(couleurs, 3))
          traits.push(t)
        }
      }
    }
    this.pointilles = new THREE.Mesh(mergeGeometries(traits, false)!, this.matLigne)
    for (const t of traits) t.dispose()
    scene.add(this.pointilles)

    // Des torii rouges enjambent la piste (décor, pas de collision)
    for (let i = 0; i < 3; i++) {
      const t = makeTorii()
      t.position.z = -40 - i * 70
      this.toriis.push(t)
      scene.add(t)
    }

    // Le torii SACRÉ : la ligne d'arrivée, tout en or
    this.finish = makeFinishGate()
    this.finish.position.z = -99999 // caché tant que la course n'a pas commencé
    scene.add(this.finish)
  }

  /**
   * Prépare une nouvelle course de `length` mètres à partir d'une graine.
   * En multi, la graine vient du serveur : les deux joueurs ont LA MÊME piste.
   */
  reset(length: number, seed: number) {
    for (const o of this.obstacles) {
      o.active = false
      o.mesh.visible = false
    }
    for (const r of this.rouleaux) {
      r.active = false
      r.mesh.visible = false
    }
    for (const j of this.jarres) {
      j.active = false
      j.mesh.visible = false
    }
    this.courseLength = length
    this.finish.position.z = -length
    /*
     * ⚠️ LES PLATEFORMES D'ABORD. L'ordre est le cœur du réglage.
     *
     * Elles occupent une ligne entière sur 15 à 25 m ; les obstacles, eux, se
     * faufilent partout. Générer les obstacles en premier ne laissait jamais
     * assez de place, et plafonnait la densité à 7 plateformes par course quoi
     * qu'on demande. En les posant d'abord, ce sont les obstacles qui se rangent
     * autour — et buildPlan garantit qu'il reste toujours une ligne libre.
     *
     * Tout le reste (jarres, rouleaux) vient ensuite et les évite : on les
     * traduit en obstacles fictifs (`commeObstacles`) pour réutiliser telles
     * quelles les recherches de ligne libre déjà éprouvées.
     */
    this.plateformePlan = buildPlateformePlan(length, seed)
    this.plateformeIdx = 0
    this.plan = buildPlan(length, seed, this.plateformePlan)
    this.planIdx = 0
    const occupe = [...this.plan, ...commeObstacles(this.plateformePlan)]
    this.planBots = occupe

    // Les rouleaux sont places APRES les obstacles : ils doivent s'en ecarter
    this.parcheminPlan = buildParcheminPlan(length, seed, occupe)
    this.parcheminIdx = 0
    this.jarrePlan = buildJarrePlan(length, seed, occupe)
    this.jarreIdx = 0
    for (const p of this.plateformes) {
      p.active = false
      p.mesh.visible = false
      p.rampe.visible = false
    }
    for (const m of this.murs) {
      m.active = false
      m.mesh.visible = false
    }
    this.murPlan = buildMurPlan(length, seed)
    this.murIdx = 0

    // Le décor : même graine décalée que le reste, donc même paysage pour tous.
    // Ça n'a aucune incidence sur le jeu, mais parler d'une course commune (« la
    // masure en feu juste avant le pont ») demande qu'on ait vu la même chose.
    for (const dec of this.decors) {
      dec.active = false
      dec.mesh.visible = false
    }
    this.graineDecor = mulberry32(seed ^ 0x1c4e9f23)
    this.prochainDecor = 0

    // Les barrières se resèment aussi : leur découpe dépend de `murPlan`, qui
    // vient d'être retiré au sort. Les garder en l'état laisserait des tronçons
    // en travers des murs de la NOUVELLE course.
    for (const b of this.barrieres) {
      b.active = false
      b.mesh.visible = false
    }
    this.prochaineBarriere = 0
  }

  /**
   * Le pan de mur qui borde la piste ICI, de ce côté — ou null.
   * Sert à savoir si l'on peut s'y accrocher, et quand il se termine.
   */
  murA(distance: number, cote: number): PlannedMur | null {
    for (const m of this.murPlan) {
      if (m.cote !== cote) continue
      if (distance >= m.d && distance < m.d + m.longueur) return m
    }
    return null
  }

  /**
   * Le plan complet de la course. Les bots le LISENT pour esquiver : ils ne
   * voient pas la piste, ils la connaissent — comme un pilote son circuit.
   */
  obstaclesPrevus(): readonly PlannedObstacle[] {
    return this.planBots
  }

  /** Le plan des plateformes — pour les tests et le débogage. */
  plateformesPrevues(): readonly PlannedPlateforme[] {
    return this.plateformePlan
  }

  /**
   * Que trouve-t-on sous le joueur ? Renvoie la hauteur du sol et, le cas
   * échéant, le fait qu'on soit en train de PERCUTER un flanc.
   *
   * Toute la mécanique du « train » tient ici :
   *  · les pieds au-dessus du plateau (à 30 cm près) → il nous porte ;
   *  · les pieds en dessous → on lui rentre dedans, et c'est un trébuchement.
   *
   * Les 30 cm de tolérance ne sont pas de la générosité gratuite : sans eux, on
   * heurterait le flanc pour un pixel de retard alors qu'on est visiblement en
   * train d'atterrir dessus. Ils sont pris SOUS le plateau, donc ils ne
   * permettent jamais de monter sans sauter — 1,6 m reste 1,6 m.
   */
  /**
   * Le flanc de plateforme qu'on peut agripper depuis la ligne `lane` en
   * swipant vers `cote` — ou null.
   *
   * On n'escalade un mur que de FACE. Vu de côté, une plateforme est une paroi
   * comme celles qui bordent la piste : on s'y accroche et on la longe. C'est
   * ce qui donne une troisième réponse au convoi, à côté de « prendre la rampe »
   * et « payer l'escalade » — et la seule qui demande du geste.
   *
   * Renvoie l'abscisse exacte du flanc, pour que le corps s'y colle vraiment.
   *
   * `pieds` est la hauteur du joueur. Au-dessus du plateau il n'y a plus de
   * flanc du tout : c'est un SOL, on marche dessus. Le paramètre sert donc à
   * deux choses d'un coup — ne pas s'accrocher à une paroi qu'on survole, et
   * savoir que le flanc BLOQUE quand on est dessous (cf. les swipes dans
   * main.ts : on ne se glisse pas de côté dans une masse pleine).
   */
  flancA(lane: number, cote: number, pieds = 0): number | null {
    const cible = lane + cote
    if (cible < 0 || cible > 2) return null
    for (const p of this.plateformes) {
      if (!p.active || p.plan.lane !== cible) continue
      // Même tolérance que `supportSous` : au-dessus, le plateau porte.
      if (pieds >= p.plan.hauteur - 0.3) continue
      const zAvant = p.mesh.userData.zAvant as number
      // Il faut être le long du plateau, pas devant son nez : arriver sur le
      // bord avant, c'est une rencontre de face, donc une escalade.
      if (zAvant < 1 || zAvant > p.plan.longueur) continue
      return LANES[cible] - cote * (PLATEFORME_LARG / 2)
    }
    return null
  }

  /**
   * 🎋 Cette plateforme est-elle montée sur pilotis, ouverte dessous ?
   *
   * Le biome d'une plateforme se déduit de sa distance — c'est déjà comme ça
   * qu'on choisit son apparence (cf. spawnPlateforme). On lit donc la MÊME
   * source : impossible qu'un radeau se dessine ajouré tout en se comportant
   * comme un bloc plein.
   */
  private ajouree(d: number): boolean {
    return BIOMES[indexBiome(d, this.courseLength)].plateformeAjouree === true
  }

  supportSous(x: number, pieds: number): { sol: number; heurte: boolean } {
    let sol = 0
    let heurte = false
    for (const p of this.plateformes) {
      if (!p.active) continue
      if (Math.abs(x - LANES[p.plan.lane]) > PLATEFORME_LARG / 2) continue

      // Le joueur est en z = 0 ; le bord avant du plateau est en `zAvant`, et
      // le plateau s'étend de là vers l'avant (z décroissant).
      const zAvant = p.mesh.userData.zAvant as number

      /*
       * ————— La rampe —————
       * Elle occupe les `rampe` mètres AVANT le plateau, et monte du sol
       * jusqu'à lui. On y est porté à hauteur proportionnelle : c'est ce qui
       * permet d'arriver en haut en courant, sans jamais sauter.
       *
       * Elle ne heurte jamais — une rampe qu'on percute n'aurait aucun sens.
       */
      const r = p.plan.rampe
      if (r > 0 && zAvant <= 0 && 0 <= zAvant + r) {
        sol = Math.max(sol, (p.plan.hauteur * (zAvant + r)) / r)
        continue
      }

      if (zAvant < -0.2 || zAvant > p.plan.longueur + 0.2) continue

      if (pieds >= p.plan.hauteur - 0.3) {
        // On garde la PLUS HAUTE : deux plateaux peuvent se chevaucher d'un
        // cheveu au moment où l'on passe de l'un à l'autre.
        sol = Math.max(sol, p.plan.hauteur)
      } else if (!this.ajouree(p.plan.d)) {
        // Les pieds sous le plateau : on lui rentre dedans. À 2,40 m, c'est
        // forcément le cas quand il n'y a pas de rampe — d'où l'escalade.
        //
        // ⚠️ Volontairement vrai sur TOUTE la longueur, et pas seulement devant
        // le nez : on peut très bien changer de ligne au sol à mi-plateau, et il
        // faut alors escalader comme partout ailleurs. Restreindre au nez ferait
        // TRAVERSER le plateau dans ce cas.
        heurte = true
      }
      /*
       * 🎋 Sous un radeau de bambou, en revanche, ON PASSE — il est monté sur
       * pilotis et son dessin l'annonce. Le bloquer revenait à démentir ce
       * qu'on voit, et à fermer le seul passage bas de la course.
       */
    }
    return { sol, heurte }
  }

  /**
   * Le plan des rouleaux. Les bots le lisent aussi : ils ramassent en passant
   * dans la bonne ligne. Chacun a son propre exemplaire du parchemin — prendre
   * un rouleau ne le vole à personne, sinon le joueur devrait courir DERRIÈRE
   * les bots pour espérer un sort.
   */
  parcheminsPrevus(): readonly PlannedParchemin[] {
    return this.parcheminPlan
  }

  /**
   * Le premier MUR qui barre la ligne `lane` entre `d1` et `d2`, ou null.
   *
   * C'est le garde-fou du portail 🔮 Onmyōji : il file tout droit et meurt au
   * premier mur. Comme un mur bouche une ligne donnée environ 1 rangée sur 6 et
   * que les rangées tombent tous les 13 m, sa portée s'auto-limite à quelques
   * dizaines de mètres. La piste fait la règle — pas un plafond arbitraire.
   */
  premierMur(lane: number, d1: number, d2: number): number | null {
    let plusProche: number | null = null
    for (const o of this.plan) {
      if (o.kind !== 'mur' || o.lane !== lane) continue
      if (o.d > d1 && o.d <= d2 && (plusProche === null || o.d < plusProche)) {
        plusProche = o.d
      }
    }
    return plusProche
  }

  /**
   * La première plateforme PLEINE qui barre cette ligne entre `d1` et `d2`.
   *
   * 🎋 Les radeaux ajourés sont ignorés : ils tiennent sur pilotis, et un
   * projectile file dessous comme un coureur y passe. Sans cette exception,
   * l'arme la plus lente du jeu aurait été arrêtée par du vide.
   */
  premierePlateforme(lane: number, d1: number, d2: number): number | null {
    let plusProche: number | null = null
    for (const p of this.plateformePlan) {
      if (p.lane !== lane || this.ajouree(p.d)) continue
      if (p.d > d1 && p.d <= d2 && (plusProche === null || p.d < plusProche)) {
        plusProche = p.d
      }
    }
    return plusProche
  }

  /**
   * Ce qui arrête un projectile dans cette ligne : un mur ou une plateforme
   * pleine, le plus proche des deux.
   *
   * Les sorts ne consultaient que les murs et TRAVERSAIENT les plateformes —
   * un kunaï passait au travers d'un wagon massif. C'est ici qu'on répare, en
   * un seul endroit, pour que tout ce qui vole obéisse à la même piste.
   */
  premierBarrage(lane: number, d1: number, d2: number): number | null {
    const mur = this.premierMur(lane, d1, d2)
    const pf = this.premierePlateforme(lane, d1, d2)
    if (mur === null) return pf
    if (pf === null) return mur
    return Math.min(mur, pf)
  }

  /**
   * Fait défiler le décor. `distance` = mètres parcourus par le joueur
   * (omise au menu : décor seul, pas d'obstacles ni d'arrivée).
   */
  /**
   * Repeint et fait défiler le sol.
   *
   * Deux choses s'y jouent :
   *
   *  · le FONDU — plan du dessous = biome qu'on quitte, plan du dessus = biome
   *    où l'on va, opacité = avancement. Hors transition, le dessus est éteint
   *    et l'on ne paie qu'un seul plan ;
   *  · le DÉFILEMENT — la matière glisse vers le joueur au rythme exact de sa
   *    course. C'est ce qui empêche le sol d'avoir l'air d'un tapis peint sur
   *    lequel les dalles glisseraient toutes seules : sans lui, les seuls
   *    éléments qui bougeaient étaient les dalles, et l'œil le voyait.
   */
  private appliqueSol(amb: Ambiance, dz: number) {
    const A = BIOMES[amb.iA]
    const B = BIOMES[amb.iB]

    // En mètres, et borné : au bout de 1 920 m un flottant simple commence à
    // perdre des décimales, et le défilement se met à saccader.
    this.defileSol = (this.defileSol + dz) % 4096

    const pose = (mat: THREE.MeshStandardMaterial, b: typeof A) => {
      mat.color.setHex(b.sol)
      const tex = b.texSol?.() ?? null
      if (mat.map !== tex) {
        mat.map = tex
        // Passer de « pas de texture » à « texture » change le shader : sans
        // ça, le changement ne se voit qu'au prochain recalcul du matériau.
        mat.needsUpdate = true
      }
      if (tex) {
        const tuile = b.tuileSol ?? 4
        tex.repeat.set(LARGEUR_SOL / tuile, 240 / tuile)
        // `repeat` étant déjà appliqué, un mètre de course vaut 1/tuile
        // d'unité de décalage — indépendamment de la longueur du plan.
        tex.offset.y = (this.defileSol / tuile) % 1
      }
    }

    pose(this.matSol, A)

    // Le plan du dessus ne sert QUE pendant le fondu.
    const enFondu = amb.melange > 0.002 && amb.iA !== amb.iB
    this.matSolHaut.visible = enFondu
    if (enFondu) {
      pose(this.matSolHaut, B)
      this.matSolHaut.opacity = amb.melange
    }

    /*
     * ————— Le sol de forêt : plus CLAIR que la brume, et texturé —————
     *
     * ⚠️ Deux erreurs corrigées ici, et la première était grossière.
     *
     * 1. IL ÉTAIT PLUS SOMBRE QUE LE FOND. Je l'avais assombri (×0,62) en me
     *    disant qu'un sous-bois est à l'ombre — en oubliant que la couleur de
     *    la brume EST l'arrière-plan. Mesuré : luminance 0,0160 contre 0,0233
     *    pour la brume. Tout ce qui est plus sombre que le fond ne se lit pas
     *    comme une surface mais comme un TROU. On avait donc bien ajouté un
     *    sol, et il ressemblait toujours à du vide.
     *
     *    Il est maintenant légèrement plus clair (×1,08) : une surface qui
     *    accroche le clair de lune et s'enfonce dans la brume.
     *
     * 2. UN APLAT NE PEUT PAS SE LIRE COMME UN SOL. Sans le moindre détail,
     *    l'œil n'a aucun repère de distance ni d'échelle. Il reprend donc la
     *    matière du biome — la même que la piste, mais sur sa propre copie de
     *    texture : `repeat` et `offset` sont portés par l'objet Texture, et
     *    partager celui de la piste ferait que chacun écraserait le réglage de
     *    l'autre à chaque image.
     *
     * La piste, elle, reste lisible par sa texture propre et ses pointillés —
     * pas par un contraste d'obscurité.
     */
    const F = amb.melange > 0.5 ? B : A
    this.matSolForet.color.copy(amb.sol).multiplyScalar(1.08)
    const texF = this.texForet(amb.melange > 0.5 ? amb.iB : amb.iA, F)
    if (this.matSolForet.map !== texF) {
      this.matSolForet.map = texF
      this.matSolForet.needsUpdate = true
    }
    if (texF) {
      const tuile = (F.tuileSol ?? 4) * 3 // plus grosses mailles : on la voit de loin
      texF.repeat.set(260 / tuile, 300 / tuile)
      texF.offset.y = (this.defileSol / tuile) % 1
    }
  }

  /**
   * La copie de texture réservée au sol de forêt, une par biome.
   *
   * ⚠️ On CLONE plutôt que de réutiliser celle de la piste : `repeat` et
   * `offset` vivent sur l'objet Texture, pas sur le matériau. Deux surfaces de
   * tailles différentes qui partagent une texture se battraient pour ces deux
   * valeurs à chaque image. Le clone partage l'image (donc rien de plus en
   * mémoire vidéo) mais garde ses propres réglages.
   */
  private texForet(i: number, b: (typeof BIOMES)[number]): THREE.Texture | null {
    const dejaLa = this.texturesForet.get(i)
    if (dejaLa !== undefined) return dejaLa
    const source = b.texSol?.() ?? null
    const copie = source ? source.clone() : null
    if (copie) copie.needsUpdate = true
    this.texturesForet.set(i, copie)
    return copie
  }

  update(dt: number, speed: number, distance = -1) {
    const dz = speed * dt // tout le décor avance de dz vers le joueur

    // Le ruban de pointillés glisse d'un bloc, et se recale tous les 6 m.
    this.pointilles.position.z = (this.pointilles.position.z + dz) % PAS_POINTILLE

    for (const t of this.toriis) {
      t.position.z += dz
      if (t.position.z > 12) t.position.z -= 210
    }

    for (const o of this.obstacles) {
      if (!o.active) continue
      o.mesh.position.z += dz
      if (o.mesh.position.z > DESPAWN_Z) {
        o.active = false
        o.mesh.visible = false
      }
    }

    // Les rouleaux tournent et flottent : impossible de les rater du regard
    this.tempsRouleaux += dt
    for (const r of this.rouleaux) {
      if (!r.active) continue
      r.mesh.position.z += dz
      r.mesh.rotation.y = this.tempsRouleaux * 2.2
      r.mesh.position.y = 1.15 + Math.sin(this.tempsRouleaux * 3) * 0.12
      if (r.mesh.position.z > DESPAWN_Z) {
        r.active = false
        r.mesh.visible = false
      }
    }

    // Les jarres restent posées au sol : rien ne bouge, seule la dorée pivote
    // lentement et RESPIRE pour se signaler de loin. Le battement n'est pas de
    // la décoration : c'est le seul mouvement de la piste qui dise « celle-ci
    // vaut le détour », et il se repère du coin de l'œil, en pleine course.
    for (const j of this.jarres) {
      if (!j.active) continue
      j.mesh.position.z += dz
      if (j.kind === 'doree' || j.kind === 'verte') {
        j.mesh.rotation.y = this.tempsRouleaux * 1.1
        const battement = 1 + Math.sin(this.tempsRouleaux * 3.4) * 0.14
        // Les pièces lumineuses sont nommées, pas comptées : le pot vert en a
        // une de plus, et un rang codé en dur animerait la mauvaise.
        const halo = j.mesh.userData.halo as THREE.Mesh | undefined
        halo?.scale.setScalar(battement)
        // Le rayon respire en INTENSITÉ, pas en taille : le mettre à l'échelle
        // l'allongerait aussi, et une colonne de lumière qui grandit vers le
        // ciel se lit comme un sort qu'on lance, pas comme un objet à ramasser.
        for (const cle of ['rayon', 'aura'] as const) {
          const m = j.mesh.userData[cle] as THREE.Mesh | undefined
          if (!m) continue
          const mat = m.material as THREE.MeshBasicMaterial
          mat.opacity = (m.userData.op as number) * battement
        }
      }
      if (j.mesh.position.z > DESPAWN_Z) {
        j.active = false
        j.mesh.visible = false
      }
    }

    // Les pans de mur défilent comme le reste du décor
    for (const m of this.murs) {
      if (!m.active) continue
      m.mesh.position.z += dz
      if (m.mesh.position.z > DESPAWN_Z + 60) {
        m.active = false
        m.mesh.visible = false
      }
    }

    // Les plateformes. On tient à jour `zAvant` — la position de leur bord
    // avant — parce que le maillage, lui, est centré : c'est le bord qui dit si
    // le joueur est dessus.
    for (const p of this.plateformes) {
      if (!p.active) continue
      p.mesh.position.z += dz
      p.rampe.position.z += dz
      p.mesh.userData.zAvant = (p.mesh.userData.zAvant as number) + dz
      if (p.mesh.userData.zAvant > DESPAWN_Z + p.plan.longueur) {
        p.active = false
        p.mesh.visible = false
        p.rampe.visible = false
      }
    }

    // Le décor de bordure. Il part plus loin derrière que le reste : un bambou
    // de 13 m de haut reste visible dans le rétroviseur bien après que la piste
    // l'ait dépassé, et le voir s'évaporer casserait l'illusion.
    for (const dec of this.decors) {
      if (!dec.active) continue
      dec.mesh.position.z += dz
      if (dec.mesh.position.z > DESPAWN_Z + 30) {
        dec.active = false
        dec.mesh.visible = false
      }
    }

    // Les barrières, elles, sont basses : passées derrière la caméra, plus
    // personne ne les voit. On les récupère aussitôt.
    for (const b of this.barrieres) {
      if (!b.active) continue
      b.mesh.position.z += dz
      if (b.mesh.position.z > DESPAWN_Z + LONG_BARRIERE) {
        b.active = false
        b.mesh.visible = false
      }
    }

    /*
     * ————— Le biome —————
     *
     * Hors course (menu, écran de fin), `distance` vaut -1 : on n'est nulle part
     * sur la piste. On retombe alors sur un compteur interne et sur le PREMIER
     * biome — le menu est la forêt de bambous, c'est-à-dire la ligne de départ.
     *
     * Ce n'est pas cosmétique : sans ça, la brume gardait la couleur du dernier
     * endroit traversé. Finir la course sur le Fuji laissait un menu tout blanc,
     * et l'apparence du jeu dépendait d'où s'était arrêtée la partie d'avant.
     */
    const enCourse = distance >= 0
    this.odo += speed * dt
    const parcouru = enCourse ? distance : this.odo

    /*
     * Course et menu comptent sur deux échelles sans rapport : la course part de
     * 0, le menu continue son compteur qui tourne depuis le chargement. Passer
     * de l'une à l'autre sans resemer laissait le prochain semis à 1 900 m alors
     * que le compteur du menu en était à 200 — et plus AUCUN décor n'apparaissait
     * jusqu'à ce qu'il rattrape. On repart donc de zéro à chaque bascule.
     */
    if (enCourse !== this.enCoursePrec) {
      this.enCoursePrec = enCourse
      this.prochainDecor = 0
      for (const dec of this.decors) {
        dec.active = false
        dec.mesh.visible = false
      }
      this.prochaineBarriere = 0
      for (const b of this.barrieres) {
        b.active = false
        b.mesh.visible = false
      }
    }

    // On repeint d'après la distance PARCOURUE, jamais par accumulation : si une
    // image saute ou si l'on rejoint une course en retard, la couleur est juste
    // malgré tout. Même principe que la ligne d'arrivée plus bas.
    const amb = enCourse ? ambianceA(distance, this.courseLength) : ambianceA(0, 1)
    this.brume.color.copy(amb.brume)
    this.brume.near = amb.brumeNear
    this.brume.far = amb.brumeFar
    /*
     * ————— Le fond de scène : ce qu'on prend pour le CIEL —————
     *
     * ⚠️ Il vaut la couleur de brume ÉCLAIRCIE, pas la couleur de brume.
     *
     * À l'identique, tout ce qui dépasse la portée de la brume se confondait
     * exactement avec le fond : plus aucune ligne d'horizon, plus aucune
     * différence entre « le ciel » et « la forêt au loin ». L'écran se
     * terminait en un aplat unique, et l'on avait beau planter des bambous et
     * poser un sol, il n'y avait toujours ni haut ni bas.
     *
     * × 1,45 suffit : la brume garde son rôle (fondre les lointains) mais le
     * ciel reste plus lumineux qu'elle. La cime des bambous s'y détache, et
     * la voûte de feuillage se lit enfin comme une voûte — quelque chose de
     * sombre DEVANT quelque chose de clair.
     */
    this.fond.copy(amb.brume).multiplyScalar(1.45)
    this.matLigne.color.copy(amb.ligne)
    this.appliqueSol(amb, dz)

    /*
     * ⚠️ Le décor est peint d'après le point où il APPARAÎT (parcouru +
     * LOOKAHEAD), pas d'après nos pieds : un bambou planté à 85 m devant alors
     * qu'on entre déjà dans le village nous arriverait dessus en pleine
     * fournaise. Le décor doit anticiper la frontière, les couleurs non.
     *
     * ⚠️ INDEXBIOME, PAS AMBIANCEA. `ambianceA(...).index` bascule au MILIEU
     * du fondu de couleur — à 90 % du biome — pour que le décor ait le temps de
     * changer avant que le sol finisse de changer de teinte. Utilisé ici, ça
     * faisait basculer le décor de la forêt vers le village **133 m avant la
     * vraie frontière** (mesuré par simulation) : la bambouseraie arrêtait de
     * pousser alors que le sol était encore vert à 100 %, laissant ~85 m sans
     * un seul bambou avant même que la couleur ait commencé à changer.
     *
     * indexBiome() est la frontière STRICTE, sans fondu : le décor ne bascule
     * qu'au moment où le point 85 m devant franchit VRAIMENT la ligne. Le
     * décalage résiduel (ces mêmes 85 m) est incompressible — c'est le prix de
     * planter le décor en avance pour qu'il ait le temps d'apparaître dans la
     * brume.
     */
    const devant = enCourse ? indexBiome(distance + LOOKAHEAD, this.courseLength) : 0
    const biome = BIOMES[devant]
    /*
     * ⚠️ Aucun offset au premier semis.
     *
     * `parcouru + 20` laissait 20 m totalement nus autour de la ligne de
     * départ — pile ce qu'on regarde en tournant la tête pendant le décompte.
     * Semer dès `parcouru - 10` (un peu derrière, pour couvrir ce qu'on voit
     * aussi en se retournant) fait exister la forêt dès le premier instant.
     */
    if (this.prochainDecor === 0) this.prochainDecor = parcouru - 10
    while (this.prochainDecor <= parcouru + LOOKAHEAD) {
      // Un élément de chaque côté, mais jamais à la même distance : deux rangées
      // symétriques feraient une allée de cimetière, pas une forêt.
      for (const cote of [-1, 1]) {
        const d = this.prochainDecor + (cote < 0 ? 0 : biome.ecartDecor * 0.5)
        this.spawnDecor(devant, cote, -(d - parcouru))
      }
      this.prochainDecor += biome.ecartDecor
    }

    /*
     * ————— Les barrières —————
     *
     * Même logique que le décor (semis par distance, recyclage par biome), à un
     * détail près : on saute les tronçons qu'un pan de mur avale entièrement
     * (cf. `murAvale`). La bordure devient ainsi une seule ligne CONTINUE, dont
     * les murs sont les portions hautes et escaladables.
     *
     * ⚠️ Le test ne vaut qu'en course : au menu, `murPlan` est celui de la
     * partie précédente et les murs, eux, ne sont pas semés (ils dépendent de
     * `distance`). Le consulter y creuserait des trous de bordure sans le
     * moindre mur dedans pour les justifier.
     */
    if (this.prochaineBarriere === 0) this.prochaineBarriere = parcouru - 10
    while (this.prochaineBarriere <= parcouru + LOOKAHEAD) {
      for (const cote of [-1, 1]) {
        if (enCourse && this.murAvale(this.prochaineBarriere, cote)) continue
        this.spawnBarriere(
          devant,
          cote,
          // Le maillage est centré : on vise le MILIEU du tronçon.
          -(this.prochaineBarriere + LONG_BARRIERE / 2 - parcouru)
        )
      }
      this.prochaineBarriere += LONG_BARRIERE
    }

    if (distance >= 0) {
      // La ligne d'arrivée est TOUJOURS placée d'après la distance parcourue :
      // impossible qu'elle se désynchronise.
      this.finish.position.z = -(this.courseLength - distance)

      // Fait apparaître les obstacles prévus qui entrent dans notre champ de vision
      while (
        this.planIdx < this.plan.length &&
        this.plan[this.planIdx].d <= distance + LOOKAHEAD
      ) {
        const p = this.plan[this.planIdx]
        // L'obstacle porte l'habillage du biome où il SE TROUVE, pas de celui
        // où l'on court : il apparaît 85 m devant, parfois de l'autre côté
        // d'une frontière.
        this.spawn(p.kind, p.lane, -(p.d - distance), indexBiome(p.d, this.courseLength))
        this.planIdx++
      }

      // Idem pour les rouleaux
      while (
        this.parcheminIdx < this.parcheminPlan.length &&
        this.parcheminPlan[this.parcheminIdx].d <= distance + LOOKAHEAD
      ) {
        const p = this.parcheminPlan[this.parcheminIdx]
        this.spawnRouleau(p.lane, -(p.d - distance))
        this.parcheminIdx++
      }

      // Idem pour les jarres
      while (
        this.jarreIdx < this.jarrePlan.length &&
        this.jarrePlan[this.jarreIdx].d <= distance + LOOKAHEAD
      ) {
        const p = this.jarrePlan[this.jarreIdx]
        this.spawnJarre(p, -(p.d - distance))
        this.jarreIdx++
      }

      // Les plateformes se voient d'aussi loin que les murs : il faut décider
      // de sauter AVANT d'arriver au bord.
      while (
        this.plateformeIdx < this.plateformePlan.length &&
        this.plateformePlan[this.plateformeIdx].d <= distance + LOOKAHEAD + 40
      ) {
        const p = this.plateformePlan[this.plateformeIdx]
        this.spawnPlateforme(p, -(p.d - distance))
        this.plateformeIdx++
      }

      // Les murs se voient de plus loin que le reste : ils sont longs, et il
      // faut les repérer assez tôt pour décider de sauter AVANT d'arriver.
      while (
        this.murIdx < this.murPlan.length &&
        this.murPlan[this.murIdx].d <= distance + LOOKAHEAD + 40
      ) {
        const p = this.murPlan[this.murIdx]
        this.spawnMur(p, -(p.d - distance))
        this.murIdx++
      }
    }
  }

  /**
   * Plante un élément de bordure. `cote` vaut -1 (gauche) ou +1 (droite).
   *
   * On l'écarte de 7 m du centre : au-delà de la piste (14 m de large, donc
   * 7 m de demi-largeur), pour qu'aucun décor ne vienne jamais masquer un
   * obstacle. La règle est absolue — un élément de paysage qui cache une
   * barrière transforme le joli en injuste.
   */
  private spawnDecor(biome: number, cote: number, z: number) {
    let dec = this.decors.find((d) => !d.active && d.biome === biome)
    if (!dec) {
      dec = {
        mesh: BIOMES[biome].fabriqueDecor(this.graineDecor),
        biome,
        active: false,
      }
      this.decors.push(dec)
      this.scene.add(dec.mesh)
    }
    /*
     * ⚠️ 5,6 m du centre, pas 7.
     *
     * Le décor commençait au BORD du sol (7 m). Or les lignes n'allaient alors
     * qu'à 2,2 m et les murs à 3,5 m : il restait une bande de sol nu de trois
     * mètres et demi tout du long, juste là où l'œil se pose. La forêt avait
     * beau être dense, elle démarrait trop loin pour se lire comme une forêt.
     *
     * 5,6 m laisse un mètre franc après les murs — assez pour qu'aucune tige ne
     * masque jamais un obstacle, ce qui reste la règle absolue.
     *
     * ⚠️ C'était 4,8 m quand les parois étaient à 3,5. Elles sont passées à
     * 4,2 avec l'élargissement des lignes : garder 4,8 aurait planté la forêt
     * DANS les murs.
     */
    dec.mesh.position.set(cote * (5.6 + this.graineDecor() * 1.4), 0, z)
    /*
     * Les décors sont dessinés d'un seul côté (x local croissant = vers
     * l'extérieur). Pour le bord gauche, on fait DEMI-TOUR.
     *
     * ⚠️ Surtout pas `scale.x = -1` : sur une géométrie fusionnée, une échelle
     * négative retourne les normales, et tout le massif s'éclaire à l'envers —
     * les faces au soleil deviennent noires. La rotation, elle, préserve
     * l'éclairage, et retourne aussi la profondeur : la même touffe recyclée à
     * droite puis à gauche ne se lit pas comme un copier-coller.
     */
    dec.mesh.rotation.y = cote < 0 ? Math.PI : 0
    dec.mesh.visible = true
    dec.active = true
  }

  private spawnPlateforme(p: PlannedPlateforme, z: number) {
    const biome = indexBiome(p.d, this.courseLength)
    let pf = this.plateformes.find((q) => !q.active && q.biome === biome)
    if (!pf) {
      const habille = BIOMES[biome].fabriquePlateforme
      pf = {
        mesh: habille
          ? habille(p.hauteur, PLATEFORME_LARG)
          : makePlateformeMesh(p.hauteur),
        rampe: new THREE.Mesh(
          GEO_RAMPE,
          new THREE.MeshStandardMaterial({
            color: BIOMES[biome].murCorps,
            roughness: 0.9,
          })
        ),
        plan: p,
        biome,
        active: false,
      }
      this.plateformes.push(pf)
      this.scene.add(pf.mesh, pf.rampe)
    }
    pf.plan = p
    // Le maillage est bâti sur 1 m de long, centré : on l'étire et on le recule
    // d'une demi-longueur pour que son bord avant tombe pile sur `z`.
    pf.mesh.scale.z = p.longueur
    pf.mesh.position.set(LANES[p.lane], 0, z - p.longueur / 2)
    pf.mesh.userData.zAvant = z
    pf.mesh.visible = true

    // La rampe monte vers le bord avant du plateau : son sommet doit tomber
    // exactement sur `z`, donc son centre une demi-rampe plus près.
    pf.rampe.visible = p.rampe > 0
    if (p.rampe > 0) {
      pf.rampe.scale.set(PLATEFORME_LARG, p.hauteur, p.rampe)
      pf.rampe.position.set(LANES[p.lane], 0, z + p.rampe / 2)
    }
    pf.active = true
  }

  private spawnMur(p: PlannedMur, z: number) {
    // Il prend la matière du biome qu'il TRAVERSE, pas celle où l'on court :
    // un mur long de 40 m apparaît 125 m devant, parfois de l'autre côté d'une
    // frontière.
    const biome = indexBiome(p.d, this.courseLength)
    let m = this.murs.find((m) => !m.active && m.biome === biome)
    if (!m) {
      const habille = BIOMES[biome].fabriqueMur
      m = { mesh: habille ? habille() : makeMurMesh(biome), biome, active: false }
      this.murs.push(m)
      this.scene.add(m.mesh)
    }
    // Le maillage est bâti sur 1 m : on l'étire à la longueur voulue. Il est
    // centré en z, d'où le décalage d'une demi-longueur.
    m.mesh.scale.z = p.longueur
    m.mesh.position.set(p.cote * MUR_X, 0, z - p.longueur / 2)
    m.mesh.visible = true
    m.active = true
  }

  /**
   * Pose un tronçon de barrière. `cote` vaut -1 (gauche) ou +1 (droite).
   *
   * Il se pose à `MUR_X`, exactement là où passent les pans de mur — et c'est
   * tout l'intérêt : la bordure de la piste devient une ligne CONTINUE dont les
   * pans de mur ne sont que les portions hautes et escaladables. Sans cet
   * alignement, on aurait deux bordures parallèles à des écarts différents, et
   * les murs auraient l'air posés au hasard au lieu de faire partie du bord.
   */
  private spawnBarriere(biome: number, cote: number, z: number) {
    const habille = BIOMES[biome].fabriqueBarriere
    if (!habille) return
    let b = this.barrieres.find((q) => !q.active && q.biome === biome)
    if (!b) {
      b = { mesh: habille(), biome, active: false }
      this.barrieres.push(b)
      this.scene.add(b.mesh)
    }
    b.mesh.position.set(cote * MUR_X, 0, z)
    b.mesh.visible = true
    b.active = true
  }

  /**
   * Un pan de mur avale-t-il ENTIÈREMENT ce tronçon de barrière ?
   *
   * ⚠️ Entièrement, et pas « le touche » — la nuance décide de tout.
   *
   * Première version : on sautait tout tronçon qui CHEVAUCHAIT un mur. Comme
   * les tronçons tombent sur une grille de 12 m sans rapport avec les murs, un
   * mur de 32 m en faisait sauter quatre : la barrière s'arrêtait jusqu'à 8 m
   * avant le mur et ne reprenait que 8 m après. Résultat, un trou de bordure
   * nue à chaque bout de chaque mur — exactement le vide qu'on cherchait à
   * combler.
   *
   * Un tronçon qui déborde n'est pourtant pas un problème : la barrière est
   * posée à `MUR_X`, c'est-à-dire DANS l'épaisseur du mur, et haute d'un mètre
   * là où le mur en fait trois. La partie qui déborde est donc purement et
   * simplement avalée par le mur, tandis que le reste prolonge la clôture au
   * ras de lui. Zéro trou, zéro artefact.
   *
   * On ne saute donc que ce qui serait invisible de bout en bout — ce qui
   * économise tout de même 1 à 3 appels de dessin par mur.
   */
  private murAvale(d: number, cote: number): boolean {
    for (const m of this.murPlan) {
      if (m.cote !== cote) continue
      if (d >= m.d && d + LONG_BARRIERE <= m.d + m.longueur) return true
    }
    return false
  }

  private spawnJarre(p: PlannedJarre, z: number) {
    // Les deux sortes n'ont pas le même corps : on recycle par sorte.
    let j = this.jarres.find((j) => !j.active && j.kind === p.kind)
    if (!j) {
      j = {
        mesh: makeJarreMesh(p.kind),
        kind: p.kind,
        parchemin: p.parchemin,
        tresor: p.tresor ?? null,
        active: false,
      }
      this.jarres.push(j)
      this.scene.add(j.mesh)
    }
    j.parchemin = p.parchemin
    // Le trésor suit le plan, pas le maillage recyclé : deux pots verts d'une
    // même course ne contiennent pas forcément la même chose.
    j.tresor = p.tresor ?? null
    j.mesh.position.x = LANES[p.lane]
    j.mesh.position.z = z
    j.mesh.rotation.y = 0
    j.mesh.visible = true
    j.active = true
  }

  /**
   * La lame en mouvement touche-t-elle une jarre ?
   *
   * On teste un vrai CONTACT entre les corps, jamais une portée devant soi :
   * passer au-dessus d'une jarre sans la frôler ne doit rien casser. C'est ce
   * qui rend la montée de rebond en rebond impossible — pour frapper, il faut
   * redescendre au niveau de la jarre, donc payer le temps de chute.
   *
   * La boîte est élargie de 35 cm : on vise au doigt sur un écran qui défile,
   * un coup raté d'un cheveu serait injuste.
   */
  casseAuContact(playerBox: THREE.Box3): {
    touchee: boolean
    parchemin: ParcheminKind | null
    /** Le contenu d'un pot vert. `null` pour toute autre jarre. */
    tresor: Tresor | null
    /** Le sommet de la jarre : c'est de LÀ qu'on rebondit. */
    sommet: number
  } {
    const box = new THREE.Box3()
    for (const j of this.jarres) {
      if (!j.active) continue
      if (Math.abs(j.mesh.position.z) > 4) continue
      box.setFromObject(j.mesh)
      const sommet = box.max.y
      box.expandByScalar(0.35)
      if (box.intersectsBox(playerBox)) {
        j.active = false
        j.mesh.visible = false
        return {
          touchee: true,
          parchemin: j.kind === 'doree' ? j.parchemin : null,
          tresor: j.kind === 'verte' ? j.tresor : null,
          sommet,
        }
      }
    }
    return { touchee: false, parchemin: null, tresor: null, sommet: 0 }
  }

  /**
   * Le joueur PERCUTE-t-il une jarre au lieu de la frapper ? La poterie
   * éclate, mais on se prend le choc.
   *
   * C'est ce qui donne son poids au combat : sans collision, ignorer une
   * grappe ne coûtait rien et frapper n'était qu'un bonus facultatif.
   * Maintenant une grappe sur sa ligne pose une vraie question — la frapper,
   * la contourner, ou payer. Et en vol on passe au-dessus : une chaîne bien
   * menée traverse tout sans jamais toucher une seule jarre.
   */
  heurteJarre(playerBox: THREE.Box3): boolean {
    const box = new THREE.Box3()
    for (const j of this.jarres) {
      if (!j.active) continue
      if (Math.abs(j.mesh.position.z) > 2.5) continue
      box.setFromObject(j.mesh)
      box.expandByScalar(-0.1) // un peu de tolérance : on frôle sans casser
      if (box.intersectsBox(playerBox)) {
        j.active = false
        j.mesh.visible = false
        return true
      }
    }
    return false
  }

  private spawnRouleau(lane: number, z: number) {
    let r = this.rouleaux.find((r) => !r.active)
    if (!r) {
      r = { mesh: makeRouleauMesh(), active: false }
      this.rouleaux.push(r)
      this.scene.add(r.mesh)
    }
    r.mesh.position.x = LANES[lane]
    r.mesh.position.z = z
    r.mesh.visible = true
    r.active = true
  }

  /**
   * Le joueur ramasse-t-il un rouleau ? Renvoie un parchemin TIRÉ AU HASARD
   * (et retire la boîte de la piste), ou null. Le contenu n'est décidé qu'ici :
   * deux joueurs qui prennent la même boîte n'ont pas forcément le même pouvoir.
   */
  ramasse(playerBox: THREE.Box3): ParcheminKind | null {
    const box = new THREE.Box3()
    for (const r of this.rouleaux) {
      if (!r.active) continue
      if (Math.abs(r.mesh.position.z) > 2.5) continue
      box.setFromObject(r.mesh)
      box.expandByScalar(0.25) // genereux : ramasser doit etre un plaisir, pas un test
      if (box.intersectsBox(playerBox)) {
        r.active = false
        r.mesh.visible = false
        return tirerParchemin() // Math.random : mon tirage, rien qu'à moi
      }
    }
    return null
  }

  private spawn(kind: Kind, lane: number, z: number, biome: number) {
    // On recycle un obstacle éteint du même type ET du même biome : un tronc de
    // bambou ne peut pas se réincarner en poutre calcinée.
    let o = this.obstacles.find((o) => !o.active && o.kind === kind && o.biome === biome)
    if (!o) {
      const habille = BIOMES[biome].fabriqueObstacle
      o = {
        mesh: habille ? habille(kind, this.graineDecor) : makeObstacleMesh(kind),
        kind,
        biome,
        active: false,
      }
      this.obstacles.push(o)
      this.scene.add(o.mesh)
    }
    o.mesh.position.x = LANES[lane]
    o.mesh.position.z = z
    o.mesh.visible = true
    o.active = true
  }

  /**
   * Le joueur touche-t-il un obstacle ? Renvoie LEQUEL (ou null) : l'Armure de
   * Fer n'encaisse pas de la même façon une barrière et un mur.
   *
   * ⚠️ La boîte vient de `TAILLE_OBSTACLE`, JAMAIS du maillage : c'est ce qui
   * permet à chaque biome d'habiller ses obstacles sans toucher au jeu. Le
   * maillage ne fournit que la position au sol.
   */
  hits(playerBox: THREE.Box3): Kind | null {
    const box = new THREE.Box3()
    const M = 0.12 // un peu de tolérance, plus sympa à jouer
    for (const o of this.obstacles) {
      if (!o.active) continue
      const { x, z } = o.mesh.position
      if (Math.abs(z) > 2.5) continue // trop loin, on ne teste pas
      const t = TAILLE_OBSTACLE[o.kind]
      box.min.set(x - t.larg / 2 + M, t.y - t.haut / 2 + M, z - t.prof / 2 + M)
      box.max.set(x + t.larg / 2 - M, t.y + t.haut / 2 - M, z + t.prof / 2 - M)
      if (box.intersectsBox(playerBox)) return o.kind
    }
    return null
  }

  /**
   * Le portique rouge touche-t-il le coureur ?
   *
   * Sa forme est CREUSE : deux piliers et deux traverses, avec une grande
   * ouverture au milieu. Une seule boîte autour du tout barrerait la piste
   * entière. On teste donc les quatre pièces séparément — d'où « exactement sa
   * forme » : on passe par le trou, on bute sur le bois.
   */
  heurteTorii(playerBox: THREE.Box3): boolean {
    const box = new THREE.Box3()
    const M = 0.12 // la même tolérance que les obstacles
    for (const t of this.toriis) {
      const z = t.position.z
      if (Math.abs(z) > 2.5) continue // trop loin, on ne teste pas
      for (const p of TORII_PIECES) {
        box.min.set(p.x - p.larg / 2 + M, p.y - p.haut / 2 + M, z - p.prof / 2 + M)
        box.max.set(p.x + p.larg / 2 - M, p.y + p.haut / 2 - M, z + p.prof / 2 - M)
        if (box.intersectsBox(playerBox)) return true
      }
    }
    return false
  }
}

/**
 * Décide de TOUS les obstacles de la course à l'avance, à partir de la graine.
 * 1 ou 2 obstacles par rangée, jamais 3 : il y a toujours un passage !
 * La zone de sprint final est dégagée.
 */
export function buildPlan(
  length: number,
  seed: number,
  plateformes: PlannedPlateforme[] = []
): PlannedObstacle[] {
  const rng = mulberry32(seed)
  const kinds: Kind[] = ['saut', 'glissade', 'mur']
  const plan: PlannedObstacle[] = []

  let d = 45 // premiers mètres tranquilles pour se chauffer
  while (d < length - SPRINT_ZONE) {
    /*
     * ⚠️ Les PLATEFORMES sont posées en premier, et les obstacles se rangent
     * autour. L'ordre inverse — obstacles d'abord, plateformes dans les trous —
     * plafonnait à 7 plateformes par course quoi qu'on demande : les obstacles
     * tombent tous les 10 à 17 m et ne laissaient jamais 50 m de ligne libre.
     *
     * L'INVARIANT à tenir : il reste TOUJOURS au moins une ligne sans rien —
     * ni plateforme, ni obstacle. Sans lui, une rangée pourrait n'offrir qu'un
     * plateau sans rampe pour seul passage, et donc imposer une seconde de
     * pénalité sans aucune alternative. C'est le seul cas vraiment injuste que
     * cette piste puisse produire.
     */
    const prises = new Set(
      plateformes
        .filter((p) => d > p.d - p.rampe - 5 && d < p.d + p.longueur + 5)
        .map((p) => p.lane)
    )
    const libres = [0, 1, 2].filter((l) => !prises.has(l))
    // On en garde une entièrement libre, d'où le -1.
    const combien = Math.min(Math.max(0, libres.length - 1), rng() < 0.6 ? 1 : 2)
    const melangees = libres.sort(() => rng() - 0.5)
    for (let i = 0; i < combien; i++) {
      plan.push({ d, lane: melangees[i], kind: kinds[Math.floor(rng() * kinds.length)] })
    }
    d += 10 + rng() * 7
  }
  return plan
}

/**
 * Place les rouleaux : environ un tous les 130 à 210 m, jamais dans la zone de
 * sprint. Seules les POSITIONS sont décidées ici (à la graine, donc communes à
 * tous les joueurs) ; le contenu de chaque boîte est tiré au ramassage.
 *
 * L'espacement vise **un ramassage toutes les ~6,5 s** (on court à ~26 m/s) :
 * assez pour que les parchemins rythment vraiment la course, assez peu pour
 * qu'on ne soit pas les deux mains pleines en permanence. Un rouleau toutes les
 * 4 s rendait le système bavard et sans enjeu.
 *
 * On décale la graine (`^`) : sans ça les rouleaux suivraient exactement le
 * même tirage que les obstacles et retomberaient toujours au même endroit.
 */
function buildParcheminPlan(
  length: number,
  seed: number,
  obstacles: PlannedObstacle[]
): PlannedParchemin[] {
  const rng = mulberry32(seed ^ 0x5f3a7c1d)
  const plan: PlannedParchemin[] = []

  let d = 120 // on laisse le temps de prendre sa vitesse
  while (d < length - SPRINT_ZONE - 15) {
    // Un rouleau collé à une barrière serait un piège : il faudrait se blesser
    // pour l'attraper. On ne cherche PAS un trou vide — les rangées tombent
    // tous les 10-17 m, il n'en existe pas toujours. On cherche une LIGNE que
    // personne n'occupe autour de ce point : une rangée n'ayant jamais 3
    // obstacles, il y en a presque toujours une de libre.
    let pos = d
    let lane = -1
    for (let essai = 0; essai < 14; essai++) {
      const occupees = new Set(
        obstacles.filter((o) => Math.abs(o.d - pos) < 6).map((o) => o.lane)
      )
      const libres = [0, 1, 2].filter((l) => !occupees.has(l))
      if (libres.length > 0) {
        lane = libres[Math.floor(rng() * libres.length)]
        break
      }
      pos += 3 // deux rangées serrées bouchent les 3 lignes : on avance un peu
    }
    // Vraiment aucune ligne libre : on saute ce rouleau plutôt que d'en poser
    // un dans un mur. Le suivant tombera 130 à 210 m plus loin. Le contenu, lui,
    // n'est pas décidé ici : chacun le tire à son ramassage (cf. tirerParchemin).
    if (lane >= 0) plan.push({ d: pos, lane })
    d += 130 + rng() * 80
  }
  return plan
}

/**
 * Place les jarres — en GRAPPES, et c'est tout l'enjeu du réglage.
 *
 * Une jarre isolée ne vaut rien : frapper coûte de la vitesse, et un coup seul
 * ne la rembourse pas. Ce qui paie, c'est la CHAÎNE. Il faut donc que les
 * cibles se suivent d'assez près pour qu'on aille de l'une à l'autre sans
 * retomber.
 *
 * ⚠️ L'espacement ne peut PAS être un chiffre fixe : il doit valoir exactement
 * la période du rebond, et celle-ci s'allonge au fil de la course puisque la
 * vitesse de croisière monte (22 → 30 m/s). Un écart constant marcherait au
 * début et raterait à la fin. Voir periodeRebond().
 *
 * Une grappe tient sur UNE ligne : on enchaîne tout droit, et le choix « je
 * prends la grappe ou je garde ma trajectoire » reste lisible en une seconde.
 *
 * Graine décalée (`^`) : sinon les jarres tomberaient toujours sur les mêmes
 * points que les obstacles et les rouleaux.
 */
/**
 * La distance parcourue pendant UN rebond, à cet endroit de la course.
 *
 * Un rebond est un vrai saut : 2 × 14 / 42 = 0,667 s en l'air. La distance
 * couverte dépend donc de la vitesse du moment — et comme on accélère au fil
 * des mètres, elle passe d'environ 15 m au départ à 20 m à l'arrivée.
 *
 * Espacer les jarres de cette distance, c'est garantir qu'on retombe PILE sur
 * la suivante. Un écart plus court fait arriver en pleine montée (et l'on ne
 * touche rien) ; un écart plus long fait retomber au sol avant.
 *
 * L'impulsion vient de player.ts : elle a DÉJÀ bougé une fois (14 → 13,2, pour
 * caler le saut sur la hauteur du mur) alors qu'elle était recopiée en dur
 * ici. On l'importe donc, pour que ce réglage-là ne puisse plus se désaccorder
 * en silence.
 *
 * ⚠️ Reste recopiée : la formule de croisière, qui vit dans main.ts — et main
 * importe track, l'inverse ferait un cycle. Si l'une bouge, l'autre doit suivre.
 */
function periodeRebond(d: number, length: number): number {
  const croisiere = 22 + 8 * (d / length)
  return ((2 * JUMP_SPEED) / 42) * croisiere
}

export function buildJarrePlan(
  length: number,
  seed: number,
  obstacles: PlannedObstacle[]
): PlannedJarre[] {
  const rng = mulberry32(seed ^ 0x2b91e6a7)
  const plan: PlannedJarre[] = []
  /** Les jarres qui POURRAIENT devenir dorées (jamais la 1re d'une grappe). */
  const eligibles: number[] = []

  let d = 90 // le temps d'avoir pris sa vitesse
  while (d < length - SPRINT_ZONE - 30) {
    const taille = 2 + Math.floor(rng() * 3) // 2 à 4 jarres
    // L'écart SUIT la période du rebond à cet endroit de la course : on
    // retombe pile sur la jarre suivante. Comme la vitesse de croisière monte
    // au fil des mètres, l'écart s'élargit avec elle.
    const ecart = periodeRebond(d, length)

    // On cherche une ligne libre sur TOUTE la longueur de la grappe : une
    // grappe coupée par un mur serait un piège, pas un choix.
    //
    // ⚠️ La fin est recalculée à CHAQUE essai : quand on décale la grappe, sa
    // fin se décale avec elle. L'oublier laissait passer des jarres dans les
    // murs — et comme les rangées d'obstacles bouchent souvent les 3 lignes
    // sur une fenêtre aussi large, ce décalage arrive tout le temps.
    let lane = -1
    for (let essai = 0; essai < 10; essai++) {
      const fin = d + ecart * (taille - 1)
      const occupees = new Set(
        obstacles.filter((o) => o.d > d - 8 && o.d < fin + 8).map((o) => o.lane)
      )
      const libres = [0, 1, 2].filter((l) => !occupees.has(l))
      if (libres.length > 0) {
        lane = libres[Math.floor(rng() * libres.length)]
        break
      }
      d += 6 // ce tronçon est bouché : on décale la grappe un peu plus loin
    }

    // La grappe doit tenir ENTIÈREMENT dans le 2ᵉ acte. Une jarre posée dans
    // la zone de sprint serait incassable — le combat y est éteint — donc on
    // arrête d'en poser dès que la grappe déborderait.
    if (d + ecart * (taille - 1) >= length - SPRINT_ZONE) break

    if (lane >= 0) {
      // Une grappe sur trois cache une dorée, jamais en première position :
      // il faut avoir commencé la chaîne pour la cueillir.
      const doree = rng() < 0.34 ? 1 + Math.floor(rng() * (taille - 1)) : -1
      for (let i = 0; i < taille; i++) {
        plan.push({
          d: d + ecart * i,
          lane,
          kind: i === doree ? 'doree' : 'vide',
          parchemin: TIRAGE[Math.floor(rng() * TIRAGE.length)],
        })
        if (i > 0) eligibles.push(plan.length - 1)
      }
    }
    d += 90 + rng() * 60
  }

  // Au moins UNE dorée par course. Le tirage à 1 grappe sur 3 en donne 2,9 en
  // moyenne, mais laissait 5 % des courses sans aucune — or c'est l'objet
  // qu'on se dispute en duel : une course sans en compter une seule raterait
  // tout l'intérêt. On en promeut donc une au besoin.
  if (eligibles.length > 0 && !plan.some((j) => j.kind === 'doree')) {
    plan[eligibles[Math.floor(rng() * eligibles.length)]].kind = 'doree'
  }

  /*
   * ————— 🟢 Les pots verts : la trouvaille rare —————
   *
   * On tire d'abord COMBIEN de pots, puis où les mettre.
   *
   * J'avais commencé par l'inverse — une chance par jarre, plafonnée à deux.
   * Mesuré sur 1 000 courses, ça donnait DEUX pots dans 66 % des parties et
   * aucun dans 12 % : exactement le contraire de « rare ». La raison est
   * arithmétique : une course compte des dizaines de jarres éligibles, donc
   * même une chance faible finit par atteindre le plafond presque à tous les
   * coups. Un plafond n'est pas une rareté.
   *
   * En tirant le nombre d'abord, la rareté est ce qu'on écrit, pas ce qui reste
   * après coup — et les proportions se lisent directement dans le code.
   *
   * Le tirage vient de la MÊME graine partagée que le reste : en duel, les deux
   * joueurs voient le même pot au même endroit, et se le disputent. Un tirage
   * local en donnerait un à l'un et pas à l'autre, ce qui serait injouable.
   */
  const candidats = eligibles.filter((i) => plan[i].kind === 'vide')
  const de = rng()
  const combien = de < CHANCE_DEUX_POTS ? 2 : de < CHANCE_UN_POT ? 1 : 0

  for (let n = 0; n < Math.min(combien, POTS_VERTS_MAX) && candidats.length > 0; n++) {
    // On RETIRE la jarre choisie du tirage : sans ça, les deux pots d'une même
    // course pourraient tomber sur la même poterie, et il n'y en aurait qu'un.
    const k = Math.floor(rng() * candidats.length)
    const i = candidats.splice(k, 1)[0]
    plan[i].kind = 'verte'
    /*
     * Le contenu est décidé ICI, dans le plan tiré de la graine partagée : en
     * duel, les deux joueurs voient le MÊME trésor dans le MÊME pot. Le tirer
     * à la casse, côté joueur, donnerait du jade à l'un et des pièces à l'autre
     * pour la même poterie — on se disputerait un objet qui n'est pas le même.
     */
    const jade = rng() < CHANCE_JADE
    plan[i].tresor = {
      monnaie: jade ? 'hisui' : 'mon',
      quantite: 1 + Math.floor(rng() * (jade ? JADE_MAX : MON_MAX)),
    }
  }
  return plan
}

/**
 * Traduit des plateformes en obstacles fictifs, pour réutiliser les recherches
 * de ligne libre existantes (jarres, rouleaux) et le pilotage des bots.
 *
 * On en sème un tous les 5 m sur toute la longueur : les recherches travaillent
 * par fenêtre de quelques mètres autour d'un point, un seul marqueur au début
 * laisserait poser une jarre au milieu du wagon.
 */
function commeObstacles(plateformes: PlannedPlateforme[]): PlannedObstacle[] {
  const out: PlannedObstacle[] = []
  for (const p of plateformes) {
    for (let d = p.d; d <= p.d + p.longueur; d += 5) {
      out.push({ d, lane: p.lane, kind: 'mur' })
    }
  }
  return out
}

/**
 * Place les plateformes : une tous les 150 à 260 m, longue de 15 à 25 m.
 *
 * Assez rares pour rester un événement qu'on guette (une toutes les ~8 s de
 * course), assez longues pour qu'on ait le temps de SENTIR qu'on court dessus —
 * environ 0,6 à 1 s en hauteur.
 *
 * Une fois sur trois, une seconde plateforme plus haute suit à 6-11 m : c'est le
 * chemin en l'air. L'écart est calculé pour être franchissable — depuis 1,6 m on
 * culmine à 3,67 m, et à 26 m/s on couvre 8 m avant de retomber au niveau de
 * départ. Trop court, on ne peut pas sauter ; trop long, on tombe.
 *
 * Graine décalée (`^`) : sans ça les plateformes tomberaient sur les mêmes
 * points que tout le reste.
 */
export function buildPlateformePlan(length: number, seed: number): PlannedPlateforme[] {
  const rng = mulberry32(seed ^ 0x3fa17c05)
  const plan: PlannedPlateforme[] = []

  let d = 200 // le temps d'avoir compris la course avant d'en changer les règles
  while (d < length - SPRINT_ZONE - 40) {
    /*
     * Un CONVOI : une à trois plateformes à la suite, toutes à hauteur de mur,
     * séparées de trous qu'on franchit d'un saut.
     *
     * C'est ça, le chemin en l'air — on ne monte pas d'étage en étage, on
     * saute de wagon en wagon comme dans Subway Surfers. Toutes à la même
     * hauteur, la lecture est immédiate : on voit tout de suite jusqu'où va la
     * route.
     *
     * ⚠️ La ligne doit être libre sur TOUT le convoi, réservé d'un bloc avant
     * même de chercher où le mettre. Poser les wagons un par un laissait une
     * barrière au milieu une fois sur deux — et en l'air on ne change plus de
     * voie pour l'éviter. C'était le pire piège possible.
     */
    /*
     * Un convoi de trois wagons réclame une ligne libre sur plus de 110 m — or
     * les obstacles tombent tous les 10 à 17 m. À force d'en demander autant, la
     * recherche échouait entièrement dans 4 % des courses, qui se retrouvaient
     * SANS AUCUNE plateforme. On penche donc franchement vers les convois
     * courts, et les longs restent une rareté qu'on croise de temps en temps.
     */
    const tirage = rng()
    const wagons = tirage < 0.5 ? 1 : tirage < 0.85 ? 2 : 3
    const longs: number[] = []
    const trous: number[] = []
    let portee = 0
    for (let i = 0; i < wagons; i++) {
      const l = 15 + rng() * 10
      longs.push(l)
      portee += l
      if (i < wagons - 1) {
        // 6 à 11 m : franchissable d'un saut depuis le wagon précédent, et
        // jamais assez large pour qu'on tombe malgré soi (cf. test).
        const t = 6 + rng() * 5
        trous.push(t)
        portee += t
      }
    }

    /*
     * La rampe, une fois sur deux.
     *
     * Avec rampe, le convoi est un cadeau : on y monte en courant, on file à
     * l'abri de tout ce qui traîne au sol. Sans rampe, c'est un mur — il faut
     * l'escalader et payer une seconde. La même structure est donc tantôt une
     * récompense, tantôt un piège, et c'est ce qui oblige à REGARDER la piste
     * au lieu d'apprendre un réflexe.
     */
    const rampe = rng() < 0.5 ? 5 + rng() * 3 : 0
    const besoin = portee + rampe

    /*
     * La seule contrainte : ne pas empiler deux convois sur la même ligne. Les
     * obstacles, eux, viendront APRÈS se ranger autour (cf. buildPlan) — c'est
     * ce qui permet enfin une vraie densité.
     *
     * On laisse toujours une ligne de côté pour que le sol reste praticable.
     */
    const prises = new Set(
      plan
        .filter((p) => p.d < d + portee + 5 && p.d + p.longueur > d - rampe - 5)
        .map((p) => p.lane)
    )
    const dispo = [0, 1, 2].filter((l) => !prises.has(l))
    // Jamais les trois lignes barrées d'un coup : on en garde une au sol.
    const lane = dispo.length > 1 ? dispo[Math.floor(rng() * dispo.length)] : -1

    // Tout doit tenir hors de la zone de sprint, où l'on ne peut plus swiper.
    if (d + portee >= length - SPRINT_ZONE) break

    if (lane >= 0) {
      let dd = d
      for (let i = 0; i < wagons; i++) {
        plan.push({
          d: dd,
          longueur: longs[i],
          lane,
          hauteur: PLATEFORME_H,
          // Seul le PREMIER wagon porte la rampe : les suivants s'atteignent
          // en sautant depuis celui d'avant.
          rampe: i === 0 ? rampe : 0,
        })
        dd += longs[i] + (trous[i] ?? 0)
      }
    }
    /*
     * On repart APRÈS le convoi qu'on vient de poser (`besoin`), plus un
     * intervalle court : ~40 à 80 m, soit un convoi toutes les 2 à 3 s.
     *
     * C'est la densité de Subway Surfers, et c'est ce qui change la nature du
     * jeu : une plateforme tous les 300 m était une curiosité qu'on croisait ;
     * une toutes les deux secondes devient un ITINÉRAIRE. On ne se demande plus
     * « tiens, un wagon », on choisit en permanence entre le sol et les hauteurs.
     */
    d += 40 + rng() * 40 + besoin
  }

  /*
   * Au moins UNE plateforme par course.
   *
   * Le tirage en donne 5,5 en moyenne, mais laissait 0,5 % des courses sans la
   * moindre — et une course sans plateforme est une course où la mécanique
   * n'existe pas, ce qui est pire qu'un déséquilibre : en multi, deux joueurs
   * feraient l'expérience de deux jeux différents. On en pose donc une de
   * secours, la plus modeste possible, au premier endroit qui l'accepte.
   *
   * Même filet que pour la jarre dorée, et pour la même raison.
   */
  if (plan.length === 0) {
    plan.push({
      d: 250,
      longueur: 16,
      lane: 1,
      hauteur: PLATEFORME_H,
      rampe: 6, // avec rampe : la course de secours ne doit pas punir
    })
  }
  return plan
}

/**
 * Le visuel GÉNÉRIQUE d'une plateforme : un plateau bâti sur 1 m de long et
 * centré, qu'on étire en Z à l'apparition.
 *
 * Le liseré du dessus est vermillon, comme celui des pans de mur — et pour la
 * même raison. Le vermillon est devenu le langage des SURFACES QU'ON UTILISE
 * (on s'y accroche, on court dessus), par opposition aux obstacles qu'on subit.
 */
export function makePlateformeMesh(hauteur: number): THREE.Object3D {
  const g = new THREE.Group()
  const corps = new THREE.Mesh(
    new THREE.BoxGeometry(PLATEFORME_LARG, hauteur, 1),
    new THREE.MeshStandardMaterial({ color: 0x3a4258, roughness: 0.9 })
  )
  corps.position.y = hauteur / 2
  // Le tablier : c'est lui le dessus, et il est de la matière de la plateforme.
  const tablier = new THREE.Mesh(
    new THREE.BoxGeometry(PLATEFORME_LARG + 0.06, 0.16, 1),
    new THREE.MeshStandardMaterial({ color: 0x4d566f, roughness: 0.9 })
  )
  tablier.position.y = hauteur - 0.08
  // Le vermillon réduit à une arête de 5 cm sur le nez : le repère survit, le
  // « ruban rouge » disparaît.
  const liser = new THREE.Mesh(
    new THREE.BoxGeometry(PLATEFORME_LARG + 0.1, 0.05, 1),
    new THREE.MeshStandardMaterial({ color: 0xc33a2c, emissive: 0x3a0f0a })
  )
  liser.position.y = hauteur - 0.02
  g.add(corps, tablier, liser)
  return g
}

/**
 * Le coin d'une rampe : un prisme triangulaire bâti sur 1 × 1 × 1, qu'on met à
 * l'échelle (largeur, hauteur, longueur) à l'apparition.
 *
 * Il est construit à la main plutôt qu'avec une boîte inclinée : une boîte
 * tournée dépasse par en dessous et se déforme dès qu'on l'étire dans un seul
 * axe. Un vrai coin, lui, se met à l'échelle sans jamais mentir sur sa pente —
 * et cette pente EST la surface sur laquelle on court.
 *
 * Profil dans le plan (z, y) : (+0,5 ; 0) au ras du sol, montant jusqu'à
 * (−0,5 ; 1) où il rejoint le plateau.
 */
function makeRampeGeo(): THREE.BufferGeometry {
  const X = 0.5
  // 6 sommets : 3 par flanc
  const s = [
    [-X, 0, 0.5], [-X, 0, -0.5], [-X, 1, -0.5], // flanc gauche
    [X, 0, 0.5], [X, 0, -0.5], [X, 1, -0.5], // flanc droit
  ]
  const tri = [
    [0, 2, 1], [3, 4, 5], // les deux flancs triangulaires
    [0, 3, 5], [0, 5, 2], // la pente, celle qu'on foule
    [1, 2, 5], [1, 5, 4], // le dos vertical, contre le plateau
    [0, 1, 4], [0, 4, 3], // le dessous
  ]
  const pos: number[] = []
  for (const t of tri) for (const i of t) pos.push(...s[i])
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.computeVertexNormals()
  return g
}

const GEO_RAMPE = makeRampeGeo()

/**
 * Place les pans de mur : un tous les 160 à 280 m, de 26 à 42 m de long.
 *
 * Assez rares pour rester un événement qu'on guette, assez longs pour valoir
 * la manœuvre (il faut sauter AVANT d'arriver). Le côté est tiré au sort :
 * on ne peut pas apprendre la piste par cœur, il faut regarder.
 *
 * Graine décalée (`^`) : sans ça les murs tomberaient sur les mêmes points
 * que les obstacles, les rouleaux et les jarres.
 */
export function buildMurPlan(length: number, seed: number): PlannedMur[] {
  const rng = mulberry32(seed ^ 0x7d3e5b19)
  const plan: PlannedMur[] = []

  let d = 140 // le temps d'avoir pris sa vitesse et compris la course
  while (d < length - SPRINT_ZONE - 50) {
    plan.push({
      d,
      longueur: 26 + rng() * 16,
      cote: rng() < 0.5 ? -1 : 1,
    })
    d += 160 + rng() * 120
  }
  return plan
}

/**
 * Le visuel d'un pan de mur, étiré en Z au spawn.
 *
 * Son corps prend la matière du biome (`murCorps`) : une paroi d'ardoise au
 * milieu d'une bambouseraie jurait. Chaque pan a donc SON matériau, recoloré à
 * l'apparition — un matériau partagé aurait teinté d'un coup tous les murs à
 * l'écran, y compris ceux du biome précédent encore visibles.
 *
 * ⚠️ Le liseré du haut reste vermillon PARTOUT. Ce n'est pas de la décoration :
 * c'est le signal « ici tu peux t'accrocher ». Un repère d'action doit se lire
 * pareil d'un bout à l'autre de la course.
 */
// `export` : le catalogue s'en sert pour montrer la paroi hors course.
// `biome` : sa matière en dépend (cf. murCorps).
export function makeMurMesh(biome: number): THREE.Mesh {
  const geo = new THREE.BoxGeometry(0.5, MUR_HAUT, 1) // 1 m de long : étiré au spawn
  // Origine AU SOL, comme tous les habillages de biome : c'est la piste qui
  // pose l'objet à y = 0, elle n'a pas à connaître la hauteur de chacun.
  geo.translate(0, MUR_HAUT / 2, 0)
  const mur = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ color: BIOMES[biome].murCorps, roughness: 0.95 })
  )
  const liser = new THREE.Mesh(
    new THREE.BoxGeometry(0.56, 0.18, 1),
    new THREE.MeshStandardMaterial({ color: 0xc33a2c, emissive: 0x3a0f0a })
  )
  liser.position.y = MUR_HAUT - 0.09 // le corps va de 0 à MUR_HAUT : il le coiffe
  mur.add(liser)
  return mur
}

/**
 * Le visuel d'une jarre. La dorée doit se repérer de TRÈS loin (on décide de
 * changer de ligne pour elle) : d'où l'or émissif, qui perce la brume.
 */
export function makeJarreMesh(kind: JarreKind): THREE.Group {
  const g = new THREE.Group()

  /*
   * Les trois poteries, réglées côte à côte plutôt qu'en ternaires imbriqués :
   * à trois sortes, « doree ? a : verte ? b : c » devient illisible, et c'est
   * exactement le genre d'endroit où l'on finit par régler la mauvaise.
   *
   * Le pot vert est PLUS GROS (echelle 1.45). C'est sa rareté rendue visible :
   * on n'en croise pas une fois sur deux courses, il faut donc qu'on le
   * reconnaisse instantanément et qu'on ait le temps de décider d'aller le
   * chercher.
   *
   * ⚠️ Sa boîte de collision grandit AVEC lui : frapperJarre() la déduit du
   * maillage (setFromObject). C'est voulu — un objet qu'on voit gros et qu'on
   * traverse serait déroutant — mais ça oblige à tenir le halo et l'aura SOUS
   * la taille du corps (0,36 × 1,45 ≈ 0,52). Sans ça, c'est une lueur, et non
   * la poterie, qui déciderait de ce qu'on touche.
   */
  const R = {
    vide: { corps: 0x8a6a52, emissive: 0x000000, rug: 0.9, teinte: 0x9fc4ff, halo: 0.34, opHalo: 0.055, opRayon: 0.075, hautRayon: 0.2, basRayon: 0.1, echelle: 1, aura: 0 },
    doree: { corps: 0xd6ac5a, emissive: 0x6a4f12, rug: 0.3, teinte: 0xffd98a, halo: 0.42, opHalo: 0.11, opRayon: 0.16, hautRayon: 0.26, basRayon: 0.12, echelle: 1, aura: 0 },
    // Le vert jade des hisui, pas un vert criard : il doit dire « précieux »
    verte: { corps: 0x2f9e63, emissive: 0x0f4a30, rug: 0.35, teinte: 0x7fe0b0, halo: 0.5, opHalo: 0.14, opRayon: 0.2, hautRayon: 0.32, basRayon: 0.15, echelle: 1.45, aura: 0.5 },
  }[kind]

  const mat = new THREE.MeshStandardMaterial({
    color: R.corps,
    roughness: R.rug,
    emissive: R.emissive,
  })

  // Le ventre : plus large en bas qu'en haut, comme une vraie poterie
  const ventre = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.36, 0.62, 12), mat)
  ventre.position.y = 0.31

  // Le col
  const col = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.14, 10), mat)
  col.position.y = 0.69

  const corps = new THREE.Group()
  corps.add(ventre, col)
  // Seul le CORPS grossit. Le halo et le rayon ont leurs propres tailles plus
  // bas : les mettre à l'échelle ici étirerait aussi la colonne de lumière en
  // largeur, et le pot ressemblerait à un projecteur.
  corps.scale.setScalar(R.echelle)
  g.add(corps)

  /*
   * ————— La surbrillance —————
   * Une poterie brune sur un sol brun, dans une nuit indigo, à 30 m/s : on la
   * voyait au moment de la percuter, jamais avant. Or il faut DÉCIDER de
   * frapper une grappe une seconde à l'avance.
   *
   * Deux couches, parce qu'elles répondent à deux questions différentes :
   *  · le halo au SOL dit OÙ elle est — sur quelle ligne, à quelle distance ;
   *  · l'aura autour du corps dit CE QUE c'est — et la dorée s'y distingue
   *    d'un coup d'œil, ce qui vaut le détour qu'elle demande.
   *
   * Additif et sans écriture de profondeur : ça brille dans la nuit sans
   * jamais masquer ce qu'il y a derrière.
   */
  const teinte = R.teinte
  const halo = new THREE.Mesh(
    new THREE.CircleGeometry(R.halo, 20),
    new THREE.MeshBasicMaterial({
      color: teinte,
      transparent: true,
      opacity: R.opHalo,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  )
  halo.rotation.x = -Math.PI / 2
  halo.position.y = 0.02 // juste au-dessus du sol, sinon il z-fight avec lui

  /*
   * La bulle qui enveloppait la jarre est remplacée par un RAYON qui monte —
   * un trait de lumière posé sur elle, comme un jour qui tombe entre deux
   * nuages. Deux raisons de préférer la colonne à la bulle :
   *  · elle est VERTICALE, donc elle dépasse du sol et des obstacles, et se
   *    repère par-dessus la piste bien avant qu'on distingue la poterie ;
   *  · elle n'entoure pas la jarre, donc elle ne noie plus sa silhouette — on
   *    voit encore la forme qu'on doit viser.
   * Faible, volontairement : c'est un repère, pas un phare.
   */
  const opRayon = R.opRayon
  const rayon = new THREE.Mesh(
    new THREE.CylinderGeometry(R.hautRayon, R.basRayon, RAYON_H, 12, 1, true),
    new THREE.MeshBasicMaterial({
      color: teinte,
      map: texRayon(),
      transparent: true,
      opacity: opRayon,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
  )
  rayon.position.y = RAYON_H / 2
  // Le battement de la dorée repart de CETTE valeur (cf. update). La recopier
  // là-bas obligerait à tenir deux chiffres en accord à la main : au premier
  // réglage oublié, la jarre se remettrait à briller comme avant.
  rayon.userData.op = opRayon

  g.add(halo, rayon)
  /*
   * Le battement (cf. update) tenait ses cibles par leur RANG dans children :
   * « les deux derniers sont le halo et le rayon ». Le pot vert ajoute une
   * troisième couche, et ce compte devenait faux — silencieusement, en animant
   * la mauvaise pièce. On les nomme donc, une fois pour toutes.
   */
  g.userData.halo = halo
  g.userData.rayon = rayon

  /*
   * 🟢 La petite aura du pot vert, et de lui seul.
   *
   * C'est la bulle qu'on avait retirée des autres jarres parce qu'elle noyait
   * leur silhouette. Ici elle se justifie : le pot est rare, gros, et on veut
   * qu'il ait l'air CHARGÉ. Elle est volontairement serrée contre le corps
   * (0,5 m) pour ne pas redevenir le halo qu'on avait supprimé.
   */
  if (R.aura > 0) {
    const aura = new THREE.Mesh(
      new THREE.SphereGeometry(R.aura, 16, 12),
      new THREE.MeshBasicMaterial({
        color: teinte,
        transparent: true,
        opacity: 0.13,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    )
    aura.position.y = 0.46
    // Le battement la reprend en même temps que le rayon (cf. update)
    aura.userData.op = 0.13
    g.add(aura)
    g.userData.aura = aura
  }
  return g
}

/** Hauteur du rayon. Au-delà il perce le plafond de brume et se voit de trop loin. */
const RAYON_H = 2.6

/**
 * Le dégradé du rayon : dense au pied, éteint au sommet.
 *
 * Sans lui, un cylindre translucide est un TUBE — on voit ses deux arêtes et
 * son bord haut, ça ressemble à un décor raté. C'est le fondu qui transforme la
 * géométrie en lumière. La texture est fabriquée une fois et partagée par
 * toutes les jarres : une par jarre, sur des centaines, coûterait cher pour un
 * résultat rigoureusement identique.
 */
let _texRayon: THREE.CanvasTexture | null = null
function texRayon(): THREE.CanvasTexture {
  if (_texRayon) return _texRayon
  const c = document.createElement('canvas')
  c.width = 1
  c.height = 64
  const ctx = c.getContext('2d')!
  // y=0 en haut de la texture = sommet du cylindre : c'est là qu'on s'éteint.
  const grad = ctx.createLinearGradient(0, 0, 0, 64)
  grad.addColorStop(0, 'rgba(255,255,255,0)')
  grad.addColorStop(0.55, 'rgba(255,255,255,0.35)')
  grad.addColorStop(1, 'rgba(255,255,255,1)')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, 1, 64)
  _texRayon = new THREE.CanvasTexture(c)
  return _texRayon
}

/**
 * Le visuel d'un rouleau : le MÊME pour les trois parchemins.
 * On ne découvre son contenu qu'en le ramassant — comme une boîte de Mario Kart.
 */
/*
 * ————— Ce qu'on ne refabrique pas —————
 *
 * Les rouleaux sont TOUS identiques et rien ne les modifie en jeu. Or ils
 * naissent d'une reserve qui s'agrandit au fil de la course : chaque nouvelle
 * entree se taillait ses propres cylindres et ses propres materiaux. Mesure sur
 * une course complete : 318 geometries et 118 materiaux pour 332 meshes —
 * presque aucun partage, et le compte grimpait de 27 materiaux a 240 m jusqu'a
 * 118 a l'arrivee.
 *
 * On les taille donc UNE fois, a la premiere demande, et tout le monde s'en
 * sert. C'est le meme dessin a l'ecran pour beaucoup moins de memoire et
 * beaucoup moins de changements d'etat GPU.
 *
 * ⚠️ Ce partage n'est possible QUE parce que rien ne mute ces materiaux. Les
 * murs (dont la couleur suit le biome traverse) et les auras de jarres (dont
 * l'opacite bat a chaque image) gardent les leurs, en propre — les mettre en
 * commun ferait deteindre un objet sur tous les autres.
 */
let _rouleau: { geo: THREE.BufferGeometry[]; mat: THREE.Material[] } | null = null
function piecesRouleau() {
  if (!_rouleau) {
    _rouleau = {
      geo: [
        new THREE.CylinderGeometry(0.17, 0.17, 0.78, 12), // le papier
        new THREE.CylinderGeometry(0.2, 0.2, 0.09, 12), // les embouts
        new THREE.CylinderGeometry(0.19, 0.19, 0.1, 12), // le lien
        new THREE.SphereGeometry(0.5, 10, 10), // le halo
      ],
      mat: [
        new THREE.MeshStandardMaterial({ color: 0xf0e8d8, roughness: 0.85 }),
        new THREE.MeshStandardMaterial({ color: 0xc33a2c, roughness: 0.5 }),
        new THREE.MeshBasicMaterial({ color: 0xd6ac5a, transparent: true, opacity: 0.12 }),
      ],
    }
  }
  return _rouleau
}

export function makeRouleauMesh(): THREE.Group {
  const g = new THREE.Group()
  const { geo, mat } = piecesRouleau()

  // Le papier : un cylindre couche en travers de la piste
  const papier = new THREE.Mesh(geo[0], mat[0])
  papier.rotation.z = Math.PI / 2

  // Les deux embouts vermillon, et le lien rouge au centre
  for (const x of [-0.42, 0.42]) {
    const embout = new THREE.Mesh(geo[1], mat[1])
    embout.rotation.z = Math.PI / 2
    embout.position.x = x
    g.add(embout)
  }
  const lien = new THREE.Mesh(geo[2], mat[1])
  lien.rotation.z = Math.PI / 2

  // Une lueur doree : le rouleau doit accrocher l'oeil dans la nuit
  const halo = new THREE.Mesh(geo[3], mat[2])

  g.add(papier, lien, halo)
  g.position.y = 1.15
  return g
}

/**
 * L'habillage GÉNÉRIQUE d'un obstacle : un bloc de la taille exacte de sa boîte
 * de collision. Il sert de repli pour tout biome qui n'a pas encore le sien.
 *
 * Les trois couleurs sont sémantiques et ne doivent jamais bouger : le vermillon
 * dit « saute », l'or dit « glisse », l'ardoise dit « change de ligne ». À
 * 28 m/s, c'est la couleur qu'on lit en premier — bien avant la forme.
 *
 * ⚠️ Comme les habillages de biome, son origine est AU SOL (y = 0) : la hauteur
 * est portée par la géométrie. `hits()` ne lit que x et z.
 */
/**
 * Trois sortes d'obstacles, donc trois blocs — et non un par obstacle croise.
 * Ils sont les plus nombreux de la course et rien ne les modifie : les tailler
 * une fois par sorte suffit (cf. la note sur le partage, plus haut).
 */
const _obstacle = new Map<Kind, { geo: THREE.BufferGeometry; mat: THREE.Material }>()

export function makeObstacleMesh(kind: Kind): THREE.Mesh {
  let piece = _obstacle.get(kind)
  if (!piece) {
    const t = TAILLE_OBSTACLE[kind]
    const couleur = kind === 'saut' ? 0xc33a2c : kind === 'glissade' ? 0xd6ac5a : 0x3a4258
    const geo = new THREE.BoxGeometry(t.larg, t.haut, t.prof)
    geo.translate(0, t.y, 0)
    piece = { geo, mat: new THREE.MeshStandardMaterial({ color: couleur, roughness: 0.7 }) }
    _obstacle.set(kind, piece)
  }
  return new THREE.Mesh(piece.geo, piece.mat)
}

/** Le torii sacré de l'arrivée : plus grand, tout en OR, avec la ligne au sol */
export function makeFinishGate(): THREE.Group {
  const g = new THREE.Group()
  const gold = new THREE.MeshStandardMaterial({
    color: 0xd6ac5a,
    roughness: 0.35,
    emissive: 0x5a4310, // il brille légèrement dans la nuit
  })

  // Le torii sacré reste le plus imposant : il domine les torii de décor d'un
  // bon mètre, sans quoi l'arrivée cesserait d'être un événement.
  for (const x of [-5.1, 5.1]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.6, 8.6, 0.6), gold)
    pillar.position.set(x, 4.3, 0)
    g.add(pillar)
  }
  const top = new THREE.Mesh(new THREE.BoxGeometry(12.2, 0.65, 0.9), gold)
  top.position.y = 8.8
  const mid = new THREE.Mesh(new THREE.BoxGeometry(10.4, 0.45, 0.7), gold)
  mid.position.y = 7.6
  g.add(top, mid)

  // La ligne d'arrivée peinte au sol — élargie avec la piste, sinon elle ne
  // barre plus les lignes extérieures.
  const line = new THREE.Mesh(
    new THREE.PlaneGeometry(9.2, 1.2),
    new THREE.MeshBasicMaterial({ color: 0xd6ac5a })
  )
  line.rotation.x = -Math.PI / 2
  line.position.y = 0.02
  g.add(line)

  return g
}

/** Un torii : deux piliers + deux linteaux, tout en rouge vermillon */
/**
 * ————— La charpente du torii —————
 *
 * Les quatre pièces, en DONNÉES : `[largeur, hauteur, profondeur]` et le centre.
 * Le portique et sa boîte de collision se construisent tous les deux à partir
 * d'ici — c'est la seule façon de garantir qu'ils ne divergeront jamais. Bouger
 * une poutre déplace du même coup ce qui l'arrête.
 *
 * ⚠️ LA HAUTEUR N'EST PAS DÉCORATIVE. Les deux traverses barrent TOUTE la
 * piste : à leur place d'origine (dessous à 3,50 m) la tête de Yasuke les
 * heurtait dès un saut au sol (3,57 m) et Hana s'y écrasait à 4,39 m — punie
 * pour sa qualité même. Et comme les torii défilent tous les 70 m sans rien
 * savoir des obstacles tirés au sort, on se serait retrouvé forcé de sauter une
 * barrière pile sous une traverse. Le portique est donc monté de 2,5 m : son
 * ouverture passe au-dessus du saut le plus haut du jeu (5,99 m, Hana depuis
 * une paroi), AVEC UNE VRAIE GARDE : 3 m de montée laissent 51 cm de dégagement
 * plutôt que le centimètre qu'aurait donné le strict nécessaire. Un centimètre
 * n'est pas une marge — la moindre retouche de l'impulsion l'aurait effacé en
 * silence. Voir `npm run torii:test`, qui exige ce dégagement.
 */
const TORII_MONTEE = 3

export const TORII_PIECES: { larg: number; haut: number; prof: number; x: number; y: number }[] = [
  /*
   * ⚠️ Les piliers sont à ±4,6 m, DERRIÈRE les parois qu'on longe (4,2 m).
   *
   * Ils étaient à ±3,6 m, ce qui allait tant que les parois se tenaient à
   * 3,5 m. L'élargissement des lignes (±2,2 → ±2,8) les a poussées à 4,2 :
   * plantés à 3,6, les piliers se seraient retrouvés DANS le mur. Un torii doit
   * enjamber toute la piste, sinon il n'enjambe plus rien.
   *
   * Les traverses suivent : 9,4 et 11 m de portée au lieu de 7,6 et 9.
   */
  { larg: 0.5, haut: 4.4 + TORII_MONTEE, prof: 0.5, x: -4.6, y: (4.4 + TORII_MONTEE) / 2 },
  { larg: 0.5, haut: 4.4 + TORII_MONTEE, prof: 0.5, x: 4.6, y: (4.4 + TORII_MONTEE) / 2 },
  { larg: 9.4, haut: 0.4, prof: 0.6, x: 0, y: 3.7 + TORII_MONTEE }, // la traverse
  { larg: 11, haut: 0.55, prof: 0.8, x: 0, y: 4.6 + TORII_MONTEE }, // le linteau
]

export function makeTorii(): THREE.Group {
  const g = new THREE.Group()
  const mat = new THREE.MeshStandardMaterial({ color: 0xc33a2c, roughness: 0.6 })

  // Le visuel est bâti d'après la MÊME table que la collision : un portique
  // qu'on voit et un portique qui arrête ne peuvent pas diverger.
  for (const p of TORII_PIECES) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(p.larg, p.haut, p.prof), mat)
    m.position.set(p.x, p.y, 0)
    g.add(m)
  }

  return g
}
