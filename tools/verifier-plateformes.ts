/**
 * ————— Les plateformes arretent, sauf le radeau de bambou —————
 *
 * Deux promesses opposees, et c'est tout l'interet :
 *
 *   · une plateforme PLEINE arrete le corps ET les sorts ;
 *   · le radeau de bambou, monte sur pilotis, laisse passer DESSOUS — coureur
 *     comme projectile. C'est le seul passage bas de la course, et son dessin
 *     l'annonce : le bloquer reviendrait a dementir ce qu'on voit.
 *
 * On pilote le vrai Track, pas une imitation.
 *
 *   node tools/verifier-plateformes.ts
 */

/*
 * Un canevas de facade. Track cuit une texture de degrade pour les jarres, ce
 * qui reclame un <canvas> — Node n'en a pas. On n'imite que les appels
 * utilises : la texture ne sera jamais REGARDEE ici, seule la geometrie compte.
 */
;(globalThis as any).document = {
  createElement: () => ({
    width: 0,
    height: 0,
    getContext: () => ({
      createLinearGradient: () => ({ addColorStop() {} }),
      createRadialGradient: () => ({ addColorStop() {} }),
      fillRect() {},
      set fillStyle(_v: unknown) {},
    }),
  }),
}

import * as THREE from 'three'
import { Track } from '../src/track.ts'
import { LANES } from '../src/player.ts'
import { BIOMES, indexBiome } from '../src/biomes.ts'

const LONGUEUR = 1920
const GRAINE = 1234

let echecs = 0
function verifier(titre: string, ok: boolean, detail = '') {
  if (!ok) echecs++
  console.log(`  ${ok ? 'ok  ' : 'ECHEC'} ${titre}${detail ? '  → ' + detail : ''}`)
}

/** Ce biome porte-t-il des radeaux ajoures ? */
const ajouree = (d: number) => BIOMES[indexBiome(d, LONGUEUR)].plateformeAjouree === true

function neuf() {
  const t = new Track(new THREE.Scene())
  // ⚠️ reset(longueur, graine) — dans CET ordre. Les avoir inverses faisait
  // courir 1234 m a mon premier essai, et les biomes tombaient ailleurs.
  t.reset(LONGUEUR, GRAINE)
  return t
}

console.log('\n————— Quel biome porte des radeaux ajoures —————')
for (const b of BIOMES) {
  console.log(
    `  · ${b.nom.padEnd(22)} ${b.plateformeAjouree ? 'AJOURE — on passe dessous' : 'plein — il arrete'}`
  )
}
verifier(
  'un seul biome est ajoure',
  BIOMES.filter((b) => b.plateformeAjouree).length === 1,
  `${BIOMES.filter((b) => b.plateformeAjouree).length} biome(s)`
)

// ————— Les sorts —————
console.log('\n————— Un projectile est arrete par une plateforme pleine —————')
{
  const track = neuf()
  const plateformes = track.plateformesPrevues()
  verifier('la course en contient', plateformes.length > 0, `${plateformes.length} plateformes`)

  let arretePlein = 0
  let ratePlein = 0
  let fileBambou = 0
  let bloqueBambou = 0
  for (const p of plateformes) {
    /*
     * On interroge la plateforme SEULE et non `premierBarrage` : un mur peut se
     * dresser a la meme distance et renvoyer le meme chiffre, ce qui aurait
     * fait passer le controle pour de mauvaises raisons.
     */
    const arretee = track.premierePlateforme(p.lane, p.d - 1, p.d + 1) === p.d
    if (ajouree(p.d)) arretee ? bloqueBambou++ : fileBambou++
    else arretee ? arretePlein++ : ratePlein++
  }
  verifier(
    'toutes les plateformes pleines arretent le tir',
    ratePlein === 0,
    `${arretePlein} arretent, ${ratePlein} laissent passer`
  )
  verifier(
    'aucun radeau ajoure n arrete le tir',
    bloqueBambou === 0,
    `${fileBambou} laissent filer dessous, ${bloqueBambou} bloquent`
  )
}

// ————— Le corps —————
console.log('\n————— Le coureur bute sur le plein, passe sous le bambou —————')
{
  const track = neuf()
  const plateformes = track.plateformesPrevues()

  /*
   * On DEROULE la course au lieu de la teleporter. Les plateformes naissent
   * 85 m devant puis defilent : sauter droit a la bonne distance ne les fait
   * pas exister, et mon premier essai en concluait a tort que plus rien
   * n'arretait le coureur.
   */
  const VITESSE = 30
  const PAS = 0.5
  const vus = new Map<number, { heurte: boolean; sol: number }>()

  let distance = 0
  while (distance < LONGUEUR) {
    track.update(PAS / VITESSE, VITESSE, distance)
    distance += PAS
    plateformes.forEach((p, i) => {
      // On ne juge qu'au MILIEU du plateau : au bord avant on rencontre la
      // rampe, qui ne heurte jamais — et c'est voulu.
      if (vus.has(i) || Math.abs(distance - (p.d + p.longueur / 2)) > PAS) return
      vus.set(i, {
        heurte: track.supportSous(LANES[p.lane], 0).heurte, // pieds au ras du sol
        sol: track.supportSous(LANES[p.lane], p.hauteur).sol, // debout dessus
      })
    })
  }

  verifier(
    'chaque plateforme a bien ete rencontree',
    vus.size === plateformes.length,
    `${vus.size}/${plateformes.length}`
  )

  let butePlein = 0
  let traversePlein = 0
  let passeBambou = 0
  let buteBambou = 0
  let porte = 0
  let creux = 0
  for (const [i, r] of vus) {
    const p = plateformes[i]
    if (ajouree(p.d)) r.heurte ? buteBambou++ : passeBambou++
    else r.heurte ? butePlein++ : traversePlein++
    r.sol >= p.hauteur - 0.01 ? porte++ : creux++
  }

  verifier(
    'il bute sur toute plateforme pleine',
    traversePlein === 0,
    `${butePlein} l arretent, ${traversePlein} le laissent traverser`
  )
  verifier(
    'il passe sous tout radeau de bambou',
    buteBambou === 0,
    `${passeBambou} le laissent passer, ${buteBambou} le bloquent`
  )
  /*
   * La contrepartie du passage : ouvert dessous ne veut pas dire transparent.
   * Un radeau doit rester un SOL quand on lui court sur le dos.
   */
  verifier(
    'le tablier porte le coureur, dans TOUS les biomes',
    creux === 0,
    `${porte} portent, ${creux} sont creux`
  )
}

console.log(echecs === 0 ? '\nTout est bon.\n' : `\n${echecs} ECHEC(S)\n`)
process.exit(echecs === 0 ? 0 : 1)
