/**
 * ————— Le portique ne doit punir aucun saut —————
 *
 * Le torii a maintenant une boite de collision qui epouse sa forme : deux
 * piliers, deux traverses, et le grand trou au milieu. Mais ses traverses
 * barrent TOUTE la piste, et les portiques defilent tous les 70 m sans rien
 * savoir des obstacles tires au sort. Si l'une d'elles descend a portee de
 * saut, on peut se retrouver force de sauter une barriere pile dessous —
 * injouable, et sans que rien ne le signale a l'ecran.
 *
 * Ce controle mesure la tete la plus haute que le jeu autorise et exige que
 * l'ouverture soit au-dessus. Il tient aussi la promesse inverse : on doit
 * pouvoir passer, donc le trou doit rester large.
 *
 *   node tools/verifier-torii.ts
 */
import { TORII_PIECES } from '../src/track.ts'
import { LANES, MUR_ECART, MUR_X } from '../src/player.ts'
import { ROSTER, customFighter, DEFAULT_CUSTOM, HEADS } from '../src/roster.ts'

/** Les constantes du saut, telles que player.ts les applique. */
const GRAVITE = 42
const IMPULSION = 13.2
const MUR_HAUTEUR = 1.6
/** La hauteur d'un coureur, cf. la hitbox de player.ts. */
const TAILLE = 1.5

let echecs = 0
function verifier(titre: string, ok: boolean, detail = '') {
  if (!ok) echecs++
  console.log(`  ${ok ? 'ok  ' : 'ECHEC'} ${titre}${detail ? '  → ' + detail : ''}`)
}

/** Tous les guerriers jouables, le perso « + » sous ses trois ornements. */
const TOUS = [
  ...ROSTER.filter((f) => f.pickable),
  ...HEADS.map((head) => customFighter({ ...DEFAULT_CUSTOM, head })),
]

const apex = (saut: number) => (IMPULSION * saut) ** 2 / (2 * GRAVITE)

// La tete la plus haute que le jeu permette d'atteindre, toutes situations.
let plusHaut = 0
let champion = ''
for (const f of TOUS) {
  const nom = f.id === 'perso' ? `perso(${f.head})` : f.id
  // Le saut depuis une paroi part deja de MUR_HAUTEUR : c'est le pire cas.
  const tete = MUR_HAUTEUR + apex(f.jump) + TAILLE
  if (tete > plusHaut) {
    plusHaut = tete
    champion = nom
  }
}

console.log('\n————— Aucun saut ne doit heurter le portique —————')
console.log(`  la tete la plus haute du jeu : ${plusHaut.toFixed(2)} m (${champion}, depuis une paroi)\n`)

// Le dessous de la piece la plus basse qui barre le passage
const barres = TORII_PIECES.filter((p) => Math.abs(p.x) < 1) // les traverses
const dessous = Math.min(...barres.map((p) => p.y - p.haut / 2))
/*
 * On exige une GARDE, pas un simple « au-dessus ». Frôler de justesse ne
 * protege de rien : retoucher l'impulsion du saut de deux centimetres suffirait
 * a rendre le portique mortel, et rien ne le signalerait.
 */
const GARDE = 0.4
verifier(
  `l ouverture degage le saut le plus haut d au moins ${GARDE} m`,
  dessous - plusHaut >= GARDE,
  `dessous a ${dessous.toFixed(2)} m, tete a ${plusHaut.toFixed(2)} m, degagement ${(dessous - plusHaut).toFixed(2)} m`
)

console.log('\n————— …y compris guerrier par guerrier —————')
for (const f of TOUS) {
  const nom = f.id === 'perso' ? `perso(${f.head})` : f.id
  const sol = apex(f.jump) + TAILLE
  const mur = MUR_HAUTEUR + apex(f.jump) + TAILLE
  verifier(
    `${nom.padEnd(14)} passe dessous`,
    mur < dessous,
    `sol ${sol.toFixed(2)} m, paroi ${mur.toFixed(2)} m`
  )
}

console.log('\n————— On doit pouvoir passer —————')
{
  /*
   * La contrepartie : un portique qui epouse sa forme ne sert a rien s'il
   * bouche la piste. Les trois voies, et le couloir de course sur mur, doivent
   * rester libres au niveau du sol.
   */
  const piliers = TORII_PIECES.filter((p) => Math.abs(p.x) > 1)
  const DEMI = 0.3 // la demi-largeur du coureur, cf. la hitbox
  for (const [nom, x] of [
    ['voie gauche', LANES[0]],
    ['voie centre', LANES[1]],
    ['voie droite', LANES[2]],
    ['le long de la paroi gauche', -(MUR_X - MUR_ECART)],
    ['le long de la paroi droite', MUR_X - MUR_ECART],
  ] as const) {
    const bloque = piliers.some(
      (p) => x + DEMI > p.x - p.larg / 2 && x - DEMI < p.x + p.larg / 2
    )
    verifier(`${nom.padEnd(26)} reste libre`, !bloque, `centre a x=${x.toFixed(2)}`)
  }
}

console.log(echecs === 0 ? '\nTout est bon.\n' : `\n${echecs} ECHEC(S)\n`)
process.exit(echecs === 0 ? 0 : 1)
