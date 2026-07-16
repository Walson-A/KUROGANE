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
- Récupérer l'adresse publique, ex. `kurogane-server.up.railway.app`

### 3. Le jeu → Vercel
- Créer un projet depuis le repo GitHub sur [vercel.com](https://vercel.com)
- **Root directory** : `kurogane` (framework : Vite, détecté tout seul)
- Ajouter la variable d'environnement :
  ```
  VITE_SERVER_URL = wss://kurogane-server.up.railway.app
  ```
  (⚠️ `wss://` — le « s » est obligatoire en ligne, connexion chiffrée)
- Déployer → le jeu a une adresse publique à partager 🎉

À chaque `git push`, Vercel et Railway **redéploient automatiquement**.

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
| Production | https://kurogane.vercel.app | wss://…railway.app (via `VITE_SERVER_URL`) |
