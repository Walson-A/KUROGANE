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
import { ROSTER, buildFighter, customFighter, DEFAULT_CUSTOM, type Corps, type Fighter } from '../src/roster.ts'

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

console.log('\n————— Couverture : qui a quoi —————')
const ACTIONS: Action[] = ['course', 'courseGenee', 'saut', 'glissade', 'chute']
for (const f of PERSOS) {
  const dispo = ACTIONS.filter((a) => clipDe(f, a))
  const nom = f.id === 'perso' ? `perso(${f.head})` : f.id
  verifier(`${nom.padEnd(16)} ${dispo.join(', ')}`, dispo.includes('course'), dispo.includes('course') ? '' : 'PAS DE COURSE')
}

console.log('\n————— Anatomie pendant la course —————')
for (const f of PERSOS) {
  const nom = f.id === 'perso' ? `perso(${f.head})` : f.id
  const { racine, corps } = corpsDe(f)
  const anim = new Anim()
  anim.jouer('course')

  let genouAvant = -9
  let coudeArriere = 9
  let piedBas = 9
  let piedHaut = -9
  let opposition = 0
  let images = 0

  const clip = clipDe(f, 'course')!
  for (let i = 0; i < 60; i++) {
    anim.appliquer(f, corps, clip.duree / 60, 1)
    racine.updateMatrixWorld(true)

    /*
     * Le repère, établi une fois pour toutes : le coureur avance vers -Z
     * (le décor défile vers +Z et sort derrière la caméra), et son buste se
     * penche vers -Z. Donc -Z = devant, +Z = derrière.
     *
     * Un segment qui pend vers le bas et qu'on tourne de `a` autour de X voit
     * son extrémité partir en z = -sin(a). Le genou doit se replier DERRIÈRE
     * (+Z), donc a < 0 ; le coude se plie DEVANT (-Z), donc a > 0.
     */
    const eG = new THREE.Euler().setFromQuaternion(corps.jambeG.bas.quaternion, 'XYZ')
    const eD = new THREE.Euler().setFromQuaternion(corps.jambeD.bas.quaternion, 'XYZ')
    genouAvant = Math.max(genouAvant, eG.x, eD.x)

    const cG = new THREE.Euler().setFromQuaternion(corps.brasG.bas.quaternion, 'XYZ')
    const cD = new THREE.Euler().setFromQuaternion(corps.brasD.bas.quaternion, 'XYZ')
    coudeArriere = Math.min(coudeArriere, cG.x, cD.x)

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
  verifier(`${nom.padEnd(16)} coude se plie devant`, coudeArriere > -0.35, `pire flexion arriere ${coudeArriere.toFixed(2)} rad`)
  verifier(`${nom.padEnd(16)} pieds au sol`, piedBas < 0.25, `plus bas ${piedBas.toFixed(2)}`)
  verifier(`${nom.padEnd(16)} jambes qui levent`, piedHaut - piedBas > 0.25, `amplitude ${(piedHaut - piedBas).toFixed(2)}`)
  verifier(`${nom.padEnd(16)} bras opposes aux jambes`, opposition / images < 0, `correlation ${(opposition / images).toFixed(3)}`)
}

console.log('\n————— Le bassin reste a hauteur normale —————')
for (const f of PERSOS) {
  const nom = f.id === 'perso' ? `perso(${f.head})` : f.id
  const { corps } = corpsDe(f)
  const anim = new Anim()
  anim.jouer('course')
  const clip = clipDe(f, 'course')!
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

console.log('\n————— Le repli quand le mouvement manque —————')
{
  // Le perso « + » n'a pas de saut : il doit retomber sur la foulée calculée
  // plutôt que rester figé en l'air.
  const f = customFighter(DEFAULT_CUSTOM)
  verifier('le perso + n\'a effectivement pas de saut', clipDe(f, 'saut') === null)
  const { racine, corps } = corpsDe(f)
  const anim = new Anim()
  let bouge = 0
  let precedent = corps.jambeG.pivot.quaternion.clone()
  for (let i = 0; i < 60; i++) {
    animerGuerrier(racine, f, anim, 'saut', 1 / 60, i / 60)
    bouge += precedent.angleTo(corps.jambeG.pivot.quaternion)
    precedent = corps.jambeG.pivot.quaternion.clone()
  }
  verifier('sans clip, le guerrier continue de courir', bouge > 0.5, `mouvement cumule ${bouge.toFixed(2)} rad`)
}

console.log(echecs === 0 ? '\nTout est bon.\n' : `\n${echecs} controle(s) en echec.\n`)
process.exit(echecs === 0 ? 0 : 1)
