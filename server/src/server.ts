import express from 'express';
import http from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import dotenv from 'dotenv';
import { connectDB } from './db/connect'; // Importiere die DB-Verbindungsfunktion
import { Player } from './models/Player'; // Importiere das Player-Modell
import { LobbyManager } from './lobby/LobbyManager'; // Importiere LobbyManager
import { GameManager } from './game/GameManager';   // Importiere GameManager
import { Faction } from './types/common.types'; // Import Faction

dotenv.config(); // Lädt Umgebungsvariablen aus .env

// Verbinde mit der Datenbank
connectDB();

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: [
        process.env.CLIENT_URL || "http://localhost:5173", // Behalte den bisherigen Standard
        "http://greeve.duckdns.org:5173" // Füge die DuckDNS Adresse hinzu
    ],
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

// --- Manager Instanzen erstellen ---
const lobbyManager = new LobbyManager();
const gameManager = new GameManager(io); // io an GameManager übergeben

app.get('/', (req, res) => {
  res.send('Fracture Protocol Server läuft! Refactored.');
});

io.on('connection', (socket: Socket) => {
  console.log('Ein Benutzer hat sich verbunden:', socket.id);

  // --- Globale Events ---
  socket.emit('lobby:list', lobbyManager.getSerializableLobbyList());

  // --- Login Handler ---
  socket.on('player:login', async (username: string, callback: (response: any) => void) => {
    console.log(`Login-Versuch von ${socket.id} mit Name: ${username}`);
    const trimmedUsername = username.trim();
    if (!trimmedUsername || trimmedUsername.length > 16) {
      return callback({ success: false, message: 'Ungültiger Benutzername.' });
    }
    try {
      const [player, created] = await Player.findOrCreate({
        where: { username: trimmedUsername },
        defaults: { username: trimmedUsername }
      });
      console.log(`${created ? 'Neuer Spieler erstellt' : 'Spieler gefunden'}: ${player.username} (ID: ${player.id})`);
      socket.data.playerId = player.id;
      socket.data.username = player.username;
      callback({ success: true, playerId: player.id });
    } catch (error) {
      console.error('Fehler bei Player.findOrCreate:', error);
      callback({ success: false, message: 'Datenbankfehler beim Login.' });
    }
  });

  // --- Lobby Handlers (Delegation an LobbyManager) ---
  socket.on('lobby:create', (callback: (response: any) => void) => {
    const playerId = socket.data.playerId;
    const username = socket.data.username;
    if (!playerId || !username) return callback({ success: false, message: 'Nicht eingeloggt.' });

    const newLobby = lobbyManager.createLobby(playerId, username, socket.id);
    socket.join(newLobby.id);
    console.log(`Socket ${socket.id} dem Raum ${newLobby.id} beigetreten.`);
    callback({ success: true, lobbyId: newLobby.id });
    io.emit('lobby:list', lobbyManager.getSerializableLobbyList()); // Update global list
  });

  socket.on('lobby:get-details', (lobbyId: string, callback: (response: any) => void) => {
    const lobby = lobbyManager.getLobby(lobbyId);
    if (lobby) {
         // Konvertiere für die Übertragung
         const playersArray = Array.from(lobby.players.values());
         callback({ success: true, lobby: { ...lobby, players: playersArray } });
    } else {
      callback({ success: false, message: 'Lobby nicht gefunden.' });
    }
  });

  socket.on('lobby:leave', (lobbyId: string, callback: (response: any) => void) => {
    const playerId = socket.data.playerId;
    if (!playerId) return callback({ success: false, message: 'Fehler: Spieler-ID nicht gefunden.' });

    const result = lobbyManager.leaveLobby(lobbyId, playerId);
    socket.leave(lobbyId);
    callback({ success: true });

    if (result.updatedLobby) {
         const playersArray = Array.from(result.updatedLobby.players.values());
         io.to(lobbyId).emit('lobby:update', { ...result.updatedLobby, players: playersArray });
    }
    // Sende immer die globale Liste, falls eine Lobby gelöscht wurde oder sich Spielerzahl änderte
    io.emit('lobby:list', lobbyManager.getSerializableLobbyList());
  });

  socket.on('lobby:join', (lobbyId: string, callback: (response: any) => void) => {
      const playerId = socket.data.playerId;
      const username = socket.data.username;
    if (!playerId || !username) return callback({ success: false, message: 'Nicht eingeloggt.' });

    const result = lobbyManager.joinLobby(lobbyId, playerId, username, socket.id);
    if (result.success && result.lobby) {
        socket.join(lobbyId);
        callback({ success: true, lobbyId: result.lobby.id });
        const playersArray = Array.from(result.lobby.players.values());
        io.to(lobbyId).emit('lobby:update', { ...result.lobby, players: playersArray });
        io.emit('lobby:list', lobbyManager.getSerializableLobbyList());
    } else {
        callback({ success: false, message: result.message });
    }
  });

  socket.on('lobby:set-faction', (data: { lobbyId: string, faction: Faction }) => {
    const playerId = socket.data.playerId;
    if (!playerId) return;
    const updatedLobby = lobbyManager.setFaction(data.lobbyId, playerId, data.faction);
    if (updatedLobby) {
         const playersArray = Array.from(updatedLobby.players.values());
         io.to(data.lobbyId).emit('lobby:update', { ...updatedLobby, players: playersArray });
    }
  });

  socket.on('lobby:set-ready', (data: { lobbyId: string, isReady: boolean }) => {
      const playerId = socket.data.playerId;
    if (!playerId) return;
    const updatedLobby = lobbyManager.setReady(data.lobbyId, playerId, data.isReady);
    if (updatedLobby) {
        const playersArray = Array.from(updatedLobby.players.values());
        io.to(data.lobbyId).emit('lobby:update', { ...updatedLobby, players: playersArray });
    }
  });

  socket.on('lobby:start-game', (lobbyId: string, callback: (response: any) => void) => {
      const playerId = socket.data.playerId;
    if (!playerId) return callback({ success: false, message: 'Fehler: Spieler-ID nicht gefunden.' });

    const readyCheck = lobbyManager.checkLobbyReadyForStart(lobbyId, playerId);
    if (!readyCheck.ready || !readyCheck.lobby) {
        return callback({ success: false, message: readyCheck.message || 'Lobby nicht bereit.' });
    }

    // Lobby ist bereit, starte das Spiel über GameManager
    const initialGameState = gameManager.startGame(readyCheck.lobby);

    if (initialGameState) {
        lobbyManager.deleteLobby(lobbyId); // Lobby aus Manager entfernen
        // Sende Spielstart-Event mit initialem State
        const playersArray = Array.from(initialGameState.players.values());
        io.to(lobbyId).emit('game:start', { ...initialGameState, players: playersArray });
      console.log(`'game:start' Event mit initialem GameState an Raum ${lobbyId} gesendet.`);
        io.emit('lobby:list', lobbyManager.getSerializableLobbyList()); // Update global list
      callback({ success: true });
    } else {
        callback({ success: false, message: 'Fehler beim Erstellen des Spiels.' });
    }
  });

  // --- Game Handlers (Delegation an GameManager) ---
  socket.on('game:force-start-combat', (gameId: string, callback: (response: any) => void) => {
      const playerId = socket.data.playerId;
    if (!playerId) return callback({ success: false, message: 'Fehler: Spieler-ID nicht gefunden.' });
    const result = gameManager.forceStartCombat(gameId, playerId);
    callback(result);
  });

  socket.on('game:unlock-unit', (data: { gameId: string, unitId: string }, callback: (response: any) => void) => {
      const playerId = socket.data.playerId;
    if (!playerId) return callback({ success: false, message: 'Fehler: Spieler-ID nicht gefunden.' });
    const result = gameManager.unlockUnit(data.gameId, playerId, data.unitId);
    callback(result);
  });

  socket.on('game:place-unit', (data: { gameId: string, unitId: string, position: { x: number, z: number } }, callback: (response: any) => void) => {
    const playerId = socket.data.playerId;
    if (!playerId) return callback({ success: false, message: 'Fehler: Spieler-ID nicht gefunden.' });
    const result = gameManager.placeUnit(data.gameId, playerId, data.unitId, data.position);
    callback(result);
  });

  // --- Disconnect Handler ---
  socket.on('disconnect', () => {
    const playerId = socket.data.playerId;
    const username = socket.data.username;
    console.log(`Benutzer ${username || socket.id} (ID: ${playerId}) hat die Verbindung getrennt.`);

    if (playerId) {
        // Spieler aus Lobby entfernen (falls er in einer war)
        const lobbyResult = lobbyManager.removePlayer(playerId);
        if (lobbyResult.affectedLobbyId) {
            if (lobbyResult.updatedLobby) {
                 const playersArray = Array.from(lobbyResult.updatedLobby.players.values());
                 io.to(lobbyResult.affectedLobbyId).emit('lobby:update', { ...lobbyResult.updatedLobby, players: playersArray });
            }
            // Immer globale Liste aktualisieren, wenn eine Lobby betroffen war
            io.emit('lobby:list', lobbyManager.getSerializableLobbyList());
        }

        // Spieler aus Spiel entfernen (falls er in einem war)
        gameManager.removePlayer(playerId); 
        // TODO: Was soll genau passieren, wenn Spieler Spiel verlässt? (siehe GameManager.removePlayer)
    }
  });

});

// Starte den Server nur, wenn die DB-Verbindung steht (connectDB beendet bei Fehler)
server.listen(PORT, () => {
  console.log(`Server läuft auf Port ${PORT}`);
});

// Exportiere io und server für eventuelle Modultests oder Erweiterungen
export { server, io }; 