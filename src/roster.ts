import * as THREE from 'three'

export type FighterId = 'yasuke' | 'hana' | 'onimaru' | 'tamae' | 'kurokumo' | 'perso'

/** L'ornement de tête d'un guerrier — le « chapeau » de la personnalisation. */
export type Head = 'rien' | 'cornes' | 'oreilles'

/**
 * Un guerrier du Tournoi des Voies.
 *
 * Ce fichier est la SOURCE DE VÉRITÉ unique : le menu de sélection, le joueur,
 * le rival et l'aperçu 3D lisent tous la même fiche. Pour ajouter un perso, il
 * suffit d'ajouter une entrée dans ROSTER — le reste du jeu suit tout seul.
 */
export interface Fighter {
  id: FighterId
  name: string
  jp: string
  role: string
  blurb: string
  /** Le mini-passif, expliqué au joueur en une phrase */
  passive: string
  /** Proposé dans le menu ? (Kurokumo est le boss du tournoi : pas encore jouable) */
  pickable: boolean

  // ————— Le look —————
  /** Couleur de l'armure */
  body: number
  /** Couleur du bandeau — le panache du guerrier */
  band: number
  /**
   * Largeur des épaules. PUREMENT visuel : voir buildFighter().
   */
  width: number
  head: Head

  // ————— Les réglages de jeu —————
  /*
   * Yasuke est la RÉFÉRENCE : tout est à 1 chez lui. Les trois autres ont un
   * bonus ET un malus — sinon un seul perso serait le bon choix, et le menu
   * ne serait qu'un piège. Yasuke, lui, n'a aucun point faible : c'est ça, son
   * intérêt.
   *
   * Les passifs ne touchent JAMAIS au sprint final : son calibrage (cf. README)
   * repose sur le fait que tout le monde est à armes égales dans les 120
   * derniers mètres.
   */
  /** Multiplicateur d'impulsion de saut */
  jump: number
  /** Multiplicateur de vitesse de changement de ligne */
  laneSpeed: number
  /** Multiplicateur de durée de glissade */
  slide: number
  /** Part de la vitesse GARDÉE quand on trébuche. 0,35 = la référence. */
  grip: number
}

export const ROSTER: Fighter[] = [
  {
    id: 'yasuke',
    name: 'Yasuke',
    jp: '弥助',
    role: 'Équilibré · robuste',
    blurb:
      "Le samouraï africain d'Oda Nobunaga. Armure d'acier noir, solide et polyvalent — le guerrier de départ.",
    passive: 'La voie du milieu — aucun bonus… mais aucun point faible.',
    pickable: true,
    body: 0x23252d,
    band: 0xc33a2c,
    width: 0.8,
    head: 'rien',
    jump: 1,
    laneSpeed: 1,
    slide: 1,
    grip: 0.35,
  },
  {
    id: 'hana',
    name: 'Hana la Kunoichi',
    jp: '花',
    role: 'Agile · fragile',
    blurb: 'Ninja rapide et nerveuse. Elle vole au-dessus des barrières et change de ligne en un souffle.',
    passive: 'Saut de la grue — saute haut, esquive vite. Mais elle trébuche plus durement.',
    pickable: true,
    body: 0x24405f,
    band: 0xe4dcc8,
    width: 0.62,
    head: 'rien',
    jump: 1.18,
    laneSpeed: 1.3,
    slide: 1,
    grip: 0.28,
  },
  {
    id: 'onimaru',
    name: 'Oni-Maru',
    jp: '鬼丸',
    role: 'Lourd · tenace',
    blurb: "Brute masquée en oni. Un choc ne l'arrête pas — mais la souplesse, ce n'est pas son fort.",
    passive: "Peau d'oni — garde bien plus de vitesse quand il trébuche. Mais saut court et esquive lente.",
    pickable: true,
    body: 0x5c2a26,
    band: 0xd6ac5a,
    width: 0.95,
    head: 'cornes',
    jump: 0.88,
    laneSpeed: 0.8,
    slide: 1,
    grip: 0.52,
  },
  {
    id: 'tamae',
    name: 'Tamae la Kitsune',
    jp: '玉恵',
    role: 'Rusée · glissante',
    blurb: 'Esprit-renard malicieux. Elle passe sous tout ce qui dépasse.',
    passive: 'Ruse du renard — glissade bien plus longue, esquive vive. Mais son saut est court.',
    pickable: true,
    body: 0xc86a2e,
    band: 0xf1ebdb,
    width: 0.7,
    head: 'oreilles',
    jump: 0.9,
    laneSpeed: 1.15,
    slide: 1.6,
    grip: 0.35,
  },
  {
    id: 'kurokumo',
    name: 'Kurokumo',
    jp: '黒雲',
    role: 'Rival · invaincu',
    blurb: '« Nuage noir ». Le champion à détrôner, le fantôme du tournoi.',
    passive: 'Le boss du Tournoi des Voies — pas encore jouable.',
    pickable: false,
    body: 0x2e2333,
    band: 0xd6ac5a,
    width: 0.85,
    head: 'cornes',
    jump: 1,
    laneSpeed: 1,
    slide: 1,
    grip: 0.35,
  },
]

// ————— Le guerrier PERSO (façon Among Us) —————
//
// Un skin que le joueur forge : deux couleurs ET un ornement de tête. Mais
// l'ornement n'est PAS que décoratif : il décide du STYLE de jeu du perso.
//   · sans ornement → l'équilibre de Yasuke (la référence, aucun point faible)
//   · cornes 🐂 → la peau d'oni d'Oni-Maru (encaisse, mais lourd)
//   · oreilles 🦊 → la ruse de Tamae (glissade longue, saut court)
// « Choisis ton ornement, choisis ton jeu. »

export const PERSO_ID: FighterId = 'perso'

/** L'ornement de tête → le guerrier dont le perso emprunte les réglages. */
export const CUSTOM_STYLE: Record<Head, FighterId> = {
  rien: 'yasuke',
  cornes: 'onimaru',
  oreilles: 'tamae',
}

/** Ce que le joueur choisit dans le vestiaire — le reste du perso est figé. */
export interface CustomSkin {
  body: number
  band: number
  head: Head
}

export const HEADS: Head[] = ['rien', 'cornes', 'oreilles']

/**
 * La palette du vestiaire. Un jeu de couleurs FERMÉ, comme les teintes d'Among
 * Us : plus lisible qu'une roue chromatique sur mobile, et toutes s'accordent à
 * la nuit indigo du jeu. On y retrouve les couleurs du roster, plus quelques
 * autres pour se démarquer.
 */
export const SKIN_PALETTE: number[] = [
  0xc33a2c, 0xe24b3a, 0xe58a2c, 0xd6ac5a, 0xe6c66a, 0x8fce7a,
  0x3a7a5c, 0x74dba6, 0x3c5a86, 0x4d8fd6, 0x6bb6d8, 0xb98cff,
  0xd86aa8, 0xf09ac0, 0xe4dcc8, 0x9aa4c0, 0x2e2333, 0x23252d,
]

/** Le skin de départ : un vert jade et un bandeau or, distinct du roster. */
export const DEFAULT_CUSTOM: CustomSkin = { body: 0x3a7a5c, band: 0xe6c66a, head: 'rien' }

/** Le passif du perso selon son ornement — la même phrase qui s'affiche au menu. */
function passifPerso(head: Head): string {
  if (head === 'cornes')
    return '🐂 Cornes d\'oni — garde bien plus de vitesse quand il trébuche. Mais lourd, esquive lente.'
  if (head === 'oreilles')
    return '🦊 Oreilles de renard — glissade très longue, esquive vive. Mais saut court.'
  return '👤 Sans ornement — équilibré comme Yasuke : aucun bonus, mais aucun point faible.'
}

/**
 * Assemble le guerrier perso à partir du skin sauvegardé. Ses COULEURS viennent
 * du skin ; ses RÉGLAGES DE JEU, eux, viennent du guerrier que l'ornement
 * désigne (cf. CUSTOM_STYLE) — Sasuke par défaut, l'oni avec des cornes, le
 * renard avec des oreilles. La largeur reste neutre : seul le style change,
 * pas la hitbox (identique pour tous, cf. player.ts).
 */
export function customFighter(skin: CustomSkin): Fighter {
  const style = fighterById(CUSTOM_STYLE[skin.head]) // l'ornement décide du style
  return {
    id: PERSO_ID,
    name: 'Mon guerrier',
    jp: '改', // « kai » : refondre, remodeler
    role: `Skin perso · ${style.role.split(' · ')[0].toLowerCase()}`,
    blurb: 'Un guerrier à tes couleurs. Son ornement décide de son style de jeu !',
    passive: passifPerso(skin.head),
    pickable: true,
    body: skin.body,
    band: skin.band,
    width: 0.8, // silhouette neutre : les couleurs et l'ornement font le look
    head: skin.head,
    // Les réglages de jeu empruntés au style choisi par l'ornement
    jump: style.jump,
    laneSpeed: style.laneSpeed,
    slide: style.slide,
    grip: style.grip,
  }
}

const BY_ID = new Map(ROSTER.map((f) => [f.id, f]))

/**
 * Retrouve un guerrier par son identifiant.
 * Inconnu (vieille sauvegarde, message réseau bizarre…) → Yasuke : le jeu ne
 * doit jamais planter à cause d'un nom de perso qu'il ne connaît pas.
 */
export function fighterById(id: string | null | undefined): Fighter {
  return BY_ID.get(id as FighterId) ?? ROSTER[0]
}

/** La couleur, en '#rrggbb', pour le CSS du menu */
export function cssColor(c: number) {
  return '#' + c.toString(16).padStart(6, '0')
}

/**
 * Fabrique le corps d'un guerrier : un tronc, un bandeau, plus des cornes ou
 * des oreilles selon le personnage.
 *
 * En mode `ghost`, tout est semi-transparent : c'est comme ça qu'on affiche le
 * rival. Au départ et à chaque dépassement les deux coureurs se superposent —
 * il faut voir à travers.
 *
 * ⚠️ La largeur (`width`) change d'un guerrier à l'autre, mais c'est PUREMENT
 * décoratif : la hitbox (player.ts) est identique pour tout le monde. Sinon
 * Hana, plus fine, aurait un avantage invisible que personne n'aurait choisi.
 */
export function buildFighter(f: Fighter, ghost = false): THREE.Object3D[] {
  const w = f.width
  const parts: THREE.Object3D[] = []

  const bodyMat = new THREE.MeshStandardMaterial({
    color: f.body,
    roughness: 0.55,
    transparent: ghost,
    opacity: ghost ? 0.55 : 1,
  })
  const bandMat = new THREE.MeshStandardMaterial({
    color: f.band,
    roughness: 0.5,
    transparent: ghost,
    opacity: ghost ? 0.75 : 1,
  })

  const body = new THREE.Mesh(new THREE.BoxGeometry(w, 1.5, 0.8), bodyMat)
  body.position.y = 0.75
  parts.push(body)

  const band = new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, 0.14, 0.84), bandMat)
  band.position.y = 1.26
  parts.push(band)

  if (f.head === 'cornes') {
    for (const x of [-w * 0.3, w * 0.3]) {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.34, 6), bandMat)
      horn.position.set(x, 1.55, 0)
      parts.push(horn)
    }
  } else if (f.head === 'oreilles') {
    for (const x of [-w * 0.32, w * 0.32]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.3, 4), bandMat)
      ear.position.set(x, 1.52, 0)
      ear.rotation.z = x < 0 ? 0.28 : -0.28
      parts.push(ear)
    }
  }

  return parts
}

/**
 * Range le guerrier précédent avant d'en afficher un autre : sans ça, changer
 * de perso 20 fois dans le menu laisserait 20 corps dans la mémoire de la carte
 * graphique.
 */
export function clearFighter(group: THREE.Group) {
  const seen = new Set<THREE.Material | THREE.BufferGeometry>()
  group.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    // Le bandeau, les cornes et les oreilles PARTAGENT un matériau :
    // on ne le libère qu'une fois.
    for (const item of [m.geometry, m.material as THREE.Material]) {
      if (item && !seen.has(item)) {
        seen.add(item)
        item.dispose()
      }
    }
  })
  group.clear()
}
