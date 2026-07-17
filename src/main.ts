import * as THREE from 'three'
import './style.css'
import { Player } from './player'
import { Opponent } from './opponent'
import { Track, SPRINT_ZONE } from './track'
import { Input } from './input'
import { Net, type RemotePlayer } from './net'
import {
  PARCHEMINS,
  SLOTS_MAX,
  VENT_BOOST,
  VENT_DUREE,
  KUSARIGAMA_FACTEUR,
  KUSARIGAMA_DUREE,
  ARMURE_SOLIDITE,
  ARMURE_COUT_MUR,
  ARMURE_COUT_PETIT,
  type ParcheminKind,
} from './parchemin'

/**
 * La longueur de la course, en mètres. Départ → torii sacré.
 * Calibrée pour qu'une course propre — aucun parchemin, aucun trébuchement,
 * aucun martèlement — dure 75 s à la vitesse de croisière ci-dessous.
 */
const COURSE_LENGTH = 1920

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
 */
const SPRINT_BOOST = 0.15 // +15 % de vitesse à jauge pleine
const SPRINT_FULL_RATE = 8 // taps/s pour remplir la jauge — au-delà, plus rien
const SPRINT_WINDOW = 0.6 // durée sur laquelle on mesure la cadence (s)

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
const sprintEl = document.getElementById('sprint')!
const sprintFillEl = document.getElementById('sprintfill')!
const slotEls = [document.getElementById('slot0')!, document.getElementById('slot1')!]

const MENU_TEXT = `1 920 m jusqu'au torii sacré. Les obstacles te ralentissent !<br />
  Swipe ⬅️ ➡️ ⬆️ ⬇️ pour esquiver, double-tap : sort.<br />
  🔥 Sur les 120 derniers mètres : <b>martèle l'écran</b> pour accélérer !<br />
  Clavier : flèches ou ZQSD, espace pour le sprint.`

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
let sprintTaps: number[] = [] // instants des derniers taps → cadence
let sprintCharge = 0 // la jauge de sprint, 0 → 1
let sprintSeen = false // la bannière ne s'annonce qu'une fois

// ————— Les parchemins —————
// Une FILE d'attente : on lance toujours le plus ancien ramassé. Impossible de
// garder le bon sort au chaud — c'est ce qui rend le ramassage tendu.
let slots: ParcheminKind[] = []
let ventFin = 0 // 🌀 le dash court jusqu'à cet instant du chrono
let kusarigamaFin = 0 // ⛓️ on est bridé jusqu'à cet instant
let armure = 0 // 🛡️ solidité restante de l'armure (0 = pas d'armure)

/** Dans les derniers mètres, les taps accélèrent au lieu de lancer un sort. */
function inSprintZone() {
  return state === 'course' && distance >= COURSE_LENGTH - SPRINT_ZONE
}

/** Redessine les 2 slots. Le 1er est mis en avant : c'est le prochain lancé. */
function drawSlots(pop = -1) {
  slotEls.forEach((el, i) => {
    const k = slots[i]
    el.textContent = k ? PARCHEMINS[k].icone : '—'
    el.classList.toggle('actif', i === 0 && !!k)
    if (i === pop) {
      el.classList.remove('plein')
      void el.offsetWidth // relance l'animation même sur un ramassage consécutif
      el.classList.add('plein')
    }
  })
}

/** Applique un sort reçu (ou lancé sur soi). */
function subirSort(kind: string) {
  if (kind === 'kusarigama') {
    kusarigamaFin = time + KUSARIGAMA_DUREE
    flash()
    toast('⛓️ Kusarigama ! Tu es entravé…')
  }
}

/** Lance le parchemin le plus ancien. Rien à faire s'il n'y en a pas. */
function lancerParchemin() {
  // Dans le sprint, tous les taps servent à marteler : pas de sort ici, sinon
  // le clavier pourrait encore lancer (touche E) là où le mobile ne peut plus.
  if (inSprintZone()) {
    toast('🔥 Pas de parchemin dans le sprint !')
    return
  }
  const kind = slots.shift()
  if (!kind) {
    toast('📜 Aucun parchemin en main')
    return
  }
  const p = PARCHEMINS[kind]
  drawSlots()
  toast(p.cri)

  if (kind === 'vent') ventFin = time + VENT_DUREE
  else if (kind === 'armure') armure = ARMURE_SOLIDITE
  else if (p.cible === 'adversaire') {
    // Le serveur relaie à la victime, qui applique l'effet elle-même
    if (online) net.sendSpell(kind)
    else toast('⛓️ Kusarigama… mais tu cours seul !')
  }
}

function showMenu(html: string) {
  state = 'menu'
  online = false
  opponent.active = false
  oppmarkEl.classList.add('hidden')
  countEl.classList.remove('show')
  msg.innerHTML = html
  btns.classList.remove('hidden')
  overlay.classList.remove('hidden')
  sprintEl.classList.add('hidden')
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
  sprintTaps = []
  sprintCharge = 0
  sprintSeen = false
  slots = []
  ventFin = 0
  kusarigamaFin = 0
  armure = 0
  drawSlots()
  countdown = 3
  state = 'depart'
  overlay.classList.add('hidden')
  countEl.classList.add('show')
  sprintEl.classList.add('hidden')
  progressEl.style.width = '0%'
  opponent.active = online
  oppmarkEl.classList.toggle('hidden', !online)
}

function crossFinishLine() {
  player.mesh.visible = true // au cas où on franchit la ligne en plein clignotement
  sprintEl.classList.add('hidden')
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
  // La clé porte la longueur : un record établi sur une course plus courte
  // serait imbattable et resterait affiché à vie.
  const CLE_RECORD = `kurogane-best-${COURSE_LENGTH}`
  const best = Number(localStorage.getItem(CLE_RECORD) ?? Infinity)
  let bestLine: string
  if (time < best) {
    localStorage.setItem(CLE_RECORD, String(time))
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
  onSpell(kind) {
    if (state === 'course') subirSort(kind)
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
  spell: () => state === 'course' && lancerParchemin(),
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
      showMenu(`⚠️ Connexion perdue au départ.<br>${MENU_TEXT}`)
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
    // …le martèlement la pousse encore un peu dans les derniers mètres…
    if (sprinting) cruise *= 1 + SPRINT_BOOST * sprintCharge
    // …et les parchemins par-dessus. Un dash sous entrave reste bride : les
    // deux effets se multiplient au lieu de s'annuler.
    if (time < ventFin) cruise *= 1 + VENT_BOOST
    if (time < kusarigamaFin) cruise *= KUSARIGAMA_FACTEUR
    speed += (cruise - speed) * Math.min(1, dt * 1.2)

    distance += speed * dt
    player.update(dt)
    opponent.update(dt, distance)
    track.update(dt, speed, distance)

    // 📜 Ramassage d'un rouleau — on découvre son contenu maintenant
    const trouve = track.ramasse(player.hitbox())
    if (trouve) {
      if (slots.length < SLOTS_MAX) {
        slots.push(trouve)
        drawSlots(slots.length - 1)
        toast(`📜 ${PARCHEMINS[trouve].icone} ${PARCHEMINS[trouve].nom}`)
      } else {
        // Les deux mains sont pleines : il faut en lancer un pour reprendre
        toast('✋ Mains pleines — lance un parchemin !')
      }
    }

    // Trébuchement : toucher un obstacle RALENTIT (on ne meurt pas, c'est une course)
    stumble = Math.max(0, stumble - dt)
    const touche = track.hits(player.hitbox())
    if (stumble <= 0 && touche) {
      if (armure > 0) {
        // 🛡️ L'armure avale le choc : on garde toute sa vitesse. Mais un mur
        // la met en pièces d'un coup, là où une barrière ne fait que l'entamer.
        const cout = touche === 'mur' ? ARMURE_COUT_MUR : ARMURE_COUT_PETIT
        armure = Math.max(0, armure - cout)
        stumble = 1.2
        toast(
          armure > 0
            ? '🛡️ L\'armure encaisse — une plaque saute'
            : '🛡️ L\'armure vole en éclats !'
        )
      } else {
        speed = Math.max(6, speed * 0.35) // grosse perte de vitesse
        stumble = 1.2 // brève invincibilité le temps de se relever
        flash()
        toast('💥 Trébuché !')
      }
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
