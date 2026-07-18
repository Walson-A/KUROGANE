/**
 * ————— La cuisson des animations —————
 *
 * Les .fbx déposés dans animation/ sont des exports Mixamo « sans peau » :
 * 65 os, AUCUN maillage. Ils ne peuvent donc pas s'afficher tels quels — nos
 * guerriers, eux, sont des empilements de boîtes montés dans roster.ts.
 *
 * Ce script fait le pont : il RECIBLE le mouvement des os Mixamo sur notre
 * petit squelette à boîtes, puis l'écrit en JSON compact.
 *
 * Pourquoi cuire hors ligne plutôt que charger les FBX dans le navigateur ?
 * Les 21 fichiers pèsent 9 Mo, plus 200 Ko de FBXLoader. Une fois cuits, les
 * mêmes mouvements tiennent dans quelques dizaines de Ko — et le jeu garde sa
 * promesse : rien de lourd à télécharger sur mobile.
 *
 *   node tools/cuire-anims.mjs
 */
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import * as THREE from 'three'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

const SOURCE = 'animation'
const SORTIE = 'src/anims-cuites.json'
const FPS = 30
/** 3 décimales : au-delà, on paye des octets pour des angles invisibles. */
const PRECISION = 1000

/*
 * ————— Le reciblage —————
 *
 * Mixamo modèle FACE À +Z. Notre corps à boîtes aussi : masque en z positif,
 * queues et écharpe en z négatif. Les deux repères COÏNCIDENT, donc il n'y a
 * rien à retourner ici.
 *
 * 🔗 C'est `buildFighter` qui tourne la racine d'un demi-tour pour faire face
 * au sens de la marche (le coureur avance vers -Z). Toucher à l'un sans
 * l'autre ferait courir tout le monde à reculons — voir le commentaire en fin
 * de buildFighter, dans roster.ts.
 */

/** Vers le BAS : la pose de repos de nos membres (le mesh pend sous le pivot) */
const BAS = new THREE.Vector3(0, -1, 0)
/** Vers le HAUT : la pose de repos du torse et de la tête */
const HAUT = new THREE.Vector3(0, 1, 0)

/**
 * Chaque articulation de notre rig, dans l'ORDRE HIÉRARCHIQUE (parent d'abord).
 * `de` → `vers` : les deux os Mixamo dont l'écart donne la direction du membre.
 * `parent` : l'articulation au-dessus, dont on hérite l'orientation.
 */
const JOINTS = [
  { nom: 'torse', parent: null, repos: HAUT, de: 'Spine', vers: 'Neck' },
  { nom: 'tete', parent: 'torse', repos: HAUT, de: 'Neck', vers: 'Head' },
  { nom: 'brasG', parent: 'torse', repos: BAS, de: 'LeftArm', vers: 'LeftForeArm' },
  { nom: 'brasGbas', parent: 'brasG', repos: BAS, de: 'LeftForeArm', vers: 'LeftHand' },
  { nom: 'brasD', parent: 'torse', repos: BAS, de: 'RightArm', vers: 'RightForeArm' },
  { nom: 'brasDbas', parent: 'brasD', repos: BAS, de: 'RightForeArm', vers: 'RightHand' },
  { nom: 'jambeG', parent: null, repos: BAS, de: 'LeftUpLeg', vers: 'LeftLeg' },
  { nom: 'jambeGbas', parent: 'jambeG', repos: BAS, de: 'LeftLeg', vers: 'LeftFoot' },
  { nom: 'jambeD', parent: null, repos: BAS, de: 'RightUpLeg', vers: 'RightLeg' },
  { nom: 'jambeDbas', parent: 'jambeD', repos: BAS, de: 'RightLeg', vers: 'RightFoot' },
]

/**
 * Quel fichier joue quel rôle, d'après son nom.
 *
 * Quand plusieurs fichiers visent le même rôle, on ne prend PAS le premier
 * venu : on les départage sur ce qu'ils font réellement (cf. `note`). Un nom
 * de fichier ment souvent — la courbe des os, jamais.
 */
/*
 * ⚠️ L'ORDRE COMPTE : le premier rôle dont un motif accroche gagne. Les cas
 * précis passent donc AVANT les génériques — sans quoi « Run Forward Arc
 * Left » serait pris pour une course par /^Run\b/ et le virage se perdrait.
 *
 * Le côté d'un virage n'est PAS lu dans le nom : deux fichiers peuvent
 * s'appeler « Running Arc » et « Running Arc (1) » sans rien dire du côté.
 * C'est la dérive latérale des hanches qui tranche, plus bas.
 */
const ACTIONS = {
  virage: [/Arc/i],
  lancer: [/Fireball/i],
  impact: [/Impact/i],
  attaque: [/Slammer/i],
  courseGenee: [/Injured Run/i, /Drunk Run/i],
  mur: [/Wall Run/i],
  glissade: [/Slide/i],
  chute: [/Defeated/i],
  saut: [/Jump/i],
  course: [/^Fast Run/i, /^Run\b/i, /^Running\./i],
}

/**
 * Les clips trop longs pour le jeu, ramenés à leur geste utile.
 * Les bornes viennent de la mesure, pas du ressenti : on suit la main droite
 * et on garde la fenêtre autour de son pic de vitesse — le moment du lâcher.
 *
 * `[début, fin]` en secondes, `vitesse` = accélération de la lecture.
 */
const DECOUPES = {
  // Fireball dure 3,37 s : la main recule jusqu'à 1,5 s, se projette à 1,90 s,
  // puis récupère. On garde l'armé + le jet, joué une fois et demie plus vite.
  'Fireball.fbx': { debut: 1.35, fin: 2.45, vitesse: 1.5 },
  /*
   * Hell Slammer dure 7,57 s. On y a cherché un VRAI coup porté : la main
   * droite passe de 31 unités derrière la hanche à 40 devant entre 0,80 s et
   * 1,08 s, puis revient. C'est la seule frappe franche du clip.
   *
   * La fenêtre est jouée en 0,26 s — exactement ATTACK_TIME (cf. player.ts).
   * Ce n'est pas un chiffre décoratif : le jeu autorise une nouvelle frappe
   * tous les 0,26 s, et en enchaînant les jarres on relançait le geste avant
   * qu'il finisse. Il ne montrait jamais que son élan et bégayait.
   */
  'Hell Slammer A.fbx': { debut: 0.8, fin: 1.3, vitesse: 0.5 / 0.26 },
}

/**
 * La note d'un candidat pour un rôle : PLUS BAS = MEILLEUR.
 *
 * - une course doit BOUCLER : `boucle` mesure l'écart de pose entre la
 *   première et la dernière image. Au-delà de ~0.1, la reprise se voit.
 * - un saut doit AVANCER et rester court : un saut de joie sur place fait un
 *   mauvais saut d'obstacle.
 */
function note(action, m) {
  if (action === 'course' || action === 'courseGenee' || action === 'mur') {
    // Boucler est éliminatoire, mais entre deux clips qui bouclent bien, le
    // départage se fait à la VITESSE. On est dans une course : un jogging à
    // côté de sprinteurs se lit comme un coureur à la traîne, même s'il
    // avance à la même allure dans le jeu.
    const boucleOk = m.boucle <= SEUIL_BOUCLE * 25 ? 0 : 100
    return boucleOk - m.avance / Math.max(0.01, m.duree)
  }
  if (action === 'saut') return (m.avance > 20 ? 0 : 10) + m.duree
  // Un virage doit PENCHER franchement : entre deux, le plus incliné se lit
  // mieux à l'écran.
  if (action.startsWith('virage')) return -Math.abs(m.derive)
  return m.duree // le reste : au plus court, faute de meilleur critère
}

/** Une boucle au-dessus de ce seuil se VOIT : on refuse de la jouer en boucle. */
const SEUIL_BOUCLE = 0.1

/** Le dossier tel qu'il est sur le disque → l'identifiant du guerrier. */
const PERSOS = {
  yasuke: 'yasuke',
  hana: 'hana',
  oni: 'onimaru',
  tamea: 'tamae',
  // Le perso « + » : son ornement décide de son style (cf. CUSTOM_STYLE)
  'perso/aucun': 'perso-rien',
  'perso/kitsu': 'perso-oreilles',
  'perso/Nouveau dossier': 'perso-oreilles', // dossier resté sans nom
  'perso/oni2': 'perso-cornes',
  perso: 'perso', // à la racine de perso/ : pour les trois variantes
}

// ————————————————————————————————————————————————————————————————

function parcourir(d) {
  return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(d, e.name)
    return e.isDirectory() ? parcourir(p) : e.name.endsWith('.fbx') ? [p] : []
  })
}

/** Le rôle d'un fichier, d'après son nom. null = on ne sait pas quoi en faire. */
function actionDe(fichier) {
  for (const [action, motifs] of Object.entries(ACTIONS)) {
    if (motifs.some((m) => m.test(fichier))) return action
  }
  return null
}

/** Le propriétaire d'un clip : le dossier, ou 'tous' à la racine. */
function persoDe(relatif) {
  const dossier = path.dirname(relatif).split(path.sep).slice(1).join('/')
  if (!dossier) return 'tous' // « pas dans un dossier, c'est pour tout le monde »
  return PERSOS[dossier] ?? dossier
}

/**
 * Recible un clip Mixamo sur notre rig à boîtes.
 *
 * Le principe : on ne recopie PAS les quaternions Mixamo (leurs os n'ont ni la
 * même pose de repos ni les mêmes longueurs que nos boîtes). On lit la
 * DIRECTION de chaque membre dans le monde, et on cherche la rotation qui
 * pointe notre boîte dans cette direction-là. C'est du reciblage : ça marche
 * quelles que soient les proportions.
 */
function cuire(fichier) {
  const b = fs.readFileSync(fichier)
  const racine = new FBXLoader().parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '')
  const clip = racine.animations[0]
  if (!clip) return null

  // Le découpage : on ne cuit que la fenêtre utile, et on la joue plus vite.
  const coupe = DECOUPES[path.basename(fichier)]
  const t0 = coupe ? Math.min(coupe.debut, clip.duration) : 0
  const t1 = coupe ? Math.min(coupe.fin, clip.duration) : clip.duration
  const etendue = Math.max(0.05, t1 - t0)
  const vitesse = coupe?.vitesse ?? 1

  const os = {}
  racine.traverse((o) => {
    if (o.isBone) os[o.name.replace(/^mixamorig:?/, '')] = o
  })
  const hanches = os.Hips
  if (!hanches) return null

  // La hauteur de repos des hanches sert d'étalon : Mixamo travaille en
  // centimètres, notre bassin vit à 0.72 unité du sol.
  const hauteurRepos = hanches.position.y || 100
  const ECHELLE = 0.72 / hauteurRepos

  const mixer = new THREE.AnimationMixer(racine)
  mixer.clipAction(clip).play()

  const n = Math.max(2, Math.round(etendue * FPS))
  const pistes = {}
  for (const j of JOINTS) pistes[j.nom] = []
  const hauteurs = []

  const pos1 = new THREE.Vector3()
  const pos2 = new THREE.Vector3()
  const dir = new THREE.Vector3()
  const monde = new THREE.Vector3()
  let depart = 0
  let arrivee = 0
  let departX = 0
  let arriveeX = 0

  let precedent = 0
  for (let i = 0; i < n; i++) {
    const t = t0 + (i / n) * etendue
    mixer.update(t - precedent)
    precedent = t
    racine.updateMatrixWorld(true)

    // L'orientation MONDE accumulée de chaque articulation, au fil de la
    // descente : c'est elle qui permet d'exprimer la suivante en local.
    const accum = { null: new THREE.Quaternion() }

    for (const j of JOINTS) {
      const a = os[j.de]
      const bOs = os[j.vers]
      if (!a || !bOs) {
        pistes[j.nom].push(0, 0, 0)
        accum[j.nom] = accum[j.parent] ?? new THREE.Quaternion()
        continue
      }
      a.getWorldPosition(pos1)
      bOs.getWorldPosition(pos2)
      dir.subVectors(pos2, pos1).normalize()

      // La direction voulue, ramenée dans le repère du parent
      const qParent = accum[j.parent] ?? new THREE.Quaternion()
      const local = dir.clone().applyQuaternion(qParent.clone().invert())
      const q = new THREE.Quaternion().setFromUnitVectors(j.repos, local)

      // Canonique (w >= 0) : on ne stocke que x, y, z et on retrouve w au
      // chargement. 25 % d'octets en moins, sans perte.
      if (q.w < 0) { q.x = -q.x; q.y = -q.y; q.z = -q.z; q.w = -q.w }
      const arr = pistes[j.nom]
      arr.push(
        Math.round(q.x * PRECISION) / PRECISION,
        Math.round(q.y * PRECISION) / PRECISION,
        Math.round(q.z * PRECISION) / PRECISION
      )
      accum[j.nom] = qParent.clone().multiply(q)
    }

    // Le rebond du bassin. On garde UNIQUEMENT la hauteur : l'avancée et les
    // écarts latéraux sont pilotés par le jeu (les lignes, le décor qui
    // défile). Les recopier ferait patiner le coureur.
    hanches.getWorldPosition(monde)
    hauteurs.push(Math.round(monde.y * ECHELLE * PRECISION) / PRECISION)
    if (i === 0) { depart = monde.z; departX = monde.x }
    arrivee = monde.z
    arriveeX = monde.x
  }

  const duree = etendue / vitesse
  return {
    d: +duree.toFixed(3),
    n,
    q: pistes,
    y: hauteurs,
    mesures: {
      duree,
      avance: Math.abs(arrivee - depart),
      /*
       * La dérive latérale, qui dit de quel côté va un virage.
       * Mixamo pose le personnage face à +Z, son côté DROIT en -X (l'épaule
       * droite est à x négatif au repos). Une dérive vers -X est donc un
       * virage à droite.
       */
      derive: arriveeX - departX,
      boucle: ecartDeBoucle(pistes, n),
    },
  }
}

/**
 * L'écart de raccord, mesuré sur le mouvement RECIBLÉ — celui qu'on jouera
 * vraiment, pas celui du fichier d'origine.
 *
 * On le rapporte à l'écart moyen entre deux images : un clip qui boucle bien
 * finit à ~1 image du début, donc un rapport proche de 1. Un clip qui ne
 * boucle pas saute beaucoup plus loin. Normaliser ainsi rend la mesure
 * indépendante de la vitesse du clip.
 */
function ecartDeBoucle(pistes, n) {
  if (n < 3) return 99
  let raccord = 0
  let cumul = 0
  for (const arr of Object.values(pistes)) {
    for (let k = 0; k < 3; k++) raccord += Math.abs(arr[k] - arr[(n - 1) * 3 + k])
    for (let i = 1; i < n; i++) {
      for (let k = 0; k < 3; k++) cumul += Math.abs(arr[i * 3 + k] - arr[(i - 1) * 3 + k])
    }
  }
  const parImage = cumul / (n - 1)
  return parImage < 1e-6 ? 99 : raccord / parImage
}

// ————— On cuit tout —————

const candidats = new Map() // 'perso/action' → [{ fichier, cuit }]
const journal = []

const fichiers = parcourir(SOURCE)

/*
 * ————— LA RÈGLE DES DOSSIERS, sans exception —————
 *
 * Un dossier au nom d'un guerrier ne contient QUE ses mouvements à lui. À la
 * racine, c'est pour tout le monde. Rien ne circule d'un dossier à l'autre.
 *
 * On a essayé plus malin : quand un fichier était identique dans plusieurs
 * dossiers, on le promouvait en commun pour que Yasuke et Oni-Maru — dont les
 * dossiers n'ont pas de course — ne restent pas sans. Résultat : ils couraient
 * avec le fichier de Hana. Un dossier vide doit se voir, pas se combler en
 * douce avec le bien d'un autre.
 *
 * Ce qui manque retombe donc sur la foulée calculée, et la liste de couverture
 * affichée en fin de cuisson dit exactement quel dossier réclame quoi.
 */

/**
 * Un fichier PROPRE à ce guerrier, ou une copie qu'on retrouve ailleurs ?
 *
 * Quand un dossier offre les deux pour un même rôle, on garde le fichier
 * unique : c'est lui qui dit quelque chose du personnage. Une copie présente
 * dans quatre dossiers ne caractérise personne.
 */
const empreintes = new Map()
for (const f of fichiers) {
  const h = crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex')
  if (!empreintes.has(h)) empreintes.set(h, [])
  empreintes.get(h).push(f)
}
const recopie = new Set()
for (const [, liste] of empreintes) {
  if (new Set(liste.map((f) => persoDe(f))).size >= 2) for (const f of liste) recopie.add(f)
}

for (const fichier of fichiers) {
  const action = actionDe(path.basename(fichier))
  if (!action) {
    journal.push(`  · ignoré, rôle inconnu : ${fichier}`)
    continue
  }
  const cuit = cuire(fichier)
  if (!cuit) {
    journal.push(`  · illisible : ${fichier}`)
    continue
  }
  // Un virage se range à gauche ou à droite d'après sa DÉRIVE, jamais d'après
  // son nom : « Running Arc » et « Running Arc (1) » ne disent rien du côté.
  let vraieAction = action
  if (action === 'virage') {
    if (Math.abs(cuit.mesures.derive) < 20) {
      journal.push(`  · ${fichier} : virage sans dérive, on ne sait pas de quel côté`)
      continue
    }
    vraieAction = cuit.mesures.derive > 0 ? 'virageG' : 'virageD'
  }

  const cle = `${persoDe(fichier)}/${vraieAction}`
  if (!candidats.has(cle)) candidats.set(cle, [])
  candidats.get(cle).push({ fichier, cuit, unique: !recopie.has(fichier) })
}

const clips = {}
const boucles = new Set(['course', 'courseGenee', 'mur'])

for (const [cle, liste] of [...candidats].sort()) {
  const action = cle.split('/')[1]
  // Le fichier PROPRE au guerrier passe devant la copie ; à égalité de
  // propriété, on départage sur ce que le mouvement fait vraiment.
  liste.sort(
    (a, b) =>
      Number(b.unique) - Number(a.unique) ||
      note(action, a.cuit.mesures) - note(action, b.cuit.mesures)
  )
  const [gagnant, ...perdants] = liste
  const m = gagnant.cuit.mesures

  // Une course qui ne boucle pas saccaderait à chaque reprise : mieux vaut
  // ne rien fournir et laisser le repli faire son travail.
  if (boucles.has(action) && m.boucle > SEUIL_BOUCLE * 25) {
    journal.push(`  ✗ ${cle.padEnd(22)} REFUSÉ : ne boucle pas (${m.boucle.toFixed(1)}×) — ${path.basename(gagnant.fichier)}`)
    continue
  }

  const { mesures, ...garde } = gagnant.cuit
  clips[cle] = garde
  const boucle = boucles.has(action) ? `, raccord ${m.boucle.toFixed(1)}×` : ''
  journal.push(`  ✓ ${cle.padEnd(22)} ← ${path.basename(gagnant.fichier).padEnd(28)} (${gagnant.cuit.n} img${boucle})`)
  for (const p of perdants) {
    journal.push(`      écarté : ${path.basename(p.fichier)}`)
  }
}

fs.writeFileSync(SORTIE, JSON.stringify({ fps: FPS, clips }))
const ko = (fs.statSync(SORTIE).size / 1024).toFixed(0)

console.log(journal.join('\n'))
console.log(`\n${Object.keys(clips).length} clips → ${SORTIE} (${ko} Ko)`)

/*
 * ————— La couverture, guerrier par guerrier —————
 *
 * C'est le tableau qui manquait : il dit d'un coup d'œil ce que chaque dossier
 * fournit, ce qu'il emprunte à la racine, et ce qui retombe encore sur la
 * foulée calculée. Sans lui, un dossier vide passait inaperçu — et on comblait
 * le trou en douce avec le fichier d'un autre.
 */
const ROLES = ['course', 'courseGenee', 'saut', 'glissade', 'virageG', 'virageD']
const GUERRIERS = [
  ['yasuke', 'yasuke'],
  ['hana', 'hana'],
  ['oni', 'onimaru'],
  ['tamea', 'tamae'],
  ['perso/aucun', 'perso-rien'],
  ['perso/Nouveau dossier', 'perso-oreilles'],
  ['perso/oni2', 'perso-cornes'],
]

console.log('\n————— Couverture —————')
console.log('  à lui · de la racine (tous) · MANQUE = foulée calculée\n')
console.log(`  ${''.padEnd(22)}${ROLES.map((r) => r.slice(0, 6).padEnd(8)).join('')}`)

const manquants = []
for (const [dossier, id] of GUERRIERS) {
  const cases = ROLES.map((r) => {
    if (clips[`${id}/${r}`]) return 'à lui'.padEnd(8)
    // Le perso « + » passe par son fonds commun avant la racine
    if (id.startsWith('perso-') && clips[`perso/${r}`]) return 'perso'.padEnd(8)
    if (clips[`tous/${r}`]) return 'racine'.padEnd(8)
    manquants.push(`${dossier}/ → ${r}`)
    return '—'.padEnd(8)
  })
  console.log(`  ${dossier.padEnd(22)}${cases.join('')}`)
}

if (manquants.length) {
  console.log('\n  ⚠️ Rien nulle part, donc foulée calculée :')
  for (const m of manquants) console.log(`     ${m}`)
  console.log('     → déposer un .fbx dans le dossier, ou à la racine pour tous.')
}
