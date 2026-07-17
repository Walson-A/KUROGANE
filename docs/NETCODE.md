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

## Les limites connues (par ordre d'importance)

1. **Confiance au client** : le serveur croit le `distance` et le `finished`
   qu'on lui envoie. Un tricheur peut mentir. Parade : le serveur connaît la
   graine ET les règles → il pourrait valider que le temps annoncé est
   physiquement possible (vitesse max × durée), voire simuler la course.
   Acceptable pour un jeu entre cousins, à durcir si le jeu devient public.
2. **Événements fondus dans le 20 Hz** : un changement de ligne part avec le
   prochain envoi (jusqu'à 50 ms d'attente). Envoyer les actions (saut,
   changement de ligne, trébuchement) **immédiatement en événements** rendrait
   les esquives du rival plus nettes, et permettrait de les rejouer exactement.
3. **Horloges non synchronisées** : on date les messages à leur *arrivée*,
   pas à leur *envoi*. Une synchro d'horloge (offset serveur estimé via le
   ping) daterait précisément chaque position → extrapolation encore plus juste,
   moins sensible à la gigue.
4. **WebSocket = TCP** : une perte de paquet bloque brièvement tout le flux
   (head-of-line blocking). Les alternatives type WebTransport/UDP ne valent
   le coût qu'à haut niveau de jeu.
5. **Une seule région serveur** : la latence plancher, c'est la géographie.
   Deux joueurs en France sur un serveur européen ≈ 20-40 ms : très bien.

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
