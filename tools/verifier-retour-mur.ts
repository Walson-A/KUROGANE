/**
 * ————— Le contrôle de la RETOMBÉE après une paroi —————
 *
 * Quitter un mur ne rend pas la main tout de suite : le corps doit d'abord
 * rentrer sur sa ligne ET redescendre sous MUR_RETOUR_Y. Sans ça, la paroi
 * devenait une boucle — on se relâchait à 1,6 m, encore collé au flanc, et
 * l'on se raccrochait dans la foulée sans jamais retoucher la piste.
 *
 * Ces règles sont invisibles à l'œil : elles se jouent en quelques images, et
 * seul un joueur qui MARTÈLE le swipe les rencontre. D'où ce banc, qui rejoue
 * la séquence image par image avec le vrai Player et spamme tous les gestes.
 *
 * Il garde aussi la trace d'un bug bien réel : swiper VERS la paroi qu'on
 * longeait changeait la ligne en silence, et l'on escaladait la plateforme au
 * relâchement au lieu de revenir sur sa voie.
 *
 *   node --import ./tools/resolveur-ts.mjs tools/verifier-retour-mur.ts
 */

/*
 * Un canvas 2D en carton-pâte.
 *
 * NameTag mesure du texte, et la piste PEINT ses textures de biome au canvas :
 * ni l'un ni l'autre n'a le moindre effet sur la géométrie qu'on vérifie ici.
 * On rend donc des méthodes qui ne font rien — le but est d'exécuter le vrai
 * code de jeu, pas de produire des pixels.
 */
const ctx2d = {
  font: '',
  fillStyle: '' as unknown,
  measureText: () => ({ width: 10 }),
  createLinearGradient: () => ({ addColorStop() {} }),
  beginPath() {},
  ellipse() {},
  fill() {},
  fillRect() {},
  save() {},
  restore() {},
  rotate() {},
  translate() {},
}
const g = globalThis as unknown as { document: unknown }
g.document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }),
}

import * as THREE from 'three'
import { Player, LANES, MUR_HAUTEUR } from '../src/player.ts'
import { Track, PLATEFORME_LARG, COURSE_LENGTH } from '../src/track.ts'

const DT = 1 / 60
const scene = new THREE.Scene()
const p = new Player(scene)

let ko = 0
function verifie(cond: boolean, quoi: string) {
  console.log(`  ${cond ? 'OK   ' : 'ÉCHEC'} ${quoi}`)
  if (!cond) ko++
}
function etat(quoi: string) {
  console.log(
    `${quoi.padEnd(32)} ligne=${p.currentLane} x=${p.mesh.position.x.toFixed(2)} ` +
      `y=${p.mesh.position.y.toFixed(2)} mur=${p.surMur} retour=${p.enRetour}`
  )
}

/** Le flanc d'une plateforme posée sur la ligne 2, vu depuis la ligne 1. */
const FLANC = LANES[2] - PLATEFORME_LARG / 2

// ————— 1. On s'accroche, et l'on martèle le swipe VERS le mur —————
console.log('\n— La course sur mur, en martelant le swipe vers la paroi —')
p.reset(1)
p.jump()
p.update(DT)
verifie(p.accrocheMur(1, FLANC), 'accroche au flanc acceptée')

let images = 0
while (p.surMur !== 0 && images < 300) {
  p.moveRight() // le geste qui faisait changer de ligne en douce
  p.update(DT)
  images++
}
etat('fin de la course sur mur')
verifie(p.currentLane === 1, "la ligne n'a pas bougé pendant le mur")
verifie(images * DT > 0.9, `le passage a duré ${(images * DT).toFixed(2)} s (non tronqué)`)
verifie(p.enRetour, 'le relâchement ouvre la retombée')

// ————— 2. La retombée : on essaie de tout casser à chaque image —————
console.log('\n— Pendant la retombée : swipes + raccroches à chaque image —')
let reAccroche = false
let ligneBougee = false
let yMax = p.mesh.position.y
let n = 0
while (p.enRetour && n < 600) {
  if (p.accrocheMur(1, FLANC) || p.accrocheMur(-1)) reAccroche = true
  p.moveRight()
  p.moveLeft()
  if (p.currentLane !== 1) ligneBougee = true
  p.update(DT)
  yMax = Math.max(yMax, p.mesh.position.y)
  n++
}
etat('fin de la retombée')
console.log(`  (apex ${yMax.toFixed(2)} m, retombée ${(n * DT).toFixed(2)} s)`)

verifie(!reAccroche, 'impossible de repartir au mur pendant la retombée')
verifie(!ligneBougee, 'impossible de changer de ligne pendant la retombée')
verifie(yMax > MUR_HAUTEUR, 'la paroi relance bien vers le haut')
verifie(Math.abs(p.mesh.position.x - LANES[1]) < 0.25, 'on est rentré sur sa ligne initiale')
// La main revient SUR LA VOIE, sans attendre d'être redescendu : la retombée
// doit donc se terminer alors qu'on est encore haut, en plein vol.
verifie(p.mesh.position.y > MUR_HAUTEUR, `la main revient en vol (y=${p.mesh.position.y.toFixed(2)} m)`)
verifie(n * DT < 0.4, `la reprise est franche : ${(n * DT).toFixed(2)} s`)

// ————— 3. La main est rendue, et pas avant —————
console.log('\n— Une fois la retombée finie —')
verifie(!p.enRetour, 'la retombée est terminée')
p.moveRight()
verifie(p.currentLane === 2, 'on peut de nouveau changer de ligne')

// ————— 4. Le filet : le sol libère toujours —————
// Un joueur ne doit JAMAIS se retrouver sans commandes, quel que soit le cas
// de figure qui l'amène là.
console.log('\n— Le filet de sécurité —')
p.reset(1)
p.jump()
p.update(DT)
p.accrocheMur(1, FLANC)
while (p.surMur !== 0) p.update(DT)
let m = 0
while (p.enRetour && m < 900) {
  p.update(DT)
  m++
}
verifie(!p.enRetour, 'la retombée finit toujours par se terminer')
verifie(m < 900, `elle a duré ${(m * DT).toFixed(2)} s, sans blocage`)

/*
 * ————— 5. Le flanc est SOLIDE, mais seulement de côté —————
 *
 * On n'escalade une plateforme que de FACE. Entrer dedans par le travers ne
 * doit RIEN faire : c'est un mur. Le contrôle se joue sur une vraie plateforme
 * de la piste, pas sur une maquette — c'est `flancA` qui tranche, et c'est lui
 * que les swipes de main.ts interrogent avant de changer de ligne.
 */
console.log('\n— Le flanc d\'une vraie plateforme —')
const track = new Track(scene)
track.reset(COURSE_LENGTH, 12345)

// Une plateforme SANS rampe : c'est le cas qui se grimpe, donc celui qui pose
// la question « de face ou de côté ? ».
const plan = track.plateformesPrevues().find((q) => q.rampe === 0 && q.lane !== 1)
if (!plan) {
  console.log('  (aucune plateforme sans rampe dans cette graine — contrôle sauté)')
} else {
  const cote = plan.lane === 2 ? 1 : -1 // depuis la ligne du milieu
  const SPEED = 14

  /** Fait défiler la piste jusqu'à `cible` mètres, puis rend la main. */
  function avanceJusqua(cible: number) {
    let d = 0
    track.reset(COURSE_LENGTH, 12345)
    while (d < cible) {
      d = Math.min(cible, d + SPEED * DT)
      track.update(DT, SPEED, d)
    }
    return d
  }

  console.log(`  (plateforme ligne ${plan.lane}, d=${plan.d.toFixed(0)} m, ` +
    `longueur ${plan.longueur} m, haut ${plan.hauteur} m)`)

  // a) LE LONG du plateau, au sol : le flanc bloque.
  avanceJusqua(plan.d + plan.longueur / 2)
  verifie(
    track.flancA(1, cote, 0) !== null,
    'de côté et au sol : le flanc BLOQUE (pas d\'escalade par le travers)'
  )

  // b) Au même endroit, mais au-dessus du pont : plus de flanc, c'est un sol.
  verifie(
    track.flancA(1, cote, plan.hauteur) === null,
    'au-dessus du pont : plus de flanc, on peut passer'
  )

  // c) DEVANT LE NEZ : là, et seulement là, la voie est libre — c'est la
  //    rencontre de face, celle qui donne l'escalade.
  avanceJusqua(plan.d)
  verifie(
    track.flancA(1, cote, 0) === null,
    'devant le nez : la voie est libre (rencontre de face → escalade)'
  )
}

console.log(ko === 0 ? '\n✅ TOUT PASSE\n' : `\n❌ ${ko} ÉCHEC(S)\n`)
process.exit(ko === 0 ? 0 : 1)
