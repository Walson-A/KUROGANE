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
  g.connect(ac.destination)
  src.start(t0)
  src.stop(t0 + duree + 0.05)
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
  if (!ac) return
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
    g.connect(ac.destination)
    o.start(debut)
    o.stop(debut + 0.8)
  })
}
