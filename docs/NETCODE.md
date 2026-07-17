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
- **Les trébuchements du rival** : pas encore — on voit juste sa vitesse
  chuter via l'extrapolation. Un événement `stumble` dédié ferait une
  meilleure anim (à faire).
- **Le temps de chaque image** : la simulation locale est en `dt` variable ;
  seul le résumé 20 Hz part sur le réseau.

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
| 1 | **Actions en événements instantanés** | Esquives du rival nettes (−50 à −80 ms) | S | ✅ à faire |
| 2 | **Reconnexion mobile** | Écran verrouillé ≠ défaite | M | ✅ à faire |
| 3 | **Synchro d'horloge** (NTP-style) | Extrapolation moins sensible à la gigue | S | 👍 si motivés |
| 4 | **Lag compensation** (Valve) | Nécessaire quand les sorts viseront l'autre | M | 📜 avec les sorts |
| 5 | Validation serveur (anti-triche) | Classements fiables | M | si jeu public |
| 6 | WebTransport (datagrammes) | Moins de blocage sur réseaux avec pertes | L | plus tard |

**1. Actions en événements instantanés.** La
[doc Colyseus](https://docs.colyseus.io/state) est claire : l'état est
diffusé *au rythme des patchs* (33 ms chez nous), mais **les messages
partent immédiatement**. Un saut/changement de ligne/trébuchement envoyé en
message `action` arrive donc ~50 ms plus tôt que fondu dans le flux 20 Hz —
et le trébuchement en événement permettrait enfin de jouer la vraie anim
chez l'autre (aujourd'hui on voit juste sa vitesse chuter).

**2. Reconnexion mobile — la priorité que la recherche a révélée.** Sur
téléphone, verrouiller l'écran ou passer du wifi à la 4G **coupe le
WebSocket** → aujourd'hui : défaite par forfait immédiate. Colyseus 0.17 a
[tout ce qu'il faut](https://docs.colyseus.io/room/reconnection) :
`onDrop()` (déconnexion anormale) → `allowReconnection(client, délai)` garde
la place → `onReconnect()` si le joueur revient. Règle d'or de la doc : ne
nettoyer les données du joueur que dans `onLeave()`, jamais dans `onDrop()`.
Pendant l'absence, notre extrapolation continue déjà d'animer le fantôme ~0,5 s,
puis il freine — comportement idéal en attendant le retour.

**3. Synchro d'horloge.** Formule
[NTP simplifiée](https://daposto.medium.com/game-networking-2-time-tick-clock-synchronisation-9a0e76101fe5) :
le client envoie `t0`, le serveur répond avec son heure `ts`, le client reçoit
à `t1` → `offset ≈ ts − (t0 + t1)/2` (moyenne sur plusieurs pings, en écartant
ceux dont le RTT s'écarte trop). On peut alors **horodater chaque position à
l'envoi** : l'extrapolation utilise l'âge exact du message au lieu de
« arrivée + RTT/2 », et la gigue ne la fait plus respirer.

**4. Lag compensation.** Le jour où un kunai « touche » l'adversaire, se
poser la question de [Valve](https://www.gabrielgambetta.com/lag-compensation.html) :
le lanceur visait la position d'il y a 100 ms. Le serveur devra juger le
coup dans le passé (ou, plus simple pour nous : le sort annonce sa cible et
l'effet est validé par le serveur, sans hitbox précise).

**6. WebTransport.** Nouveauté : c'est
[Baseline depuis mars 2026](https://webrtc.ventures/2026/04/webtransport-is-now-baseline-what-it-means-for-real-time-media/)
(Safari 26.4 a enfin suivi). Datagrammes non fiables = plus de blocage TCP
quand un paquet se perd (P99 de latence divisé par ~8 sur réseau avec
pertes). Pertinent le jour où des joueurs jouent en 4G instable — pas tant
que vous jouez en wifi. À réévaluer quand Colyseus stabilisera son transport
WebTransport.

### La limite qu'aucun code ne franchira

La géographie : deux joueurs en France sur un serveur européen ≈ 20-40 ms
d'aller-retour incompressible. Tout le netcode du monde ne fait que *cacher*
ce délai — c'est exactement le travail de l'extrapolation.

## Étendre le netcode (pour les sorts 📜)

Un sort qui affecte l'adversaire (kunai, brouillard…) doit passer par le
serveur — jamais de client à client :

```
lanceur ──'cast' {sort}──▶ RaceRoom (valide : possède-t-il le sort ? cooldown ?)
                               │ broadcast 'spell' {sort, lanceur}
                  les DEUX clients jouent l'effet, chacun chez soi
```

Le serveur valide (anti-triche), les clients affichent. Même logique que le
reste : **le serveur décide, les clients racontent et dessinent.**
