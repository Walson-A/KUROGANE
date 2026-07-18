/**
 * ————— Les animations importées —————
 *
 * Les mouvements viennent des .fbx Mixamo déposés dans animation/. Ils ne sont
 * PAS lus ici : `tools/cuire-anims.mjs` les a déjà reciblés sur notre squelette
 * à boîtes et rangés dans anims-cuites.json. Ce module ne fait que les jouer.
 *
 * Le partage suit la règle des dossiers : un mouvement rangé dans le dossier
 * d'un guerrier n'appartient qu'à lui ; à la racine, il sert à tout le monde.
 * Quand un guerrier n'a pas le mouvement demandé, on remonte la chaîne
 * jusqu'au mouvement commun — et s'il n'y a rien du tout, l'appelant garde son
 * animation calculée. Aucun personnage ne peut donc se retrouver figé.
 */
import * as THREE from 'three'
// L'attribut `type: json` n'est pas décoratif : sans lui, Node refuse le
// module. Vite l'accepte aussi, donc le même fichier sert au jeu et aux tests.
import cuites from './anims-cuites.json' with { type: 'json' }
import { animerCourse, type Corps, type Fighter } from './roster'

export type Action =
  | 'course'
  | 'courseRapide'
  | 'courseGenee'
  | 'saut'
  | 'glissade'
  | 'chute'
  | 'lancer'
  | 'virageG'
  | 'virageD'
  | 'impact'
  | 'attaque'

/**
 * Les gestes qui se SUPERPOSENT à la foulée au lieu de la remplacer.
 *
 * Un coureur qui lance un sort ne cesse pas de courir : il jette le bras
 * pendant que ses jambes continuent. Jouer le lancer seul le ferait patiner
 * sur place au milieu de la piste. On garde donc la foulée sur le bas du
 * corps et on ne pose le geste que sur le haut.
 *
 * C'est un type à part pour que le compilateur refuse de superposer une
 * course : `declencher('course')` n'a aucun sens et ne doit pas compiler.
 */
export type Geste = 'lancer' | 'attaque' | 'impact'

/** Le temps d'un fondu entre deux mouvements. Court : on court, ça doit claquer. */
const FONDU = 0.18

/** Un mouvement prêt à jouer : des quaternions par articulation, plus le rebond. */
interface Clip {
  duree: number
  images: number
  /** 4 flottants par image et par articulation (x, y, z, w) */
  pistes: Record<string, Float32Array>
  /** La hauteur du bassin, image par image */
  hauteur: Float32Array
}

/*
 * Le décodage. Le fichier cuit ne stocke que x, y, z : les quaternions sont
 * unitaires et rangés avec w positif, donc w se retrouve par le calcul. C'est
 * un quart des octets économisé sans rien perdre.
 */
const CLIPS = new Map<string, Clip>()

for (const [cle, brut] of Object.entries((cuites as any).clips as Record<string, any>)) {
  const pistes: Record<string, Float32Array> = {}
  for (const [joint, plat] of Object.entries(brut.q as Record<string, number[]>)) {
    const n = brut.n as number
    const out = new Float32Array(n * 4)
    for (let i = 0; i < n; i++) {
      const x = plat[i * 3]
      const y = plat[i * 3 + 1]
      const z = plat[i * 3 + 2]
      out[i * 4] = x
      out[i * 4 + 1] = y
      out[i * 4 + 2] = z
      out[i * 4 + 3] = Math.sqrt(Math.max(0, 1 - x * x - y * y - z * z))
    }
    pistes[joint] = out
  }
  CLIPS.set(cle, {
    duree: brut.d,
    images: brut.n,
    pistes,
    hauteur: Float32Array.from(brut.y as number[]),
  })
}

/**
 * Où chercher les mouvements d'un guerrier, du plus personnel au plus commun.
 * Le perso « + » passe d'abord par son ornement (c'est lui qui décide du
 * style), puis par le fonds commun des trois variantes.
 */
function chaine(f: Fighter): string[] {
  if (f.id === 'perso') return [`perso-${f.head}`, 'perso', 'tous']
  return [f.id, 'tous']
}

/**
 * Le mouvement de repli quand une action n'a pas de clip à elle.
 *
 * La course pressée n'a pas de fichier dédié : personne n'a déposé de sprint.
 * Elle rejoue donc la course normale, mais PLUS VITE (cf. CADENCE) — ce qui
 * suffit à lire l'accélération. Le jour où un vrai sprint atterrit dans un
 * dossier, il sera pris sans toucher à une ligne de code.
 */
const REPLI: Partial<Record<Action, Action>> = {
  courseRapide: 'course',
}

/**
 * La vitesse de lecture d'une action.
 *
 * 1,35 n'est pas un chiffre au jugé : c'est exactement le gain du Souffle de
 * Vent (VENT_BOOST = 0,35). La foulée s'accélère donc autant que le coureur —
 * les pieds ne patinent pas et ne courent pas devant lui.
 */
const CADENCE: Partial<Record<Action, number>> = {
  courseRapide: 1.35,
}

/** Le mouvement à jouer, ou null si personne n'en a fourni. */
export function clipDe(f: Fighter, action: Action): Clip | null {
  for (const source of chaine(f)) {
    const c = CLIPS.get(`${source}/${action}`)
    if (c) return c
  }
  const repli = REPLI[action]
  return repli ? clipDe(f, repli) : null
}

/** Ce guerrier a-t-il de quoi jouer cette action ? */
export function aUnClip(f: Fighter, action: Action) {
  return clipDe(f, action) !== null
}

// ————— La lecture —————

const qA = new THREE.Quaternion()
const qB = new THREE.Quaternion()

/**
 * Lit une articulation à l'instant `t` et pose le résultat dans `sortie`.
 * On interpole en SLERP et pas en linéaire : sur des angles marqués (le genou
 * qui se replie), le linéaire raccourcit le trajet et le membre s'écrase.
 */
function lire(clip: Clip, joint: string, t: number, sortie: THREE.Quaternion, boucle: boolean) {
  const piste = clip.pistes[joint]
  if (!piste) {
    sortie.identity()
    return
  }
  const n = clip.images
  const pos = boucle
    ? ((t % clip.duree) / clip.duree) * n
    : Math.min(t / clip.duree, 0.9999) * n
  const i = Math.floor(pos)
  const f = pos - i
  const i0 = i % n
  // En boucle, la dernière image enchaîne sur la première ; sinon elle tient.
  const i1 = boucle ? (i + 1) % n : Math.min(i + 1, n - 1)

  qA.set(piste[i0 * 4], piste[i0 * 4 + 1], piste[i0 * 4 + 2], piste[i0 * 4 + 3])
  qB.set(piste[i1 * 4], piste[i1 * 4 + 1], piste[i1 * 4 + 2], piste[i1 * 4 + 3])
  sortie.copy(qA).slerp(qB, f)
}

/** Le rebond du bassin à l'instant `t`. */
function lireHauteur(clip: Clip, t: number, boucle: boolean) {
  const n = clip.images
  const pos = boucle ? ((t % clip.duree) / clip.duree) * n : Math.min(t / clip.duree, 0.9999) * n
  const i = Math.floor(pos)
  const f = pos - i
  const a = clip.hauteur[i % n]
  const b = clip.hauteur[boucle ? (i + 1) % n : Math.min(i + 1, n - 1)]
  return a + (b - a) * f
}

/** Le raccord entre un nom d'articulation cuite et le membre correspondant. */
function membre(g: Corps, joint: string): THREE.Object3D | null {
  switch (joint) {
    case 'torse': return g.torse
    case 'tete': return g.tete
    case 'brasG': return g.brasG.pivot
    case 'brasGbas': return g.brasG.bas
    case 'brasD': return g.brasD.pivot
    case 'brasDbas': return g.brasD.bas
    case 'jambeG': return g.jambeG.pivot
    case 'jambeGbas': return g.jambeG.bas
    case 'jambeD': return g.jambeD.pivot
    case 'jambeDbas': return g.jambeD.bas
    default: return null
  }
}

/** Les actions qui tournent en rond ; les autres se jouent une fois et tiennent. */
const EN_BOUCLE: Record<Action, boolean> = {
  course: true,
  courseRapide: true,
  courseGenee: true,
  saut: false,
  glissade: false,
  chute: false,
  lancer: false,
  virageG: false,
  virageD: false,
  impact: false,
  attaque: false,
}

/** Les articulations du haut du corps — celles que pilote un geste superposé. */
const JOINTS_HAUT = new Set(['torse', 'tete', 'brasG', 'brasGbas', 'brasD', 'brasDbas'])

/**
 * L'état d'animation d'UN coureur. Chacun a le sien : le joueur, chaque bot,
 * chaque rival en ligne. C'est lui qui retient où on en est dans le mouvement
 * et le fondu en cours.
 */
export class Anim {
  private action: Action = 'course'
  private t: number
  private clipCourant: Clip | null = null
  /** Le mouvement qu'on quitte, gardé le temps du fondu */
  private avant: { clip: Clip; action: Action; t: number } | null = null
  private fondu = 0

  /**
   * `phase` décale le point de départ dans le cycle. Sans elle, tous les
   * coureurs poseraient le même pied au même instant : un peloton au pas
   * cadencé, comme des soldats. Un décalage au hasard suffit à casser ça.
   */
  constructor(phase = 0) {
    this.t = phase
  }

  /** Le geste superposé en cours (lancer, attaque, encaissement) */
  private geste: Geste | null = null
  private tGeste = 0

  /**
   * Déclenche un geste du haut du corps, par-dessus la foulée en cours.
   * Rejouer le même le REPART du début : on peut enchaîner deux sorts.
   */
  declencher(geste: Geste) {
    this.geste = geste
    this.tGeste = 0
  }

  /**
   * Demande une action. Rejouer la même ne la redémarre pas — sauf pour les
   * mouvements à un coup (saut, glissade), qu'on veut bien revoir depuis le
   * début à chaque appui.
   */
  jouer(action: Action, redemarrer = false) {
    if (action === this.action && !redemarrer) return
    // Sans clip en cours (première image, ou guerrier sans animation), il n'y
    // a rien à quitter : on démarre net plutôt que de fondre depuis le vide.
    const sortant = this.clipCourant
    this.avant = sortant ? { clip: sortant, action: this.action, t: this.t } : null
    this.fondu = sortant ? FONDU : 0
    this.action = action
    this.t = 0
  }

  /**
   * Avance le temps et pose la pose sur le corps.
   * Renvoie false si ce guerrier n'a aucun clip pour l'action en cours :
   * l'appelant retombe alors sur son animation calculée.
   */
  appliquer(f: Fighter, g: Corps, dt: number, intensite = 1): boolean {
    const clip = clipDe(f, this.action)
    this.clipCourant = clip
    if (!clip) return false

    this.t += dt * (CADENCE[this.action] ?? 1)
    this.fondu = Math.max(0, this.fondu - dt)

    const boucle = EN_BOUCLE[this.action]
    const melange = this.avant && this.fondu > 0 ? this.fondu / FONDU : 0

    for (const joint of Object.keys(clip.pistes)) {
      const cible = membre(g, joint)
      if (!cible) continue
      lire(clip, joint, this.t, cible.quaternion, boucle)

      // Le fondu : on revient vers la pose qu'on quittait, pour ne pas
      // téléporter les membres d'un mouvement à l'autre.
      if (melange > 0 && this.avant) {
        lire(this.avant.clip, joint, this.avant.t, qTmp, EN_BOUCLE[this.avant.action])
        cible.quaternion.slerp(qTmp, melange)
      }

      // `intensite` à 0 = la pose de repos : c'est ce qui fige le guerrier
      // sur l'écran de sélection.
      if (intensite < 1) cible.quaternion.slerp(REPOS, 1 - intensite)
    }

    let y = lireHauteur(clip, this.t, boucle)
    if (melange > 0 && this.avant) {
      const yAvant = lireHauteur(this.avant.clip, this.avant.t, EN_BOUCLE[this.avant.action])
      y = y + (yAvant - y) * melange
    }
    g.bassin.position.y = 0.72 + (y - 0.72) * intensite

    if (this.fondu <= 0) this.avant = null
    this.poserGeste(f, g, dt, intensite)
    return true
  }

  /**
   * Pose le geste du haut du corps par-dessus la foulée.
   *
   * Il s'ouvre et se referme en douceur : sans ça, le bras claquerait d'un
   * coup dans la pose de lancer, puis retomberait tout aussi sec.
   */
  private poserGeste(f: Fighter, g: Corps, dt: number, intensite: number) {
    if (!this.geste) return
    const clip = clipDe(f, this.geste)
    if (!clip) {
      this.geste = null
      return
    }

    this.tGeste += dt
    if (this.tGeste >= clip.duree) {
      this.geste = null
      return
    }

    // Une ouverture et une fermeture proportionnelles au geste : un geste
    // court ne peut pas s'offrir un fondu aussi long qu'un geste ample.
    const rampe = Math.min(FONDU, clip.duree * 0.25)
    const restant = clip.duree - this.tGeste
    const poids =
      Math.min(1, this.tGeste / rampe) * Math.min(1, restant / rampe) * intensite

    for (const joint of Object.keys(clip.pistes)) {
      if (!JOINTS_HAUT.has(joint)) continue
      const cible = membre(g, joint)
      if (!cible) continue
      lire(clip, joint, this.tGeste, qTmp, false)
      cible.quaternion.slerp(qTmp, poids)
    }
  }

  /** Un geste est-il en train de se jouer ? */
  get gesteEnCours() {
    return this.geste !== null
  }

  /** Où en est le mouvement, de 0 à 1. Utile pour savoir s'il est fini. */
  get avancement() {
    const c = this.clipCourant
    return c ? Math.min(1, this.t / c.duree) : 1
  }

  get actionCourante() {
    return this.action
  }
}

const qTmp = new THREE.Quaternion()
const REPOS = new THREE.Quaternion()

/*
 * ————— Ce que Mixamo ne sait pas —————
 *
 * Les clips animent un corps humain nu. Nos guerriers, eux, portent une lame
 * et traînent des queues ou une cape. Ces deux détails restent CALCULÉS, et se
 * posent par-dessus le mouvement importé.
 */

/** Le bras armé, verrouillé : épaule un peu en arrière, coude replié devant. */
const ARME_EPAULE = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.3, 0, 0))
const ARME_COUDE = new THREE.Quaternion().setFromEuler(new THREE.Euler(1.15, 0, 0))

function finitions(g: Corps, t: number, intensite: number, geste: boolean) {
  // Pendant un geste (lancer, frappe, encaissement), on RELÂCHE le verrou :
  // le bras doit pouvoir partir. Le garder tiendrait la garde et écraserait
  // le lancer qu'on vient justement de déclencher.
  if (g.porteArme && !geste) {
    // Laissé libre, le bras qui PORTE balance de 40° et promène la lame dans
    // les jambes. On le ramène presque entièrement sur sa pose de garde, en
    // gardant un souffle de mouvement pour qu'il ne paraisse pas vissé.
    g.brasD.pivot.quaternion.slerp(ARME_EPAULE, 0.85 * intensite)
    g.brasD.bas.quaternion.slerp(ARME_COUDE, 0.9 * intensite)
  }

  // Ce qui traîne derrière ondule PLUS LENTEMENT que la foulée, et en retard :
  // à la même cadence, queues et cape auraient l'air vissées au corps.
  for (let i = 0; i < g.flottants.length; i++) {
    const f = g.flottants[i]
    const repos = (f.userData.repos ??= f.rotation.x)
    f.rotation.x = repos + Math.sin(t * 5 - 0.6 + i * 0.5) * 0.16 * intensite
  }
}

/**
 * Anime un guerrier : le mouvement importé s'il en a un, l'ancienne foulée
 * calculée sinon.
 *
 * Ce repli n'est pas une précaution de principe. Tout le monde n'a pas tout :
 * les dossiers déposés ne couvrent ni le saut du perso « + » ni la glissade de
 * Yasuke. Plutôt que de figer ces guerriers, on les fait courir comme avant.
 *
 * `tSecours` est l'horloge de la foulée calculée — elle sert au repli et aux
 * flottants, qui ne viennent d'aucun clip.
 */
export function animerGuerrier(
  racine: THREE.Object3D | undefined,
  f: Fighter,
  anim: Anim,
  action: Action,
  dt: number,
  tSecours: number,
  intensite = 1
) {
  const g = racine?.userData?.corps as Corps | undefined
  if (!g) return
  anim.jouer(action)
  if (!anim.appliquer(f, g, dt, intensite)) {
    animerCourse(racine, tSecours, intensite)
    return
  }
  finitions(g, tSecours, intensite, anim.gesteEnCours)
}
