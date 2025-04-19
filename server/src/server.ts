import express from 'express';
import http from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import dotenv from 'dotenv';
import { connectDB } from './db/connect'; // Importiere die DB-Verbindungsfunktion
import { Player } from './models/Player'; // Importiere das Player-Modell
import { Lobby, LobbyPlayer, GameMode } from './types/lobby.types'; // Importiere Lobby-Typen
import { v4 as uuidv4 } from 'uuid'; // Importiere uuid zur ID-Generierung
import { Faction } from './types/common.types'; // Import Faction
import { GameState, PlayerInGame, GamePhase, PlacedUnit, FigureState, FigureBehaviorState, ProjectileState } from './types/game.types'; // Importiere Spiel-Typen
import { Unit, placeholderUnits, parseFormation } from './units/unit.types'; // Import Unit types and data

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

// Konstanten
const TICK_INTERVAL_MS = 50; // Geändert von 100 auf 50 ms (20 Ticks pro Sekunde)

// --- In-Memory Speicher für Lobbies und Spiele ---
const activeLobbies = new Map<string, Lobby>();
const activeGames = new Map<string, GameState>();
// Map zum Speichern der Vorbereitungs-Timer für jedes Spiel
const preparationTimers = new Map<string, NodeJS.Timeout>();

// Hilfsfunktion zum Erstellen einer serialisierbaren Lobby-Liste
const getSerializableLobbyList = () => {
  // Maps sind nicht direkt JSON-serialisierbar, wandle Spieler-Map in Array um
  return Array.from(activeLobbies.values()).map(lobby => ({
    ...lobby,
    players: Array.from(lobby.players.values()), // Spieler-Map in Array umwandeln
  }));
};

// Hilfsfunktion zum Senden von GameState-Updates an einen Raum
const emitGameStateUpdate = (gameId: string, gameState: GameState) => {
    // Stelle sicher, dass activeProjectiles immer ein Array ist
    const currentProjectiles = gameState.activeProjectiles || []; 
    const serializableState = {
      ...gameState,
      players: Array.from(gameState.players.values()),
      activeProjectiles: currentProjectiles, // Projektile mitsenden
    };
    // Lösche undefined Felder vor dem Senden (optional, aber sauber)
    if (serializableState.preparationEndTime === undefined) {
        delete serializableState.preparationEndTime;
    }
    
    io.to(gameId).emit('game:state-update', serializableState);
    // console.log(`'game:state-update' an Raum ${gameId} gesendet.`); // DEBUG Log entfernt
};

// Funktion zum Starten der Kampfphase
const startCombatPhase = (gameId: string) => {
    const gameState = activeGames.get(gameId);
    if (gameState && gameState.phase === 'Preparation') {
        console.log(`Spiel ${gameId}: Vorbereitung beendet. Speichere Einheiten & starte Kampfphase.`);
        
        // Speichere den Zustand der Einheiten zu Kampfbeginn
        gameState.players.forEach(player => {
            // Tiefe Kopie erstellen!
            player.unitsAtCombatStart = JSON.parse(JSON.stringify(player.placedUnits));
            // Stelle sicher, dass Figuren volle HP haben (optional, je nach Design)
            /* 
            player.unitsAtCombatStart.forEach(unit => {
                const unitData = placeholderUnits.find(ud => ud.id === unit.unitId);
                if(unitData) {
                    unit.figures.forEach(figure => figure.currentHP = unitData.hp);
                }
            });
            */
        });
        
        gameState.phase = 'Combat';
        gameState.preparationEndTime = undefined; 
        
        // Timer löschen
        // ... (clearTimeout, preparationTimers.delete)

        emitGameStateUpdate(gameId, gameState);
    }
};

// NEU: Funktion zur Berechnung des Abstands zwischen zwei Punkten (Quadrat)
const calculateDistanceSq = (pos1: { x: number, z: number }, pos2: { x: number, z: number }): number => {
    const dx = pos1.x - pos2.x;
    const dz = pos1.z - pos2.z;
    return dx * dx + dz * dz;
};

// NEU: Hauptfunktion für den Kampftick
const updateCombatState = (gameId: string, deltaTimeSeconds: number) => {
    const gameState = activeGames.get(gameId);
    if (!gameState || gameState.phase !== 'Combat') return;

    let unitsChanged = false;
    let projectilesChanged = false;
    const now = Date.now();

    // 1. Figuren-Map erstellen
    const figureMap = new Map<string, FigureState>();
    gameState.players.forEach(player => {
        player.placedUnits.forEach(unit => {
            unit.figures.forEach(figure => {
                if (figure.currentHP > 0) { 
                    figureMap.set(figure.figureId, figure);
                }
            });
        });
    });
    if (figureMap.size === 0) return;

    // 1.5 Projektile aktualisieren & Treffererkennung (VOR Figuren-Updates)
    if (!gameState.activeProjectiles) { gameState.activeProjectiles = []; }
    const remainingProjectiles: ProjectileState[] = [];
    gameState.activeProjectiles.forEach(projectile => {
        const travelTimeSeconds = (now - projectile.createdAt) / 1000.0;
        const totalDistance = Math.sqrt(calculateDistanceSq(projectile.originPos, projectile.targetPos));
        const distanceCovered = projectile.speed * travelTimeSeconds;

        if (distanceCovered >= totalDistance) {
            projectilesChanged = true;
            const targetFigure = figureMap.get(projectile.targetFigureId);
            if (targetFigure) { 
                targetFigure.currentHP -= projectile.damage;
                unitsChanged = true;
                if (targetFigure.currentHP <= 0) {
                     figureMap.delete(targetFigure.figureId); 
                }
            }
        } else {
            projectilesChanged = true;
            const ratio = distanceCovered / totalDistance;
            projectile.currentPos.x = projectile.originPos.x + (projectile.targetPos.x - projectile.originPos.x) * ratio;
            projectile.currentPos.z = projectile.originPos.z + (projectile.targetPos.z - projectile.originPos.z) * ratio;
            remainingProjectiles.push(projectile); 
        }
    });
    gameState.activeProjectiles = remainingProjectiles;

    // 2. Figuren aktualisieren (Zielsuche, Bewegungswunsch, Angriff)
    const nextPositions = new Map<string, { x: number; z: number }>();
    figureMap.forEach(figure => { // Erster Durchlauf
        if (!figureMap.has(figure.figureId)) { // Von Projektil getroffen?
             nextPositions.set(figure.figureId, figure.position); // Keine Bewegung für tote Figur
             return; 
        }
        const unitData = placeholderUnits.find(u => u.id === figure.unitTypeId);
        if (!unitData) return; 
        
        // --- Zielsuche (wie im vorherigen Schritt korrigiert) ---
        const potentialTargets = Array.from(figureMap.values()).filter(f => f.playerId !== figure.playerId);
        if (potentialTargets.length === 0) { figure.behavior='idle'; figure.targetFigureId=null; nextPositions.set(figure.figureId, figure.position); return; }
        let nearestTargetOverall: FigureState | null = null;
        let minDistanceSqOverall = Infinity;
        potentialTargets.forEach((target: FigureState) => {
             const distSq = calculateDistanceSq(figure.position, target.position);
             if (distSq < minDistanceSqOverall) { minDistanceSqOverall = distSq; nearestTargetOverall = target; }
        });
        if ((!figure.targetFigureId || figure.behavior !== 'attacking') && nearestTargetOverall) {
             // @ts-ignore
             if (nearestTargetOverall.figureId !== figure.targetFigureId) {
                  // @ts-ignore
                  figure.targetFigureId = nearestTargetOverall.figureId;
                  figure.behavior = 'moving'; 
                  unitsChanged = true;
             }
        }
        
        // --- Bewegungswunsch berechnen --- 
        let intendedNextX = figure.position.x;
        let intendedNextZ = figure.position.z;
        if (figure.targetFigureId) {
            const currentTarget = figureMap.get(figure.targetFigureId);
            if (currentTarget) { // Ziel muss noch existieren
                const distanceToTargetSq = calculateDistanceSq(figure.position, currentTarget.position);
                const attackRangeSq = unitData.range * unitData.range;
                if (figure.behavior === 'moving' && distanceToTargetSq > attackRangeSq) {
                    const targetPos = currentTarget.position;
                    const currentPos = figure.position;
                    const dx = targetPos.x - currentPos.x;
                    const dz = targetPos.z - currentPos.z;
                    const distance = Math.sqrt(distanceToTargetSq);
                    if (distance > 0.01) {
                         const moveAmount = unitData.speed * deltaTimeSeconds;
                         intendedNextX = figure.position.x + (dx / distance) * moveAmount;
                         intendedNextZ = figure.position.z + (dz / distance) * moveAmount;
                    }
                }
            }
        }
        nextPositions.set(figure.figureId, { x: intendedNextX, z: intendedNextZ });

        // --- Angriff (Projektil erstellen) ---
        if (figure.targetFigureId) {
             const currentTarget = figureMap.get(figure.targetFigureId);
             // Nur angreifen, wenn Ziel existiert, Verhalten 'attacking' ist und Cooldown bereit
             if (currentTarget && currentTarget.currentHP > 0 && figure.behavior === 'attacking' && now >= figure.attackCooldownEnd) {
                // Projektil erstellen (Logik wie vorher)
                const bulletSpeed = unitData.bulletSpeed ?? 10;
                const newProjectile: ProjectileState = { projectileId: uuidv4(), playerId: figure.playerId, unitTypeId: figure.unitTypeId, damage: unitData.damage, speed: bulletSpeed, originPos: { ...figure.position }, targetPos: { ...currentTarget.position }, currentPos: { ...figure.position }, targetFigureId: currentTarget.figureId, createdAt: now };
                gameState.activeProjectiles.push(newProjectile);
                projectilesChanged = true;
                figure.attackCooldownEnd = now + (1000 / unitData.attackSpeed);
             } else if (currentTarget && currentTarget.currentHP <= 0) {
                 // Wenn Ziel existiert, aber keine HP mehr hat
                 figure.targetFigureId = null;
                 figure.behavior = 'idle';
                 unitsChanged = true;
             }
        }

    }); // Ende erster Durchlauf

    // 3. Kollisionsbehandlung & Finale Position + Behavior setzen
    figureMap.forEach(figure => {
        if (!figureMap.has(figure.figureId)) return; 
        const unitData = placeholderUnits.find(u => u.id === figure.unitTypeId);
        if (!unitData) return; 
        const currentPos = figure.position; 
        const intendedPos = nextPositions.get(figure.figureId)!;
        const figureCollisionRange = unitData.collisionRange ?? 0.4; 

        let separationX = 0;
        let separationZ = 0;
        let collisionCount = 0;

        // Prüfe Kollision mit ALLEN ANDEREN Figuren in der Map
        figureMap.forEach(otherFigure => {
            if (figure.figureId === otherFigure.figureId) return; 
            if (!nextPositions.has(otherFigure.figureId)) return; // Skip, wenn andere Figur schon tot/entfernt

            const otherUnitData = placeholderUnits.find(u => u.id === otherFigure.unitTypeId);
            const otherCollisionRange = otherUnitData?.collisionRange ?? 0.4;
            const otherPos = nextPositions.get(otherFigure.figureId)!; // Nutze geplante Position des anderen
            
            const distSq = calculateDistanceSq(intendedPos, otherPos);
            const requiredDist = figureCollisionRange + otherCollisionRange;
            const requiredDistSq = requiredDist * requiredDist;

            if (distSq < requiredDistSq && distSq > 0.0001) { 
                collisionCount++;
                const distance = Math.sqrt(distSq);
                const overlap = requiredDist - distance;
                // Stärke der Wegstoßung - kann angepasst werden
                const pushStrength = 0.5; 
                const pushFactor = (overlap / distance) * pushStrength;
                
                separationX += (intendedPos.x - otherPos.x) * pushFactor;
                separationZ += (intendedPos.z - otherPos.z) * pushFactor;
            }
        });

        let finalX = intendedPos.x;
        let finalZ = intendedPos.z;
        if (collisionCount > 0) {
            // Wende Separation an (Vorsicht: Kann zu stark sein)
            finalX += separationX; 
            finalZ += separationZ;
            // Optional: Begrenze die Distanz der Verschiebung pro Tick
            // const sepDistSq = separationX*separationX + separationZ*separationZ;
            // const maxSepSpeed = 0.5 * deltaTimeSeconds; // Beispiel: Max 0.5 Einheiten pro Sekunde
            // if (sepDistSq > maxSepSpeed * maxSepSpeed) { ... normalisieren ... }
            unitsChanged = true;
        }
        
        // Position aktualisieren, wenn Änderung signifikant
        if (Math.abs(finalX - currentPos.x) > 0.001 || Math.abs(finalZ - currentPos.z) > 0.001) {
            figure.position.x = finalX;
            figure.position.z = finalZ;
            unitsChanged = true;
        }
        
        // Finale Behavior setzen basierend auf Distanz nach Kollisionsanpassung
        if (figure.targetFigureId) {
            const currentTarget = figureMap.get(figure.targetFigureId);
            if (currentTarget) {
                const distanceToTargetSq = calculateDistanceSq(figure.position, currentTarget.position);
                const attackRangeSq = unitData.range * unitData.range;
                const newBehavior = (distanceToTargetSq <= attackRangeSq) ? 'attacking' : 'moving';
                if (figure.behavior !== newBehavior) {
                    figure.behavior = newBehavior;
                    unitsChanged = true;
                }
            } else { // Ziel verschwunden
                 if (figure.behavior !== 'idle') {
                    figure.behavior = 'idle';
                    figure.targetFigureId = null;
                    unitsChanged = true;
                 }
            }
        } else { // Kein Ziel
             if (figure.behavior !== 'idle') {
                figure.behavior = 'idle';
                unitsChanged = true;
             }
        }
        
    }); // Ende zweiter Durchlauf

    // 4. Spielzustand aufräumen (tote Figuren entfernen)
    let figuresRemoved = false;
    gameState.players.forEach(player => {
        player.placedUnits.forEach(unit => {
            const initialCount = unit.figures.length;
            unit.figures = unit.figures.filter(f => figureMap.has(f.figureId)); // Nur behalten, was noch in der Map ist
            if (unit.figures.length < initialCount) {
                figuresRemoved = true;
            }
        });
        player.placedUnits = player.placedUnits.filter(unit => unit.figures.length > 0);
    });

    // 5. Prüfe auf Rundenende 
    let player1AliveUnits = 0;
    let player2AliveUnits = 0;
    let player1Id: number | null = null;
    let player2Id: number | null = null;
    const playerIds = Array.from(gameState.players.keys());
    if (playerIds.length === 2) {
        player1Id = playerIds[0];
        player2Id = playerIds[1];
        // Zähle Figuren direkt aus der figureMap oder dem aktualisierten gameState
        gameState.players.get(player1Id)?.placedUnits.forEach(u => player1AliveUnits += u.figures.length);
        gameState.players.get(player2Id)?.placedUnits.forEach(u => player2AliveUnits += u.figures.length);
    }
    
    if (player1AliveUnits === 0 || player2AliveUnits === 0) {
        const currentRound = gameState.round;
        console.log(`[Tick ${gameId}] Runde ${currentRound} beendet! Spieler 1: ${player1AliveUnits}, Spieler 2: ${player2AliveUnits}`);
        
        // Einkommen berechnen (200 pro abgeschlossener Runde)
        const incomePerPlayer = currentRound * 200;
        console.log(`[Tick ${gameId}] Vergebenes Einkommen für Runde ${currentRound + 1}: ${incomePerPlayer}`);

        // Phase wechseln, Runde erhöhen
        gameState.round++;
        gameState.phase = 'Preparation';
        gameState.preparationEndTime = Date.now() + 60000; 
        
        // Zustand für neue Runde zurücksetzen & Einkommen gutschreiben
        gameState.players.forEach(player => {
            // Einkommen hinzufügen
            player.credits += incomePerPlayer;
            // Einheiten zurücksetzen
            player.placedUnits = JSON.parse(JSON.stringify(player.unitsAtCombatStart || []));
            player.unitsPlacedThisRound = 0;
            // Figuren zurücksetzen
            player.placedUnits.forEach(unit => {
                const unitData = placeholderUnits.find(ud => ud.id === unit.unitId);
                let figIndex = 0;
                const cols = Math.ceil(Math.sqrt(unit.figures.length));
                const figureSpacing = 1.0;
                unit.figures.forEach(figure => {
                    if (unitData) figure.currentHP = unitData.hp;
                    figure.behavior = 'idle';
                    figure.targetFigureId = null;
                    const c = figIndex % cols;
                    const r = Math.floor(figIndex / cols);
                    const offsetX = (c - (cols - 1) / 2) * figureSpacing;
                    const offsetZ = (r - Math.floor((unit.figures.length - 1) / cols / 2)) * figureSpacing;
                    figure.position.x = unit.initialPosition.x + offsetX;
                    figure.position.z = unit.initialPosition.z + offsetZ;
                    figIndex++;
                });
            });
        });
        gameState.activeProjectiles = [];

        // Neuen Timer starten
        const timerId = setTimeout(() => {
            startCombatPhase(gameState.gameId);
        }, 60000);
        preparationTimers.set(gameState.gameId, timerId);

        unitsChanged = true; 
        projectilesChanged = true; 
    }
    
    // 6. Sende Update
    if (unitsChanged || figuresRemoved || projectilesChanged) {
        emitGameStateUpdate(gameId, gameState);
    }
};

// --- Globaler Game Loop --- 
setInterval(() => {
    // console.log('[Game Loop Interval] Tick fired'); // DEBUG Log entfernt
    activeGames.forEach((gameState, gameId) => {
        // console.log(`[Game Loop Interval] Checking game ${gameId}, Phase: ${gameState.phase}`); // DEBUG Log entfernt
        if (gameState.phase === 'Combat') {
            const deltaTimeSeconds = TICK_INTERVAL_MS / 1000.0;
            updateCombatState(gameId, deltaTimeSeconds);
        }
    });
}, TICK_INTERVAL_MS);

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

  // --- Spiel Starten Handler ---
  socket.on('lobby:start-game', (lobbyId: string, callback: (response: any) => void) => {
      const playerId = socket.data.playerId;
      const lobby = activeLobbies.get(lobbyId);

      // Prüfungen
      if (!lobby) {
          return callback({ success: false, message: 'Lobby nicht gefunden.' });
      }
      if (lobby.hostId !== playerId) {
          return callback({ success: false, message: 'Nur der Host kann das Spiel starten.' });
      }
      if (lobby.players.size !== lobby.maxPlayers) {
          return callback({ success: false, message: 'Nicht genügend Spieler in der Lobby.' });
      }

      // Prüfen, ob alle Spieler bereit sind
      let allReady = true;
      for (const player of lobby.players.values()) {
          if (!player.isReady) {
              allReady = false;
              break;
          }
      }

      if (!allReady) {
          return callback({ success: false, message: 'Nicht alle Spieler sind bereit.' });
      }

      console.log(`Spiel wird in Lobby ${lobbyId} gestartet!`);
      const initialCredits = 200;
      const initialBaseHealth = 1000;
      const preparationDurationMs = 60 * 1000;

      // Erstelle den initialen Spielzustand
      const playersInGame = new Map<number, PlayerInGame>();
      for (const lobbyPlayer of lobby.players.values()) {
          if (!lobbyPlayer.selectedFaction) {
              // Sollte nicht passieren, da alle bereit sein müssen (was Fraktionswahl impliziert)
              console.error(`Fehler: Spieler ${lobbyPlayer.username} ist bereit, hat aber keine Fraktion!`);
              return callback({ success: false, message: 'Fehler bei Spielerdaten.' });
          }
          playersInGame.set(lobbyPlayer.id, {
              id: lobbyPlayer.id,
              username: lobbyPlayer.username,
              faction: lobbyPlayer.selectedFaction!, 
              credits: initialCredits,
              baseHealth: initialBaseHealth,
              unlockedUnits: [],
              placedUnits: [],
              unitsPlacedThisRound: 0,
              unitsAtCombatStart: [], // Initialisiere mit leerem Array
          });
      }

      const initialGameState: GameState = {
          gameId: lobby.id,
          hostId: lobby.hostId,
          mode: lobby.mode,
          round: 1,
          phase: 'Preparation',
          preparationEndTime: Date.now() + preparationDurationMs,
          players: playersInGame,
          activeProjectiles: [],
      };

      activeGames.set(lobby.id, initialGameState);
      activeLobbies.delete(lobbyId);
      // Sicherstellen, dass preparationEndTime hier nicht undefined ist für das Logging
      const endTimeString = initialGameState.preparationEndTime ? new Date(initialGameState.preparationEndTime).toLocaleTimeString() : 'FEHLER';
      console.log(`Lobby ${lobbyId} in Spiel ${initialGameState.gameId} umgewandelt. Vorbereitung endet um ${endTimeString}`);

      // Starte den Timer für die Vorbereitungsphase
      const timerId = setTimeout(() => {
          startCombatPhase(initialGameState.gameId);
      }, preparationDurationMs);
      preparationTimers.set(initialGameState.gameId, timerId);

      // Sende den initialen Spielzustand an alle Spieler im (ehemaligen) Lobby-Raum
      // Wandle Spieler-Map für die Übertragung um
      const serializableGameState = {
          ...initialGameState,
          players: Array.from(initialGameState.players.values()),
      };
      io.to(lobbyId).emit('game:start', serializableGameState);
      console.log(`'game:start' Event mit initialem GameState an Raum ${lobbyId} gesendet.`);

      // Globale Lobby-Liste aktualisieren (da eine Lobby entfernt wurde)
      io.emit('lobby:list', getSerializableLobbyList());

      // Erfolgsrückmeldung an den Host
      callback({ success: true });
  });

  // --- NEU: Kampfphase erzwingen Handler (nur Host) ---
  socket.on('game:force-start-combat', (gameId: string, callback: (response: any) => void) => {
      const playerId = socket.data.playerId;
      const gameState = activeGames.get(gameId);

      // Prüfungen
      if (!gameState) {
          return callback({ success: false, message: 'Spiel nicht gefunden.' });
      }
      if (gameState.hostId !== playerId) {
          return callback({ success: false, message: 'Nur der Host kann die Kampfphase starten.' });
      }
      if (gameState.phase !== 'Preparation') {
          return callback({ success: false, message: 'Das Spiel ist nicht in der Vorbereitungsphase.' });
      }

      // Kampfphase starten (stoppt auch den Timer)
      startCombatPhase(gameId);
      callback({ success: true });
  });

  // --- Einheit Freischalten Handler ---
  socket.on('game:unlock-unit', (data: { gameId: string, unitId: string }, callback: (response: any) => void) => {
      const { gameId, unitId } = data;
      const playerId = socket.data.playerId;
      const gameState = activeGames.get(gameId);

      if (!gameState || !playerId || !gameState.players.has(playerId)) {
          return callback({ success: false, message: 'Spiel oder Spieler nicht gefunden.' });
      }

      const playerState = gameState.players.get(playerId)!;
      const unitToUnlock = placeholderUnits.find(u => u.id === unitId);

      if (!unitToUnlock) {
          return callback({ success: false, message: 'Einheit nicht gefunden.' });
      }
      if (unitToUnlock.faction !== playerState.faction) {
          return callback({ success: false, message: 'Einheit gehört nicht zu deiner Fraktion.' });
      }
      if (playerState.unlockedUnits.includes(unitId)) {
          return callback({ success: false, message: 'Einheit bereits freigeschaltet.' });
      }
      if (playerState.credits < unitToUnlock.unlockCost) {
          return callback({ success: false, message: 'Nicht genügend Credits zum Freischalten.' });
      }

      // Alles ok -> Freischalten!
      playerState.credits -= unitToUnlock.unlockCost;
      playerState.unlockedUnits.push(unitId);
      console.log(`Spieler ${playerState.username} (ID: ${playerId}) in Spiel ${gameId} schaltet Einheit ${unitId} frei. (${playerState.credits} Credits verbleibend)`);

      // Update an alle im Spiel senden
      emitGameStateUpdate(gameId, gameState);

      // Erfolgsrückmeldung
      callback({ success: true });
  });

  // --- Einheit Platzieren Handler ---
  socket.on('game:place-unit', (data: { gameId: string, unitId: string, position: { x: number, z: number } }, callback: (response: any) => void) => {
    const { gameId, unitId, position } = data;
    const playerId = socket.data.playerId;
    const gameState = activeGames.get(gameId);

    // Grundlegende Prüfungen
    if (!gameState || !playerId || !gameState.players.has(playerId)) {
        return callback({ success: false, message: 'Spiel oder Spieler nicht gefunden.' });
    }
    if (gameState.phase !== 'Preparation') {
        return callback({ success: false, message: 'Einheiten können nur in der Vorbereitungsphase platziert werden.' });
    }

    const playerState = gameState.players.get(playerId)!;
    const unitData = placeholderUnits.find(u => u.id === unitId);

    if (!unitData) {
        return callback({ success: false, message: 'Unbekannter Einheitentyp.' });
    }
    if (!playerState.unlockedUnits.includes(unitId)) {
        return callback({ success: false, message: 'Einheit nicht für dieses Match freigeschaltet.' });
    }
    if (playerState.credits < unitData.placementCost) {
        return callback({ success: false, message: 'Nicht genügend Credits zum Platzieren.' });
    }

    // Geändertes Platzierungslimit
    const PLACEMENT_LIMIT_PER_ROUND = 3;
    if (playerState.unitsPlacedThisRound >= PLACEMENT_LIMIT_PER_ROUND) {
        return callback({ success: false, message: `Du kannst nur ${PLACEMENT_LIMIT_PER_ROUND} Einheiten pro Runde platzieren.` });
    }

    // --- Konsistente Platzierungsvalidierung (Annahme: position = Mittelpunkt) ---
    // Grid-Definitionen
    const GRID_WIDTH = 50; // Breite des Grids
    const PLAYER_ZONE_DEPTH = 20; // Tiefe der Platzierungszone eines Spielers
    const NEUTRAL_ZONE_DEPTH = 10; // Tiefe der neutralen Zone in der Mitte
    const TOTAL_DEPTH = PLAYER_ZONE_DEPTH * 2 + NEUTRAL_ZONE_DEPTH;

    // Berechne Grid-Grenzen (Koordinaten der Zellenmittelpunkte)
    // Beispiel: width=50 -> von -25 bis +24
    const gridMinX = -Math.floor(GRID_WIDTH / 2);
    const gridMaxX = Math.floor((GRID_WIDTH - 1) / 2);
    const gridMinZ = 0;
    const gridMaxZ = TOTAL_DEPTH - 1;

    // Bestimme Platzierungszone des Spielers
    let playerMinZ, playerMaxZ;
    const isHostPlacing = playerId === gameState.hostId;
    if (isHostPlacing) {
        playerMinZ = gridMinZ; // 0
        playerMaxZ = PLAYER_ZONE_DEPTH - 1;
    } else {
        playerMinZ = PLAYER_ZONE_DEPTH + NEUTRAL_ZONE_DEPTH;
        playerMaxZ = gridMaxZ; // TOTAL_DEPTH - 1
    }

    // 1. Liegt der ZIEL-MITTELPUNKT (position) in der erlaubten Zone?
    if (position.x < gridMinX || position.x > gridMaxX || position.z < playerMinZ || position.z > playerMaxZ) {
        console.warn(`Platzierungsversuch (${position.x}, ${position.z}) außerhalb der Zone [x: ${gridMinX}-${gridMaxX}, z: ${playerMinZ}-${playerMaxZ}] für Spieler ${playerId}`);
        return callback({ success: false, message: 'Zielposition außerhalb deines Platzierungsbereichs.' });
    }

    // Berechne die Bounding Box der neuen Einheit (Kantenkoordinaten)
    // Bei ungerader Breite/Höhe liegt der Mittelpunkt auf einer Koordinate,
    // bei gerader Breite/Höhe liegt er zwischen zwei Koordinaten.
    const unitHalfWidth = unitData.width / 2;
    const unitHalfDepth = unitData.height / 2; // height repräsentiert Tiefe auf Z-Achse
    const newUnitBox = {
        minX: position.x - unitHalfWidth,
        maxX: position.x + unitHalfWidth,
        minZ: position.z - unitHalfDepth,
        maxZ: position.z + unitHalfDepth
    };

    // 2. Passt die Einheit VOLLSTÄNDIG in die GRID-Grenzen UND die SPIELER-Zone?
    // Beachte: Die Box-Koordinaten können halbe Werte sein (z.B. 1.5)
    // Wir vergleichen mit den Grenzen der Zellenmittelpunkte.
    // Eine Einheit, die bei x=1.5 endet, belegt Zelle 1.
    // Eine Einheit, die bei x=2.0 endet, belegt Zelle 1.
    // Eine Einheit, die bei x=2.1 endet, belegt Zelle 2.
    // Wir runden min ab und max auf, um die äußersten *belegten* Zell-Indizes zu bekommen.
    const occupiedMinX = Math.floor(newUnitBox.minX);
    const occupiedMaxX = Math.ceil(newUnitBox.maxX) -1; // Index der letzten belegten Zelle
    const occupiedMinZ = Math.floor(newUnitBox.minZ);
    const occupiedMaxZ = Math.ceil(newUnitBox.maxZ) -1; // Index der letzten belegten Zelle

    if (occupiedMinX < gridMinX || occupiedMaxX > gridMaxX || occupiedMinZ < playerMinZ || occupiedMaxZ > playerMaxZ) {
         console.warn(`Einheit ${unitData.id} bei (${position.x}, ${position.z}) ragt aus Grid/Zone. Belegte Zellen: [x: ${occupiedMinX}-${occupiedMaxX}, z: ${occupiedMinZ}-${occupiedMaxZ}], Zone: [x: ${gridMinX}-${gridMaxX}, z: ${playerMinZ}-${playerMaxZ}]`);
         return callback({ success: false, message: 'Einheit ragt aus dem Grid oder deiner Platzierungszone.' });
    }

    // 3. Kollisionsprüfung mit allen bereits platzierten Einheiten (Bounding Box)
    let collisionDetected = false;
    for (const player of gameState.players.values()) {
        for (const placedUnit of player.placedUnits) {
            const existingUnitData = placeholderUnits.find(u => u.id === placedUnit.unitId);
            if (!existingUnitData) continue;

            // Berechne Bounding Box der EXISTIERENDEN Einheit 
            // basierend auf ihrer `initialPosition` (der ursprüngliche Mittelpunkt)
            const existingUnitHalfWidth = existingUnitData.width / 2;
            const existingUnitHalfDepth = existingUnitData.height / 2;
            const existingUnitBox = {
                minX: placedUnit.initialPosition.x - existingUnitHalfWidth,
                maxX: placedUnit.initialPosition.x + existingUnitHalfWidth,
                minZ: placedUnit.initialPosition.z - existingUnitHalfDepth,
                maxZ: placedUnit.initialPosition.z + existingUnitHalfDepth
            };

            // AABB Kollisionstest zwischen neuer Box und existierender Box
            const noOverlap = 
                newUnitBox.maxX <= existingUnitBox.minX || 
                newUnitBox.minX >= existingUnitBox.maxX || 
                newUnitBox.maxZ <= existingUnitBox.minZ || 
                newUnitBox.minZ >= existingUnitBox.maxZ;

            if (!noOverlap) {
                 // Verwende placedUnit.initialPosition im Log
                 console.warn(`Kollision erkannt! Neue Einheit ${unitData.id} bei (${position.x}, ${position.z}) kollidiert mit existierender ${existingUnitData.id} (Inst: ${placedUnit.instanceId}) bei (${placedUnit.initialPosition.x}, ${placedUnit.initialPosition.z})`);
                 collisionDetected = true;
                 break; 
            }
        }
        if (collisionDetected) break; 
    }

    if (collisionDetected) {
        return callback({ success: false, message: 'Position ist bereits durch eine andere Einheit blockiert.' });
    }

    // --- Ende der Validierung --- 

    // Alles ok -> Platzieren!
    playerState.credits -= unitData.placementCost;
    playerState.unitsPlacedThisRound++; // Zähler erhöhen
    
    // --- NEUE Logik zum Erstellen der Figuren mit Formation ---
    const figures: FigureState[] = [];
    const unitInstanceId = uuidv4(); 
    const formationInfo = parseFormation(unitData.formation);

    // Wichtig: unitData.squadSize verwenden!
    const useFormation = formationInfo && formationInfo.cols * formationInfo.rows >= unitData.squadSize;

    let cols = 1;
    let rows = 1;
    let spacingX = 1.0; // Standardabstand
    let spacingZ = 1.0; // Standardabstand

    if (useFormation && formationInfo) {
        cols = formationInfo.cols;
        rows = formationInfo.rows;
        spacingX = unitData.width > 0 ? unitData.width / cols : 1.0; // Verhindere Division durch 0
        spacingZ = unitData.height > 0 ? unitData.height / rows : 1.0; // Verhindere Division durch 0
        console.log(`Using formation ${cols}x${rows} for ${unitData.id}. Spacing X=${spacingX.toFixed(2)}, Z=${spacingZ.toFixed(2)} within Area W=${unitData.width}, H=${unitData.height}`);
    } else {
        console.warn(`Invalid formation '${unitData.formation}' for unit ${unitData.id} or squad size mismatch (${unitData.squadSize}). Using fallback arrangement.`);
        cols = Math.ceil(Math.sqrt(unitData.squadSize));
        rows = Math.ceil(unitData.squadSize / cols);
        spacingX = unitData.width > 0 ? unitData.width / cols : 1.0;
        spacingZ = unitData.height > 0 ? unitData.height / rows : 1.0;
    }

    const startOffsetX = -unitData.width / 2 + spacingX / 2;
    const startOffsetZ = -unitData.height / 2 + spacingZ / 2;

    for (let i = 0; i < unitData.squadSize; i++) {
        const col = i % cols;
        const row = Math.floor(i / cols);

        const offsetX = startOffsetX + col * spacingX;
        const offsetZ = startOffsetZ + row * spacingZ;

        const finalX = position.x + offsetX;
        const finalZ = position.z + offsetZ;
        
        console.log(`  Figure ${i}: Col=${col}, Row=${row} -> OffsetX=${offsetX.toFixed(2)}, OffsetZ=${offsetZ.toFixed(2)} -> PosX=${finalX.toFixed(2)}, PosZ=${finalZ.toFixed(2)}`);

        const figure: FigureState = {
            figureId: uuidv4(),
            unitInstanceId: unitInstanceId,
            playerId: playerId,
            unitTypeId: unitId,
            position: { x: finalX, z: finalZ },
            currentHP: unitData.hp, 
            behavior: 'idle',
            targetFigureId: null,
            attackCooldownEnd: 0 
        };
        figures.push(figure);
    }
    // --- Ende NEUE Logik ---

    const newPlacedUnit: PlacedUnit = {
        instanceId: unitInstanceId, 
        unitId: unitId,
        playerId: playerId,
        initialPosition: position, // Speichert den Klickpunkt als Mittelpunkt
        figures: figures, 
    };
    playerState.placedUnits.push(newPlacedUnit);
    console.log(`Spieler ${playerState.username} platziert Einheit ${unitId} (Nr. ${playerState.unitsPlacedThisRound} diese Runde).`);

    emitGameStateUpdate(gameId, gameState);
    callback({ success: true });
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

    // Spiel-Timer beim Disconnect aufräumen
    for (const [gameId, timerId] of preparationTimers.entries()) {
       const game = activeGames.get(gameId);
       // Wenn der Spieler in diesem Spiel war oder das Spiel nicht mehr existiert?
       // Sicherer: Prüfen ob der Spieler Teil des Spiels war.
       if (game && game.players.has(socket.data.playerId)) { 
          // Hier entscheiden, was passieren soll. Spiel beenden? Timer stoppen?
          // Vorerst: Nur den Timer für dieses Spiel stoppen, wenn der Spieler geht?
          // Besser: Spiel beenden oder pausieren? Für MVP: Timer löschen.
          console.log(`Spieler ${socket.data.username} hat Verbindung getrennt, stoppe Vorbereitungstimer für Spiel ${gameId}`);
          clearTimeout(timerId);
          preparationTimers.delete(gameId);
          // TODO: Robusteres Handling für Spielabbrüche / Disconnects
       }
    }

    // TODO: Austrittslogik für laufende Spiele...
  });

  // Hier werden später die spezifischen Socket-Handler für Lobby, Match etc. hinzugefügt
});

// Starte den Server nur, wenn die DB-Verbindung steht (connectDB beendet bei Fehler)
server.listen(PORT, () => {
  console.log(`Server läuft auf Port ${PORT}`);
});

// Exportiere io und server für eventuelle Modultests oder Erweiterungen
export { server, io }; 