import * as THREE from 'three'

export type FighterId = 'yasuke' | 'hana' | 'onimaru' | 'tamae' | 'sasuke' | 'kurokumo' | 'perso'

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
  /** Proposé dans le menu ? */
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
  /** Le passif de Sasuke : une traînée d'éclair à chaque changement de ligne. */
  spark?: boolean
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
    // Sasuke n'est PAS un guerrier jouable (pickable: false → aucune vignette).
    // Il ne sert que de MODÈLE DE STYLE au perso « + » sans ornement (cf.
    // CUSTOM_STYLE) : ses réglages vivent ici, adressables par `fighterById`.
    id: 'sasuke',
    name: 'Sasuke',
    jp: '佐助',
    role: 'Vif · fragile',
    blurb: "Le ninja au Sharingan — le style par défaut du perso « + ».",
    passive: 'Œil du Sharingan — change de ligne en un éclair. Mais chaque choc lui coûte cher.',
    pickable: false,
    body: 0x1c2333, // bleu nuit
    band: 0xc0392b, // rouge Sharingan
    width: 0.66,
    head: 'rien',
    jump: 1,
    laneSpeed: 1.4, // l'esquive la plus vive — sa signature
    slide: 1,
    grip: 0.25, // …payée par le grip le plus faible : un choc le sonne
    spark: true, // l'éclair du Sharingan à chaque changement de ligne
  },
  {
    id: 'kurokumo',
    name: 'Kurokumo',
    jp: '黒雲',
    role: 'Rival · invaincu',
    blurb: '« Nuage noir ». Le champion à détrôner, le fantôme du tournoi.',
    passive: 'Le boss du Tournoi des Voies — pas encore jouable.',
    pickable: true,
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
//   · sans ornement → les réflexes de Sasuke (esquive éclair, fragile)
//   · cornes 🐂 → la peau d'oni d'Oni-Maru (encaisse, mais lourd)
//   · oreilles 🦊 → la ruse de Tamae (glissade longue, saut court)
// « Choisis ton ornement, choisis ton jeu. »

export const PERSO_ID: FighterId = 'perso'

/** L'ornement de tête → le guerrier dont le perso emprunte les réglages. */
export const CUSTOM_STYLE: Record<Head, FighterId> = {
  rien: 'sasuke',
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
  return '👁️ Œil du Sharingan — change de ligne en un éclair. Mais chaque choc lui coûte cher.'
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
    spark: style.spark, // l'éclair de Sasuke suit son style (sans ornement)
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

// ————————————————————————————————————————————————————————————
//  LE LOOK DES GUERRIERS
// ————————————————————————————————————————————————————————————
/*
 * Les pièces qu'on greffe sur le corps de base. Elles sont rangées À PART des
 * fiches (ROSTER) : la fiche décrit le JEU (passifs, réglages), ceci décrit
 * l'APPARENCE. On peut retoucher le look sans risquer de casser l'équilibrage.
 *
 * ⚠️ RÈGLE DE LISIBILITÉ — on voit les coureurs DE DOS, à 20 m, de nuit. Chaque
 * guerrier doit être reconnaissable à sa SILHOUETTE seule : la bannière de
 * Yasuke, l'écharpe de Hana, les cornes d'Oni-Maru, les queues de Tamae, la
 * cape de Kurokumo. La couleur ne suffit pas, elle se perd dans la brume.
 *
 * ⚠️ RÈGLE D'ÉQUITÉ — largeur et taille varient, mais c'est PUREMENT visuel :
 * la hitbox (player.ts) reste la même pour tout le monde.
 */
export type Arme = 'aucune' | 'katana' | 'nodachi' | 'kanabo' | 'kunai' | 'eventail'

interface Look {
  largeur: number
  taille: number
  capuche: boolean
  masque: 'aucun' | 'menpo' | 'oni' | 'tissu'
  ornement: 'aucun' | 'cornes' | 'cornesLongues' | 'oreilles'
  epaules: 'aucune' | 'legere' | 'lourde'
  dos: 'aucun' | 'sashimono' | 'cape'
  jupe: boolean
  queues: number
  echarpe: boolean
  arme: Arme
}

const LOOKS: Record<FighterId, Look> = {
  // Le seul en armure COMPLÈTE : c'est lui, la référence du jeu.
  yasuke: {
    largeur: 1, taille: 1, capuche: false, masque: 'menpo', ornement: 'aucun',
    epaules: 'lourde', dos: 'sashimono', jupe: false, queues: 0, echarpe: false,
    arme: 'katana',
  },
  // Aucune armure : elle doit paraître LÉGÈRE au premier coup d'œil.
  // L'écharpe qui flotte derrière dit la vitesse.
  hana: {
    largeur: 0.78, taille: 0.95, capuche: true, masque: 'tissu', ornement: 'aucun',
    epaules: 'aucune', dos: 'aucun', jupe: false, queues: 0, echarpe: true,
    arme: 'kunai',
  },
  // Le plus large et le plus massif. Pas de kasa : il écrasait les cornes et
  // le masque, qui sont justement son identité (« brute masquée en oni »).
  // Deux marqueurs de silhouette qui se recouvrent, c'est un marqueur perdu.
  onimaru: {
    largeur: 1.22, taille: 1.06, capuche: false, masque: 'oni', ornement: 'cornes',
    epaules: 'lourde', dos: 'aucun', jupe: false, queues: 0, echarpe: false,
    arme: 'kanabo',
  },
  // Les trois queues sont LA signature : aucune autre silhouette du roster
  // n'a quoi que ce soit derrière.
  tamae: {
    largeur: 0.86, taille: 0.97, capuche: false, masque: 'aucun', ornement: 'oreilles',
    epaules: 'legere', dos: 'aucun', jupe: true, queues: 3, echarpe: false,
    arme: 'eventail',
  },
  // Le champion invaincu : le plus grand, longues cornes, cape, et un nodachi
  // démesuré qui déborde de sa silhouette.
  kurokumo: {
    largeur: 1.05, taille: 1.1, capuche: false, masque: 'menpo', ornement: 'cornesLongues',
    epaules: 'lourde', dos: 'cape', jupe: false, queues: 0, echarpe: false,
    arme: 'nodachi',
  },
  // Sasuke: style ninja vif, de base sans armure ni ornement
  sasuke: {
    largeur: 0.8, taille: 1, capuche: false, masque: 'aucun', ornement: 'aucun',
    epaules: 'aucune', dos: 'aucun', jupe: false, queues: 0, echarpe: false,
    arme: 'katana',
  },
  // Perso: le guerrier personnalisable
  perso: {
    largeur: 0.8, taille: 1, capuche: false, masque: 'aucun', ornement: 'aucun',
    epaules: 'aucune', dos: 'aucun', jupe: false, queues: 0, echarpe: false,
    arme: 'katana',
  },
}

const PEAU = 0x8d6748

/** Un membre articulé : un pivot au joint, l'articulation du bas, la main */
interface Membre {
  pivot: THREE.Group
  bas: THREE.Group
  main?: THREE.Group
}

/** Le corps articulé, avec de quoi l'animer */
export interface Corps {
  bassin: THREE.Group
  torse: THREE.Group
  tete: THREE.Group
  brasG: Membre
  brasD: Membre
  jambeG: Membre
  jambeD: Membre
  porteArme: boolean
  /** Ce qui traîne derrière (queues, écharpe, cape) et doit onduler */
  flottants: THREE.Object3D[]
}

function boite(w: number, h: number, d: number, mat: THREE.Material, y = 0, x = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
  m.position.set(x, y, z)
  return m
}

/**
 * Fabrique le corps d'un guerrier : bassin, torse, tête, deux bras, deux
 * jambes — chacun dans son Group, pour pouvoir TOURNER.
 *
 * Le principe de l'articulation : un pivot placé AU JOINT, et le mesh décalé
 * vers le bas à l'intérieur. Tourner le pivot fait pivoter tout le membre
 * autour de l'épaule ou de la hanche.
 *
 * En mode `ghost`, tout est semi-transparent : c'est comme ça qu'on affiche le
 * rival. Au départ et à chaque dépassement les deux coureurs se superposent —
 * il faut voir à travers.
 *
 * Renvoie un seul Object3D (la racine) pour ne pas changer le contrat des
 * appelants. Le corps articulé est rangé dans `racine.userData.corps` :
 * c'est ce que lit animerCourse().
 */
export function buildFighter(f: Fighter, ghost = false): THREE.Object3D[] {
  const d = LOOKS[f.id] ?? LOOKS.yasuke
  const ornement = f.id === 'perso'
    ? (f.head === 'cornes' ? 'cornes' : f.head === 'oreilles' ? 'oreilles' : 'aucun')
    : d.ornement
  const opa = (o: number) => (ghost ? { transparent: true, opacity: o } : {})

  const matCorps = new THREE.MeshStandardMaterial({ color: f.body, roughness: 0.62, ...opa(0.55) })
  const matAccent = new THREE.MeshStandardMaterial({ color: f.band, roughness: 0.5, ...opa(0.75) })
  const matPeau = new THREE.MeshStandardMaterial({ color: PEAU, roughness: 0.8, ...opa(0.55) })
  const matFer = new THREE.MeshStandardMaterial({
    color: 0x2b2f3a, roughness: 0.45, metalness: 0.3, ...opa(0.55),
  })

  const L = d.largeur
  const flottants: THREE.Object3D[] = []

  const racine = new THREE.Group()
  racine.scale.setScalar(d.taille)

  const bassin = new THREE.Group()
  bassin.position.y = 0.72
  racine.add(bassin)

  // ————— Les jambes —————
  function jambe(cote: number): Membre {
    const pivot = new THREE.Group()
    pivot.position.set(0.13 * L * cote, 0, 0)
    pivot.add(boite(0.19 * L, 0.38, 0.2, matCorps, -0.19))

    const bas = new THREE.Group() // le genou
    bas.position.y = -0.38
    bas.add(boite(0.16 * L, 0.36, 0.18, matCorps, -0.18))
    bas.add(boite(0.18 * L, 0.1, 0.26, matFer, -0.36, 0, 0.04)) // le pied
    pivot.add(bas)

    bassin.add(pivot)
    return { pivot, bas }
  }
  const jambeG = jambe(-1)
  const jambeD = jambe(1)

  // ————— Le torse —————
  const torse = new THREE.Group()
  bassin.add(torse)
  torse.add(boite(0.46 * L, 0.3, 0.28, matCorps, 0.16)) // la taille
  torse.add(boite(0.54 * L, 0.26, 0.3, matCorps, 0.42)) // le buste, plus large
  torse.add(boite(0.48 * L, 0.1, 0.3, matAccent, 0.02)) // l'obi, la ceinture
  torse.add(boite(0.44 * L, 0.14, 0.26, matFer, -0.08)) // les lamelles de cuisse

  if (d.jupe) {
    for (const c of [-1, 1]) {
      const pan = boite(0.2 * L, 0.34, 0.06, matAccent, -0.2, 0.15 * L * c, 0.13)
      pan.rotation.x = 0.15
      torse.add(pan)
      flottants.push(pan)
    }
  }

  // ————— Les bras —————
  function bras(cote: number): Membre {
    const pivot = new THREE.Group()
    // L'épaule MORD sur le torse : écartée, le bras flotte à côté du corps
    // et le personnage a l'air démonté.
    pivot.position.set(0.29 * L * cote, 0.48, 0)
    pivot.add(boite(0.15 * L, 0.32, 0.16, matCorps, -0.16))

    const bas = new THREE.Group() // le coude
    bas.position.y = -0.32
    bas.add(boite(0.13 * L, 0.3, 0.14, matPeau, -0.15))
    bas.add(boite(0.15 * L, 0.12, 0.16, matAccent, -0.32)) // le gant

    // La MAIN : un Group vide au bout. Ce qu'on y accroche suit l'épaule ET
    // le coude sans une ligne de code en plus.
    const main = new THREE.Group()
    main.position.y = -0.38
    bas.add(main)
    pivot.add(bas)

    torse.add(pivot)
    return { pivot, bas, main }
  }
  const brasG = bras(-1)
  const brasD = bras(1)

  // ————— Les épaulières (sode) —————
  if (d.epaules !== 'aucune') {
    const gros = d.epaules === 'lourde'
    for (const c of [-1, 1]) {
      const s = boite(
        (gros ? 0.26 : 0.18) * L, gros ? 0.28 : 0.2, gros ? 0.32 : 0.24,
        matAccent, gros ? 0.44 : 0.46, 0.34 * L * c
      )
      s.rotation.z = -0.32 * c
      torse.add(s)
    }
  }

  // ————— La tête —————
  const tete = new THREE.Group()
  tete.position.y = 0.6
  torse.add(tete)
  tete.add(boite(0.14, 0.06, 0.14, matPeau, 0.01)) // le cou
  // Une tête un peu GROSSE : c'est ce qui donne le charme figurine. Trop
  // petite, le perso fait maigre et devient illisible de loin.
  tete.add(boite(0.3, 0.3, 0.3, matPeau, 0.15))

  if (d.capuche) {
    tete.add(boite(0.35, 0.33, 0.35, matCorps, 0.16))
    tete.add(boite(0.37, 0.2, 0.12, matCorps, 0.18, 0, -0.14))
  } else {
    tete.add(boite(0.32, 0.08, 0.32, matAccent, 0.23)) // le hachimaki
  }

  if (d.masque === 'menpo') {
    tete.add(boite(0.27, 0.12, 0.1, matFer, 0.09, 0, 0.12))
  } else if (d.masque === 'tissu') {
    tete.add(boite(0.29, 0.14, 0.1, matAccent, 0.1, 0, 0.12))
  } else if (d.masque === 'oni') {
    // Le masque d'oni mange tout le visage, avec deux crocs qui dépassent
    tete.add(boite(0.32, 0.22, 0.1, matAccent, 0.14, 0, 0.13))
    for (const c of [-1, 1]) {
      const croc = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.09, 4), matFer)
      croc.position.set(0.07 * c, 0.03, 0.15)
      croc.rotation.x = Math.PI
      tete.add(croc)
    }
  }

  if (ornement === 'cornes' || ornement === 'cornesLongues') {
    const longue = ornement === 'cornesLongues'
    for (const c of [-1, 1]) {
      const corne = new THREE.Mesh(
        new THREE.ConeGeometry(longue ? 0.045 : 0.055, longue ? 0.46 : 0.3, 5), matAccent
      )
      corne.position.set(0.1 * c, longue ? 0.48 : 0.4, 0)
      corne.rotation.z = (longue ? -0.28 : -0.4) * c
      tete.add(corne)
    }
  } else if (ornement === 'oreilles') {
    for (const c of [-1, 1]) {
      const oreille = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.24, 4), matAccent)
      oreille.position.set(0.11 * c, 0.38, 0)
      oreille.rotation.z = -0.26 * c
      tete.add(oreille)
    }
  }

  // ————— Le dos —————
  if (d.dos === 'sashimono') {
    // La bannière de clan : penchée en arrière, et surtout PLUS HAUTE que le
    // crâne — à hauteur de tête, elle se lisait comme un chapeau-cheminée.
    const hampe = new THREE.Group()
    hampe.position.set(0, 0.42, -0.16)
    hampe.rotation.x = 0.3
    hampe.add(boite(0.035, 1.15, 0.035, matFer, 0.575))
    hampe.add(boite(0.3, 0.5, 0.02, matAccent, 0.99, 0, -0.02))
    torse.add(hampe)
  } else if (d.dos === 'cape') {
    // ⚠️ Dans la couleur du corps, la cape était INVISIBLE de dos — une masse
    // sombre sur une masse sombre. On la fonce, et surtout on la BORDE
    // d'accent : c'est le liseré qui dessine la forme, pas la toile.
    const matCape = new THREE.MeshStandardMaterial({
      color: new THREE.Color(f.body).multiplyScalar(0.55), roughness: 0.75, ...opa(0.55),
    })
    const cape = new THREE.Group()
    cape.position.set(0, 0.5, -0.19)
    cape.add(boite(0.66 * L, 1.0, 0.04, matCape, -0.48))
    cape.add(boite(0.68 * L, 0.09, 0.07, matAccent, 0.02)) // le col
    cape.add(boite(0.66 * L, 0.07, 0.05, matAccent, -0.97)) // l'ourlet
    torse.add(cape)
    flottants.push(cape)
  }

  // ————— Les queues de renard —————
  for (let i = 0; i < d.queues; i++) {
    const queue = new THREE.Group()
    // Haut et bien EN ARRIÈRE : plus bas, elles se noyaient dans les jambes.
    queue.position.set(0, 0.12, -0.16)
    const ecart = d.queues === 1 ? 0 : (i / (d.queues - 1) - 0.5) * 1.1
    queue.rotation.z = ecart
    queue.rotation.x = -0.95

    queue.add(boite(0.11, 0.5, 0.11, matCorps, 0.25))
    queue.add(boite(0.115, 0.16, 0.115, matAccent, 0.55)) // le bout blanc du kitsune
    torse.add(queue)
    flottants.push(queue)
  }

  // ————— L'écharpe —————
  if (d.echarpe) {
    // Décalée sur le côté et bien en arrière : dans l'axe du dos, elle
    // disparaissait derrière le corps quand on court de dos.
    const echarpe = new THREE.Group()
    echarpe.position.set(0.1, 0.5, -0.24)
    echarpe.rotation.x = -0.75
    echarpe.rotation.z = 0.3
    echarpe.add(boite(0.17, 0.66, 0.03, matAccent, -0.3))
    echarpe.add(boite(0.14, 0.34, 0.03, matAccent, -0.76, 0.06))
    torse.add(echarpe)
    flottants.push(echarpe)
  }

  // ————— L'arme, accrochée à la main droite —————
  if (d.arme !== 'aucune' && brasD.main) {
    brasD.main.add(fabriquerArme(d.arme, matAccent, matFer, ghost))
  }

  /*
   * ————— ⚠️ LE DEMI-TOUR : à lire avant de toucher aux positions —————
   *
   * Tout ce corps est modelé FACE À +Z : le masque et le menpo sont posés en
   * z positif, tandis que les queues, l'écharpe, la cape et le pan de capuche
   * sont en z négatif — leurs commentaires disent bien « en arrière ».
   *
   * Mais le jeu fait avancer le coureur vers -Z : le décor défile vers +Z et
   * sort derrière la caméra. Sans ce demi-tour, le guerrier court à reculons —
   * ses queues lui battaient devant le nez et son visage était dans son dos.
   *
   * On tourne donc la racine plutôt que de déplacer trente pièces une à une :
   * une seule ligne, et rien ne peut être oublié en chemin.
   *
   * 🔗 `tools/cuire-anims.mjs` en dépend : Mixamo modèle AUSSI face à +Z, donc
   * les deux repères coïncident et la cuisson ne retourne rien. Enlever ce
   * demi-tour sans toucher à la cuisson ferait courir tout le monde à l'envers.
   */
  racine.rotation.y = Math.PI

  const corps: Corps = {
    bassin, torse, tete, brasG, brasD, jambeG, jambeD,
    porteArme: d.arme !== 'aucune', flottants,
  }
  racine.userData.corps = corps
  return [racine]
}

/**
 * Les armes. Chacune est bâtie la poignée À L'ORIGINE et la lame vers le +Y :
 * c'est la poignée qu'on tient, donc c'est elle qui doit être au point
 * d'attache. Le groupe est ensuite incliné pour la pose de course.
 */
function fabriquerArme(
  type: Arme, matAccent: THREE.Material, matFer: THREE.Material, ghost: boolean
): THREE.Group {
  const g = new THREE.Group()
  const opa = ghost ? { transparent: true, opacity: 0.55 } : {}
  const matBois = new THREE.MeshStandardMaterial({ color: 0x4a3524, roughness: 0.9, ...opa })
  // Claire et PEU métallique : trop de metalness et la lame ne renvoie que le
  // ciel de nuit — donc elle noircit au lieu de briller.
  const matLame = new THREE.MeshStandardMaterial({
    color: 0xdde4f0, roughness: 0.3, metalness: 0.15, ...opa,
  })

  if (type === 'katana' || type === 'nodachi') {
    const grand = type === 'nodachi'
    g.add(boite(0.05, grand ? 0.22 : 0.17, 0.05, matBois, 0)) // tsuka
    g.add(boite(0.13, 0.025, 0.13, matAccent, grand ? 0.12 : 0.095)) // tsuba
    // Une lame fine DISPARAÎT à distance de jeu : on l'épaissit sans vergogne.
    // C'est de la lisibilité, pas du réalisme.
    g.add(boite(0.055, grand ? 0.85 : 0.58, 0.03, matLame, grand ? 0.56 : 0.4))
    g.rotation.x = 0.75
    g.rotation.z = 0.15
  } else if (type === 'kanabo') {
    g.add(boite(0.06, 0.24, 0.06, matBois, 0))
    g.add(boite(0.14, 0.62, 0.14, matBois, 0.44))
    for (let i = 0; i < 5; i++) {
      for (const c of [-1, 1]) {
        const clou = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.06, 4), matFer)
        clou.position.set(0.08 * c, 0.22 + i * 0.12, 0)
        clou.rotation.z = (Math.PI / 2) * -c
        g.add(clou)
      }
    }
    g.rotation.x = 0.7
    g.rotation.z = 0.18
  } else if (type === 'eventail') {
    // Le tessen, l'éventail de guerre : plat, large, très lisible
    g.add(boite(0.04, 0.12, 0.04, matBois, 0))
    g.add(boite(0.34, 0.3, 0.02, matAccent, 0.22))
    g.rotation.x = 0.9
    g.rotation.z = 0.2
  } else {
    g.add(boite(0.035, 0.1, 0.035, matFer, 0)) // kunai
    g.add(boite(0.06, 0.02, 0.06, matAccent, 0.06))
    const lame = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.24, 4), matLame)
    lame.position.y = 0.19
    g.add(lame)
    g.rotation.x = 0.9
  }

  return g
}

/**
 * Le cycle de course, entièrement calculé — aucune animation importée.
 * Bras et jambes en opposition, rebond à chaque appui, buste penché : c'est
 * ce qui fait qu'on croit à la course.
 *
 * `racine` est l'objet renvoyé par buildFighter. Un objet sans corps articulé
 * est simplement ignoré — la fonction est sûre à appeler partout.
 * `intensite` à 0 remet la pose de repos (au menu, à l'arrêt).
 */
export function animerCourse(racine: THREE.Object3D | undefined, t: number, intensite = 1) {
  const g = racine?.userData?.corps as Corps | undefined
  if (!g) return

  const ph = t * 11 // la cadence de la foulée

  g.jambeG.pivot.rotation.x = Math.sin(ph) * 0.85 * intensite
  g.jambeD.pivot.rotation.x = Math.sin(ph + Math.PI) * 0.85 * intensite
  // Le genou ne se plie que vers l'arrière — jamais dans l'autre sens
  g.jambeG.bas.rotation.x = Math.max(0, -Math.sin(ph - 0.6)) * 1.15 * intensite
  g.jambeD.bas.rotation.x = Math.max(0, -Math.sin(ph + Math.PI - 0.6)) * 1.15 * intensite

  g.brasG.pivot.rotation.x = Math.sin(ph + Math.PI) * 0.7 * intensite
  g.brasG.bas.rotation.x = -0.5 - Math.sin(ph) * 0.3 * intensite

  if (g.porteArme) {
    // Le bras qui PORTE se verrouille, coude plié contre le buste. Laissé
    // libre, il balançait de 40° et promenait la lame dans les jambes.
    g.brasD.pivot.rotation.x = -0.3 + Math.sin(ph) * 0.1 * intensite
    g.brasD.bas.rotation.x = -1.15
  } else {
    g.brasD.pivot.rotation.x = Math.sin(ph) * 0.7 * intensite
    g.brasD.bas.rotation.x = -0.5 + Math.sin(ph) * 0.3 * intensite
  }

  // Le rebond : deux fois par cycle, un par appui de pied
  g.bassin.position.y = 0.72 + Math.abs(Math.sin(ph)) * 0.05 * intensite
  g.torse.rotation.x = -0.12 * intensite
  g.torse.rotation.z = Math.sin(ph) * 0.05 * intensite
  g.tete.rotation.x = 0.1 * intensite

  // Ce qui traîne derrière ondule PLUS LENTEMENT que la foulée, et en retard :
  // à la même cadence, queues et cape auraient l'air vissées au corps.
  for (let i = 0; i < g.flottants.length; i++) {
    const f = g.flottants[i]
    const repos = (f.userData.repos ??= f.rotation.x)
    f.rotation.x = repos + Math.sin(ph * 0.45 - 0.6 + i * 0.5) * 0.16 * intensite
  }
}

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
