import { Server } from 'colyseus'
import { RaceRoom } from './RaceRoom'

/**
 * Le serveur de jeu KUROGANE.
 * Il tourne en permanence et héberge les salles de course.
 * En local : ws://localhost:2567 — en production : l'adresse Railway/Render.
 */
const port = Number(process.env.PORT ?? 2567)

const gameServer = new Server()
gameServer.define('race', RaceRoom)

gameServer.listen(port).then(() => {
  console.log(`⛩️  Serveur KUROGANE prêt sur ws://localhost:${port}`)
})
