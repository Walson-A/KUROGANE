import * as THREE from 'three'
import './style.css'
import { Player } from './player'
import { Opponent } from './opponent'
import { Track } from './track'
import { Input } from './input'
import { Net, type RemotePlayer } from './net'

/** La longueur de la course, en mètres. Départ → torii sacré. */
const COURSE_LENGTH = 600

// ————— La scène 3D —————
const canvas = document.querySelector<HTMLCanvasElement>('#game')!
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))

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

// ————— L'interface —————
const overlay = document.getElementById('overlay')!
const msg = document.getElementById('msg')!
const btns = document.getElementById('btns')!
const btnSolo = document.getElementById('btnSolo')!
const btnOnline = document.getElementById('btnOnline')!
const scoreEl = document.getElementById('score')!
const toastEl = document.getElementById('toast')!
const countEl = document.getElementById('count')!
const flashEl = document.getElementById('flash')!
const progressEl = document.getElementById('progressfill')!
const oppmarkEl = document.getElementById('oppmark')!

const MENU_TEXT = `600 m jusqu'au torii sacré. Les obstacles te ralentissent !<br />
  Swipe ⬅️ ➡️ ⬆️ ⬇️ pour esquiver, double-tap : sort.<br />
  Clavier : flèches ou ZQSD.`

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

function showMenu(html: string) {
  state = 'menu'
  online = false
  opponent.active = false
  oppmarkEl.classList.add('hidden')
  countEl.classList.remove('show')
  msg.innerHTML = html
  btns.classList.remove('hidden')
  overlay.classList.remove('hidden')
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
  countdown = 3
  state = 'depart'
  overlay.classList.add('hidden')
  countEl.classList.add('show')
  progressEl.style.width = '0%'
  opponent.active = online
  oppmarkEl.classList.toggle('hidden', !online)
}

function crossFinishLine() {
  player.mesh.visible = true // au cas où on franchit la ligne en plein clignotement
  const t = time.toFixed(2)

  if (online) {
    // On prévient le serveur, et on attend le verdict s'il manque l'adversaire
    net.sendFinished(time)
    state = 'fini'
    msg.innerHTML = `⛩️ Ligne franchie en <b>${t} s</b> !<br>L'adversaire court encore…`
    btns.classList.add('hidden')
    overlay.classList.remove('hidden')
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
  showMenu(`⛩️ Torii sacré franchi en <b>${t} s</b> !<br>${bestLine}`)
}

// ————— Le réseau —————
const net = new Net({
  onWaiting() {
    state = 'attente'
    msg.innerHTML = '🔎 Recherche d\'un adversaire…<br>Ouvre le jeu sur un autre appareil pour le duel !'
    btns.classList.add('hidden')
    overlay.classList.remove('hidden')
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
    opponent.target = { lane: op.lane, y: op.y, distance: op.distance, sliding: op.sliding }
    oppmarkEl.style.left = `${Math.min(100, (op.distance / COURSE_LENGTH) * 100)}%`
    if (op.finished && !oppFinishedSeen) {
      oppFinishedSeen = true
      if (state === 'course') toast('⚔️ L\'adversaire a franchi le torii !')
    }
  },
  onResults(iWon, oppTime) {
    const mine = `Ton temps : <b>${time.toFixed(2)} s</b>`
    const theirs = oppTime > 0 ? ` · Adversaire : <b>${oppTime.toFixed(2)} s</b>` : ''
    net.leave()
    showMenu(
      iWon
        ? `🏆 <b>VICTOIRE !</b> La lame légendaire est à toi.<br>${mine}${theirs}`
        : `☁️ Vaincu… la voie du guerrier est longue.<br>${mine}${theirs}`
    )
  },
  onError(message) {
    net.leave()
    showMenu(`⚠️ ${message}<br>${MENU_TEXT}`)
  },
})

btnSolo.addEventListener('click', () => {
  online = false
  startRace(Math.floor(Math.random() * 2 ** 31))
})

btnOnline.addEventListener('click', () => {
  online = true
  net.join()
})

// ————— Les contrôles —————
new Input(document.body, {
  left: () => state === 'course' && player.moveLeft(),
  right: () => state === 'course' && player.moveRight(),
  jump: () => state === 'course' && player.jump(),
  slide: () => state === 'course' && player.slide(),
  spell: () => state === 'course' && toast('📜 Pas de parchemin équipé… (bientôt !)'),
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
      showMenu(`⚠️ Connexion perdue au départ.<br>${MENU_TEXT}`)
    }
    player.update(dt)
    opponent.update(dt, distance)
  } else if (state === 'course') {
    time += dt

    // La vitesse de croisière augmente au fil de la course (sprint final !)
    const cruise = 22 + 8 * (distance / COURSE_LENGTH)
    speed += (cruise - speed) * Math.min(1, dt * 1.2)

    distance += speed * dt
    player.update(dt)
    opponent.update(dt, distance)
    track.update(dt, speed, distance)

    // Trébuchement : toucher un obstacle RALENTIT (on ne meurt pas, c'est une course)
    stumble = Math.max(0, stumble - dt)
    if (stumble <= 0 && track.hits(player.hitbox())) {
      speed = Math.max(6, speed * 0.35) // grosse perte de vitesse
      stumble = 1.2 // brève invincibilité le temps de se relever
      flash()
      toast('💥 Trébuché !')
    }
    // Le perso clignote tant qu'il se relève
    player.mesh.visible = stumble <= 0 || Math.floor(stumble * 12) % 2 === 0

    // Interface : chrono + progression
    scoreEl.textContent = `${time.toFixed(1)} s`
    progressEl.style.width = `${Math.min(100, (distance / COURSE_LENGTH) * 100)}%`

    // En ligne : on envoie notre position 10 fois par seconde
    if (online) {
      netTimer += dt
      if (netTimer >= 0.1) {
        netTimer = 0
        net.sendProgress({
          lane: player.currentLane,
          y: player.mesh.position.y,
          distance,
          sliding: player.isSliding,
        })
      }
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
