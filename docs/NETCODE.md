# 🌐 NETCODE — comment KUROGANE synchronise deux coureurs

*Référence technique du multijoueur. À lire avant de toucher à
[net.ts](../src/net.ts), [opponent.ts](../src/opponent.ts) ou
[RaceRoom.ts](../server/src/RaceRoom.ts) — par exemple pour les sorts en ligne.*

---

## Vue d'ensemble

```
  TÉLÉPHONE A                    SERVEUR (Railway)                TÉLÉPHONE B
┌─────────────┐              ┌─────────────────────┐           ┌─────────────┐
│  je simule  │──progress──▶ │      RaceRoom       │──patchs──▶│  j'affiche  │
│  MA course  │   20 fois/s  │  phase · seed        │  30 fois/s│  SON fantôme│
│             │ ◀──patchs────│  players{} · winner  │◀─progress─│             │
└─────────────┘              └─────────────────────┘           └─────────────┘
```

- **Chacun simule SA propre course en local** (vitesse, saut, collisions,
  trébuchements) : tes contrôles répondent en 0 ms, le réseau n'y touche jamais.
- On envoie au serveur un résumé de où on en est : `{ lane, y, distance,
  sliding }`, **20 fois par seconde** (`sendProgress`).
- Le serveur range ça dans son état (`players`) et le rediffuse à l'autre,
  **30 fois par seconde** (patchs binaires delta de Colyseus, `setPatchRate(33)`).
- L'adversaire n'est donc **jamais simulé** chez toi : c'est un enregistrement
  reçu du réseau, affiché intelligemment (voir plus bas).

## Le serveur est le chef (RaceRoom.ts)

| Décision | Comment |
|---|---|
| Apparier 2 joueurs | `maxClients = 2`, salle verrouillée quand pleine |
| Même piste pour les deux | il tire la **graine** (`seed`) → générateur mulberry32 |
| Le départ | phase `waiting → countdown → racing` (countdown 3,5 s serveur) |
| Le vainqueur | premier message `finished` reçu — pas de débat client |
| L'abandon | un joueur part en course → victoire par forfait de l'autre |

Les phases pilotent tout : le client ne démarre jamais sa course tout seul,
il attend le `racing` du serveur (avec un garde-fou : si le GO n'arrive pas
4 s après le countdown → « Connexion perdue »).

## Afficher le rival : le problème du retard

Un message met du temps à voyager (la **latence**), et il n'en arrive que 20
par seconde. Afficher la dernière position reçue = voir le rival **là où il
était il y a 100 à 300 ms** — soit 5 à 8 m de retard à pleine vitesse. C'est
exactement le bug « je le double alors que non ».

Les trois parades (toutes dans `opponent.ts` / `net.ts`) :

### 1. L'extrapolation (dead reckoning)
On déduit sa vitesse de ses deux derniers messages, puis à chaque image :

```
position affichée = dernière position reçue + vitesse × (âge du message + latence)
```

- L'estimation est lissée (lerp) et **saute** directement si l'erreur dépasse
  10 m (correction de lag spike).
- Bornée à **0,5 s** d'invention : si ses messages s'arrêtent, on le voit
  freiner plutôt que traverser des murs. C'est le compromis de l'extrapolation :
  elle prédit le futur, elle peut se tromper (s'il trébuche pile maintenant,
  on le verra « reculer » brièvement à la correction suivante).

### 2. La mesure du ping
Toutes les 2 s, le client envoie `ping(heure)` ; le serveur renvoie `pong`
avec la même heure ; l'écart = l'aller-retour (RTT). Moyenne glissante
(70 % ancien / 30 % nouveau) pour amortir les à-coups. La latence aller
simple = `rtt / 2`, injectée dans l'extrapolation.

### 3. Le fantôme
Le rival est **semi-transparent** : au départ (tous deux ligne du milieu,
distance 0) et à chaque dépassement, les deux avatars se superposent — il
faut voir à travers. Aucune collision entre coureurs, c'est voulu : chacun
court sa course, on ne peut pas se pousser (pour l'instant 😈).

### Règle d'or du HUD
Tout ce qui répond à « qui est devant ? » (marqueur sur la barre, écart
« Rival +12 m ») utilise `opponent.distanceNow` — la position **estimée** —
jamais la position brute reçue. Elle seule est honnête.

## Ce qu'on N'ENVOIE PAS (et pourquoi)

- **Les obstacles** : jamais. La graine suffit (piste déterministe).
- **Le temps de chaque image** : la simulation locale est en `dt` variable ;
  seuls le résumé 20 Hz et les événements d'action partent sur le réseau.

## Les deux canaux (à connaître avant d'ajouter une feature réseau)

| Canal | Cadence | Pour quoi | Exemples |
|---|---|---|---|
| **État** (schema) | patchs 30 Hz | ce qui EST (persiste, rejoint tard, survit à une reconnexion) | position, pseudo, phase, `connected` |
| **Messages** | immédiat | ce qui ARRIVE (événements ponctuels) | `action` (saut, esquive, trébuchement), `ping/pong`, futurs sorts |

Règle simple : *un fait durable → l'état ; un instant → un message.* Les deux
ensemble : l'action donne la réaction immédiate, l'état corrige derrière.

## L'état de l'art — recherche du 17/07/2026

*Ce que font les vrais jeux, croisé avec notre situation. Sources principales :
la série [Fast-Paced Multiplayer de Gabriel Gambetta](https://www.gabrielgambetta.com/client-server-game-architecture.html)
(LA référence du domaine), [Gaffer On Games](https://gafferongames.com/post/snapshot_interpolation/),
la [doc Colyseus](https://docs.colyseus.io/state), et
[l'étude « Hiding latency » du jeu de course mobile Razor](https://www.decarpentier.nl/hiding-latency).*

### Ce que la recherche VALIDE dans notre netcode ✅

- **Contrôles 100 % locaux** : nos inputs ne passent jamais par le réseau →
  0 ms de latence ressentie. C'est pour ça qu'on n'a pas besoin de la
  « client-side prediction + réconciliation » de Gambetta : elle sert aux jeux
  où le serveur simule TON perso. Chez nous, par design, il ne le fait pas.
- **Extrapolation plutôt qu'interpolation tamponnée** : le buffer
  d'interpolation ([Gaffer](https://gafferongames.com/post/snapshot_interpolation/),
  Valve) affiche l'adversaire *en retard mais exact* — parfait pour un shooter,
  faux pour une course où « qui est devant ? » EST le jeu. L'étude Razor
  utilise du dead reckoning sophistiqué (3 simulations mélangées) parce que
  des *voitures tournent* ; notre coureur avance en 1D à vitesse quasi
  constante : le cas idéal de l'extrapolation simple. Bon choix confirmé.
- **Payload minuscule** : la quantization/compression que font les gros jeux
  est déjà couverte par les patchs binaires delta de
  [@colyseus/schema](https://github.com/colyseus/schema). Rien à gagner ici.

### Les optimisations restantes, priorisées

| # | Optimisation | Gain | Effort | Verdict |
|---|---|---|---|---|
| 1 | **Actions en événements instantanés** | Esquives du rival nettes (−50 à −80 ms) | S | ✅ **fait** (17/07) |
| 2 | **Reconnexion mobile** | Écran verrouillé ≠ défaite | M | ✅ **fait** (17/07) |
| 3 | **Synchro d'horloge** (NTP-style) | Extrapolation moins sensible à la gigue | S | ✅ **fait** (17/07) |
| 4 | **Lag compensation** (Valve) | Nécessaire quand les sorts viseront l'autre | M | 🧱 **fondations posées** (17/07) |
| 5 | Validation serveur (anti-triche) | Classements fiables | M | ✅ **fait** (17/07) |
| 6 | WebTransport (datagrammes) | Moins de blocage sur réseaux avec pertes | L | 🚫 **bloqué par l'hébergement** |

**1. Actions en événements instantanés — FAIT.** La
[doc Colyseus](https://docs.colyseus.io/state) est claire : l'état est
diffusé *au rythme des patchs* (33 ms chez nous), mais **les messages
partent immédiatement**. Chaque action (saut, changement de ligne, glissade,
trébuchement) est donc envoyée en message `action`, que le serveur **relaie
aussitôt** à l'autre joueur (liste blanche de types, le reste est refusé).
À la réception, le rival la rejoue sur-le-champ : son saut est simulé en
physique locale (mêmes constantes que `player.ts`), son trébuchement fait
chuter sa vitesse **dans notre extrapolation** au moment même — c'était la
dernière source de « je le double alors que non » (l'extrapolation le voyait
continuer à pleine vitesse pendant ~100 ms après sa faute).

**2. Reconnexion mobile — FAIT.** Sur téléphone, verrouiller l'écran ou
passer du wifi à la 4G **coupe le WebSocket** → avant : défaite par forfait
immédiate. Maintenant, côté serveur
([RaceRoom.ts](../server/src/RaceRoom.ts)) : `onDrop()` →
`allowReconnection(client, 30)` garde la place 30 s et marque
`connected = false` (l'autre joueur voit « 📡 il a coupé… ») → `onReconnect()`
remet `connected = true`. Le ménage ne se fait QUE dans `onLeave()` (règle
d'or de la [doc](https://docs.colyseus.io/room/reconnection)). Côté client,
**l'auto-reconnexion du SDK 0.17 fait tout** : retentatives progressives,
messages mis en tampon, mêmes `sessionId` — vérifié par le test simulé
(coupure en pleine course → retour 0,2 s après → la course continue).
Pendant l'absence, l'extrapolation anime le fantôme ~0,5 s puis le freine.

**3. Synchro d'horloge — FAIT.** Formule
[NTP simplifiée](https://daposto.medium.com/game-networking-2-time-tick-clock-synchronisation-9a0e76101fe5) :
le `pong` du serveur renvoie désormais AUSSI son heure, qui date du **milieu**
de l'aller-retour → `offset ≈ serveur − (envoi + réception)/2`, en moyenne
glissante et en écartant les pings anormalement lents. Chaque position est
alors **horodatée à l'envoi** (`at`, en heure serveur — la référence commune
aux deux joueurs) : l'extrapolation utilise l'âge exact du message au lieu
de « heure d'arrivée + RTT/2 », et la gigue ne la fait plus respirer.

**4. Lag compensation — FONDATIONS POSÉES.** Le jour où un kunai « touche »
l'adversaire, question de [Valve](https://www.gabrielgambetta.com/lag-compensation.html) :
le lanceur visait la position d'il y a 100 ms — il faut juger le coup **dans
le passé**. Tout est prêt côté serveur ([RaceRoom.ts](../server/src/RaceRoom.ts)) :
chaque position reçue alimente un **historique de 2 s par joueur**, et
l'API **`positionAt(sessionId, t)`** répond « où était-il à l'heure serveur
`t` ? » (interpolé entre les échantillons). Grâce à la synchro d'horloge, le
lanceur horodate sa visée dans la même horloge → le serveur rejuge le coup à
cet instant-là exactement. 📜 **Agents des parchemins : c'est votre API.**

**5. Validation serveur (anti-triche) — FAIT.** Trois barrières, toutes
appuyées sur l'horloge du serveur (`raceStartAt`, posée au GO) :

- **La distance ne ment pas** : elle ne peut ni reculer, ni dépasser
  `temps écoulé × 45 m/s` (au-delà de tout ce que le jeu permet, sprint
  compris). Le tricheur qui annonce 600 m à la 3ᵉ seconde est ramené au
  plafond, silencieusement.
- **« J'ai fini » doit être crédible** : refusé si le temps écoulé rend
  l'arrivée physiquement impossible, ou si les positions reçues ne
  montrent pas ~600 m parcourus.
- **Le chrono retenu est honnête** : celui du client s'il colle à l'horloge
  du serveur (à la latence près), sinon celui du serveur. Annoncer « 2 s »
  ne sert à rien.

Vérifié par le test simulé : téléportation plafonnée, victoire éclair
ignorée, chrono menteur corrigé, chrono honnête conservé.

**6. WebTransport — BLOQUÉ, et pas par nous.** Côté navigateurs c'est
[Baseline depuis mars 2026](https://webrtc.ventures/2026/04/webtransport-is-now-baseline-what-it-means-for-real-time-media/)
(Safari 26.4 a enfin suivi), et les datagrammes non fiables supprimeraient
le blocage TCP sur pertes de paquets. MAIS, vérifié le 17/07/2026 :

1. le [transport WebTransport de Colyseus](https://docs.colyseus.io/server/transport/webtransport)
   est officiellement **expérimental** (« pas testé au combat ») ;
2. surtout, [Railway n'accepte pas le trafic UDP entrant](https://station.railway.com/questions/adding-inbound-udp-fad19847)
   — or WebTransport = QUIC = UDP. **Aucun code ne peut contourner ça.**

À réévaluer seulement si l'hébergement change (Fly.io accepte l'UDP) ET que
le transport Colyseus sort de l'expérimental. D'ici là : non-sujet.

### La limite qu'aucun code ne franchira

La géographie : deux joueurs en France sur un serveur européen ≈ 20-40 ms
d'aller-retour incompressible. Tout le netcode du monde ne fait que *cacher*
ce délai — c'est exactement le travail de l'extrapolation.

## Étendre le netcode (pour les sorts 📜)

Un sort qui affecte l'adversaire (kunai, brouillard…) doit passer par le
serveur — jamais de client à client :

```
lanceur ──'cast' {sort, at}──▶ RaceRoom
                                 │ 1. valide : possède-t-il le sort ? cooldown ?
                                 │ 2. si le sort VISE : positionAt(cible, at)
                                 │    → où était la cible quand il a visé ?
                                 │ 3. broadcast 'spell' {sort, lanceur, touché?}
                    les DEUX clients jouent l'effet, chacun chez soi
```

Le serveur valide (anti-triche), les clients affichent. Même logique que le
reste : **le serveur décide, les clients racontent et dessinent.**

Boîte à outils déjà en place pour vous :
- **`positionAt(sessionId, t)`** — la position d'un joueur à l'heure serveur
  `t` (lag compensation, 2 s d'historique) ;
- **l'horodatage `at`** — les clients savent estampiller leurs messages en
  heure serveur (`net.serverNow()`), la synchro d'horloge tourne déjà ;
- **le canal messages** — pour tout effet instantané (cf. « Les deux
  canaux ») ; ajoutez votre type à la liste blanche `ACTIONS` ou créez un
  message `cast` dédié, mais ne mettez JAMAIS un événement dans le schema.
