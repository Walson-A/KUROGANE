# ⛩️ KUROGANE 黒鉄

> **« Acier noir » — le Tournoi des Voies.**
> Un runner de course multijoueur en 3D dans le Japon féodal de l'ère Sengoku.
> Incarne **Yasuke**, le samouraï africain d'Oda Nobunaga, et fonce vers le
> torii sacré avant ton rival.

Jeu créé en 2 jours, en duo (un chef de projet de 15 ans 🥷 + un co-pilote),
avec Claude Code comme développeur.

---

## 🎮 Le jeu

- **Une course de 1 920 m** (≈ 75 s) sur 3 lignes, départ 3-2-1-GO, arrivée au torii doré
- **Esquive** : barrières (saute !), barres hautes (glisse !), murs (change de ligne !)
- Toucher un obstacle ne tue pas : tu **trébuches** et perds ta vitesse — le
  perdant est celui qui arrive 2ᵉ
- **🔥 Sprint final** : sur les 120 derniers mètres, martèle l'écran pour
  accélérer et voler la victoire sur le fil ([voir le calibrage](#-le-sprint-final--départager-sans-refaire-la-course))
- **⚔️ Duel en ligne** : matchmaking automatique, les deux joueurs affrontent
  exactement la même piste, le serveur déclare le vainqueur
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
├── index.html          La page + le HUD (chrono, progression, menus)
├── src/
│   ├── main.ts         Le chef d'orchestre : scène 3D, boucle de jeu, états
│   ├── player.ts       Yasuke : 3 lignes, saut, gravité, glissade, hitbox
│   ├── opponent.ts     Kurokumo, le rival : position reçue du réseau, interpolée
│   ├── track.ts        La piste : obstacles + rouleaux PLANIFIÉS par graine
│   ├── parchemin.ts    Le catalogue des sorts et tous leurs réglages
│   ├── net.ts          La connexion au serveur : rejoindre, envoyer, recevoir
│   ├── input.ts        Clavier + swipes + double-tap + martèlement du sprint
│   └── style.css       L'habillage de l'interface
└── server/
    └── src/
        ├── index.ts    Démarrage du serveur (port 2567)
        └── RaceRoom.ts  Une salle = 2 joueurs, 1 piste, 1 vainqueur
```

## 🧠 L'idée clé du multi : la graine partagée

Le serveur tire un nombre au hasard (la **graine**) et l'envoie aux deux
joueurs. La piste entière est générée à partir de cette graine
([mulberry32](src/track.ts)) : **même graine = mêmes obstacles aux mêmes
endroits**. On n'envoie jamais les obstacles par le réseau — juste un nombre.

Le serveur est **autoritaire** : c'est lui qui apparie les joueurs, donne le
GO et déclare le vainqueur. Les clients ne font que lui raconter où ils en
sont (10 fois par seconde).

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
| Sprint parfait (8 taps/s) | **0,35 s** (≈ 10 m) |
| Sprint moyen (5 taps/s) | 0,23 s (≈ 7 m) |
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

## 📜 Les parchemins

On ramasse des rouleaux sur la piste (environ un toutes les **8 secondes**).
**Tous les rouleaux se ressemblent** : on ne sait ce qu'on a décroché qu'une
fois dans la main — comme les boîtes de Mario Kart.

On en porte **deux au maximum**, et on est obligé de lancer **le plus ancien
d'abord** : une file d'attente, pas un choix. Impossible de garder le bon sort
au chaud jusqu'à l'arrivée ; les mains pleines, on ne ramasse plus rien.

| Parchemin | Effet | Réglage | Vaut |
|---|---|---|---|
| 🌀 **Vent du Nord** | dash | +35 % pendant 1,5 s | 0,53 s gagnées |
| 🛡️ **Armure de Fer** | bouclier | absorbe un trébuchement | 0,53 s économisées |
| ⛓️ **Kusarigama** | ralentit le rival | ×0,7 pendant 2 s | 0,60 s perdues par la victime |

Les trois valent **volontairement la même chose** (≈ 0,53 s, soit un
trébuchement). Sans ça, un seul serait joué et les deux autres feraient de la
figuration : le choix doit être tactique, pas mathématique.

Les réglages sont tous dans [`src/parchemin.ts`](src/parchemin.ts).

**Le sort est coupé pendant le sprint final** : sur mobile, le pouce martèle
déjà l'écran. Sans cette règle, le clavier (touche `E`) pourrait encore lancer
là où le mobile ne peut plus. Il faut donc vider ses rouleaux **avant** les
120 derniers mètres — c'est une vraie décision.

Côté réseau, le serveur ne fait que **relayer** le Kusarigama : il ne simule
aucun effet, c'est la victime qui l'applique. Il vérifie juste que le sort
existe, pour qu'un client bricolé ne puisse pas inventer de sortilège.

## 🗺️ Roadmap

- [x] Course solo 1 920 m : obstacles, trébuchement, chrono, record
- [x] Duel en ligne : matchmaking, piste partagée, adversaire visible, victoire
- [x] 🔥 Sprint final au martèlement, calibré pour départager les ex æquo
- [x] 📜 Parchemins, 1er lot : Vent du Nord, Armure de Fer, Kusarigama
- [ ] 📜 Les 7 autres parchemins (Kunai explosif, Bombe fumigène, Onmyōji…)
- [ ] 🌍 Mise en ligne publique (Vercel + Railway)
- [ ] 🎨 Vrais modèles 3D low-poly, sons, décors variés
- [ ] 🥷 Le roster : Hana, Oni-Maru, Tamae, et le boss Kurokumo

## 📜 L'univers

Japon, ère Sengoku. Le pays brûle. Nobunaga convoque les meilleurs guerriers
pour le **Tournoi des Voies** : une course à travers forêts de bambous,
villages en flammes et ponts au clair de lune. Sur la route, des
**parchemins de techniques** — pour se surpasser, ou saboter les rivaux.
Premier au torii sacré, une lame légendaire à la clé.
