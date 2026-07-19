# ⛩️ KUROGANE — Lancer et déployer le jeu

Le jeu est composé de **deux programmes** :

| Quoi | Dossier | Rôle |
|---|---|---|
| 🎮 **Le client** | `kurogane/` (racine) | Le jeu 3D qui tourne dans le navigateur (Vite + Three.js) |
| 🖥️ **Le serveur** | `kurogane/server/` | Le serveur de course multijoueur (Colyseus). C'est LE CHEF : il apparie les joueurs, donne le départ et déclare le vainqueur |

---

## 🚀 Lancer le jeu en local (dev)

Ouvre **deux terminaux** :

**Terminal 1 — le serveur multi :**
```bash
cd server
npm run dev
```
→ affiche `⛩️ Serveur KUROGANE prêt sur ws://localhost:2567`

**Terminal 2 — le jeu :**
```bash
npm run dev
```
→ ouvre **http://localhost:5173** dans ton navigateur

💡 Pour tester le multi tout seul : ouvre le jeu dans **deux onglets** et clique
« ⚔️ COURSE EN LIGNE » dans chacun.

---

## 📱 Jouer sur téléphone (même wifi)

1. Lance le serveur multi (terminal 1, comme ci-dessus)
2. Lance le jeu en mode « exposé au réseau » :
   ```bash
   npm run dev -- --host
   ```
3. Vite affiche une adresse `Network:` du genre `http://192.168.1.42:5173`
   → ouvre-la sur le téléphone (même wifi que le PC !)
4. Le jeu trouve le serveur multi **tout seul** (même adresse IP, port 2567)

⚠️ **Si le téléphone ne se connecte pas** : le pare-feu Windows bloque sûrement.
À la première exécution, Windows demande d'autoriser `node` → accepte pour les
**réseaux privés**. (Sinon : Paramètres → Pare-feu → Autoriser une application.)

---

## 📦 Vérifier avant de mettre en ligne (build de prod)

```bash
# Le client : compile TypeScript + fabrique le dossier dist/
npm run build
npm run preview      # teste la version de prod en local

# Le serveur
cd server
npm run build
npm start
```

---

## 🌍 Mise en ligne (le jour J)

### 1. Pousser le code sur GitHub
```bash
git add .
git commit -m "Mon message qui décrit le changement"
git push
```

### 2. Le serveur multi → Railway (ou Render)
- Créer un projet depuis le repo GitHub sur [railway.app](https://railway.app)
- **Root directory** : `server`
- Build : `npm run build` · Start : `npm start`
- Railway fournit le port via la variable `PORT` (déjà géré dans le code)
- Ajouter un service **Postgres** au projet : il fournit `DATABASE_URL`
- Adresse publique actuelle : `kurogane-production.up.railway.app`

#### ⚠️ Les variables à poser sur Railway

Sans elles, le serveur démarre mais **la moitié du jeu ne répond pas**. Les
deux premières sont obligatoires ; les autres décident de ce qui fonctionne.

| Variable | Ce qui casse sans elle |
|---|---|
| `AUTH_SECRET` | **Refus de démarrer.** C'est voulu : sans secret, les jetons de session seraient signés avec une valeur écrite dans le dépôt, et n'importe qui pourrait se faire passer pour un autre joueur |
| `DATABASE_URL` | Ni comptes, ni monnaie, ni boutique, ni classement (le jeu reste jouable) |
| `ORIGINES_AUTORISEES` | Le CORS bloque **tout** : connexion, boutique, classement. À remplir avec l'adresse Vercel exacte |
| `PUBLIC_URL` | L'OAuth Google casse. À remplir avec l'adresse Railway ci-dessus |
| `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` | Le bouton Google est simplement masqué, le reste marche |

Pour générer le secret :
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

> 🗃️ **Les migrations SQL s'appliquent toutes seules** au démarrage, dans
> l'ordre des noms de fichiers, chacune dans sa transaction et une seule fois
> (table `migrations`). Rien à lancer à la main, et redéployer est sans risque.

#### 🔑 Se connecter avec Google

Dans la Google Cloud Console → *APIs & Services* → *Credentials* → OAuth client
ID (type **Web application**), enregistrer l'URI de redirection **exacte** :

```
https://kurogane-production.up.railway.app/api/auth/callback/google
```

Et en local, pour tester :
```
http://localhost:2567/api/auth/callback/google
```

> ⚠️ **En local, laisser `PUBLIC_URL` VIDE.** Y mettre l'adresse de production
> ferait croire au serveur qu'il tourne sur Railway : il enverrait Google
> rediriger vers la production. Symptôme : le bouton Google ne fait rien.

### 3. Le jeu → Vercel
- Créer un projet depuis le repo GitHub sur [vercel.com](https://vercel.com)
- **Root directory** : `kurogane` (framework : Vite, détecté tout seul)
- **Aucune variable n'est nécessaire** : servi en https, le jeu bascule tout
  seul sur l'adresse Railway (cf. `PROD_SERVER_URL` dans `src/net.ts`)
- `VITE_SERVER_URL` existe si l'on veut viser un autre serveur (préproduction,
  serveur d'un camarade). Elle prime sur tout le reste.
- Déployer → le jeu a une adresse publique à partager 🎉

> ⚠️ **L'adresse Railway est écrite dans `src/net.ts`.** Si le serveur change de
> nom, il faut la corriger LÀ — sinon le multijoueur se connecte dans le vide,
> et rien dans l'interface ne dit pourquoi. Trois endroits doivent toujours
> concorder : `src/net.ts`, `server/.env.example` et ce fichier.

À chaque `git push`, Vercel et Railway **redéploient automatiquement**.

### 4. Vérifier que la mise en ligne a pris

1. Ouvrir l'adresse Vercel — le jeu se lance, on peut courir en solo
2. Ouvrir la console du navigateur (F12) : aucune erreur rouge
3. Lancer une partie rapide — si le salon s'ouvre, le serveur répond
4. Se connecter (Google ou e-mail) — si ça marche, base et CORS sont bons
5. Finir une course — le temps apparaît au classement

---

## 🧰 Pense-bête Git

```bash
git status                  # où j'en suis ?
git add .                   # je prépare tous mes changements
git commit -m "message"     # je prends la photo
git log --oneline           # l'historique des photos
git push                    # j'envoie sur GitHub
```

## 🗺️ Les adresses en résumé

| Environnement | Jeu | Serveur multi |
|---|---|---|
| Dev local | http://localhost:5173 | ws://localhost:2567 |
| Téléphone (wifi) | http://IP-DU-PC:5173 | ws://IP-DU-PC:2567 (auto) |
| Production | https://kurogane.vercel.app | wss://kurogane-production.up.railway.app |

Le client choisit dans cet ordre : `VITE_SERVER_URL` si elle existe, sinon
l'adresse Railway quand la page est en https, sinon `localhost`. C'est ce qui
permet de ne rien configurer sur Vercel.
