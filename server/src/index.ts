import { Server, LobbyRoom } from 'colyseus'
import { RaceRoom } from './RaceRoom'

/**
 * Le serveur de jeu KUROGANE.
 * Il tourne en permanence et héberge les salles de course.
 * En local : ws://localhost:2567 — en production : l'adresse Railway/Render.
 */
const port = Number(process.env.PORT ?? 2567)

const gameServer = new Server()

// La salle « lobby » : le jeu s'y connecte le temps de LIRE la liste des salons
// publics ouverts (cf. Net.listSalons). Colyseus la tient à jour en temps réel.
gameServer.define('lobby', LobbyRoom)

// filterBy(['code']) : joinOrCreate('race', { code }) route vers le salon qui
// porte CE code — ou en crée un. C'est ce qui fait marcher les codes privés ET
// la partie rapide (tous les publics partagent le code 'PUBLIC' et se remplissent).
// enableRealtimeListing() : le salon se signale à la salle « lobby » ci-dessus.
gameServer.define('race', RaceRoom).filterBy(['code']).enableRealtimeListing()

gameServer.listen(port).then(() => {
  console.log(`⛩️  Serveur KUROGANE prêt sur ws://localhost:${port}`)
})
