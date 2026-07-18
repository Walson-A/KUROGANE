import * as THREE from 'three'
import {
  ROSTER,
  animerCourse,
  buildFighter,
  clearFighter,
  cssColor,
  fighterById,
  type Fighter,
} from './roster'
import { cleanName, loadSettings, saveSettings, type Quality, type Settings } from './settings'

type ScreenName = 'title' | 'roster' | 'options' | 'help' | 'status' | 'botpick'

export interface MenuCallbacks {
  onSolo(): void
  onOnline(): void
  /** Le joueur a changé de guerrier */
  onFighter(f: Fighter): void
  /** Le joueur a changé la qualité graphique */
  onQuality(q: Quality): void
  /** Le joueur annule la recherche d'adversaire */
  onCancel(): void
}

/**
 * Échappe le HTML.
 * ⚠️ Indispensable : le pseudo de l'adversaire vient d'un AUTRE joueur, on ne
 * lui fait aucune confiance. Sans ça, quelqu'un pourrait s'appeler
 * `<img src=x onerror=…>` et faire exécuter son code sur ton téléphone.
 */
export function escapeHtml(s: string): string {
  const div = document.createElement('div')
  div.textContent = s
  return div.innerHTML
}

/** L'aperçu 3D du guerrier sélectionné : sa propre petite scène, son propre canvas. */
interface Preview {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  group: THREE.Group
}

/**
 * Tous les écrans de menu : titre, choix du guerrier, options, aide, et les
 * messages (attente d'un adversaire, résultat de la course).
 *
 * Le menu ne connaît RIEN de la course : il prévient main.ts par des callbacks
 * et se contente de garder les réglages à jour.
 */
export class Menu {
  readonly settings: Settings

  private cb: MenuCallbacks
  private screens: Record<ScreenName, HTMLElement>
  private current: ScreenName = 'title'
  private preview: Preview | null = null
  private spin = 0
  private apercu?: THREE.Object3D

  private el = {
    banner: document.getElementById('banner')!,
    msg: document.getElementById('msg')!,
    cancel: document.getElementById('btnCancel')!,
    pickJp: document.getElementById('pickJp')!,
    pickName: document.getElementById('pickName')!,
    fighters: document.getElementById('fighters')!,
    infoJp: document.getElementById('infoJp')!,
    infoName: document.getElementById('infoName')!,
    infoRole: document.getElementById('infoRole')!,
    infoBlurb: document.getElementById('infoBlurb')!,
    infoPassive: document.getElementById('infoPassive')!,
    optName: document.getElementById('optName') as HTMLInputElement,
    optQuality: document.getElementById('optQuality')!,
  }

  constructor(cb: MenuCallbacks) {
    this.cb = cb
    this.settings = loadSettings()

    this.screens = {
      title: document.getElementById('scr-title')!,
      roster: document.getElementById('scr-roster')!,
      options: document.getElementById('scr-options')!,
      help: document.getElementById('scr-help')!,
      status: document.getElementById('scr-status')!,
      botpick: document.getElementById('scr-botpick')!,
    }

    // — Écran-titre —
    document.getElementById('btnSolo')!.addEventListener('click', () => cb.onSolo())
    document.getElementById('btnOnline')!.addEventListener('click', () => cb.onOnline())
    document.getElementById('btnRoster')!.addEventListener('click', () => this.show('roster'))
    document.getElementById('btnOptions')!.addEventListener('click', () => this.show('options'))
    document.getElementById('btnHelp')!.addEventListener('click', () => this.show('help'))
    this.el.cancel.addEventListener('click', () => cb.onCancel())

    // Tous les boutons « retour » / « OK » ramènent au titre
    for (const b of document.querySelectorAll('[data-back]')) {
      b.addEventListener('click', () => this.show('title'))
    }

    this.buildRoster()
    this.buildOptions()
    this.applyFighter(this.settings.fighter)
  }

  get fighter(): Fighter {
    return fighterById(this.settings.fighter)
  }

  // ————— Les écrans —————

  private show(name: ScreenName) {
    this.current = name
    for (const [key, el] of Object.entries(this.screens)) {
      el.classList.toggle('hidden', key !== name)
    }
    document.getElementById('overlay')!.classList.remove('hidden')
    // L'aperçu 3D ne tourne que quand on le regarde : inutile de faire chauffer
    // le téléphone pour un canvas caché.
    if (name === 'roster') this.resizePreview()
  }

  /** L'écran-titre. `banner` : le mot de la fin de la course précédente. */
  showTitle(banner?: string) {
    this.el.banner.innerHTML = banner ?? ''
    this.el.banner.classList.toggle('hidden', !banner)
    this.show('title')
  }

  /** Un message plein écran : recherche d'adversaire, ligne franchie… */
  showStatus(html: string, cancellable = false) {
    this.el.msg.innerHTML = html
    this.el.cancel.classList.toggle('hidden', !cancellable)
    this.show('status')
  }

  showBotPick() {
    this.show('botpick')
  }

  hide() {
    document.getElementById('overlay')!.classList.add('hidden')
  }

  // ————— Le choix du guerrier —————

  private buildRoster() {
    for (const f of ROSTER) {
      if (!f.pickable) continue
      const b = document.createElement('button')
      b.className = 'fighter'
      b.dataset.id = f.id
      b.style.setProperty('--c', cssColor(f.band))
      // Le prénom seul : « Hana la Kunoichi » ne rentre pas dans une vignette
      b.innerHTML =
        `<span class="jp-mini">${f.jp}</span><span class="nm">${escapeHtml(f.name.split(' ')[0])}</span>`
      b.addEventListener('click', () => this.pick(f.id))
      this.el.fighters.appendChild(b)
    }
  }

  private pick(id: string) {
    this.applyFighter(id)
    saveSettings(this.settings)
  }

  /** Met à jour le perso partout : vignettes, fiche, aperçu 3D, bouton du titre, jeu. */
  private applyFighter(id: string) {
    const f = fighterById(id)
    this.settings.fighter = f.id

    for (const b of this.el.fighters.querySelectorAll<HTMLElement>('.fighter')) {
      b.classList.toggle('on', b.dataset.id === f.id)
    }

    this.el.infoJp.textContent = f.jp
    this.el.infoName.textContent = f.name
    this.el.infoRole.textContent = f.role
    this.el.infoBlurb.textContent = f.blurb
    this.el.infoPassive.textContent = f.passive
    this.el.pickJp.textContent = f.jp
    this.el.pickName.textContent = f.name

    this.showInPreview(f)
    this.cb.onFighter(f)
  }

  // ————— L'aperçu 3D —————

  private showInPreview(f: Fighter) {
    if (!this.preview) this.initPreview()
    if (!this.preview) return // pas de WebGL pour le petit canvas : tant pis, on garde les vignettes
    clearFighter(this.preview.group)
    const parts = buildFighter(f)
    this.apercu = parts[0] // on le fait courir sur place dans la vignette
    this.preview.group.add(...parts)
  }

  private initPreview() {
    const canvas = document.querySelector<HTMLCanvasElement>('#preview')
    if (!canvas) return

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
    } catch {
      return // certains vieux mobiles refusent un 2ᵉ contexte WebGL — le jeu passe avant
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2))

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 20)
    camera.position.set(0, 1.5, 4.2)
    camera.lookAt(0, 0.85, 0)

    // Même ambiance que la course : clair de lune froid + contre-jour chaud
    const ambient = new THREE.HemisphereLight(0xbfd4ff, 0x30281e, 1.1)
    const key = new THREE.DirectionalLight(0xdfe8ff, 1.7)
    key.position.set(-2.5, 4, 3)
    const rim = new THREE.DirectionalLight(0xe24b3a, 0.8)
    rim.position.set(3, 1.5, -3)
    scene.add(ambient, key, rim)

    const group = new THREE.Group()
    scene.add(group)

    this.preview = { renderer, scene, camera, group }
  }

  /** Le canvas est dimensionné par le CSS : on recale le rendu dessus. */
  private resizePreview() {
    const p = this.preview
    if (!p) return
    const w = p.renderer.domElement.clientWidth
    const h = p.renderer.domElement.clientHeight
    if (w === 0 || h === 0) return
    const size = p.renderer.getSize(new THREE.Vector2())
    if (size.x === w && size.y === h) return
    p.renderer.setSize(w, h, false)
    p.camera.aspect = w / h
    p.camera.updateProjectionMatrix()
  }

  /** Appelé à chaque image par la boucle de jeu : fait tourner l'aperçu. */
  update(dt: number) {
    if (this.current !== 'roster' || !this.preview) return
    this.resizePreview()
    this.spin += dt * 0.7
    this.preview.group.rotation.y = this.spin
    // Il court sur place pendant qu'on le regarde : une pose figée donnerait
    // l'impression d'un mannequin, pas d'un coureur.
    animerCourse(this.apercu, this.spin)
    this.preview.renderer.render(this.preview.scene, this.preview.camera)
  }

  // ————— Les options —————

  private buildOptions() {
    // Le pseudo
    this.el.optName.value = this.settings.name
    const commit = () => {
      this.settings.name = cleanName(this.el.optName.value)
      this.el.optName.value = this.settings.name
      saveSettings(this.settings)
    }
    this.el.optName.addEventListener('change', commit)
    this.el.optName.addEventListener('blur', commit)
    // Entrée = j'ai fini : on referme le clavier du téléphone
    this.el.optName.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.el.optName.blur()
    })

    // La qualité graphique
    for (const b of this.el.optQuality.querySelectorAll<HTMLElement>('button')) {
      b.addEventListener('click', () => {
        this.settings.quality = b.dataset.q as Quality
        saveSettings(this.settings)
        this.markQuality()
        this.cb.onQuality(this.settings.quality)
      })
    }
    this.markQuality()
  }

  private markQuality() {
    for (const b of this.el.optQuality.querySelectorAll<HTMLElement>('button')) {
      b.classList.toggle('on', b.dataset.q === this.settings.quality)
    }
  }
}
