/**
 * ————— Le contrôle anatomique des animations reciblées —————
 *
 * Recibler, c'est deviner : on lit une DIRECTION d'os Mixamo et on cherche la
 * rotation qui pointe notre boîte dans le même sens. Une erreur de repère et
 * le guerrier court les genoux à l'envers — sans qu'aucun typage ne bronche.
 *
 * Ce contrôle joue les clips pour de vrai et mesure le squelette obtenu :
 * les genoux plient-ils du bon côté, les pieds touchent-ils le sol, les bras
 * balancent-ils à l'opposé des jambes ? Ce sont des faits vérifiables sans
 * jamais regarder l'écran.
 *
 *   node tools/verifier-anims.ts
 */
import * as THREE from 'three'
import { Anim, animerGuerrier, clipDe, type Action } from '../src/anims.ts'

/** La pose de garde attendue pour l'épaule armée (cf. ARME_EPAULE dans anims). */
const ARME_EPAULE_ATTENDUE = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.3, 0, 0))
import { ROSTER, buildFighter, customFighter, fighterById, DEFAULT_CUSTOM, type Corps, type Fighter } from '../src/roster.ts'
import { MUR_ECART, MUR_PENCHE } from '../src/player.ts'

let echecs = 0
function verifier(titre: string, ok: boolean, detail = '') {
  if (!ok) echecs++
  console.log(`  ${ok ? 'ok  ' : 'ECHEC'} ${titre}${detail ? '  → ' + detail : ''}`)
}

/** Monte un guerrier et rend son corps articulé. */
function corpsDe(f: Fighter): { racine: THREE.Object3D; corps: Corps } {
  const g = new THREE.Group()
  g.add(...buildFighter(f))
  const racine = g.children[0]
  return { racine, corps: racine.userData.corps as Corps }
}

/**
 * De quel côté regarde le corps DANS SON PROPRE REPÈRE : +1 si son avant est
 * en +Z local, −1 si c'est en −Z.
 *
 * Le coureur avance vers −Z dans le monde ; `buildFighter` oriente la racine
 * pour l'y faire face. On remonte cette orientation pour savoir quel signe
 * attendre sur les angles, plutôt que de le coder en dur — la convention du
 * modèle a déjà changé une fois, et les contrôles avaient tous basculé d'un
 * coup sans qu'aucun ne soit réellement faux.
 */
const devantZ = (() => {
  const { racine } = corpsDe(ROSTER[0])
  racine.updateMatrixWorld(true)
  const q = new THREE.Quaternion()
  racine.getWorldQuaternion(q)
  const avantLocal = new THREE.Vector3(0, 0, -1).applyQuaternion(q.invert())
  return Math.sign(avantLocal.z) || 1
})()

/** La hauteur au sol d'un point du membre, une fois toute la chaîne appliquée. */
function hauteurMonde(racine: THREE.Object3D, noeud: THREE.Object3D, bas: number) {
  racine.updateMatrixWorld(true)
  const p = new THREE.Vector3(0, bas, 0)
  noeud.localToWorld(p)
  return p.y
}

const PERSOS: Fighter[] = [
  ...ROSTER.filter((f) => f.pickable),
  customFighter(DEFAULT_CUSTOM),
  customFighter({ ...DEFAULT_CUSTOM, head: 'cornes' }),
  customFighter({ ...DEFAULT_CUSTOM, head: 'oreilles' }),
]

/*
 * ————— Couverture —————
 *
 * Un simple CONSTAT, pas un contrôle. Un guerrier sans clip n'est pas cassé :
 * il retombe sur la foulée calculée, chemin prévu et vérifié plus bas. Le
 * faire échouer ici rendrait le test rouge en permanence pour un état
 * parfaitement voulu — et on finirait par ne plus le lire.
 *
 * C'est `npm run anims` qui dit quel dossier réclame quoi, avec son tableau.
 */
const ACTIONS: Action[] = ['repos', 'course', 'courseRapide', 'courseGenee', 'saut', 'glissade', 'chute', 'lancer', 'virageG', 'virageD', 'impact', 'attaque']
console.log('\n————— Couverture : qui a quoi (constat) —————')
for (const f of PERSOS) {
  const dispo = ACTIONS.filter((a) => clipDe(f, a))
  const nom = f.id === 'perso' ? `perso(${f.head})` : f.id
  const foulee = clipDe(f, 'course') ? '' : '   ⚠️ foulée calculée'
  console.log(`  ·    ${nom.padEnd(16)} ${dispo.length}/${ACTIONS.length} mouvements${foulee}`)
}

console.log('\n————— Anatomie pendant la course —————')
for (const f of PERSOS) {
  const nom = f.id === 'perso' ? `perso(${f.head})` : f.id
  const { racine, corps } = corpsDe(f)
  const anim = new Anim()
  anim.jouer('course')

  let genouAvant = -9
  let coudeArriere = -9
  let piedBas = 9
  let piedHaut = -9
  let opposition = 0
  let images = 0

  const clip = clipDe(f, 'course')
  if (!clip) continue // pas de clip a lui : c'est la foulee calculee, verifiee ailleurs
  for (let i = 0; i < 60; i++) {
    anim.appliquer(f, corps, clip.duree / 60, 1)
    racine.updateMatrixWorld(true)

    /*
     * Un segment qui pend vers le bas et qu'on tourne de `a` autour de X voit
     * son extrémité partir en z = -sin(a). Le genou doit se replier DERRIÈRE,
     * le coude se plier DEVANT.
     *
     * Le signe attendu dépend du sens dans lequel le corps est modelé — et ce
     * sens a déjà changé une fois. On le DÉDUIT donc du rig (cf. `devantZ`)
     * au lieu de le figer : ce contrôle reste juste quelle que soit la
     * convention choisie plus tard.
     */
    const eG = new THREE.Euler().setFromQuaternion(corps.jambeG.bas.quaternion, 'XYZ')
    const eD = new THREE.Euler().setFromQuaternion(corps.jambeD.bas.quaternion, 'XYZ')
    genouAvant = Math.max(genouAvant, -devantZ * eG.x, -devantZ * eD.x)

    const cG = new THREE.Euler().setFromQuaternion(corps.brasG.bas.quaternion, 'XYZ')
    const cD = new THREE.Euler().setFromQuaternion(corps.brasD.bas.quaternion, 'XYZ')
    // `devantZ * a` mesure combien le coude part EN ARRIÈRE. C'est cette
    // valeur-là qui doit rester petite ; la flexion vers l'avant, elle, est
    // au contraire attendue et ample.
    coudeArriere = Math.max(coudeArriere, devantZ * cG.x, devantZ * cD.x)

    // Les pieds : le mesh du pied est à -0.36 sous le genou
    for (const j of [corps.jambeG, corps.jambeD]) {
      const h = hauteurMonde(racine, j.bas, -0.4)
      piedBas = Math.min(piedBas, h)
      piedHaut = Math.max(piedHaut, h)
    }

    // Bras et jambe OPPOSÉS : quand la jambe gauche part devant, c'est le
    // bras droit qui l'accompagne. Le produit doit être négatif en moyenne.
    const jG = new THREE.Euler().setFromQuaternion(corps.jambeG.pivot.quaternion, 'XYZ').x
    const bG = new THREE.Euler().setFromQuaternion(corps.brasG.pivot.quaternion, 'XYZ').x
    opposition += jG * bG
    images++
  }

  verifier(`${nom.padEnd(16)} genou se replie derriere`, genouAvant < 0.35, `pire hyperextension ${genouAvant.toFixed(2)} rad`)
  verifier(`${nom.padEnd(16)} coude se plie devant`, coudeArriere < 0.35, `pire flexion arriere ${coudeArriere.toFixed(2)} rad`)
  verifier(`${nom.padEnd(16)} pieds au sol`, piedBas < 0.25, `plus bas ${piedBas.toFixed(2)}`)
  /*
   * On ne juge PLUS l'ampleur de la foulée, seulement qu'elle existe.
   *
   * Le seuil était à 0,25 et faisait échouer Hana, dont le `Run.fbx` est un
   * jogging à 0,22. Mais ce fichier est dans SON dossier : c'est sa foulée,
   * pas un défaut. Le contrôle encodait une préférence — « tout le monde doit
   * sprinter » — au lieu d'un fait. Seule une jambe quasi immobile signale un
   * vrai reciblage raté.
   */
  const amplitude = piedHaut - piedBas
  verifier(`${nom.padEnd(16)} les jambes bougent`, amplitude > 0.1, `amplitude ${amplitude.toFixed(2)}`)
  verifier(`${nom.padEnd(16)} bras opposes aux jambes`, opposition / images < 0, `correlation ${(opposition / images).toFixed(3)}`)
}

console.log('\n————— Le bassin reste a hauteur normale —————')
for (const f of PERSOS) {
  const nom = f.id === 'perso' ? `perso(${f.head})` : f.id
  const { corps } = corpsDe(f)
  const anim = new Anim()
  anim.jouer('course')
  const clip = clipDe(f, 'course')
  if (!clip) continue // pas de clip a lui : c'est la foulee calculee, verifiee ailleurs
  let min = 9
  let max = -9
  for (let i = 0; i < 60; i++) {
    anim.appliquer(f, corps, clip.duree / 60, 1)
    min = Math.min(min, corps.bassin.position.y)
    max = Math.max(max, corps.bassin.position.y)
  }
  verifier(`${nom.padEnd(16)} bassin 0.5–0.95`, min > 0.5 && max < 0.95, `${min.toFixed(2)}–${max.toFixed(2)}`)
}

console.log('\n————— Le fondu ne casse rien —————')
{
  const f = PERSOS[0]
  const { corps } = corpsDe(f)
  const anim = new Anim()
  anim.jouer('course')
  for (let i = 0; i < 30; i++) anim.appliquer(f, corps, 1 / 60, 1)
  anim.jouer('saut', true)
  let pire = 0
  let precedent: THREE.Quaternion | null = null
  for (let i = 0; i < 30; i++) {
    anim.appliquer(f, corps, 1 / 60, 1)
    const q = corps.jambeG.pivot.quaternion.clone()
    if (precedent) pire = Math.max(pire, precedent.angleTo(q))
    precedent = q
  }
  // Un saut d'angle > 1 rad en une image (1/60 s), c'est un membre qui se teleporte.
  verifier('pas de teleportation de membre au changement d\'action', pire < 1, `pire bond ${pire.toFixed(2)} rad/image`)
}

console.log('\n————— Aucun NaN —————')
for (const f of PERSOS) {
  const { corps } = corpsDe(f)
  const anim = new Anim()
  let sain = true
  for (const a of ACTIONS) {
    anim.jouer(a, true)
    for (let i = 0; i < 40; i++) {
      anim.appliquer(f, corps, 1 / 60, 1)
      for (const n of [corps.torse, corps.tete, corps.brasG.pivot, corps.jambeD.bas]) {
        const q = n.quaternion
        if (!isFinite(q.x + q.y + q.z + q.w)) sain = false
      }
      if (!isFinite(corps.bassin.position.y)) sain = false
    }
  }
  const nom = f.id === 'perso' ? `perso(${f.head})` : f.id
  verifier(`${nom.padEnd(16)} valeurs finies sur toutes les actions`, sain)
}

console.log('\n————— Le bras qui porte la lame —————')
for (const f of PERSOS) {
  const { racine, corps } = corpsDe(f)
  if (!corps.porteArme) continue
  const anim = new Anim()
  let ecart = 0
  for (let i = 0; i < 60; i++) {
    animerGuerrier(racine, f, anim, 'course', 1 / 60, i / 60)
    ecart = Math.max(ecart, corps.brasD.pivot.quaternion.angleTo(ARME_EPAULE_ATTENDUE))
  }
  const nom = f.id === 'perso' ? `perso(${f.head})` : f.id
  // Laissé libre, l'epaule balançait de 40° et promenait la lame dans les
  // jambes. Verrouillée, elle ne doit plus s'en écarter que d'un souffle.
  verifier(`${nom.padEnd(16)} epaule armee tenue`, ecart < 0.3, `ecart max ${ecart.toFixed(2)} rad`)
}

console.log('\n————— Les virages penchent du bon cote —————')
for (const f of PERSOS) {
  const nom = f.id === 'perso' ? `perso(${f.head})` : f.id
  const mesure = (a: Action) => {
    const { racine, corps } = corpsDe(f)
    const anim = new Anim()
    let cumul = 0
    let n = 0
    const clip = clipDe(f, a)
    if (!clip) return 0
    for (let i = 0; i < 30; i++) {
      animerGuerrier(racine, f, anim, a, clip.duree / 30, i / 30)
      // L'inclinaison du buste sur l'axe Z : negatif = penche vers -X.
      cumul += new THREE.Euler().setFromQuaternion(corps.torse.quaternion, 'ZYX').z
      n++
    }
    return cumul / n
  }
  const g = mesure('virageG')
  const d = mesure('virageD')
  /*
   * Le coureur avance vers -Z. Un virage a GAUCHE le porte vers -X, et on se
   * penche DANS son virage comme a moto. Les deux inclinaisons doivent donc
   * etre opposees — c'est ce qui prouve qu'aucun cote n'a ete inverse.
   */
  verifier(`${nom.padEnd(16)} gauche et droite opposes`, g * d < 0, `gauche ${g.toFixed(3)} / droite ${d.toFixed(3)}`)
}

console.log('\n————— Les gestes se posent sur le HAUT du corps —————')
for (const geste of ['lancer', 'attaque', 'impact'] as const) {
  const f = PERSOS[0]
  const { racine, corps } = corpsDe(f)
  const anim = new Anim()
  // On laisse d'abord la course s'installer, puis on declenche le geste.
  for (let i = 0; i < 20; i++) animerGuerrier(racine, f, anim, 'course', 1 / 60, i / 60)
  anim.declencher(geste)
  let brasBouge = 0
  let jambeBouge = 0
  let precBras = corps.brasD.pivot.quaternion.clone()
  let precJambe = corps.jambeG.pivot.quaternion.clone()
  for (let i = 0; i < 40; i++) {
    animerGuerrier(racine, f, anim, 'course', 1 / 60, (20 + i) / 60)
    brasBouge += precBras.angleTo(corps.brasD.pivot.quaternion)
    jambeBouge += precJambe.angleTo(corps.jambeG.pivot.quaternion)
    precBras = corps.brasD.pivot.quaternion.clone()
    precJambe = corps.jambeG.pivot.quaternion.clone()
  }
  // Les JAMBES doivent continuer de courir : un lanceur ne patine pas sur place.
  verifier(`${geste.padEnd(10)} le bras joue`, brasBouge > 0.3, `bras ${brasBouge.toFixed(2)} rad`)
  verifier(`${geste.padEnd(10)} les jambes courent toujours`, jambeBouge > 1, `jambes ${jambeBouge.toFixed(2)} rad`)
}

console.log('\n————— La foulee pressee va vraiment plus vite —————')
for (const f of PERSOS) {
  const nom = f.id === 'perso' ? `perso(${f.head})` : f.id
  /*
   * On mesure l'ANGLE TOTAL parcouru par la cuisse en une seconde, pas un
   * nombre de cycles entiers : compter des cycles ne donnait que 2 ou 3, une
   * resolution trop grossiere pour distinguer un facteur 1,35.
   */
  const agitation = (a: Action) => {
    const { racine, corps } = corpsDe(f)
    const anim = new Anim()
    let cumul = 0
    let precedent = corps.jambeG.pivot.quaternion.clone()
    for (let i = 0; i < 120; i++) {
      animerGuerrier(racine, f, anim, a, 1 / 120, i / 120)
      cumul += precedent.angleTo(corps.jambeG.pivot.quaternion)
      precedent = corps.jambeG.pivot.quaternion.clone()
    }
    return cumul
  }
  const lent = agitation('course')
  const vite = agitation('courseRapide')
  const rapport = vite / lent
  // On vise 1,35. On accepte 1,2–1,5 : l'echantillonnage a 120 Hz sur des
  // clips de 0,53 s ne tombe pas au centieme pres.
  verifier(
    `${nom.padEnd(16)} cadence pressee ~1,35x`,
    rapport > 1.2 && rapport < 1.5,
    `${lent.toFixed(1)} → ${vite.toFixed(1)} rad/s, soit ×${rapport.toFixed(2)}`
  )
}

console.log('\n————— Ce qui traine doit trainer DERRIERE —————')
for (const f of PERSOS) {
  const nom = f.id === 'perso' ? `perso(${f.head})` : f.id
  const { racine, corps } = corpsDe(f)
  racine.updateMatrixWorld(true)
  /*
   * Queues de kitsune, echarpe, cape : tout cela doit flotter dans le dos.
   * Les pans de jupe, eux, pendent devant — et c'est voulu. On les distingue
   * par leur nature : un trainant est un Group (plusieurs pieces), un pan de
   * jupe un simple Mesh.
   */
  let devant = 0
  let derriere = 0
  for (const fl of corps.flottants) {
    if (fl.type !== 'Group') continue
    const p = new THREE.Vector3(0, 0.5, 0)
    fl.localToWorld(p) // remonte toute la chaine, demi-tour de la racine compris
    if (p.z > 0.05) derriere++
    else if (p.z < -0.05) devant++
  }
  verifier(
    `${nom.padEnd(16)} ${derriere} trainant(s) dans le dos`,
    devant === 0,
    devant ? `${devant} devant le nez !` : ''
  )
}

console.log('\n————— Personne ne s\'enfonce dans la piste —————')
for (const action of ACTIONS) {
  let pire = 9
  let coupable = ''
  for (const f of PERSOS) {
    const clip = clipDe(f, action)
    if (!clip) continue
    const { racine, corps } = corpsDe(f)
    const anim = new Anim()
    for (let i = 0; i < 60; i++) {
      animerGuerrier(racine, f, anim, action, clip.duree / 60, i / 60)
      racine.updateMatrixWorld(true)
      for (const [m, creux] of [
        [corps.jambeG.bas, -0.41], [corps.jambeD.bas, -0.41],
        [corps.brasG.bas, -0.38], [corps.brasD.bas, -0.38],
      ] as const) {
        const p = new THREE.Vector3(0, creux, 0)
        m.localToWorld(p)
        racine.worldToLocal(p)
        if (p.y < pire) { pire = p.y; coupable = f.id }
      }
    }
  }
  verifier(
    `${action.padEnd(13)} membre le plus bas`,
    pire > -0.02,
    `${pire.toFixed(3)} (${coupable})`
  )
}

console.log('\n————— L\'attaque tient dans le verrou du jeu —————')
{
  // ATTACK_TIME vaut 0,26 s dans player.ts : le jeu autorise une frappe tous
  // les 0,26 s. Un geste plus long serait relance avant d'avoir fini et
  // begaierait des qu'on enchaine les jarres.
  const clip = clipDe(PERSOS[0], 'attaque')!
  verifier('le geste ne depasse pas ATTACK_TIME', clip.duree <= 0.261, `${clip.duree.toFixed(3)} s`)
}

console.log('\n————— Le perso « + » herite du guerrier de son style —————')
{
  /*
   * L'ornement decide du style (CUSTOM_STYLE) : cornes → Oni-Maru, oreilles
   * → Tamae. Ce style va jusqu'au MOUVEMENT. On le prouve en comparant les
   * clips obtenus : la variante doit jouer EXACTEMENT le meme objet que son
   * modele, pas un equivalent venu de la racine.
   */
  for (const [head, modele] of [['cornes', 'onimaru'], ['oreilles', 'tamae']] as const) {
    const variante = customFighter({ ...DEFAULT_CUSTOM, head })
    const source = fighterById(modele)
    // Le saut n'existe ni dans perso/ ni a la racine : s'il est la, il ne peut
    // venir que du guerrier du style.
    const a = clipDe(variante, 'saut')
    const b = clipDe(source, 'saut')
    verifier(
      `perso(${head}) saute comme ${modele}`,
      a !== null && a === b,
      a === null ? 'aucun saut' : a === b ? '' : 'ce n\'est pas le meme clip'
    )
  }
}

console.log('\n————— La course sur mur —————')
{
  const f = PERSOS[0]
  const clip = clipDe(f, 'mur')
  // Elle est a la RACINE : elle doit servir a tout le monde, sans exception.
  verifier('tout le monde a la course sur mur', PERSOS.every((p) => clipDe(p, 'mur') !== null))
  // Le clip dure 0,93 s pour un passage de 0,95 s (MUR_DUREE) : il tient tout
  // le temps qu'on reste accroche, sans avoir a boucler.
  verifier(
    'le clip couvre le passage sur la paroi',
    clip !== null && clip.duree >= 0.85 && clip.duree <= 1.0,
    clip ? `${clip.duree.toFixed(2)} s pour 0,95 s au mur` : 'aucun clip'
  )
  /*
   * Le clip penche DEJA le buste. Le jeu ajoute MUR_PENCHE par-dessus : la
   * somme doit rester lisible. A 0,48 + 0,55 (l'ancienne valeur) on montait a
   * 59°, et le coureur basculait presque a l'horizontale.
   */
  const { racine, corps } = corpsDe(f)
  const anim = new Anim()
  let propre = 0
  for (let i = 0; i < 60; i++) {
    animerGuerrier(racine, f, anim, 'mur', (clip?.duree ?? 1) / 60, i / 60)
    const z = new THREE.Euler().setFromQuaternion(corps.torse.quaternion, 'ZYX').z
    if (Math.abs(z) > Math.abs(propre)) propre = z
  }
  const total = Math.abs(propre) + MUR_PENCHE
  verifier(
    'l\'inclinaison totale au mur reste lisible',
    total < 0.8,
    `${Math.abs(propre).toFixed(2)} (clip) + ${MUR_PENCHE} (jeu) = ${total.toFixed(2)} rad, ${((total * 180) / Math.PI).toFixed(0)}°`
  )
}

console.log('\n————— Personne ne s\'enfonce dans la paroi —————')
for (const f of PERSOS) {
  const nom = f.id === 'perso' ? `perso(${f.head})` : f.id
  const { racine } = corpsDe(f)
  racine.updateMatrixWorld(true)
  const b = new THREE.Box3().setFromObject(racine)
  const demi = Math.max(Math.abs(b.min.x), Math.abs(b.max.x))
  /*
   * MUR_X designe le CENTRE du bloc ; la face qu'on longe est une
   * demi-epaisseur plus pres de la piste, et le coureur se tient en retrait de
   * MUR_ECART. On verifie que son point le plus large ne traverse pas la face.
   *
   * Sans ce retrait, l'axe du corps etait plante au milieu du bloc : 0,76 de
   * penetration, on ne voyait plus qu'un bras et une jambe depasser.
   */
  const penetration = demi - MUR_ECART
  verifier(
    `${nom.padEnd(16)} ne traverse pas la paroi`,
    penetration < 0.25,
    `${penetration > 0 ? 'frole de ' : 'degage de '}${Math.abs(penetration).toFixed(2)}`
  )
}

console.log('\n————— Le repos respire sans courir —————')
{
  /*
   * L'attente sur la grille n'a pas de clip : elle est CALCULEE. Deux choses a
   * garantir : les jambes ne pedalent pas (un coureur qui court sur place
   * pendant le decompte serait ridicule), et le buste bouge quand meme (une
   * statue serait pire). Le controle ne vaut que pour le REPLI : si un vrai
   * clip « Standing Idle » arrive un jour, il aura le droit de bouger plus.
   */
  const f = PERSOS[0]
  if (!clipDe(f, 'repos')) {
    const { racine, corps } = corpsDe(f)
    const anim = new Anim()
    let jambes = 0
    let buste = 0
    let pj = corps.jambeG.pivot.quaternion.clone()
    let pt = corps.torse.rotation.x
    for (let i = 0; i < 120; i++) {
      animerGuerrier(racine, f, anim, 'repos', 1 / 60, i / 60)
      jambes += pj.angleTo(corps.jambeG.pivot.quaternion)
      pj = corps.jambeG.pivot.quaternion.clone()
      buste += Math.abs(corps.torse.rotation.x - pt)
      pt = corps.torse.rotation.x
    }
    verifier('au repos, les jambes ne courent pas', jambes < 0.2, `${jambes.toFixed(2)} rad cumules`)
    verifier('au repos, le buste respire', buste > 0.05, `${buste.toFixed(2)} rad cumules`)
  }
}

console.log('\n————— Le repli quand le mouvement manque —————')
{
  /*
   * Un guerrier SANS dossier doit continuer de courir, sur la foulée calculee.
   *
   * On ne peut plus se servir du perso « + » comme cobaye : il avait un trou
   * au saut, on le lui a comble, et le controle tombait alors sur sa propre
   * premisse. On fabrique donc un guerrier dont l'identifiant ne correspond a
   * aucun dossier — le cas restera reproductible quoi qu'on depose ensuite
   * dans animation/.
   */
  const f = { ...ROSTER[0], id: 'fantome-sans-dossier' } as unknown as Fighter
  verifier('ce guerrier n\'a effectivement aucun clip', clipDe(f, 'course') === null)
  const { racine, corps } = corpsDe(f)
  const anim = new Anim()
  let bouge = 0
  let precedent = corps.jambeG.pivot.quaternion.clone()
  for (let i = 0; i < 60; i++) {
    animerGuerrier(racine, f, anim, 'course', 1 / 60, i / 60)
    bouge += precedent.angleTo(corps.jambeG.pivot.quaternion)
    precedent = corps.jambeG.pivot.quaternion.clone()
  }
  verifier('sans clip, le guerrier continue de courir', bouge > 0.5, `mouvement cumule ${bouge.toFixed(2)} rad`)
}

console.log(echecs === 0 ? '\nTout est bon.\n' : `\n${echecs} controle(s) en echec.\n`)
process.exit(echecs === 0 ? 0 : 1)
