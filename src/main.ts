import * as THREE from 'three'
import './style.css'
import { Player } from './player'
import { Track } from './track'
import { Input } from './input'

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
const track = new Track(scene)

// ————— L'interface —————
const overlay = document.getElementById('overlay')!
const msg = document.getElementById('msg')!
const btn = document.getElementById('btn')!
const scoreEl = document.getElementById('score')!
const toastEl = document.getElementById('toast')!
const countEl = document.getElementById('count')!
const flashEl = document.getElementById('flash')!
const progressEl = document.getElementById('progressfill')!

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
let state: 'menu' | 'depart' | 'course' | 'fini' = 'menu'
let time = 0 // le chrono
let distance = 0 // mètres parcourus
let speed = 0
let countdown = 0 // secondes avant le GO !
let stumble = 0 // invincibilité après un trébuchement

function start() {
  player.reset()
  track.reset(COURSE_LENGTH)
  time = 0
  distance = 0
  speed = 0
  stumble = 0
  countdown = 3
  state = 'depart'
  overlay.classList.add('hidden')
  countEl.classList.add('show')
  progressEl.style.width = '0%'
}

function finishRace() {
  state = 'fini'
  player.mesh.visible = true // au cas où on franchit la ligne en plein clignotement
  const t = time.toFixed(2)

  // Meilleur temps gardé en mémoire sur le téléphone
  const best = Number(localStorage.getItem('kurogane-best') ?? Infinity)
  let bestLine: string
  if (time < best) {
    localStorage.setItem('kurogane-best', String(time))
    bestLine = '🏆 Nouveau record personnel !'
  } else {
    bestLine = `Record à battre : ${best.toFixed(2)} s`
  }

  msg.innerHTML = `⛩️ Torii sacré franchi en <b>${t} s</b> !<br>${bestLine}`
  btn.textContent = 'REJOUER'
  overlay.classList.remove('hidden')
}

btn.addEventListener('click', start)

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
    // 3… 2… 1… GO !
    countdown -= dt
    countEl.textContent = countdown > 0 ? `${Math.ceil(countdown)}` : 'GO !'
    if (countdown <= -0.6) {
      countEl.classList.remove('show')
      state = 'course'
      speed = 12
    }
    player.update(dt)
  } else if (state === 'course') {
    time += dt

    // La vitesse de croisière augmente au fil de la course (sprint final !)
    const cruise = 22 + 8 * (distance / COURSE_LENGTH)
    speed += (cruise - speed) * Math.min(1, dt * 1.2)

    distance += speed * dt
    player.update(dt)
    track.update(dt, speed, COURSE_LENGTH - distance)

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

    // ⛩️ Ligne d'arrivée !
    if (distance >= COURSE_LENGTH) finishRace()
  } else {
    // Au menu / après l'arrivée, le décor défile doucement derrière le titre
    track.update(dt, state === 'menu' ? 5 : 3)
    player.update(dt)
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
