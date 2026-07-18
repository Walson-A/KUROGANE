/**
 * ————— Les icônes des deux monnaies —————
 *
 * Les dessins vivent dans `index.html`, en planche SVG (`<symbol>`). On ne fait
 * ici que les RÉFÉRENCER : chaque icône affichée est un `<use>` de quelques
 * octets, pas une copie du tracé. Une seule définition, donc un seul endroit à
 * retoucher pour changer l'allure d'une pièce partout dans le jeu.
 *
 * Pourquoi du SVG et pas une image : zéro fichier à télécharger, net sur les
 * écrans à forte densité, et lisible aussi bien à 14 px dans un prix qu'à 22 px
 * en tête de boutique.
 */

const SVG = 'http://www.w3.org/2000/svg'

export type Monnaie = 'mon' | 'hisui'

/** Le nom de la monnaie, pour les lecteurs d'écran et les infobulles. */
const NOMS: Record<Monnaie, string> = { mon: 'Mon', hisui: 'Hisui' }

/**
 * Une icône de monnaie, prête à insérer.
 * `taille` en pixels — elle suit la taille du texte à côté.
 */
export function icone(monnaie: Monnaie, taille = 16): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg')
  svg.setAttribute('class', 'piece')
  svg.setAttribute('width', String(taille))
  svg.setAttribute('height', String(taille))
  svg.setAttribute('viewBox', '0 0 24 24')
  // L'icône ne dit rien de plus que le texte qui la suit : on l'ignore à la
  // lecture d'écran pour ne pas annoncer « Mon » deux fois.
  svg.setAttribute('aria-hidden', 'true')

  const use = document.createElementNS(SVG, 'use')
  use.setAttribute('href', monnaie === 'mon' ? '#i-mon' : '#i-hisui')
  svg.appendChild(use)
  return svg
}

/**
 * Un montant complet : « [pièce] 500 ».
 *
 * Renvoie un fragment plutôt qu'une chaîne de HTML — on ne fabrique jamais de
 * balises à partir d'une valeur, même quand elle vient de nous.
 */
export function montant(valeur: number | string, monnaie: Monnaie, taille = 16): DocumentFragment {
  const frag = document.createDocumentFragment()
  frag.append(icone(monnaie, taille), ` ${valeur}`)
  // Le nom écrit en toutes lettres, pour qui n'y verrait qu'un rond doré
  const lu = document.createElement('span')
  lu.className = 'sr-only'
  lu.textContent = ` ${NOMS[monnaie]}`
  frag.append(lu)
  return frag
}
