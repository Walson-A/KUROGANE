/**
 * Le banc d'essai des bruitages (sfx-lab.html).
 * Une page à part, hors du jeu : on écoute, on juge, on ajuste les chiffres
 * dans sfx.ts. Elle ne part pas en production — c'est un outil d'atelier.
 */
import { jouerBruit, setVolumeSfx, souffleDeVent, type Bruit } from './sfx'

const CATALOGUE: { id: Bruit | 'vent'; nom: string; quand: string }[] = [
  { id: 'saut', nom: '🦘 Saut', quand: 'swipe ⬆️' },
  { id: 'glissade', nom: '🛷 Glissade', quand: 'swipe ⬇️' },
  { id: 'jarre', nom: '🏺 Jarre cassée', quand: 'un coup qui porte' },
  { id: 'jarreDoree', nom: '✨ Jarre dorée', quand: 'un parchemin dedans' },
  { id: 'coup', nom: '⚔️ Coup au rival', quand: 'on touche un joueur' },
  { id: 'chute', nom: '💥 Trébuchement', quand: 'obstacle ou coup reçu' },
  { id: 'parchemin', nom: '📜 Ramassage', quand: 'on prend un rouleau' },
  { id: 'bip', nom: '🔔 Bip du décompte', quand: '3… 2… 1…' },
  { id: 'go', nom: '🚦 GO !', quand: 'le départ' },
  { id: 'victoire', nom: '🏆 Victoire', quand: 'premier au torii' },
  { id: 'defaite', nom: '☁️ Défaite', quand: 'arrivé après' },
  { id: 'clic', nom: '👆 Clic de menu', quand: 'un bouton' },
  { id: 'vent', nom: '🌬️ Rafale de vent', quand: 'départ de course (existant)' },
]

const jouer = (id: Bruit | 'vent') =>
  id === 'vent' ? souffleDeVent(3.2) : jouerBruit(id)

const grille = document.getElementById('grille')!
for (const s of CATALOGUE) {
  const b = document.createElement('button')
  b.innerHTML = `<b></b><small></small>`
  b.querySelector('b')!.textContent = s.nom
  b.querySelector('small')!.textContent = s.quand
  b.addEventListener('click', () => jouer(s.id))
  grille.appendChild(b)
}

// La rafale : c'est ELLE qui dit si la variation aléatoire suffit.
document.getElementById('rafale')!.addEventListener('click', () => {
  for (let i = 0; i < 5; i++) setTimeout(() => jouerBruit('jarre'), i * 180)
})

const vol = document.getElementById('vol') as HTMLInputElement
const volVal = document.getElementById('volVal')!
vol.addEventListener('input', () => {
  setVolumeSfx(Number(vol.value) / 100)
  volVal.textContent = `${vol.value} %`
})
setVolumeSfx(0.6)
