/**
 * ————— Le chemin de retour dans les menus —————
 *
 * Un bug signale en jeu : « je change de skin depuis le salon et ca me sort de
 * la partie ». La cause etait un repere de retour UNIQUE, incapable de retenir
 * plus d'un cran. Ces controles rejouent les parcours a la main.
 *
 * On ne teste pas le vrai Menu (il reclame tout le DOM du jeu) mais la REGLE
 * qu'il applique : empiler en descendant, depiler au retour, effacer aux
 * racines. C'est exactement le code de menu.ts, isole.
 *
 *   node tools/verifier-navigation.ts
 */

type Ecran = string

/** Les ecrans ou l'on ARRIVE : y entrer efface le chemin parcouru. */
const RACINES = new Set<Ecran>(['title', 'salon', 'lobby', 'results', 'status'])

/** La navigation de menu.ts, reduite a son mecanisme. */
class Navigation {
  courant: Ecran = 'title'
  private pile: Ecran[] = []

  /** Descendre dans une fiche : on retient d'ou l'on vient. */
  ouvrir(vers: Ecran) {
    this.pile.push(this.courant)
    this.aller(vers)
  }

  /** Y arriver directement (lien lateral, evenement reseau). */
  aller(vers: Ecran) {
    if (RACINES.has(vers)) this.pile.length = 0
    this.courant = vers
  }

  /** Le bouton retour : un cran en arriere, et un seul. */
  retour() {
    this.aller(this.pile.pop() ?? 'title')
  }
}

let echecs = 0
function verifier(titre: string, obtenu: Ecran, attendu: Ecran) {
  const ok = obtenu === attendu
  if (!ok) echecs++
  console.log(`  ${ok ? 'ok  ' : 'ECHEC'} ${titre}${ok ? '' : `  → ${obtenu} au lieu de ${attendu}`}`)
}

console.log('\n————— Le parcours qui sortait du salon —————')
{
  // C'est LE bug signale : dans un salon, on va changer de skin, et on se
  // retrouve dehors. Trois crans de descente, trois retours.
  const n = new Navigation()
  n.aller('lobby')
  n.ouvrir('roster') // 🥷 le vestiaire
  n.ouvrir('boutique') // on y achete une couleur
  n.retour()
  verifier('la boutique ramene au vestiaire', n.courant, 'roster')
  n.retour()
  verifier('le vestiaire ramene au salon', n.courant, 'lobby')
  // Et surtout : on est TOUJOURS dans le salon. Avant, on en etait sorti.
  verifier('on est reste dans le salon', n.courant, 'lobby')
}

console.log('\n————— L\'aide depuis le salon —————')
{
  const n = new Navigation()
  n.aller('lobby')
  n.ouvrir('help')
  n.retour()
  verifier('l\'aide ramene au salon', n.courant, 'lobby')
}

console.log('\n————— Le meme ecran, atteint depuis deux endroits —————')
{
  // Le vestiaire ne doit pas se souvenir de la fois d'avant : c'est la
  // confusion « les skins ouvrent l'aide ».
  const n = new Navigation()
  n.ouvrir('roster') // depuis le titre
  n.retour()
  verifier('depuis le titre, le vestiaire ramene au titre', n.courant, 'title')

  n.aller('lobby')
  n.ouvrir('roster') // depuis le salon, cette fois
  n.retour()
  verifier('depuis le salon, il ramene au salon', n.courant, 'lobby')
}

console.log('\n————— Un chemin abandonne ne traine pas —————')
{
  /*
   * On descend dans le vestiaire depuis un salon, puis la partie se lance et
   * se termine. Le chemin d'avant ne doit plus exister : un retour ne peut pas
   * renvoyer vers un salon qu'on a quitte entre-temps.
   */
  const n = new Navigation()
  n.aller('lobby')
  n.ouvrir('roster')
  n.aller('results') // la course a eu lieu
  n.ouvrir('options')
  n.retour()
  verifier('le retour ramene aux resultats', n.courant, 'results')
  n.retour()
  verifier('et non vers le salon quitte', n.courant, 'title')
}

console.log('\n————— La profondeur ne casse rien —————')
{
  const n = new Navigation()
  n.aller('lobby')
  n.ouvrir('roster')
  n.ouvrir('boutique')
  n.ouvrir('compte')
  verifier('trois crans plus bas', n.courant, 'compte')
  n.retour()
  n.retour()
  n.retour()
  verifier('trois retours ramenent au salon', n.courant, 'lobby')
}

console.log(echecs === 0 ? '\nTout est bon.\n' : `\n${echecs} ECHEC(S)\n`)
process.exit(echecs === 0 ? 0 : 1)
