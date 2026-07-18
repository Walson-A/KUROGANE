import * as THREE from 'three'
import {
  ROSTER,
  PERSO_ID,
  SKIN_PALETTE,
  animerCourse,
  buildFighter,
  clearFighter,
  cssColor,
  customFighter,
  fighterById,
  type Fighter,
  type Head,
} from './roster'
import { cleanName, loadSettings, saveSettings, type Quality, type Settings } from './settings'
import type { LobbyView, SalonInfo } from './net'

type ScreenName =
  | 'title'
  | 'roster'
  | 'options'
  | 'help'
  | 'status'
  | 'botpick'
  | 'salon'
  | 'lobby'
  | 'results'

export interface MenuCallbacks {
  onSolo(): void
  onOnline(): void
  /** Le joueur a changé de guerrier */
  onFighter(f: Fighter): void
  /** Le joueur a changé la qualité graphique */
  onQuality(q: Quality): void
  /** Le joueur a allumé ou coupé la musique */
  onMusique(on: boolean): void
  /** Le joueur annule la recherche d'adversaire */
  onCancel(): void
  // ————— Les salons en ligne —————
  onCreateSalon(): void
  onQuick(): void
  onJoinByCode(code: string): void
  onJoinRoom(roomId: string): void
  onListSalons(): Promise<SalonInfo[]>
  onReady(ready: boolean): void
  onStart(): void
  onChat(text: string): void
  onReplay(): void
  onLeaveSalon(): void
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
  /** La dernière vue du salon reçue — pour savoir qui je suis, si je suis prêt… */
  private view: LobbyView | null = null
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
    // ————— Le vestiaire perso —————
    forge: document.getElementById('forge')!,
    palBody: document.getElementById('palBody')!,
    palBand: document.getElementById('palBand')!,
    forgeHead: document.getElementById('forgeHead')!,
    optName: document.getElementById('optName') as HTMLInputElement,
    optQuality: document.getElementById('optQuality')!,
    optMusique: document.getElementById('optMusique')!,
    // ————— Salon —————
    joinCode: document.getElementById('joinCode') as HTMLInputElement,
    salonList: document.getElementById('salonList')!,
    // ————— Lobby —————
    lobbyCode: document.getElementById('lobbyCode')!,
    lobbyHint: document.getElementById('lobbyHint')!,
    lobbyList: document.getElementById('lobbyList')!,
    chatLog: document.getElementById('chatLog')!,
    chatInput: document.getElementById('chatInput') as HTMLInputElement,
    ready: document.getElementById('btnReady')!,
    start: document.getElementById('btnStart')!,
    // ————— Résultats —————
    resultsBody: document.getElementById('resultsBody')!,
    replay: document.getElementById('btnReplay')!,
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
      salon: document.getElementById('scr-salon')!,
      lobby: document.getElementById('scr-lobby')!,
      results: document.getElementById('scr-results')!,
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
    this.buildSalon()
    this.applyFighter(this.settings.fighter)
  }

  get fighter(): Fighter {
    return this.settings.fighter === PERSO_ID
      ? customFighter(this.settings.custom)
      : fighterById(this.settings.fighter)
  }

  // ————— Les salons en ligne —————

  private buildSalon() {
    const cb = this.cb
    document.getElementById('btnCreate')!.addEventListener('click', () => cb.onCreateSalon())
    document.getElementById('btnQuick')!.addEventListener('click', () => cb.onQuick())
    document.getElementById('btnRefresh')!.addEventListener('click', () => this.refreshSalons())

    const join = () => {
      const code = this.el.joinCode.value.toUpperCase().replace(/[^A-Z]/g, '')
      if (code) cb.onJoinByCode(code)
    }
    document.getElementById('btnJoinCode')!.addEventListener('click', join)
    this.el.joinCode.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') join()
    })
    // Toujours en majuscules pendant la frappe
    this.el.joinCode.addEventListener('input', () => {
      this.el.joinCode.value = this.el.joinCode.value.toUpperCase().replace(/[^A-Z]/g, '')
    })

    // — Lobby —
    document.getElementById('btnLeaveLobby')!.addEventListener('click', () => cb.onLeaveSalon())
    this.el.ready.addEventListener('click', () => {
      const me = this.view?.players.find((p) => p.id === this.view?.me)
      cb.onReady(!me?.ready)
    })
    this.el.start.addEventListener('click', () => cb.onStart())

    const send = () => {
      const text = this.el.chatInput.value.trim()
      if (!text) return
      cb.onChat(text)
      this.el.chatInput.value = ''
    }
    document.getElementById('btnChatSend')!.addEventListener('click', send)
    this.el.chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') send()
    })

    // — Résultats —
    this.el.replay.addEventListener('click', () => cb.onReplay())
    document.getElementById('btnQuitResults')!.addEventListener('click', () => cb.onLeaveSalon())
  }

  /** Ouvre l'accueil « jouer en ligne » et charge la liste des salons. */
  showSalon() {
    this.el.joinCode.value = ''
    this.el.chatLog.innerHTML = '' // nouveau salon = chat vierge
    this.show('salon')
    this.refreshSalons()
  }

  private async refreshSalons() {
    this.el.salonList.innerHTML = '<div class="salonempty">…</div>'
    const salons = await this.cb.onListSalons()
    if (!salons.length) {
      this.el.salonList.innerHTML = '<div class="salonempty">Aucun salon ouvert. Crée le tien !</div>'
      return
    }
    this.el.salonList.innerHTML = ''
    for (const s of salons) {
      const b = document.createElement('button')
      b.className = 'salonrow'
      const host = s.host ? escapeHtml(s.host) : 'un guerrier'
      b.innerHTML =
        `<span class="salonhost">${host}</span>` +
        `<span class="saloncount">${s.count}/${s.max}</span>`
      b.addEventListener('click', () => this.cb.onJoinRoom(s.roomId))
      this.el.salonList.appendChild(b)
    }
  }

  /** (Re)dessine le lobby à partir de la vue serveur. */
  showLobby(view: LobbyView) {
    this.view = view
    this.el.lobbyCode.textContent = view.code === 'PUBLIC' ? '' : view.code
    this.show('lobby')

    const me = view.players.find((p) => p.id === view.me)
    const total = view.players.length
    const prets = view.players.filter((p) => p.ready).length

    // La liste des joueurs : hôte, prêt, moi
    this.el.lobbyList.innerHTML = view.players
      .map((p) => {
        const tags: string[] = []
        if (p.id === view.hostId) tags.push('<span class="tag host">hôte</span>')
        if (p.ready) tags.push('<span class="tag ok">prêt</span>')
        if (!p.connected) tags.push('<span class="tag off">absent</span>')
        const moi = p.id === view.me ? ' moi' : ''
        const nom = escapeHtml(p.name || 'Guerrier') + (p.id === view.me ? ' (toi)' : '')
        return `<div class="lobbyrow${moi}"><span class="lnom">${nom}</span>${tags.join('')}</div>`
      })
      .join('')

    // Le bouton « prêt » reflète mon état
    this.el.ready.textContent = me?.ready ? '✓ PRÊT (annuler)' : 'JE SUIS PRÊT'
    this.el.ready.classList.toggle('on', !!me?.ready)

    // Le bouton « lancer » : à l'hôte seul, actif dès la moitié prête (≥ 2 joueurs)
    const peutLancer = total >= 2 && prets >= Math.ceil(total / 2)
    this.el.start.classList.toggle('hidden', !view.isHost)
    ;(this.el.start as HTMLButtonElement).disabled = !peutLancer

    // Le mot d'ambiance : le MODE (duel à 2, chacun pour soi à 3+) puis le statut
    if (total < 2) {
      this.el.lobbyHint.textContent =
        view.code === 'PUBLIC'
          ? 'En attente d\'autres guerriers…'
          : `Partage le code ${view.code} pour inviter tes amis.`
    } else {
      const mode = total === 2 ? '⚔️ Duel' : `⚔️ Chacun pour soi · ${total} guerriers`
      const statut = view.isHost
        ? peutLancer
          ? `${prets}/${total} prêts — tu peux lancer !`
          : `${prets}/${total} prêts — il en faut ${Math.ceil(total / 2)}.`
        : `${prets}/${total} prêts — l'hôte lance la partie.`
      this.el.lobbyHint.textContent = `${mode} — ${statut}`
    }
  }

  /** Ajoute une ligne au chat (et fait défiler en bas). */
  addChatLine(name: string, text: string, mine: boolean) {
    const line = document.createElement('div')
    line.className = 'chatline' + (mine ? ' mine' : '')
    line.innerHTML = `<b>${escapeHtml(name || 'Anonyme')}</b> ${escapeHtml(text)}`
    this.el.chatLog.appendChild(line)
    // On borne l'historique et on colle en bas
    while (this.el.chatLog.childElementCount > 60) this.el.chatLog.firstElementChild!.remove()
    this.el.chatLog.scrollTop = this.el.chatLog.scrollHeight
  }

  /** Le classement de fin de course. `canReplay` : l'hôte peut relancer. */
  showResults(html: string, canReplay: boolean) {
    this.el.resultsBody.innerHTML = html
    this.el.replay.classList.toggle('hidden', !canReplay)
    this.show('results')
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

    // La vignette « + » : le vestiaire perso, en bout de rangée façon Among Us
    const plus = document.createElement('button')
    plus.className = 'fighter plus'
    plus.dataset.id = PERSO_ID
    plus.style.setProperty('--c', cssColor(this.settings.custom.band))
    plus.innerHTML = '<span class="plusicon">＋</span><span class="nm">Perso</span>'
    plus.addEventListener('click', () => this.pick(PERSO_ID))
    this.el.fighters.appendChild(plus)

    this.buildForge()
  }

  private pick(id: string) {
    this.applyFighter(id)
    saveSettings(this.settings)
  }

  // ————— Le vestiaire perso —————

  /** Câble les deux palettes et le choix d'ornement. */
  private buildForge() {
    for (const [pal, key] of [
      [this.el.palBody, 'body'],
      [this.el.palBand, 'band'],
    ] as const) {
      for (const c of SKIN_PALETTE) {
        const sw = document.createElement('button')
        sw.className = 'swatch'
        sw.dataset.c = String(c)
        sw.style.background = cssColor(c)
        sw.setAttribute('aria-label', cssColor(c))
        sw.addEventListener('click', () => {
          this.settings.custom[key] = c
          this.editCustom()
        })
        pal.appendChild(sw)
      }
    }
    for (const b of this.el.forgeHead.querySelectorAll<HTMLElement>('button')) {
      b.addEventListener('click', () => {
        this.settings.custom.head = b.dataset.h as Head
        this.editCustom()
      })
    }
  }

  /** Une retouche du skin : on sauve et on réapplique (aperçu + jeu en direct). */
  private editCustom() {
    saveSettings(this.settings)
    this.applyFighter(PERSO_ID)
  }

  /** Reflète le skin courant dans les palettes et l'ornement sélectionnés. */
  private markForge() {
    const c = this.settings.custom
    for (const sw of this.el.palBody.querySelectorAll<HTMLElement>('.swatch')) {
      sw.classList.toggle('on', Number(sw.dataset.c) === c.body)
    }
    for (const sw of this.el.palBand.querySelectorAll<HTMLElement>('.swatch')) {
      sw.classList.toggle('on', Number(sw.dataset.c) === c.band)
    }
    for (const b of this.el.forgeHead.querySelectorAll<HTMLElement>('button')) {
      b.classList.toggle('on', b.dataset.h === c.head)
    }
    // La vignette « + » prend la couleur du bandeau perso, même non sélectionnée
    const plus = this.el.fighters.querySelector<HTMLElement>('.fighter.plus')
    if (plus) plus.style.setProperty('--c', cssColor(c.band))
  }

  /** Met à jour le perso partout : vignettes, fiche, aperçu 3D, bouton du titre, jeu. */
  private applyFighter(id: string) {
    const custom = id === PERSO_ID
    const f = custom ? customFighter(this.settings.custom) : fighterById(id)
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

    // L'éditeur n'apparaît que pour le guerrier perso
    this.el.forge.classList.toggle('hidden', !custom)
    this.markForge()

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

    // La musique
    for (const b of this.el.optMusique.querySelectorAll<HTMLElement>('button')) {
      b.addEventListener('click', () => {
        this.settings.musique = b.dataset.m === 'on'
        saveSettings(this.settings)
        this.markMusique()
        this.cb.onMusique(this.settings.musique)
      })
    }
    this.markMusique()
  }

  private markQuality() {
    for (const b of this.el.optQuality.querySelectorAll<HTMLElement>('button')) {
      b.classList.toggle('on', b.dataset.q === this.settings.quality)
    }
  }

  private markMusique() {
    for (const b of this.el.optMusique.querySelectorAll<HTMLElement>('button')) {
      b.classList.toggle('on', (b.dataset.m === 'on') === this.settings.musique)
    }
  }
}
