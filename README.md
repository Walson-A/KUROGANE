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
- 🏋️ Mode **entraînement solo** contre **1 à 4 rivaux** (voir
  [le roster](#-les-rivaux-dentraînement)), avec record personnel sauvegardé

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

On ramasse des rouleaux sur la piste (environ un toutes les **7 secondes**).
**Tous les rouleaux se ressemblent** : on ne sait ce qu'on a décroché qu'une
fois dans la main — comme les boîtes de Mario Kart.

Un rouleau est toujours posé dans une **ligne libre** : on ne cherche pas un
trou vide entre deux rangées (avec des obstacles tous les 10-17 m, il n'en
existe pas toujours), mais une ligne que personne n'occupe autour de ce point.
Ramasser un parchemin ne doit jamais coûter un trébuchement.

On en porte **deux au maximum**, et on est obligé de lancer **le plus ancien
d'abord** : une file d'attente, pas un choix. Impossible de garder le bon sort
au chaud jusqu'à l'arrivée ; les mains pleines, on ne ramasse plus rien.

### Sur soi

| Parchemin | Effet | Réglage |
|---|---|---|
| 🌀 **Vent du Nord** | dash | +35 % pendant 1,5 s → 0,53 s gagnées |
| 🕊️ **Saut de la Grue** | double saut | un saut en plein vol, pendant 7 s |
| 🛡️ **Armure de Fer** | jauge de solidité | 2 barrières **ou** 1 mur |
| 🪞 **Parade Miroir** | renvoie le sort | le prochain sort reçu repart, 8 s |
| 🍵 **Thé Purificateur** | lave les afflictions | chaîne, fumée et poison d'un coup |

### Sabotage

| Parchemin | Effet | Réglage |
|---|---|---|
| 🎯 **Kunai Explosif** | fait trébucher sec | 0,53 s, sans esquive possible |
| ⛓️ **Kusarigama** | ralentit | ×0,7 pendant 2 s → 0,60 s perdues |
| 💨 **Bombe Fumigène** | aveugle | écran noyé 2,5 s |
| ☠️ **Senbon Empoisonné** | fait tanguer | écran qui ondule 3 s |
| 🔮 **Onmyōji** | échange les places | projectile, portée médiane ≈ 53 m |

Le dash, le Kunai et le Kusarigama valent **volontairement la même chose**
(≈ 0,53 s, soit un trébuchement) : sans ça, un seul serait joué et les autres
feraient de la figuration.

La **fumée** et le **poison** ne ralentissent pas — ils empêchent de *voir*.
C'est leur intérêt face au Kusarigama, lui inévitable : un bon joueur peut s'en
sortir. L'**Armure** peut monter au double d'un trébuchement, mais ne paie que
si on se rate vraiment.

### 🔮 Onmyōji : pourquoi un échange complet ne casse pas le jeu

Sa **portée est infinie** : aucun plafond de distance. Il vole tant qu'il ne
rencontre rien. Les deux échangés s'enveloppent alors d'une **lueur jaune** —
sans elle, on se téléporterait sans comprendre ce qui vient d'arriver, ni avec
qui.

Échanger les places viole frontalement la règle « aucun parchemin ne refait la
course » — un joueur largué pourrait voler la 1re place. Ce qui le rachète :
**il ne vise pas**. Il file tout droit dans ta ligne et **meurt au premier mur**.

Un mur bouche une ligne donnée environ une rangée sur six, et les rangées
tombent tous les 13 m. Mesuré sur 1 860 tirs simulés :

| Portée (sans aucun plafond) | Part des tirs |
|---|---|
| médiane | **53 m** |
| franchit 100 m | 27,8 % |
| franchit 200 m | 8,2 % |
| franchit 400 m | **1,0 %** |
| franchit 800 m | **0 %** — aucun tir, jamais |

C'est **la piste qui borne le sort**, pas un plafond arbitraire — et il faut
encore aligner sa ligne sur celle du rival. L'échange se mérite.

### Les bots jouent aussi

Les rivaux d'entraînement ramassent et lancent des parchemins, avec les mêmes
règles : 2 slots, file d'attente. Un bot n'a pas d'écran, donc la fumée et le
poison se traduisent chez lui en **malus d'adresse** — il rate ses esquives.
Même prix payé, par un autre chemin. Sans ça, 🪞 Miroir et 🍵 Thé n'auraient
servi à rien en solo : deux ramassages blancs sur dix.

Les réglages sont tous dans [`src/parchemin.ts`](src/parchemin.ts).

**Le sort est coupé pendant le sprint final** : sur mobile, le pouce martèle
déjà l'écran. Sans cette règle, le clavier (touche `E`) pourrait encore lancer
là où le mobile ne peut plus. Il faut donc vider ses rouleaux **avant** les
120 derniers mètres — c'est une vraie décision.

Côté réseau, le serveur ne fait que **relayer** le Kusarigama : il ne simule
aucun effet, c'est la victime qui l'applique. Il vérifie juste que le sort
existe, pour qu'un client bricolé ne puisse pas inventer de sortilège.

## 🥷 Les rivaux d'entraînement

Le menu a 2 écrans : on choisit **ENTRAÎNEMENT SOLO**, *puis* le nombre de
rivaux — le sélecteur n'a aucun sens tant qu'on n'a pas dit qu'on s'entraînait.
L'ordre EST la difficulté : un rival de plus est toujours un rival **plus
fort**, jamais un de plus à doubler. Le choix est gardé sur le téléphone d'une
course à l'autre.

Pendant la course, un **classement en direct** en haut à gauche donne la
position de chacun et l'écart **en secondes** — la seule unité qui parle au
joueur, celle de son chrono et de son record.

Ils ne trichent pas : chacun court avec **la même formule de vitesse que le
joueur**, sur **la même piste**, et n'a aucun effet sur la sienne. Deux nombres
suffisent à les régler — `facteur` (leur rythme) et `adresse` (leurs chances
d'esquiver). Tout est dans [`src/bot.ts`](src/bot.ts).

| Rival | Temps moyen | Ce qu'il t'apprend |
|---|---|---|
| 🌸 **Hana** | 85,2 s | la première victoire |
| 👹 **Oni-Maru** | 80,1 s | tenir sa ligne du début à la fin |
| 🍃 **Tamae** | 76,0 s | le duel serré — elle gagne 20 % du temps |
| ☁️ **Kurokumo** | 71,1 s | le boss : imbattable sans les parchemins |

Les temps **encadrent volontairement les 75,07 s** d'une course propre du
joueur. C'est ce qui rend l'entraînement lisible : Kurokumo ne se bat pas au
sans-faute — il faut un sans-faute **et** bien jouer ses rouleaux.

Mesuré sur 200 courses, **rouleaux compris**. Les ramasser ne déplace un rival
que de ~0,1 s : il n'en trouve que dans sa ligne, et ses sorts de sabotage
partent surtout dans les pattes du joueur plutôt que de le faire avancer, lui.

### L'esquive scriptée

Un bot n'a **pas de boîte de collision**. Il lit le plan de la piste (généré
par la graine, comme le reste), décide à chaque rangée quoi faire — s'écarter,
sauter, glisser — et tire au sort s'il réussit selon son `adresse`. Un raté
déclenche exactement la pénalité du joueur : vitesse × 0,35.

C'est ce qui rend la difficulté **réglable au lieu d'émerger** : on choisit le
niveau d'un rival avec deux nombres, pas en bricolant une IA. Le retard causé
par les fautes est d'ailleurs mesuré et **linéaire** : ≈ 30 × (1 − `adresse`)
secondes. Sa graine est dérivée de celle de la course : même course rejouée =
mêmes esquives et mêmes fautes, on peut donc retravailler une course ratée.

## 🗺️ Roadmap

- [x] Course solo 1 920 m : obstacles, trébuchement, chrono, record
- [x] Duel en ligne : matchmaking, piste partagée, adversaire visible, victoire
- [x] 🔥 Sprint final au martèlement, calibré pour départager les ex æquo
- [x] 🥷 Le roster en entraînement : Hana, Oni-Maru, Tamae, et le boss Kurokumo
- [x] 📜 Les 10 parchemins de la fiche, et des rivaux qui les jouent aussi
- [ ] 🌍 Mise en ligne publique (Vercel + Railway)
- [ ] 🎨 Vrais modèles 3D low-poly, sons, décors variés

## 📜 L'univers

Japon, ère Sengoku. Le pays brûle. Nobunaga convoque les meilleurs guerriers
pour le **Tournoi des Voies** : une course à travers forêts de bambous,
villages en flammes et ponts au clair de lune. Sur la route, des
**parchemins de techniques** — pour se surpasser, ou saboter les rivaux.
Premier au torii sacré, une lame légendaire à la clé.
