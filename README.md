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
- **🥷 4 guerriers** au choix, chacun avec son mini-passif
  ([voir l'équilibrage](#-le-roster--un-choix-pas-un-piège))
- **Esquive** : barrières (saute !), barres hautes (glisse !), murs (change de ligne !)
- Toucher un obstacle ne tue pas : tu **trébuches** et perds ta vitesse — le
  perdant est celui qui arrive 2ᵉ
- **⚔️ Combat** : le même swipe sert à bouger ET à frapper — jarres et rivaux.
  Frappe en l'air pour rebondir et enchaîner ([voir le combat](#-le-combat--le-2ᵉ-acte))
- **🔥 Sprint final** : sur les 120 derniers mètres, martèle l'écran pour
  accélérer et voler la victoire sur le fil ([voir le calibrage](#-le-sprint-final--départager-sans-refaire-la-course))
- **🚀 Départ canon** : martèle pendant le 3-2-1 — à fond, tu pars directement
  à la vitesse de croisière (≈ 0,3 s de gagnées, toujours moins qu'un
  trébuchement). Le GO est **programmé à la même milliseconde** sur les deux
  téléphones, peu importe le ping
- **⚔️ Duel en ligne** : matchmaking automatique, **grille de départ** (chacun
  sa ligne), les deux joueurs affrontent exactement la même piste, le serveur
  déclare le vainqueur
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
├── index.html          La page, le HUD (chrono, progression) et les écrans de menu
├── src/
│   ├── main.ts         Le chef d'orchestre : scène 3D, boucle de jeu, états
│   ├── roster.ts       🥷 LA FICHE DES GUERRIERS : look, passifs, fabrique des corps
│   ├── menu.ts         Les écrans : titre, choix du guerrier, options, aide
│   ├── settings.ts     Les réglages gardés sur le téléphone (perso, pseudo, qualité)
│   ├── player.ts       Le coureur : 3 lignes, saut, gravité, glissade, hitbox
│   ├── opponent.ts     Le rival : position reçue du réseau, extrapolée, en fantôme
│   ├── track.ts        La piste : obstacles + rouleaux PLANIFIÉS par graine
│   ├── parchemin.ts    Le catalogue des sorts et tous leurs réglages
│   ├── bot.ts          Les rivaux d'entraînement : esquive scriptée, parchemins
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

Saisi dans les options, il **flotte au-dessus de la tête** du coureur, dans la
couleur de son bandeau ([`nametag.ts`](src/nametag.ts)). Les deux coureurs en
portent un : c'est surtout au-dessus du **rival** que ça compte — savoir qui on
double. Sans pseudo, on montre le nom du guerrier plutôt qu'une étiquette vide.
En duel il voyage aussi par le réseau et apparaît dans le HUD : « Noslow +12 m ».

L'étiquette est un **sprite** : un panneau qui fait toujours face à la caméra,
sur lequel on colle une image dessinée dans un canvas 2D. Pas de police 3D, pas
d'asset — zéro octet à télécharger. Trois détails qui font qu'elle vit :

- **Elle suit la tête**, pas le sol : quand le perso s'écrase pour glisser
  (`scale.y = 0.45`), elle descend avec lui ; quand il saute, elle monte.
- **Elle grossit avec la distance** (plafonnée à ×3,2). Sans ça, le rival à
  70 m aurait une étiquette de 3 pixels — illisible exactement au moment où on
  a le plus besoin de savoir qui c'est.
- **La brume ne l'efface pas** (`fog: false`) : le corps du rival s'estompe au
  loin, son nom reste net.

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

## ⚔️ Le combat : le 2ᵉ acte

La course tient en **trois actes**, chacun avec sa compétence — aucun ne
déborde sur l'autre :

| Acte | Ce qui compte |
|---|---|
| **1. Départ** | 🚀 Martèlement seul (départ canon) |
| **2. Le corps de course** | ⚔️ Combat, jarres, enchaînements |
| **3. Sprint final** | 🔥 Martèlement seul |

**Le swipe est contextuel** : s'il y a une cible dans cette direction il
frappe, sinon c'est le déplacement habituel. Un seul geste, deux sens — rien
de plus à apprendre sur un téléphone. De côté, on **se fend** : le coup part
et on va sur la ligne.

**Le rebond ne récompense que les coups donnés en vol** — un vrai saut,
automatique. Il faut donc décider de sauter *avant* d'aborder une grappe :
c'est ce choix pris à l'avance qui sépare celui qui casse une jarre au
passage de celui qui enchaîne. Un rebond, c'est 0,67 s en l'air ≈ 17 m,
alors que les jarres d'une grappe sont espacées de 12 à 15 m.

| Geste | Effet |
|---|---|
| Un coup | −6 % de vitesse |
| Gain | 1,5 m/s **× le rang dans la chaîne** (plafonné à 5) |
| Percuter une jarre | −28 % et la chaîne casse |
| Encaisser un coup du rival | −45 % |
| *Rappel : un trébuchement* | *−65 %* |

Une chaîne parfaite vaut toujours **moins** qu'éviter une faute : le combat
ajoute une compétence, il ne remplace pas la course. Et comme on survole les
obstacles tant qu'on vole, une chaîne bien menée traverse la grappe sans rien
percuter — c'est là sa vraie récompense.

**Les jarres** naissent de la graine partagée, donc identiques chez les deux
joueurs. Les **dorées** cachent un parchemin : on se bat pour l'objet, pas
seulement contre le chrono. Elles arrivent en grappes de 2 à 4, jamais en
tête (il faut avoir lancé la chaîne pour les cueillir), et jamais dans un
obstacle — c'est cette garantie qui rend le swipe contextuel sûr.

**Frapper le rival** est validé par le serveur, avec la lag compensation :
`positionAt()` rejuge le coup à l'instant où il a été porté, pas à l'arrivée
du message. L'horodatage est borné à 400 ms dans le passé (anti-triche), et
la victime a 1,5 s de répit — on ne matraque pas un joueur à terre. En
entraînement, les bots se frappent exactement pareil, mais en local.

Les réglages sont en tête de [`src/main.ts`](src/main.ts) : `COUP_COUT`,
`COUP_GAIN`, `CHAINE_FENETRE`, `JARRE_FREIN`, `PVP_PORTEE`, `PVP_FREIN`.
⚠️ `PVP_PORTEE` doit rester égal à celui de
[`RaceRoom.ts`](server/src/RaceRoom.ts).

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
- [x] 🥷 Le roster : Yasuke, Hana, Oni-Maru, Tamae — passifs, aperçu 3D, synchro en duel
- [x] 🎌 Le menu : écran-titre, choix du guerrier, options (pseudo, qualité), aide
- [x] 🥷 Le roster en entraînement : Hana, Oni-Maru, Tamae, et le boss Kurokumo
- [x] 📜 Les 10 parchemins de la fiche, et des rivaux qui les jouent aussi
- [ ] 🔊 **Le son** — il n'y en a aucun pour l'instant. À faire avant d'ajouter
      l'option « Son » au menu : un interrupteur qui ne coupe rien serait pire
      que pas d'interrupteur du tout.
- [ ] 🌍 Mise en ligne publique (Vercel + Railway)
- [ ] 🎨 Vrais modèles 3D low-poly, sons, décors variés
- [ ] 👹 Kurokumo jouable (il est déjà dans `roster.ts`, en `pickable: false`)

## 📜 L'univers

Japon, ère Sengoku. Le pays brûle. Nobunaga convoque les meilleurs guerriers
pour le **Tournoi des Voies** : une course à travers forêts de bambous,
villages en flammes et ponts au clair de lune. Sur la route, des
**parchemins de techniques** — pour se surpasser, ou saboter les rivaux.
Premier au torii sacré, une lame légendaire à la clé.
