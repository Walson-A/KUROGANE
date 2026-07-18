/**
 * ————— Le son du jeu —————
 *
 * Tout est SYNTHÉTISÉ à la volée (Web Audio) : pas un seul fichier à charger,
 * donc rien à télécharger sur mobile et aucun asset à gérer.
 *
 * Les navigateurs interdisent le son tant que le joueur n'a pas interagi : on
 * débloque le contexte au tout premier clic / appui, une bonne fois.
 */

let ctx: AudioContext | null = null

/** Le contexte audio, créé à la demande. null si le navigateur n'en veut pas. */
function audio(): AudioContext | null {
  const AC = window.AudioContext ?? (window as any).webkitAudioContext
  if (!AC) return null
  if (!ctx) ctx = new AC()
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

// Déblocage au premier geste : après ça, le son marche partout dans la partie.
for (const ev of ['pointerdown', 'keydown', 'touchstart']) {
  addEventListener(ev, () => audio(), { once: true, passive: true })
}

/**
 * 🌬️ Un souffle de vent : du bruit blanc passé dans un filtre qui balaie les
 * fréquences, avec une enveloppe qui enfle puis retombe. C'est la recette
 * classique du vent — bien plus convaincant qu'un simple souffle constant.
 */
export function souffleDeVent(duree = 3.2, volume = 0.22) {
  const ac = audio()
  if (!ac) return

  // Le bruit blanc : la matière première du vent
  const n = Math.floor(ac.sampleRate * duree)
  const buf = ac.createBuffer(1, n, ac.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1
  const src = ac.createBufferSource()
  src.buffer = buf

  // Le filtre qui balaie : c'est lui qui fait « whoooosh » plutôt que « chhhh »
  const bp = ac.createBiquadFilter()
  bp.type = 'bandpass'
  bp.Q.value = 0.7
  const t0 = ac.currentTime
  bp.frequency.setValueAtTime(300, t0)
  bp.frequency.linearRampToValueAtTime(950, t0 + duree * 0.5)
  bp.frequency.linearRampToValueAtTime(380, t0 + duree)

  // L'enveloppe : la rafale monte, tient, puis s'éteint
  const g = ac.createGain()
  g.gain.setValueAtTime(0, t0)
  g.gain.linearRampToValueAtTime(volume, t0 + duree * 0.3)
  g.gain.linearRampToValueAtTime(volume * 0.7, t0 + duree * 0.72)
  g.gain.linearRampToValueAtTime(0, t0 + duree)

  src.connect(bp)
  bp.connect(g)
  g.connect(sortie(ac)) // passe par le volume commun, comme tous les bruitages
  src.start(t0)
  src.stop(t0 + duree + 0.05)
}

/* ═══════════════ Les bruitages du jeu ═══════════════
 *
 * Le piège de la synthèse, c'est de sonner « bip de vieux jouet ». Trois
 * partis pris l'évitent :
 *
 * 1. **Du bruit, pas des tons.** Un impact ou une poterie qui casse, c'est du
 *    bruit blanc passé dans un filtre — jamais un oscillateur. Les tons purs
 *    ne servent qu'aux SIGNAUX (décompte, victoire), où personne n'attend
 *    qu'ils sonnent organiques.
 * 2. **Des décroissances exponentielles.** Un objet réel perd son énergie de
 *    plus en plus vite ; une décroissance linéaire s'entend tout de suite
 *    comme artificielle.
 * 3. **Une variation à chaque jeu.** Sans elle, casser dix jarres d'affilée
 *    sonne comme une mitraillette.
 */

export type Bruit =
  | 'saut'
  | 'glissade'
  | 'jarre'
  | 'jarreDoree'
  | 'coup'
  | 'chute'
  | 'parchemin'
  | 'bip'
  | 'go'
  | 'victoire'
  | 'defaite'
  | 'clic'

let master: GainNode | null = null
let volumeSfx = 0.6
let bruitBuf: AudioBuffer | null = null

/** Le volume commun à tous les bruitages — le vent compris. */
function sortie(ac: AudioContext): GainNode {
  if (!master) {
    master = ac.createGain()
    master.gain.value = volumeSfx
    master.connect(ac.destination)
  }
  return master
}

export function setVolumeSfx(v: number) {
  volumeSfx = Math.min(1, Math.max(0, v))
  if (master) master.gain.value = volumeSfx
}

/** Un poil de hasard : ±4 %, assez pour casser la répétition sans dénaturer. */
const vary = () => 1 + (Math.random() - 0.5) * 0.08

/** Une seconde de bruit blanc, fabriquée une fois et réutilisée partout. */
function bruitBlanc(ac: AudioContext): AudioBuffer {
  if (!bruitBuf) {
    const n = ac.sampleRate
    bruitBuf = ac.createBuffer(1, n, ac.sampleRate)
    const d = bruitBuf.getChannelData(0)
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1
  }
  return bruitBuf
}

/**
 * Une bouffée de bruit filtrée : la brique de tous les impacts.
 * Passe-bas pour un choc sourd, passe-bande pour un tintement sec.
 */
function souffle(
  ac: AudioContext,
  depart: number,
  duree: number,
  gain: number,
  freq: number,
  type: BiquadFilterType = 'bandpass',
  freqFin?: number
) {
  const src = ac.createBufferSource()
  src.buffer = bruitBlanc(ac)
  src.playbackRate.value = vary()

  const filtre = ac.createBiquadFilter()
  filtre.type = type
  filtre.frequency.setValueAtTime(freq, depart)
  if (freqFin) filtre.frequency.exponentialRampToValueAtTime(freqFin, depart + duree)
  filtre.Q.value = type === 'bandpass' ? 1.4 : 0.8

  const g = ac.createGain()
  g.gain.setValueAtTime(gain, depart)
  g.gain.exponentialRampToValueAtTime(0.0001, depart + duree)

  src.connect(filtre).connect(g).connect(sortie(ac))
  // On démarre à un point au hasard du bruit : deux souffles ne sont jamais
  // taillés dans la même matière.
  src.start(depart, Math.random() * 0.8, duree)
  src.stop(depart + duree)
}

/** Un ton : pour les signaux, et pour le corps grave d'un impact. */
function ton(
  ac: AudioContext,
  depart: number,
  duree: number,
  gain: number,
  freq: number,
  freqFin?: number,
  forme: OscillatorType = 'triangle'
) {
  const o = ac.createOscillator()
  o.type = forme
  o.frequency.setValueAtTime(freq, depart)
  if (freqFin) o.frequency.exponentialRampToValueAtTime(freqFin, depart + duree)

  const g = ac.createGain()
  // Attaque de 4 ms : instantanée à l'oreille, mais sans le « clic » parasite
  // qu'un démarrage à pic produirait.
  g.gain.setValueAtTime(0.0001, depart)
  g.gain.exponentialRampToValueAtTime(gain, depart + 0.004)
  g.gain.exponentialRampToValueAtTime(0.0001, depart + duree)

  o.connect(g).connect(sortie(ac))
  o.start(depart)
  o.stop(depart + duree + 0.02)
}

export function jouerBruit(b: Bruit) {
  const ac = audio()
  if (!ac || volumeSfx <= 0) return
  const t = ac.currentTime
  const v = vary()

  switch (b) {
    // Un appel d'air qui monte : le corps qui se détend.
    case 'saut':
      ton(ac, t, 0.1 * v, 0.22, 300 * v, 620 * v)
      souffle(ac, t, 0.1, 0.05, 1400, 'bandpass', 2600)
      break

    // Du frottement : le filtre se referme à mesure que la vitesse retombe.
    case 'glissade':
      souffle(ac, t, 0.3 * v, 0.16, 3200 * v, 'lowpass', 500)
      break

    // La poterie : un choc sourd, une gerbe claire, puis trois éclats qui
    // retombent. Ce sont EUX qui font entendre « céramique » et non « explosion ».
    case 'jarre':
      ton(ac, t, 0.09, 0.18, 190 * v, 85)
      souffle(ac, t, 0.2 * v, 0.3, 2300 * v)
      souffle(ac, t + 0.03, 0.09, 0.14, 3600 * v)
      souffle(ac, t + 0.07, 0.07, 0.1, 4400 * v)
      souffle(ac, t + 0.12, 0.06, 0.07, 5200 * v)
      break

    // La même casse, doublée d'un accord clair : la récompense s'entend avant
    // même qu'on lise le HUD.
    case 'jarreDoree':
      ton(ac, t, 0.09, 0.18, 190 * v, 85)
      souffle(ac, t, 0.2 * v, 0.28, 2500 * v)
      souffle(ac, t + 0.04, 0.08, 0.12, 4000 * v)
      ton(ac, t + 0.02, 0.4, 0.16, 880 * v, undefined, 'sine')
      ton(ac, t + 0.09, 0.38, 0.13, 1320 * v, undefined, 'sine')
      ton(ac, t + 0.16, 0.36, 0.1, 1760 * v, undefined, 'sine')
      break

    // Un coup porté : le claquement du contact, puis le poids derrière.
    case 'coup':
      souffle(ac, t, 0.06, 0.28, 900 * v, 'lowpass')
      ton(ac, t, 0.14 * v, 0.34, 170 * v, 55)
      break

    // On tombe : plus grave, plus long et plus mou qu'un coup donné.
    case 'chute':
      souffle(ac, t, 0.32 * v, 0.3, 700 * v, 'lowpass', 200)
      ton(ac, t, 0.26, 0.3, 130 * v, 42)
      break

    // Le papier qu'on saisit, puis deux notes qui montent : c'est un gain.
    case 'parchemin':
      souffle(ac, t, 0.09, 0.1, 3000, 'bandpass', 1500)
      ton(ac, t + 0.02, 0.16, 0.2, 660 * v, undefined, 'sine')
      ton(ac, t + 0.1, 0.22, 0.18, 990 * v, undefined, 'sine')
      break

    // Ici le ton pur est LÉGITIME : c'est un signal, pas un objet du monde.
    case 'bip':
      ton(ac, t, 0.11, 0.24, 660, undefined, 'square')
      break

    case 'go':
      ton(ac, t, 0.3, 0.3, 990, undefined, 'square')
      ton(ac, t, 0.3, 0.12, 1980, undefined, 'sine')
      break

    // Do–mi–sol : l'accord parfait, ça sonne juste sans effort.
    case 'victoire':
      ton(ac, t, 0.18, 0.26, 523)
      ton(ac, t + 0.13, 0.18, 0.26, 659)
      ton(ac, t + 0.26, 0.5, 0.3, 784)
      break

    // Les mêmes notes à l'envers et plus lentes : ça retombe.
    case 'defaite':
      ton(ac, t, 0.22, 0.24, 392)
      ton(ac, t + 0.18, 0.24, 0.22, 330)
      ton(ac, t + 0.4, 0.6, 0.24, 262)
      break

    // Un rien : juste de quoi sentir que le doigt a touché.
    case 'clic':
      souffle(ac, t, 0.03, 0.14, 2600)
      break
  }
}

/**
 * 🍵 Le son du soin : trois notes qui MONTENT (do-mi-sol, un accord parfait).
 *
 * Un arpège ascendant en harmonie, c'est la grammaire universelle du soin dans
 * le jeu vidéo — on l'entend comme « ça va mieux » sans avoir rien appris. On
 * les joue sur des sinus doux, jamais sur une onde carrée : il faut que ça
 * apaise au milieu du vacarme de la course.
 */
export function sonDeSoin(volume = 0.16) {
  const ac = audio()
  if (!ac || volumeSfx <= 0) return
  const t0 = ac.currentTime
  const notes = [523.25, 659.25, 783.99] // do5, mi5, sol5

  notes.forEach((f, i) => {
    const debut = t0 + i * 0.085 // elles s'enchaînent vite : un geste, pas une mélodie
    const o = ac.createOscillator()
    o.type = 'sine'
    o.frequency.value = f

    const g = ac.createGain()
    // Attaque douce et longue traîne : une cloche, pas un bip
    g.gain.setValueAtTime(0, debut)
    g.gain.linearRampToValueAtTime(volume, debut + 0.03)
    g.gain.exponentialRampToValueAtTime(0.0001, debut + 0.75)

    o.connect(g)
    // Passe par le volume commun (sortie), comme tous les autres bruitages —
    // sinon ce son ignorerait le réglage de volume et le mute.
    g.connect(sortie(ac))
    o.start(debut)
    o.stop(debut + 0.8)
  })
}
