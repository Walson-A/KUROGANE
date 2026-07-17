import * as THREE from 'three'
import './style.css'
import { Player } from './player'
import { Opponent } from './opponent'
import { Track, SPRINT_ZONE } from './track'
import { Input } from './input'
import { Net, type RemotePlayer } from './net'
import { Menu, escapeHtml } from './menu'
import type { Quality } from './settings'

/** La longueur de la course, en mètres. Départ → torii sacré. */
const COURSE_LENGTH = 600

/**
 * ————— Le sprint final —————
 * Sur les SPRINT_ZONE derniers mètres, marteler l'écran fait accélérer.
 * Réglages calibrés par simulation, pour tenir deux promesses contradictoires :
 *
 *  · Départager deux joueurs au coude-à-coude : à fond, on gagne 0,37 s (≈ 10 m).
 *  · Ne PAS refaire la course : un trébuchement coûte 0,53 s (≈ 15 m). Le sprint
 *    parfait vaut moins que ça, donc il ne rattrape jamais une vraie faute.
 *
 * Ne pas marteler ne pénalise pas : on garde la vitesse normale, c'est un bonus.
 *
 * ⚠️ Aucun passif de guerrier ne touche à ces valeurs : dans les 120 derniers
 * mètres, tout le monde est à armes égales.
 */
const SPRINT_BOOST = 0.15 // +15 % de vitesse à jauge pleine
const SPRINT_FULL_RATE = 8 // taps/s pour remplir la jauge — au-delà, plus rien
const SPRINT_WINDOW = 0.6 // durée sur laquelle on mesure la cadence (s)

// ————— La scène 3D —————
const canvas = document.querySelector<HTMLCanvasElement>('#game')!
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x151a2c) // nuit indigo
scene.fog = new THREE.Fog(0x151a2c, 30, 85) // la brume cache l'apparition des obstacles

const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 200)
camera.position.set(0, 4.4, 7.5)
camera.lookAt(0, 1.2, -8)

// Lumières : clair de lune + lueur d'ambiance
const ambient = new THREE.HemisphereLight(0xbfd4ff, 0x30281e, 0.9)
const moon = new THREE.DirectionalLight(0xdfe8ff, 1.4)
moon.position.set(-6, 12, -4)
scene.add(ambient, moon)

const player = new Player(scene)
const opponent = new Opponent(scene)
const track = new Track(scene)

/**
 * La qualité graphique ne joue QUE sur le nombre de pixels dessinés — c'est de
 * loin le plus gros coût sur mobile, et diviser par 2 le pixelRatio, c'est 4
 * fois moins de pixels.
 *
 * On ne touche SURTOUT pas à la brume : c'est elle qui décide à quelle distance
 * on découvre les obstacles. La rapprocher pour gagner des images/s donnerait
 * moins de temps pour réagir — ce serait un réglage de difficulté déguisé en
 * réglage graphique, et un désavantage en duel.
 */
function applyQuality(q: Quality) {
  const mobile = matchMedia('(pointer: coarse)').matches
  const cap = q === 'bas' ? 1 : q === 'haut' ? 2 : mobile ? 1.5 : 2
  renderer.setPixelRatio(Math.min(devicePixelRatio, cap))
  resize() // setSize doit être rappelé après un changement de pixelRatio
}

// ————— L'interface —————
const scoreEl = document.getElementById('score')!
const toastEl = document.getElementById('toast')!
const countEl = document.getElementById('count')!
const flashEl = document.getElementById('flash')!
const progressEl = document.getElementById('progressfill')!
const oppmarkEl = document.getElementById('oppmark')!
const gapEl = document.getElementById('gap')!
const sprintEl = document.getElementById('sprint')!
const sprintFillEl = document.getElementById('sprintfill')!

let toastTimer = 0
function toast(text: string) {
  toastEl.textContent = text
  toastEl.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1400)
}

function flash() {
  flashEl.classList.add('show')
  setTimeout(() => flashEl.classList.remove('show'), 120)
}

// ————— L'état de la course —————
let state: 'menu' | 'attente' | 'depart' | 'course' | 'fini' = 'menu'
let online = false // course en ligne ou entraînement ?
let raceGo = false // le serveur a-t-il donné le GO ?
let time = 0 // le chrono
let distance = 0 // mètres parcourus
let speed = 0
let countdown = 0 // secondes avant le GO !
let stumble = 0 // invincibilité après un trébuchement
let netTimer = 0 // pour n'envoyer notre position que 10 fois/s
let oppFinishedSeen = false
let oppConnected = true // le rival est-il encore connecté ? (cf. reconnexion)
let oppName = '' // le pseudo du rival, appris par le réseau
let sprintTaps: number[] = [] // instants des derniers taps → cadence
let sprintCharge = 0 // la jauge de sprint, 0 → 1
let sprintSeen = false // la bannière ne s'annonce qu'une fois

/** Comment appeler le rival à l'écran quand il n'a pas mis de pseudo */
function rivalLabel() {
  return oppName || 'Rival'
}

/** Dans les derniers mètres, les taps accélèrent au lieu de lancer un sort. */
function inSprintZone() {
  return state === 'course' && distance >= COURSE_LENGTH - SPRINT_ZONE
}

/** Retour à l'écran-titre. `banner` : le mot de la fin de la course précédente. */
function backToMenu(banner?: string) {
  state = 'menu'
  online = false
  opponent.active = false
  oppmarkEl.classList.add('hidden')
  gapEl.classList.add('hidden')
  countEl.classList.remove('show')
  sprintEl.classList.add('hidden')
  menu.showTitle(banner)
}

/** Lance une course. En ligne, la graine vient du serveur : même piste pour les deux ! */
function startRace(seed: number) {
  player.reset()
  opponent.reset()
  track.reset(COURSE_LENGTH, seed)
  time = 0
  distance = 0
  speed = 0
  stumble = 0
  netTimer = 0
  raceGo = false
  oppFinishedSeen = false
  oppConnected = true
  sprintTaps = []
  sprintCharge = 0
  sprintSeen = false
  countdown = 3
  state = 'depart'
  menu.hide()
  countEl.classList.add('show')
  sprintEl.classList.add('hidden')
  progressEl.style.width = '0%'
  opponent.active = online
  oppmarkEl.classList.toggle('hidden', !online)
  gapEl.classList.toggle('hidden', !online)
}

function crossFinishLine() {
  player.mesh.visible = true // au cas où on franchit la ligne en plein clignotement
  sprintEl.classList.add('hidden')
  gapEl.classList.add('hidden')
  const t = time.toFixed(2)

  if (online) {
    // On prévient le serveur, et on attend le verdict s'il manque l'adversaire
    net.sendFinished(time)
    state = 'fini'
    menu.showStatus(`⛩️ Ligne franchie en <b>${t} s</b> !<br>${escapeHtml(rivalLabel())} court encore…`)
    return
  }

  // Solo : meilleur temps gardé en mémoire sur le téléphone
  state = 'fini'
  const best = Number(localStorage.getItem('kurogane-best') ?? Infinity)
  let bestLine: string
  if (time < best) {
    localStorage.setItem('kurogane-best', String(time))
    bestLine = '🏆 Nouveau record personnel !'
  } else {
    bestLine = `Record à battre : ${best.toFixed(2)} s`
  }
  backToMenu(`⛩️ Torii sacré franchi en <b>${t} s</b> !<br>${bestLine}`)
}

// ————— Le réseau —————
const net = new Net({
  onWaiting() {
    state = 'attente'
    menu.showStatus(
      '🔎 Recherche d\'un adversaire…<br>Ouvre le jeu sur un autre appareil pour le duel !',
      true // …avec un bouton pour annuler
    )
  },
  onCountdown(seed) {
    toast('⚔️ Adversaire trouvé !')
    startRace(seed)
  },
  onGo() {
    raceGo = true
  },
  onOpponent(op: RemotePlayer | null) {
    if (!op) return
    // Son identité : le corps n'est refait que si le guerrier change vraiment
    opponent.setFighter(op.fighter)
    oppName = op.name
    // On nourrit l'extrapolation, avec l'âge RÉEL du message quand la synchro
    // d'horloge est prête. Le marqueur et l'écart, eux, sont mis à jour à
    // chaque image dans la boucle de jeu, sur la position ESTIMÉE.
    opponent.onNetUpdate(
      { lane: op.lane, y: op.y, distance: op.distance, sliding: op.sliding },
      net.ageOf(op.at)
    )
    // Sa connexion : coupée (écran verrouillé ?) ou revenue
    if (op.connected !== oppConnected) {
      oppConnected = op.connected
      if (state === 'course' || state === 'depart') {
        toast(
          op.connected
            ? `📡 ${rivalLabel()} est de retour !`
            : `📡 ${rivalLabel()} a coupé… il a 30 s pour revenir`
        )
      }
    }
    if (op.finished && !oppFinishedSeen) {
      oppFinishedSeen = true
      if (state === 'course') toast('⚔️ Le rival a franchi le torii !')
    }
  },
  onAction(a) {
    // Une action du rival, reçue à l'instant même où il l'a faite
    opponent.applyAction(a)
  },
  onLink(up) {
    // NOTRE connexion qui vacille — le SDK retente tout seul derrière
    toast(up ? '📡 Reconnecté !' : '📡 Connexion instable… reconnexion en cours')
  },
  onResults(iWon, oppTime) {
    const mine = `Ton temps : <b>${time.toFixed(2)} s</b>`
    // ⚠️ escapeHtml : le pseudo vient de l'autre joueur, jamais de confiance
    const theirs = oppTime > 0 ? ` · ${escapeHtml(rivalLabel())} : <b>${oppTime.toFixed(2)} s</b>` : ''
    net.leave()
    backToMenu(
      iWon
        ? `🏆 <b>VICTOIRE !</b> La lame légendaire est à toi.<br>${mine}${theirs}`
        : `☁️ Vaincu… la voie du guerrier est longue.<br>${mine}${theirs}`
    )
  },
  onError(message) {
    net.leave()
    backToMenu(`⚠️ ${escapeHtml(message)}`)
  },
})

// ————— Les menus —————
const menu = new Menu({
  onSolo() {
    online = false
    startRace(Math.floor(Math.random() * 2 ** 31))
  },
  onOnline() {
    online = true
    oppName = ''
    net.join({ name: menu.settings.name, fighter: menu.settings.fighter })
  },
  onFighter(f) {
    // Le guerrier qui court derrière le menu change tout de suite : on voit son
    // choix avant même de lancer la course.
    player.setFighter(f)
  },
  onQuality(q) {
    applyQuality(q)
  },
  onCancel() {
    net.leave()
    backToMenu()
  },
})

applyQuality(menu.settings.quality)
menu.showTitle()

// ————— Les contrôles —————
// Chaque action est AUSSI envoyée au serveur en événement instantané : le
// rival la voit ~50 ms plus tôt que si elle était fondue dans le flux 20 Hz.
new Input(document.body, {
  left: () => {
    if (state !== 'course') return
    player.moveLeft()
    if (online) net.sendAction({ t: 'lane', lane: player.currentLane })
  },
  right: () => {
    if (state !== 'course') return
    player.moveRight()
    if (online) net.sendAction({ t: 'lane', lane: player.currentLane })
  },
  jump: () => {
    if (state !== 'course') return
    const v = player.jump()
    if (online && v > 0) net.sendAction({ t: 'jump', v })
  },
  slide: () => {
    if (state !== 'course') return
    const d = player.slide()
    if (online && d > 0) net.sendAction({ t: 'slide', d })
  },
  spell: () => state === 'course' && toast('📜 Pas de parchemin équipé… (bientôt !)'),
  // On horodate chaque coup : la boucle de jeu en déduit la cadence
  sprint: () => sprintTaps.push(time),
  isSprint: inSprintZone,
})

// ————— La boucle de jeu (60 fois par seconde) —————
const timer = new THREE.Timer()

function tick(now?: number) {
  requestAnimationFrame(tick)
  timer.update(now)
  const dt = Math.min(timer.getDelta(), 0.05) // temps écoulé depuis la dernière image

  if (state === 'depart') {
    // 3… 2… 1… GO ! (en ligne, c'est le serveur qui donne le vrai GO)
    countdown -= dt
    countEl.textContent = countdown > 0 ? `${Math.ceil(countdown)}` : 'GO !'
    const ready = online ? raceGo : countdown <= -0.6
    if (ready && countdown <= 0) {
      countEl.classList.remove('show')
      state = 'course'
      speed = 12
    } else if (online && countdown < -4) {
      // Le GO du serveur n'arrive pas : connexion perdue
      net.leave()
      backToMenu('⚠️ Connexion perdue au départ.')
    }
    player.update(dt)
    opponent.update(dt, distance)
  } else if (state === 'course') {
    time += dt

    // ————— Sprint final : plus on martèle vite, plus on accélère —————
    const sprinting = inSprintZone()
    sprintTaps = sprintTaps.filter((t) => time - t < SPRINT_WINDOW)

    // La cadence est PLAFONNÉE à SPRINT_FULL_RATE : au-delà, plus aucun gain.
    // C'est ce qui met le pouce d'un mobile et un autoclicker à égalité.
    const rate = sprintTaps.length / SPRINT_WINDOW
    const target = sprinting ? Math.min(1, rate / SPRINT_FULL_RATE) : 0
    sprintCharge += (target - sprintCharge) * Math.min(1, dt * 8)

    // La vitesse de croisière augmente au fil de la course…
    let cruise = 22 + 8 * (distance / COURSE_LENGTH)
    // …et le martèlement la pousse encore un peu dans les derniers mètres
    if (sprinting) cruise *= 1 + SPRINT_BOOST * sprintCharge
    speed += (cruise - speed) * Math.min(1, dt * 1.2)

    distance += speed * dt
    player.update(dt)
    opponent.update(dt, distance)
    track.update(dt, speed, distance)

    // Trébuchement : toucher un obstacle RALENTIT (on ne meurt pas, c'est une course)
    stumble = Math.max(0, stumble - dt)
    if (stumble <= 0 && track.hits(player.hitbox())) {
      // `player.grip` = la part de vitesse gardée. C'est LE passif d'Oni-Maru
      // (il garde 52 %) et le point faible de Hana (28 %).
      speed = Math.max(6, speed * player.grip)
      stumble = 1.2 // brève invincibilité le temps de se relever
      flash()
      toast('💥 Trébuché !')
      // Le rival doit le voir TOUT DE SUITE : sa version de nous ralentit
      // immédiatement (au lieu que son extrapolation nous fasse dépasser à tort)
      if (online) net.sendAction({ t: 'stumble', keep: player.grip })
    }
    // Le perso clignote tant qu'il se relève
    player.mesh.visible = stumble <= 0 || Math.floor(stumble * 12) % 2 === 0

    // Interface : chrono + progression
    scoreEl.textContent = `${time.toFixed(1)} s`
    progressEl.style.width = `${Math.min(100, (distance / COURSE_LENGTH) * 100)}%`

    // Interface du sprint : on annonce, puis la jauge suit le martèlement
    if (sprinting) {
      if (!sprintSeen) {
        sprintSeen = true
        sprintEl.classList.remove('hidden')
        toast('🔥 MARTÈLE L\'ÉCRAN !')
      }
      sprintFillEl.style.width = `${sprintCharge * 100}%`
    }

    // En ligne : on envoie notre position 20 fois par seconde
    if (online) {
      netTimer += dt
      if (netTimer >= 0.05) {
        netTimer = 0
        net.sendProgress({
          lane: player.currentLane,
          y: player.mesh.position.y,
          distance,
          sliding: player.isSliding,
        })
      }

      // L'extrapolation a besoin de la latence mesurée (la moitié du ping)
      opponent.latency = net.rtt / 2

      // Marqueur + écart, sur la position ESTIMÉE du rival — la seule honnête
      const oppD = opponent.distanceNow
      oppmarkEl.style.left = `${Math.min(100, (oppD / COURSE_LENGTH) * 100)}%`
      const lead = oppD - distance
      // textContent, pas innerHTML : le pseudo vient de l'autre joueur
      gapEl.textContent = `${rivalLabel()} ${lead >= 0 ? '+' : '−'}${Math.abs(lead).toFixed(0)} m`
      gapEl.classList.toggle('ahead', lead >= 0)
    }

    // ⛩️ Ligne d'arrivée !
    if (distance >= COURSE_LENGTH) crossFinishLine()
  } else {
    // Au menu / en attente / après l'arrivée : le décor défile doucement
    track.update(dt, state === 'fini' ? 3 : 5)
    player.update(dt)
    if (state === 'fini' && online) opponent.update(dt, distance)
  }

  // La caméra suit en douceur la ligne du joueur
  camera.position.x += (player.mesh.position.x * 0.55 - camera.position.x) * Math.min(1, dt * 5)

  renderer.render(scene, camera)
  menu.update(dt) // l'aperçu 3D du guerrier, quand le menu de sélection est ouvert
}

// ————— Adaptation à la taille de l'écran —————
function resize() {
  renderer.setSize(innerWidth, innerHeight)
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
}
addEventListener('resize', resize)
resize()

tick()
