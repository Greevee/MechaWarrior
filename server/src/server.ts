import express from 'express';
import http from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import dotenv from 'dotenv';
import { connectDB } from './db/connect'; // Importiere die DB-Verbindungsfunktion
import { Player } from './models/Player'; // Importiere das Player-Modell
import { Lobby, LobbyPlayer, GameMode } from './types/lobby.types'; // Importiere Lobby-Typen
import { v4 as uuidv4 } from 'uuid'; // Importiere uuid zur ID-Generierung
import { Faction } from './types/common.types'; // Import Faction

dotenv.config(); // Lädt Umgebungsvariablen aus .env

// Verbinde mit der Datenbank
connectDB();

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:5173", // Erlaube Anfragen vom Frontend (Vite Standardport)
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

// --- In-Memory Speicher für Lobbies ---
const activeLobbies = new Map<string, Lobby>();

// Hilfsfunktion zum Erstellen einer serialisierbaren Lobby-Liste
const getSerializableLobbyList = () => {
  // Maps sind nicht direkt JSON-serialisierbar, wandle Spieler-Map in Array um
  return Array.from(activeLobbies.values()).map(lobby => ({
    ...lobby,
    players: Array.from(lobby.players.values()), // Spieler-Map in Array umwandeln
  }));
};

app.get('/', (req, res) => {
  res.send('Fracture Protocol Server läuft!');
});

io.on('connection', (socket: Socket) => {
  console.log('Ein Benutzer hat sich verbunden:', socket.id);

  // Sende die aktuelle Lobby-Liste an den neu verbundenen Client
  socket.emit('lobby:list', getSerializableLobbyList());

  // Handler für Spieler-Login (MVP)
  socket.on('player:login', async (username: string, callback: (response: any) => void) => {
    console.log(`Login-Versuch von ${socket.id} mit Name: ${username}`);

    const trimmedUsername = username.trim();
    if (!trimmedUsername || trimmedUsername.length > 16) {
      return callback({ success: false, message: 'Ungültiger Benutzername.' });
    }

    try {
      // Versuche Spieler zu finden ODER zu erstellen
      const [player, created] = await Player.findOrCreate({
        where: { username: trimmedUsername },
        defaults: { username: trimmedUsername } // Wird nur beim Erstellen verwendet
      });

      if (created) {
        console.log(`Neuer Spieler erstellt: ${player.username} (ID: ${player.id})`);
      } else {
        console.log(`Spieler gefunden: ${player.username} (ID: ${player.id})`);
      }

      // Spieler-ID zur Socket-Instanz hinzufügen (nützlich für spätere Anfragen)
      socket.data.playerId = player.id;
      socket.data.username = player.username;

      // Erfolgreiche Antwort mit Spieler-ID senden
      callback({ success: true, playerId: player.id });

    } catch (error) {
      console.error('Fehler bei Player.findOrCreate:', error);
      callback({ success: false, message: 'Datenbankfehler beim Login.' });
    }
  });

  // --- Lobby Erstellen Handler ---
  socket.on('lobby:create', (callback: (response: any) => void) => {
    // Prüfen, ob der Socket bereits einen eingeloggten Spieler repräsentiert
    const playerId = socket.data.playerId;
    const username = socket.data.username;

    if (!playerId || !username) {
      return callback({ success: false, message: 'Nicht eingeloggt.' });
    }

    // TODO: Prüfen, ob der Spieler bereits in einer anderen Lobby ist?

    const lobbyId = uuidv4(); // Eindeutige ID generieren
    const gameMode: GameMode = '1on1'; // Vorerst nur 1on1
    const maxPlayers = 2; // Entsprechend GameMode

    const hostPlayer: LobbyPlayer = {
      id: playerId,
      socketId: socket.id,
      username: username,
      isHost: true,
      isReady: false, // Host ist initial nicht bereit
      selectedFaction: null,
    };

    const newLobby: Lobby = {
      id: lobbyId,
      hostId: playerId,
      mode: gameMode,
      players: new Map<number, LobbyPlayer>([[playerId, hostPlayer]]),
      maxPlayers: maxPlayers,
      createdAt: new Date(),
    };

    activeLobbies.set(lobbyId, newLobby);
    console.log(`Lobby erstellt: ${lobbyId} von ${username} (ID: ${playerId})`);

    socket.join(lobbyId);
    console.log(`Socket ${socket.id} dem Raum ${lobbyId} beigetreten.`);

    callback({ success: true, lobbyId: lobbyId });

    // Alle Clients über die neue/aktualisierte Lobby-Liste informieren
    io.emit('lobby:list', getSerializableLobbyList());
  });

  // --- Lobby Details Abrufen Handler ---
  socket.on('lobby:get-details', (lobbyId: string, callback: (response: any) => void) => {
    const lobby = activeLobbies.get(lobbyId);
    if (lobby) {
      // Sende serialisierte Lobby-Daten zurück
      callback({ success: true, lobby: { ...lobby, players: Array.from(lobby.players.values()) } });
    } else {
      callback({ success: false, message: 'Lobby nicht gefunden.' });
    }
  });

  // --- Lobby Verlassen Handler ---
  socket.on('lobby:leave', (lobbyId: string, callback: (response: any) => void) => {
    const playerId = socket.data.playerId;
    const lobby = activeLobbies.get(lobbyId);

    if (!lobby || !playerId || !lobby.players.has(playerId)) {
      return callback({ success: false, message: 'Konnte Lobby nicht verlassen.' });
    }

    console.log(`Spieler ${playerId} verlässt Lobby ${lobbyId}`);
    lobby.players.delete(playerId);
    socket.leave(lobbyId); // Socket verlässt den Raum

    let lobbyDeleted = false;
    // Host-Wechsel oder Löschen, wenn nötig (ähnlich wie im Disconnect-Handler)
    if (lobby.hostId === playerId) {
      if (lobby.players.size > 0) {
        const newHostEntry = lobby.players.entries().next().value;
        if (newHostEntry) {
          const newHostPlayerId = newHostEntry[0];
          const newHostPlayer = newHostEntry[1];
          newHostPlayer.isHost = true;
          lobby.hostId = newHostPlayerId;
          console.log(`Neuer Host für Lobby ${lobbyId}: ${newHostPlayer.username}`);
        } else {
          activeLobbies.delete(lobbyId);
          lobbyDeleted = true;
        }
      } else {
        activeLobbies.delete(lobbyId);
        lobbyDeleted = true;
      }
    }

    callback({ success: true });

    // Informiere andere Spieler in der Lobby (falls nicht gelöscht)
    if (!lobbyDeleted) {
      io.to(lobbyId).emit('lobby:update', { ...lobby, players: Array.from(lobby.players.values()) });
    }
    // Sende aktualisierte globale Lobby-Liste
    io.emit('lobby:list', getSerializableLobbyList());
  });

  // --- Lobby Beitreten Handler ---
  socket.on('lobby:join', (lobbyId: string, callback: (response: any) => void) => {
      const playerId = socket.data.playerId;
      const username = socket.data.username;
      const lobby = activeLobbies.get(lobbyId);

      // Prüfungen
      if (!playerId || !username) {
          return callback({ success: false, message: 'Nicht eingeloggt.' });
      }
      if (!lobby) {
          return callback({ success: false, message: 'Lobby nicht gefunden.' });
      }
      if (lobby.players.has(playerId)) {
          // Spieler ist bereits in der Lobby (sollte nicht passieren, aber sicherheitshalber)
          socket.join(lobbyId); // Sicherstellen, dass er im Raum ist
          return callback({ success: true, lobbyId: lobby.id }); 
      }
      if (lobby.players.size >= lobby.maxPlayers) {
          return callback({ success: false, message: 'Lobby ist voll.' });
      }
      // TODO: Prüfen, ob Spieler bereits in einer *anderen* Lobby ist?

      // Spieler zur Lobby hinzufügen
      const newPlayer: LobbyPlayer = {
          id: playerId,
          socketId: socket.id,
          username: username,
          isHost: false, // Beitretende Spieler sind nie Host
          isReady: false,
          selectedFaction: null,
      };
      lobby.players.set(playerId, newPlayer);

      // Socket dem Raum beitreten lassen
      socket.join(lobbyId);
      console.log(`Spieler ${username} (ID: ${playerId}) ist Lobby ${lobbyId} beigetreten.`);

      // Erfolgsantwort an den beitretenden Spieler
      callback({ success: true, lobbyId: lobby.id });

      // Alle in der Lobby über den Beitritt informieren (Lobby-Update)
      io.to(lobbyId).emit('lobby:update', { ...lobby, players: Array.from(lobby.players.values()) });

      // Globale Lobby-Liste aktualisieren (Spielerzahl hat sich geändert)
      io.emit('lobby:list', getSerializableLobbyList());
  });

  // --- Fraktion Setzen Handler ---
  socket.on('lobby:set-faction', (data: { lobbyId: string, faction: Faction }) => {
    const { lobbyId, faction } = data;
    const playerId = socket.data.playerId;
    const lobby = activeLobbies.get(lobbyId);

    if (!lobby || !playerId || !lobby.players.has(playerId)) return; // Ignoriere ungültige Anfragen
    
    const player = lobby.players.get(playerId);
    if (player && !player.isReady) { // Nur ändern, wenn nicht bereit
        player.selectedFaction = faction;
        console.log(`Spieler ${player.username} in Lobby ${lobbyId} wählt Fraktion: ${faction}`);
        // Informiere alle in der Lobby über das Update
        io.to(lobbyId).emit('lobby:update', { ...lobby, players: Array.from(lobby.players.values()) });
    }
  });

  // --- Bereitschaftsstatus Setzen Handler ---
  socket.on('lobby:set-ready', (data: { lobbyId: string, isReady: boolean }) => {
      const { lobbyId, isReady } = data;
      const playerId = socket.data.playerId;
      const lobby = activeLobbies.get(lobbyId);
  
      if (!lobby || !playerId || !lobby.players.has(playerId)) return;
      
      const player = lobby.players.get(playerId);
      // Nur ändern, wenn Fraktion gewählt wurde
      if (player && player.selectedFaction) { 
          player.isReady = isReady;
          console.log(`Spieler ${player.username} in Lobby ${lobbyId} ist jetzt ${isReady ? 'bereit' : 'nicht bereit'}.`);
          // Informiere alle in der Lobby über das Update
          io.to(lobbyId).emit('lobby:update', { ...lobby, players: Array.from(lobby.players.values()) });
      } else if (player) {
          console.log(`Spieler ${player.username} kann nicht bereit sein, ohne eine Fraktion gewählt zu haben.`);
          // Optional: Rückmeldung an den Client senden?
      }
  });

  // --- Disconnect Handler ---
  socket.on('disconnect', () => {
    const username = socket.data.username;
    const playerId = socket.data.playerId;
    console.log(`Benutzer ${username || socket.id} (ID: ${playerId}) hat die Verbindung getrennt.`);

    // --- Logik zum Austreten aus Lobbies beim Disconnect ---
    let lobbyUpdated = false;
    for (const [lobbyId, lobby] of activeLobbies.entries()) {
      if (lobby.players.has(playerId)) {
        console.log(`Entferne Spieler ${playerId} aus Lobby ${lobbyId}`);
        lobby.players.delete(playerId);
        lobbyUpdated = true;

        // Wenn der Host die Lobby verlässt
        if (lobby.hostId === playerId) {
          // Wenn noch andere Spieler da sind, neuen Host bestimmen (der erste verbleibende)
          if (lobby.players.size > 0) {
            const newHostEntry = lobby.players.entries().next().value;
            // Explizite Prüfung, auch wenn size > 0 ist
            if (newHostEntry) {
              const newHostPlayerId = newHostEntry[0];
              const newHostPlayer = newHostEntry[1];
              newHostPlayer.isHost = true;
              lobby.hostId = newHostPlayerId;
              console.log(`Neuer Host für Lobby ${lobbyId}: ${newHostPlayer.username} (ID: ${newHostPlayerId})`);
              // Informiere den neuen Host und andere Spieler in der Lobby über den Host-Wechsel
              io.to(lobbyId).emit('lobby:update', { ...lobby, players: Array.from(lobby.players.values()) });
            } else {
               // Sollte theoretisch nicht passieren, wenn size > 0, aber sicher ist sicher
               console.error(`Konnte keinen neuen Host finden in Lobby ${lobbyId}, obwohl Spieler vorhanden sind.`);
               activeLobbies.delete(lobbyId); // Lobby sicherheitshalber löschen
               lobbyUpdated = true; // Sicherstellen, dass die Liste gesendet wird
            }
          } else {
            // Wenn keine Spieler mehr übrig sind, Lobby löschen
            console.log(`Lobby ${lobbyId} ist leer und wird gelöscht.`);
            activeLobbies.delete(lobbyId);
          }
        } else {
          // Nur ein normaler Spieler hat verlassen, informiere die anderen in der Lobby
          io.to(lobbyId).emit('lobby:update', { ...lobby, players: Array.from(lobby.players.values()) });
        }
        // Da ein Spieler entfernt wurde, braucht dieser Socket nicht mehr in der Lobby zu sein
        // (er ist ja disconnected)
        break; // Gehe davon aus, dass ein Spieler nur in einer Lobby sein kann
      }
    }

    // Wenn eine Lobby aktualisiert wurde (Spieler entfernt/Host gewechselt/Lobby gelöscht),
    // sende die neue Liste an alle Clients
    if (lobbyUpdated) {
      io.emit('lobby:list', getSerializableLobbyList());
    }
  });

  // Hier werden später die spezifischen Socket-Handler für Lobby, Match etc. hinzugefügt
});

// Starte den Server nur, wenn die DB-Verbindung steht (connectDB beendet bei Fehler)
server.listen(PORT, () => {
  console.log(`Server läuft auf Port ${PORT}`);
});

// Exportiere io und server für eventuelle Modultests oder Erweiterungen
export { server, io }; 