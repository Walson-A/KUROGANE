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
- **🏃 Ligne droite & aspiration** : tenir sa voie fait monter la vitesse, et
  se glisser dans le sillage d'un rival tire vers l'avant
  ([voir le calibrage](#-les-deux-vitesses-du-2ᵉ-acte))
- **🧱 Les murs** : saute, colle-toi au bord, et longe la paroi à l'abri des
  obstacles — elle te renvoie en l'air ([voir les murs](#-les-murs-quon-longe))
- **🔥 Sprint final** : sur les 120 derniers mètres, martèle l'écran pour
  accélérer et voler la victoire sur le fil ([voir le calibrage](#-le-sprint-final--départager-sans-refaire-la-course))
- **🚀 Départ canon** : martèle pendant le 3-2-1 — à fond, tu pars directement
  à la vitesse de croisière (≈ 0,3 s de gagnées, toujours moins qu'un
  trébuchement). Le GO est **programmé à la même milliseconde** sur les deux
  téléphones, peu importe le ping
- **⚔️ Salons jusqu'à 10 joueurs** : crée un salon et partage son code, rejoins
  par code ou depuis la liste publique, ou lance une **partie rapide**. Départ
  façon Among Us : chacun se déclare **prêt**, l'hôte lance dès la moitié prête,
  décompte de 10 s commun ([voir les salons](#-les-salons--jouer-jusquà-10))
- 💬 **Chat de salon** en attendant le départ
- 🏋️ Mode **entraînement solo** contre **1 à 4 rivaux** (voir
  [le roster](#-les-rivaux-dentraînement)), avec record personnel sauvegardé
- 🌸 **Le cerisier du départ** : pendant le décompte, une **rafale** emporte ses
  pétales vers la droite, avec son **souffle de vent** — un son *synthétisé* à la
  volée ([`src/sfx.ts`](src/sfx.ts)), donc zéro fichier à télécharger
- 💨 **Rideau de vitesse façon animé** : des éclats **triangulaires** effilés
  giclent vers les bords quand on martèle ou qu'on dash
- 👣 **Poussière d'atterrissage** : un petit nuage s'étale au sol quand un
  coureur retombe d'un saut — **tout le monde**, bots et rivaux en ligne compris

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
│   ├── anims.ts        🎞️ Le lecteur des mouvements importés (Mixamo reciblé)
│   ├── anims-cuites.json  Les mouvements, cuits — NE PAS ÉDITER À LA MAIN
│   └── style.css       L'habillage de l'interface
├── animation/          Les .fbx Mixamo déposés (la SOURCE des mouvements)
├── tools/
│   ├── cuire-anims.mjs    La cuisson : .fbx → anims-cuites.json
│   └── verifier-anims.ts  Le contrôle anatomique des mouvements reciblés
└── server/
    └── src/
        ├── index.ts    Démarrage du serveur (port 2567)
        └── RaceRoom.ts  Une salle = 2 joueurs, 1 piste, 1 vainqueur
```

`roster.ts` est la **source de vérité unique** : le menu, le joueur, le rival et
l'aperçu 3D lisent tous la même fiche. Pour ajouter un guerrier, il suffit
d'ajouter une entrée dans `ROSTER` — le reste du jeu suit tout seul.

## 🎞️ Les animations : du Mixamo sur des boîtes

Les mouvements viennent de `.fbx` Mixamo déposés dans `animation/`. Ils sont
exportés **sans peau** : 65 os, aucun maillage. Impossible de les afficher tels
quels — nos guerriers sont des empilements de boîtes montés par `buildFighter`.

D'où le **reciblage**. On ne recopie pas les rotations Mixamo (leurs os n'ont ni
la même pose de repos ni les mêmes proportions que nos boîtes) : on lit la
**direction** de chaque membre dans le monde, et on cherche la rotation qui
pointe notre boîte dans ce sens-là. Ça marche quelles que soient les
proportions, et ça tient dans dix articulations.

### Pourquoi cuire hors ligne

Les 21 fichiers pèsent **8,7 Mo**, plus 200 Ko de `FBXLoader` dans le bundle.
Une fois cuits : **26 Ko compressés** — 350 fois moins. Le jeu garde sa promesse,
rien de lourd à télécharger sur mobile.

```bash
npm run anims        # recuit animation/*.fbx → src/anims-cuites.json
npm run anims:test   # contrôle anatomique (à lancer après toute recuisson)
```

### La règle des dossiers

`animation/hana/` n'anime que Hana ; à la **racine**, ça sert à tout le monde.
Le perso « + » cherche d'abord son ornement (`perso/aucun`, `perso/kitsu`,
`perso/oni2`), puis le fonds commun `perso/`, puis la racine.

Personne ne peut se retrouver figé : quand un mouvement manque — le perso « + »
n'a pas de saut — le guerrier **retombe sur l'ancienne foulée calculée**.

> Les **bots d'entraînement** (`bot.ts`) gardent leur maillage simple : ils n'ont
> pas de corps articulé, donc rien à animer. Seuls le joueur et les rivaux en
> ligne jouent ces mouvements.

### 🔥 La foulée qui s'emballe

Sous le **Souffle de Vent** et dans le **sprint final**, le coureur passe en
`courseRapide`.

Attention au piège : `Fast Run` est déjà la foulée de **tout le monde, en
permanence**. Lui « mettre Fast Run » sur ces deux moments n'aurait donc rien
changé à l'écran. Ce qui se voit, c'est la **cadence** : le même cycle joué à
**1,35×**. Ce chiffre n'est pas au jugé — c'est exactement le gain du Souffle de
Vent (`VENT_BOOST = 0,35`), donc les pieds ne patinent pas et ne courent pas
devant le coureur.

Le jour où un vrai clip de sprint atterrit dans un dossier, il est pris
automatiquement : `courseRapide` cherche d'abord un fichier à elle, et ne
retombe sur la course normale accélérée qu'à défaut.

La **gêne l'emporte sur la hâte** : empoisonné, on titube même porté par le vent
— sinon un sort offensif se verrait annulé à l'écran. Et les rivaux entrent dans
le sprint à **leur** distance, pas à la nôtre : dans un peloton de dix, chacun
son tour.

### Les gestes qui se superposent

🔥 **Le lancer** part sur le **portail, le senbon, la fumigène et le kunai** —
les quatre sorts qui quittent la main. Les sorts qu'on se jette à soi-même
(armure, thé, grue) n'ont rien à lancer.

Un coureur qui jette un sort **ne cesse pas de courir**. Le lancer, la frappe et
l'encaissement ne sont donc pas des mouvements à part entière : ce sont des
**gestes du haut du corps**, posés par-dessus la foulée. Les jambes continuent,
seuls le buste, la tête et les bras jouent le geste — sinon le lanceur patinerait
sur place au milieu de la piste.

Pendant un geste, le **verrou du bras armé se relâche** : le garder tiendrait la
garde et écraserait le lancer qu'on vient de déclencher.

L'encaissement se déclenche sur le **front montant** de `stumble`, guetté à un
seul endroit de la boucle — plutôt qu'aux cinq sources qui font trébucher (mur,
kunai, coup d'un rival, armure entamée…), dont une aurait fini par être oubliée.

### Ce que le nom du fichier ne dit pas

Un nom de fichier ment ; la courbe des os, non. La cuisson **mesure** chaque
clip et départage sur les faits :

- **une course doit boucler.** On compare la pose d'arrivée à celle de départ,
  rapportée à l'écart entre deux images. `Running.fbx` saute de 2,6 images à la
  reprise — et pour cause, ce n'est pas une course : les hanches y tombent de 98
  à 12 et dérivent de 436 sur le côté. C'est une roulade. Elle est **refusée**.
- **entre deux clips qui bouclent, le plus rapide gagne.** Hana avait hérité de
  `Run.fbx`, un jogging : elle levait les jambes deux fois moins haut que les
  autres et se serait lue comme une coureuse à la traîne, alors qu'elle avance à
  la même allure.
- **un saut doit avancer.** `Joyful Jump` est un saut de joie sur place ; c'est
  `Jump (2)` qui franchit l'obstacle.
- **le côté d'un virage se mesure.** Hana a deux fichiers nommés `Running Arc`
  et `Running Arc (1)` — les noms ne disent rien. C'est la **dérive latérale des
  hanches** qui tranche. Là où Mixamo nomme le côté (`Arc Left` / `Arc Right`),
  la mesure tombe d'accord avec le nom : de quoi lui faire confiance ailleurs.
- **une attaque doit frapper devant.** Dans les 7,57 s de `Hell Slammer`, la
  main droite ne passe devant la hanche qu'**une seule fois** : de 31 unités
  derrière à 40 devant, entre 0,80 s et 1,08 s. On ne garde que ça — joué en
  **0,26 s, soit exactement `ATTACK_TIME`**. Ce n'est pas décoratif : le jeu
  autorise une frappe toutes les 0,26 s, et en enchaînant les jarres le geste
  était relancé avant d'avoir fini. Il ne montrait jamais que son élan et
  bégayait.
- **un clip trop long est taillé autour de son geste.** `Fireball` dure 3,37 s :
  la main recule jusqu'à 1,5 s, se projette à 1,90 s, puis récupère. On garde
  1,35 → 2,45 s, joué une fois et demie plus vite. `Hell Slammer` dure 7,57 s
  pour une frappe qui en dure 0,26 dans le jeu : on ne garde que le coup.

### Le contrôle anatomique

Le reciblage est de la déduction : une erreur de repère et le guerrier court les
**genoux à l'envers**, sans qu'aucun typage ne bronche. `npm run anims:test`
joue les clips pour de vrai et mesure le squelette obtenu — les genoux se
replient-ils derrière, les coudes devant, les pieds touchent-ils le sol, les
bras balancent-ils à l'opposé des jambes, le bassin reste-t-il à hauteur d'homme.

C'est ce contrôle qui a établi le repère : le coureur avance vers **−Z** (le
décor défile vers +Z et sort derrière la caméra) et son buste se penche dans le
sens de la marche. Donc −Z devant, +Z derrière.

### 🔄 Le demi-tour

Tout le corps est modelé **face à +Z** : masque et menpo en z positif, queues,
écharpe, cape et pan de capuche en z négatif — leurs commentaires disent bien
« en arrière ».

Mais le jeu fait avancer le coureur vers **−Z**. Sans correction, le guerrier
courait **à reculons** : les queues de kitsune lui battaient devant le nez et
son visage était dans son dos.

`buildFighter` tourne donc la **racine** d'un demi-tour, plutôt que de déplacer
trente pièces une à une — une seule ligne, et rien ne peut être oublié. Mixamo
modelant lui aussi face à +Z, les deux repères coïncident et **la cuisson ne
retourne plus rien**. ⚠️ Les deux vont ensemble : toucher à l'un sans l'autre
fait courir tout le monde à l'envers.

Le contrôle en garde la trace, et il **déduit le sens du rig** au lieu de le
figer : quand la convention a changé, tous les contrôles d'angle ont basculé
d'un coup sans qu'aucun ne soit réellement faux. Ils s'adaptent désormais.

### 🕳️ Le garde-fou du sol

Les mouvements sont joués par un corps aux proportions qui ne sont pas les
nôtres : là où le personnage Mixamo rase le sol, nos boîtes le traversent. La
**glissade** était la pire — mains et bassin passaient jusqu'à **16 cm sous la
piste**, et le coureur semblait à moitié enterré.

Plutôt que de retoucher chaque clip, on relève le bassin de ce qui dépasse.
C'est un filet : il ne fait rien quand tout va bien, et aucun mouvement futur
ne pourra enfoncer un guerrier dans le décor.

On ne sonde que les **membres solides**. Les queues, capes et écharpes traînent
volontiers plus bas : les inclure relèverait le corps entier pour sauver un
bout de tissu, et la glissade se jouerait debout.

## 🎌 Les salons — jouer jusqu'à 10

Un **salon** = une salle Colyseus (jusqu'à 10 guerriers). Trois façons d'entrer,
toutes dans [src/net.ts](src/net.ts) et [server/src/RaceRoom.ts](server/src/RaceRoom.ts) :

| Entrée | Comment |
|---|---|
| 🏮 **Créer** | On génère un **code à 4 lettres** (sans voyelles, pas de gros mots) et on le partage. Salon privé, invisible dans la liste. |
| 🚪 **Rejoindre par code** | On tape le code d'un ami. |
| 📋 **Liste publique** | Les salons publics ouverts, listés en temps réel. |
| ⚡ **Partie rapide** | Remplit un salon public partagé (`joinOrCreate` sur le code `PUBLIC`) — l'auto-remplissage jusqu'à 10. |

Le routage repose sur `filterBy(['code'])` : `joinOrCreate('race', { code })`
tombe sur le salon qui porte ce code, ou en crée un. La **liste publique**
passe par la salle `LobbyRoom` de Colyseus, tenue à jour en temps réel
(`enableRealtimeListing` + `updateLobby`).

### Le départ, façon Among Us

Chacun se déclare **prêt**. L'hôte (le premier arrivé, réattribué s'il part)
peut **lancer dès que la moitié est prête** — pas besoin d'attendre les
traînards. Le lancement déclenche un **décompte de 10 s commun** (l'heure du GO
est programmée à la milliseconde, comme en 1v1), puis la course. À l'arrivée,
un **classement** de 1 à 10, et l'hôte peut **rejouer** sans quitter le salon.

Un **chat** occupe l'attente. Tout ce qui vient d'un autre joueur (pseudo, message)
est **échappé** avant affichage — on ne fait jamais confiance au client.

## 🧠 L'idée clé du multi : la graine partagée

Le serveur tire un nombre au hasard (la **graine**) et l'envoie à tous les
joueurs. La piste entière est générée à partir de cette graine
([mulberry32](src/track.ts)) : **même graine = mêmes obstacles aux mêmes
endroits**. On n'envoie jamais les obstacles par le réseau — juste un nombre.

Le serveur est **autoritaire** : c'est lui qui héberge le salon, donne le GO,
relaie les sorts et tient le classement. Les clients ne font que lui raconter
où ils en sont (20 fois par seconde). Les avatars des 9 autres sont un **pool
recyclé** côté jeu : on n'en crée jamais en pleine course.

Un **sort offensif** vise le rival le plus proche **devant** (calculé côté jeu) ;
le serveur ne l'applique qu'à cette cible. Le 🔮 portail, lui, file tout droit
et échange les places du premier croisé dans sa ligne.

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

Cinq guerriers, choisis depuis l'écran-titre — **Kurokumo, le champion
invaincu, est jouable comme les autres** (il garde juste sa dégaine). **Yasuke
est la référence** : tout est à 1 chez lui. Les autres ont **un bonus ET un
malus** — sinon un seul perso serait le bon choix, et le menu ne serait qu'un
piège à débutants. Yasuke, lui, n'a aucun point faible : c'est ça, son intérêt.

| Guerrier | Saut | Esquive | Glissade | Vitesse gardée si on trébuche |
|---|---|---|---|---|
| 弥助 **Yasuke** — la référence | 1 | 1 | 1 | 35 % |
| 花 **Hana** — agile, fragile | **1,18** | **1,3** | 1 | *0,28* |
| 鬼丸 **Oni-Maru** — lourd, tenace | *0,88* | *0,8* | 1 | **52 %** |
| 玉恵 **Tamae** — rusée, glissante | *0,9* | **1,15** | **1,6** | 35 % |
| 黒雲 **Kurokumo** — le champion | 1 | 1 | 1 | 35 % |

### 改 Le perso « + » : l'ornement décide du style

Le 5ᵉ slot est un guerrier qu'on **forge soi-même** (deux couleurs + un
ornement de tête, façon Among Us). L'**ornement n'est pas qu'un look, il
choisit le style de jeu** —

| Ornement | Style emprunté |
|---|---|
| 👁️ aucun | les réflexes de **Sasuke** (esquive éclair, fragile) |
| 🐂 cornes | la peau d'oni d'**Oni-Maru** (encaisse, mais lourd) |
| 🦊 oreilles | la ruse de **Tamae** (glissade longue, saut court) |

« Choisis ton ornement, choisis ton jeu. » Les couleurs, elles, restent
purement cosmétiques. Sasuke n'est **pas un guerrier jouable** — ses réglages ne
servent que de style par défaut au « + ».

Signature visuelle du style Sasuke : **deux éclairs cartoon** (zigzag façon ⚡,
remplissage cyan + gros contour bleu nuit) à chaque **changement de ligne**, et
un plus petit au **saut**.

Ils ne sont jamais « déjà posés » : un **plan de coupe** balaie la trajectoire en
**70 ms** et le zigzag *naît derrière lui* — c'est ça qui donne la vitesse de la
lumière. Puis ils se **dissipent** en 200 ms : le trait gonfle pendant que le
contour s'efface plus vite que le remplissage, si bien qu'il « perd ses bords »
et paraît flou. Réglé dans [`src/main.ts`](src/main.ts) : `SPARK_TRACE`,
`SPARK_DISSIP`, `makeBolt`, `flashSpark`.

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

### Le corps articulé

Les guerriers ne sont plus deux boîtes empilées : `buildFighter()` construit
un corps en Group imbriqués (bassin → torse → tête, deux bras, deux jambes),
chacun pivotable. `animerCourse()` fait tourner tout ça en sinusoïdes — bras
et jambes en opposition, rebond à chaque appui, buste penché — sans importer
la moindre animation.

Le **look** de chaque guerrier (silhouette, arme, ce qui traîne derrière) est
décrit à part dans `LOOKS` (toujours `roster.ts`) : la fiche décrit le JEU
(passifs, réglages), `LOOKS` décrit l'APPARENCE. On retouche l'un sans
risquer de casser l'autre.

Règle de lisibilité : on voit les coureurs **de dos**, à 20 m, de nuit — donc
chacun doit se reconnaître à sa silhouette seule (la bannière de Yasuke, les
cornes d'Oni-Maru, les queues de Tamae, la cape de Kurokumo), pas qu'à sa
couleur, qui se noie dans la brume.

Un guerrier qui tient une arme (katana, kanabō, tessen…) verrouille son bras
droit contre le buste en courant — laissé libre, il balançait de 40° et
promenait la lame dans les jambes.

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

### Frapper, c'est TOUCHER

Un coup ne part pas « vers l'avant » : le swipe sort la lame pendant 0,26 s, et
c'est le **contact des corps** qui décide de ce qu'elle tranche.

La première version frappait tout ce qui se trouvait devant, à n'importe quelle
altitude. On cassait donc une jarre restée au sol depuis dix mètres de haut, on
empochait le rebond, et **on grimpait sans jamais redescendre** — la simulation
donnait 0,23 → 3,49 → 5,30 → 7,11 → 8,91 m, sans fin.

Trois corrections, et **il fallait les trois** :

1. **Le contact obligatoire.** Sans lui, rien ne bornait l'altitude.
2. **Le rebond depuis le sommet de la jarre** — on se pose dessus avant de
   repartir, comme on rebondit sur la tête d'un ennemi. À lui seul le contact
   ne suffisait pas : la simulation dérivait encore de +2,1 m sur dix jarres,
   parce que chaque bond repartait d'un poil plus haut. Ce recalage verrouille
   la hauteur — mesurée à `1,06 → 1,06 → 1,06 → …`, à tous les points de la
   course.
3. **L'espacement accordé à la période du rebond.** Un rebond dure 0,667 s ; la
   distance qu'il couvre dépend donc de la vitesse, qui monte de 22 à 30 m/s au
   fil de la course. Un écart fixe marchait au début et ratait à la fin : les
   jarres sont désormais espacées de `0,667 × vitesse à cet endroit` (15 m au
   départ, 19 m à l'arrivée).

La lame a une **allonge de 1,3 m sous les pieds** — un sabre tranche ce qu'on
survole de peu. Sans elle, il faudrait heurter la jarre du corps et la fenêtre
de frappe tomberait à deux mètres : injouable au doigt. Elle ne rouvre pas la
porte à la montée, puisque le rebond repart toujours du sommet de la jarre.

## 🧱 Les murs qu'on longe

Des pans de mur bordent la piste par tronçons (un tous les 160 à 280 m, longs
de 26 à 42 m). S'y accrocher demande **trois conditions réunies** :

1. **être en l'air** — le mur est une manœuvre aérienne, pas un raccourci
   qu'on prend au sol : il faut décider de sauter *avant* d'arriver ;
2. être sur la **voie extérieure** de ce côté ;
3. swiper **vers le mur**.

Ce dernier geste était jusqu'ici **mort** : swiper à gauche quand on est déjà
tout à gauche ne faisait rien. Il n'y a donc aucun contrôle nouveau à
apprendre — juste un geste inutile devenu utile.

Pendant qu'on longe la paroi (0,95 s max, ou jusqu'à la fin du tronçon), on
est **hors de la piste** : plus rien ne peut nous faucher. Puis le mur nous
**renvoie en l'air** avant de nous rendre à notre voie — et c'est là tout
l'intérêt : on ressort *en vol*, donc encore capable de frapper une jarre et
d'enchaîner. Un swipe vers l'intérieur (ou un saut) permet de s'en détacher
plus tôt.

Le mur ne donne **aucune vitesse** : c'est une route, pas un raccourci. On y
gagne un passage sûr et un tremplin ; on y perd les jarres et les sillages du
centre. Tout est dans [`track.ts`](src/track.ts) (génération) et
[`player.ts`](src/player.ts) (`accrocheMur`, `lacheMur`, `MUR_DUREE`).

## 🏃 Les deux vitesses du 2ᵉ acte

Dans le corps de la course — ni au départ canon, ni au sprint final — deux
systèmes récompensent le **placement** :

- **La ligne droite** : tenir sa voie fait monter la vitesse (jauge pleine en
  3 s). Changer de ligne remet le compteur à zéro — c'est le coût « très
  léger » d'un déplacement : une occasion manquée, pas une punition.
- **L'aspiration** : se glisser dans le sillage d'un rival, **sur sa ligne**,
  entre 2 et 16 m derrière lui. Plus on est près, plus ça tire. C'est la
  mécanique de rattrapage des jeux de course : elle garde les duels serrés au
  lieu de laisser filer celui qui mène.

Les deux se cumulent, et ça pose un choix permanent : tenir **ma** ligne pour
l'élan, ou aller chercher **sa** ligne pour le sillage ?

### Le calibrage, corrigé par la simulation

L'intuition se trompe lourdement ici, et la simulation l'a rattrapée. Ces
bonus courent sur **tout le 2ᵉ acte (~70 s)**, là où le sprint final ne dure
que 4 s : des pourcentages qui semblent modestes y deviennent écrasants. À
+6 % / +9 %, mes premières valeurs faisaient gagner **9,25 s** — vingt fois le
sprint final. Ramenées à +1,8 % / +3 % :

| Situation | Gain |
|---|---|
| Ligne droite tenue à fond | 1,25 s |
| Aspiration collée en permanence | 2,07 s |
| **Jeu réaliste (les deux à 50 %)** | **1,65 s** |
| *Un trébuchement (étalon)* | *−0,53 s* |
| *Sprint final parfait (étalon)* | *0,42 s* |

Bien se placer sur toute une course vaut donc environ **trois fautes
évitées** : ça compte, sans jamais remplacer l'esquive.

Le retour au joueur passe par deux signaux : le témoin **🌀 ASPIRATION** dans
le HUD (sans lui, on accélère sans comprendre pourquoi), et le **champ de
vision qui s'ouvre avec la vitesse** — celui-là rend sensibles d'un coup tous
les gains (ligne, sillage, sprint, chaîne) sans rien donner à lire.

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

### 📖 L'aide, qui ne peut pas mentir

Les dix fiches s'affichent dans l'écran **Comment jouer** — depuis le ❓ du menu
principal, et depuis le **📜 du salon**, où l'on revient en refermant : personne
n'a à quitter la partie pour aller lire une fiche.

Elles ne sont **pas écrites dans le HTML**. `EFFETS`, dans
[`parchemin.ts`](src/parchemin.ts), vit sous les constantes de calibrage et les
**calcule** au lieu de les recopier : « +35 % pendant 1,5 s » sort de
`VENT_BOOST` et `VENT_DUREE`. Retoucher un réglage corrige donc l'aide toute
seule — un texte figé aurait menti au joueur dès le premier ajustement.

On ramasse des rouleaux sur la piste (environ un toutes les **7 secondes**).
**Tous les rouleaux se ressemblent** : on ne sait ce qu'on a décroché qu'une
fois dans la main — comme les boîtes de Mario Kart.

Le **contenu est tiré au ramassage**, pas à la génération de la piste. Les
boîtes sont aux **mêmes endroits pour tous** (piste partagée, à la graine), mais
chacun tire le sien : deux joueurs qui prennent la même boîte n'ont **pas
forcément le même pouvoir**. Un vrai joueur tire avec `Math.random` ; un bot
avec sa propre graine, pour rester rejouable ([`tirerParchemin`](src/parchemin.ts)).

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

## 💰 Les comptes & les deux monnaies

| Monnaie | Comment on l'obtient |
|---|---|
| 文 **Mon** | En courant. Le *mon* est la vraie pièce percée d'un trou carré de l'ère Sengoku — elle existe déjà dans l'univers du jeu. |
| 翡翠 **Hisui** | Le jade. Elle s'achète. |

> ⚠️ **On ne vend QUE de l'apparence.** Jamais un passif, jamais un parchemin,
> jamais un réglage de course. Les guerriers sont équilibrés bonus/malus, la
> hitbox est identique pour tous et le sprint final se court à armes égales —
> vendre de la puissance ferait s'effondrer tout ça, et le duel deviendrait une
> question de portefeuille. La contrainte est inscrite dans la base : la table
> `articles` n'accepte que des catégories cosmétiques.

### L'architecture : le navigateur ne voit jamais la base

Le jeu parle **au serveur**, et le serveur seul ouvre une connexion à Postgres.
Aucune clé, aucune adresse de base ne part dans le navigateur.

```
navigateur  ──websocket + HTTP──▶  serveur Colyseus  ──▶  Postgres
  (jeu)                            (Railway)              (Railway)
```

**L'identité** appartient à [Better Auth](https://better-auth.com) — une
*bibliothèque*, pas un service : elle tourne sur notre serveur et range ses
utilisateurs dans **notre** base. On lui délègue ce qu'il ne faut jamais écrire
soi-même : hachage des mots de passe, sessions, limitation des tentatives.

**Le parcours du joueur** : il arrive → un compte **anonyme** est créé, il joue
tout de suite, sans inscription ni donnée personnelle (les joueurs sont souvent
mineurs). Le jour où il veut jouer sur un autre appareil ou acheter de l'hisui,
il attache un email à *son* compte — et ne perd rien de ce qu'il a gagné.

Le schéma est partagé : Better Auth gère `user`, `session`, `account`,
`verification` ; nous gérons `profils`, `articles`, `deblocages`, `mouvements`
([migration 001](server/migrations/001_comptes_et_monnaies.sql)).

### Ce qui protège les soldes

1. **Le solde ne vient jamais du client.** Le jeu ne fait que l'afficher
   (`GET /api/profil`, authentifié). Un client modifié peut mentir sur tout ce
   qu'il envoie — s'il pouvait annoncer son propre solde, la boutique serait
   gratuite.
2. **C'est la base qui refuse**, pas un `if`. La dépense s'écrit
   `update … set mon = mon - $1 where joueur = $2 and mon >= $1` : deux achats
   lancés en même temps (double-tap) ne peuvent pas passer tous les deux.
   *Vérifié* : deux dépenses simultanées de 60 sur un solde de 70 → **une seule
   passe**, solde final 10, une seule ligne au journal.
3. **`check (mon >= 0)`** dans le schéma : même avec un bug côté serveur, un
   solde négatif est impossible.
4. **Chaque mouvement est journalisé** (`mouvements`) : c'est ce qui permet
   d'expliquer un solde qui semble faux, et de repérer après coup un joueur qui
   gagnerait trop vite.

### Le serveur HTTP partagé

Les courses (websocket) et les comptes (HTTP) tiennent sur **un seul port**,
donc un seul service à déployer. Piège rencontré : Colyseus installe ses
propres routes HTTP sur le même serveur, et Node appelle tous les écouteurs à la
suite **sans attendre** un gestionnaire asynchrone — Colyseus répondait 404
pendant que Better Auth interrogeait encore la base. D'où l'aiguilleur unique
installé après le `listen()` dans [server/src/index.ts](server/src/index.ts).

## 🗺️ Roadmap

- [x] Course solo 1 920 m : obstacles, trébuchement, chrono, record
- [x] Duel en ligne : matchmaking, piste partagée, adversaire visible, victoire
- [x] 🎌 Salons jusqu'à 10 : code privé, liste publique, partie rapide, prêt/hôte, décompte 10 s, chat, classement
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
