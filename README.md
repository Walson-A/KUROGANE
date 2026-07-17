# ⛩️ KUROGANE 黒鉄

> **« Acier noir » — le Tournoi des Voies.**
> Un runner de course multijoueur en 3D dans le Japon féodal de l'ère Sengoku.
> Incarne **Yasuke**, le samouraï africain d'Oda Nobunaga, et fonce vers le
> torii sacré avant ton rival.

Jeu créé en 2 jours, en duo (un chef de projet de 15 ans 🥷 + un co-pilote),
avec Claude Code comme développeur.

---

## 🎮 Le jeu

- **Une course de 600 m** sur 3 lignes, départ 3-2-1-GO, arrivée au torii doré
- **🥷 4 guerriers** au choix, chacun avec son mini-passif
  ([voir l'équilibrage](#-le-roster--un-choix-pas-un-piège))
- **Esquive** : barrières (saute !), barres hautes (glisse !), murs (change de ligne !)
- Toucher un obstacle ne tue pas : tu **trébuches** et perds ta vitesse — le
  perdant est celui qui arrive 2ᵉ
- **🔥 Sprint final** : sur les 120 derniers mètres, martèle l'écran pour
  accélérer et voler la victoire sur le fil ([voir le calibrage](#-le-sprint-final--départager-sans-refaire-la-course))
- **🚀 Départ canon** : martèle pendant le 3-2-1 — à fond, tu pars directement
  à la vitesse de croisière (≈ 0,3 s de gagnées, toujours moins qu'un
  trébuchement). Le GO est **programmé à la même milliseconde** sur les deux
  téléphones, peu importe le ping
- **⚔️ Duel en ligne** : matchmaking automatique, **grille de départ** (chacun
  sa ligne), les deux joueurs affrontent exactement la même piste, le serveur
  déclare le vainqueur
- 🏋️ Mode **entraînement solo** avec record personnel sauvegardé

### Contrôles

| Action | Mobile | Clavier |
|---|---|---|
| Changer de ligne | Swipe ⬅️ ➡️ | ← → ou Q D |
| Sauter | Swipe ⬆️ | ↑, Z ou Espace |
| Glisser | Swipe ⬇️ | ↓ ou S |
| Lancer le sort | Double-tap | E |
| 🔥 Sprint final | Martèle l'écran | Espace ou clic |

## 🚀 Lancer le jeu

Voir **[DEPLOY.md](DEPLOY.md)** pour toutes les commandes (dev local, jouer
sur téléphone, mise en ligne). Version courte :

```bash
# Terminal 1 : le serveur multi
cd server && npm install && npm run dev

# Terminal 2 : le jeu
npm install && npm run dev     # → http://localhost:5173
```

## 🛠️ La stack

| Brique | Techno | Pourquoi |
|---|---|---|
| 3D | [Three.js](https://threejs.org) | Léger, parfait pour le mobile web |
| Langage | TypeScript + [Vite](https://vite.dev) | Rechargement instantané |
| Multijoueur | [Colyseus 0.17](https://colyseus.io) | Salles, matchmaking, état synchronisé |
| Hébergement | Vercel (jeu) + Railway (serveur) | Gratuit et automatique à chaque push |

## 📁 La structure

```
kurogane/
├── index.html          La page, le HUD (chrono, progression) et les écrans de menu
├── src/
│   ├── main.ts         Le chef d'orchestre : scène 3D, boucle de jeu, états
│   ├── roster.ts       🥷 LA FICHE DES GUERRIERS : look, passifs, fabrique des corps
│   ├── menu.ts         Les écrans : titre, choix du guerrier, options, aide
│   ├── settings.ts     Les réglages gardés sur le téléphone (perso, pseudo, qualité)
│   ├── player.ts       Le coureur : 3 lignes, saut, gravité, glissade, hitbox
│   ├── opponent.ts     Le rival : position reçue du réseau, extrapolée, en fantôme
│   ├── track.ts        La piste : obstacles PLANIFIÉS par graine, torii, arrivée
│   ├── net.ts          La connexion au serveur : rejoindre, envoyer, recevoir
│   ├── input.ts        Clavier + swipes + double-tap + martèlement du sprint
│   └── style.css       L'habillage de l'interface
└── server/
    └── src/
        ├── index.ts    Démarrage du serveur (port 2567)
        └── RaceRoom.ts  Une salle = 2 joueurs, 1 piste, 1 vainqueur
```

`roster.ts` est la **source de vérité unique** : le menu, le joueur, le rival et
l'aperçu 3D lisent tous la même fiche. Pour ajouter un guerrier, il suffit
d'ajouter une entrée dans `ROSTER` — le reste du jeu suit tout seul.

## 🧠 L'idée clé du multi : la graine partagée

Le serveur tire un nombre au hasard (la **graine**) et l'envoie aux deux
joueurs. La piste entière est générée à partir de cette graine
([mulberry32](src/track.ts)) : **même graine = mêmes obstacles aux mêmes
endroits**. On n'envoie jamais les obstacles par le réseau — juste un nombre.

Le serveur est **autoritaire** : c'est lui qui apparie les joueurs, donne le
GO et déclare le vainqueur. Les clients ne font que lui raconter où ils en
sont (20 fois par seconde).

### Voir le rival là où il EST, pas là où il ÉTAIT

Ses positions arrivent ~20 fois/s, après un temps de trajet. Les afficher
telles quelles = le voir **toujours en retard** (5 à 8 m à pleine vitesse) :
on croirait le doubler à tort. Trois parades, dans [opponent.ts](src/opponent.ts)
et [net.ts](src/net.ts) :

1. **Extrapolation** (dead reckoning) : on déduit sa vitesse de ses deux
   derniers messages et on l'affiche là où il *doit* être maintenant —
   `dernière position + vitesse × (âge du message + latence)`. Bornée à
   0,5 s : en cas de gros lag, mieux vaut le voir freiner qu'inventer.
2. **Mesure du ping** : toutes les 2 s, on envoie l'heure au serveur qui la
   renvoie telle quelle ; l'écart = l'aller-retour (moyenne glissante).
3. **Fantôme** : le rival est semi-transparent — au départ et à chaque
   dépassement les deux coureurs se superposent, il faut voir à travers.
   L'écart affiché dans le HUD (« Rival +12 m ») utilise la position
   *estimée* — la seule honnête.

📖 Le détail complet (schémas, limites connues, comment brancher les sorts
en ligne) : **[docs/NETCODE.md](docs/NETCODE.md)**.

## 🥷 Le roster : un choix, pas un piège

Quatre guerriers, choisis depuis l'écran-titre. **Yasuke est la référence** :
tout est à 1 chez lui. Les trois autres ont **un bonus ET un malus** — sinon un
seul perso serait le bon choix, et le menu ne serait qu'un piège à débutants.
Yasuke, lui, n'a aucun point faible : c'est ça, son intérêt.

| Guerrier | Saut | Esquive | Glissade | Vitesse gardée si on trébuche |
|---|---|---|---|---|
| 弥助 **Yasuke** — la référence | 1 | 1 | 1 | 35 % |
| 花 **Hana** — agile, fragile | **1,18** | **1,3** | 1 | *0,28* |
| 鬼丸 **Oni-Maru** — lourd, tenace | *0,88* | *0,8* | 1 | **52 %** |
| 玉恵 **Tamae** — rusée, glissante | *0,9* | **1,15** | **1,6** | 35 % |

Tout est dans [`src/roster.ts`](src/roster.ts). Deux règles d'équité s'appliquent :

1. **La hitbox est la même pour tout le monde**, alors que les corps n'ont pas
   la même largeur à l'écran. Une hitbox plus fine pour Hana serait un 5ᵉ
   réglage *invisible* : personne ne l'aurait choisie en connaissance de cause,
   et ça fausserait tous les duels.
2. **Aucun passif ne touche au sprint final.** Son calibrage (ci-dessous)
   suppose que les 120 derniers mètres se courent à armes égales.

En duel, le rival porte les couleurs du guerrier qu'il a vraiment choisi
(son identité passe par le réseau). Il reste **semi-transparent** : c'est ce qui
permet de le distinguer même si vous avez choisi le même perso.

> Tamae devait « recharger ses techniques plus vite » d'après la fiche de jeu.
> Les parchemins n'existent pas encore : lui donner ce passif aujourd'hui, ce
> serait la rendre strictement moins bonne que les autres. Elle a donc un passif
> qui marche *maintenant* (la glissade), et héritera de l'autre le jour où les
> sorts arriveront.

## 🎌 Le menu & les réglages

Cinq écrans, un seul visible à la fois — un petit routeur dans
[`menu.ts`](src/menu.ts) : **titre**, **choix du guerrier** (avec l'aperçu 3D
qui tourne), **options**, **comment jouer**, et l'écran de **message**
(recherche d'adversaire, verdict de fin de course).

La recherche d'adversaire a un bouton **Annuler** : sans lui, une fois lancée,
on ne pouvait plus en sortir sans recharger la page.

Les réglages sont gardés sur le téléphone ([`settings.ts`](src/settings.ts)) et
relus au démarrage. Tout est **validé au passage** : une vieille sauvegarde ou
un `localStorage` bidouillé à la main ne doit pas pouvoir casser le jeu.

### Le pseudo

Saisi dans les options, il s'affiche en course en haut à gauche sous le chrono,
**dans la couleur du bandeau de ton guerrier** (`弥助 Yasuke`). Sans pseudo, on
montre le nom du guerrier plutôt qu'un vide. En duel il voyage par le réseau et
apparaît chez l'adversaire, dans le HUD : « Noslow +12 m ».

> ⚠️ **Le pseudo de l'autre joueur n'est jamais du HTML.** Le serveur le coupe à
> 12 caractères, et il est **échappé à l'affichage** (`escapeHtml`, dans
> [menu.ts](src/menu.ts)). Sans ça, quelqu'un pouvait s'appeler
> `<img src=x onerror=…>` et faire exécuter son code sur ton téléphone. Partout
> où c'est possible on passe par `textContent`, qui ne *peut pas* fabriquer une
> balise.

### La qualité graphique

| Réglage | Pixels dessinés |
|---|---|
| **Auto** | ×2 sur PC, ×1,5 sur mobile |
| **Belle** | ×2 |
| **Fluide** | ×1 — 4 fois moins de pixels qu'en « Belle » |

Elle ne joue **que** sur le nombre de pixels (`pixelRatio`) : c'est de loin le
plus gros coût sur mobile, et diviser la densité par 2, c'est 4 fois moins de
pixels à dessiner.

On ne touche **surtout pas à la brume**, alors que la rapprocher ferait gagner
des images/s : c'est elle qui décide à quelle distance on découvre les
obstacles. Moins de brume = moins de temps pour réagir. Ce serait un réglage de
**difficulté déguisé en réglage graphique** — et un désavantage en duel.

## 🔥 Le sprint final : départager sans refaire la course

Sur les **120 derniers mètres**, marteler l'écran fait accélérer. La zone est
volontairement **vidée d'obstacles** : sur mobile, on ne peut pas swiper pour
esquiver ET marteler en même temps.

Le réglage devait tenir deux promesses contradictoires — récompenser le skill,
sans que le spam ne remplace le pilotage. On l'a donc calibré par simulation
plutôt qu'au feeling, en prenant **le trébuchement comme étalon** :

| Repère | Coût / gain |
|---|---|
| Un trébuchement | **0,53 s** (≈ 15 m) |
| Sprint parfait (8 taps/s) | **0,37 s** (≈ 10 m) |
| Sprint moyen (5 taps/s) | 0,25 s (≈ 7 m) |
| Ne pas marteler | 0 s — c'est un bonus, jamais une punition |

Le sprint parfait vaut **moins qu'un trébuchement** : il départage deux joueurs
au coude-à-coude, mais ne rattrape jamais une vraie faute. La course reste
décidée par l'esquive.

**L'équité PC / mobile** est assurée par un plafond strict : la cadence est
mesurée sur une fenêtre glissante et **plafonnée à 8 taps/s**. Au-delà, plus
aucun gain — un autoclicker à 20 taps/s ne gagne rien de plus qu'un pouce.
Côté clavier, la répétition automatique est ignorée (`e.repeat`) : maintenir
la barre d'espace ne donne rien.

Les trois constantes sont en tête de [`src/main.ts`](src/main.ts) :
`SPRINT_BOOST`, `SPRINT_FULL_RATE`, `SPRINT_WINDOW` — et la longueur de la
zone est `SPRINT_ZONE` dans [`src/track.ts`](src/track.ts), partagée avec le
générateur d'obstacles pour que les deux ne puissent pas se désynchroniser.

## 🗺️ Roadmap

- [x] Course solo 600 m : obstacles, trébuchement, chrono, record
- [x] Duel en ligne : matchmaking, piste partagée, adversaire visible, victoire
- [x] 🔥 Sprint final au martèlement, calibré pour départager les ex æquo
- [x] 🥷 Le roster : Yasuke, Hana, Oni-Maru, Tamae — passifs, aperçu 3D, synchro en duel
- [x] 🎌 Le menu : écran-titre, choix du guerrier, options (pseudo, qualité), aide
- [ ] 🔊 **Le son** — il n'y en a aucun pour l'instant. À faire avant d'ajouter
      l'option « Son » au menu : un interrupteur qui ne coupe rien serait pire
      que pas d'interrupteur du tout.
- [ ] 📜 Les parchemins de techniques (dash, bouclier, kunai explosif…)
      → et le vrai passif de Tamae (recharge plus rapide)
- [ ] 🌍 Mise en ligne publique (Vercel + Railway)
- [ ] 🎨 Vrais modèles 3D low-poly, décors variés
- [ ] 👹 Kurokumo jouable (il est déjà dans `roster.ts`, en `pickable: false`)

## 📜 L'univers

Japon, ère Sengoku. Le pays brûle. Nobunaga convoque les meilleurs guerriers
pour le **Tournoi des Voies** : une course à travers forêts de bambous,
villages en flammes et ponts au clair de lune. Sur la route, des
**parchemins de techniques** — pour se surpasser, ou saboter les rivaux.
Premier au torii sacré, une lame légendaire à la clé.
