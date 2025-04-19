import { Socket } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import { Lobby, LobbyPlayer, GameMode } from '../types/lobby.types';
import { Faction } from '../types/common.types';

export class LobbyManager {
    private activeLobbies = new Map<string, Lobby>();

    public createLobby(playerId: number, username: string, socketId: string): Lobby {
        const lobbyId = uuidv4();
        const gameMode: GameMode = '1on1'; // Vorerst nur 1on1
        const maxPlayers = 2;

        const hostPlayer: LobbyPlayer = {
            id: playerId,
            socketId: socketId,
            username: username,
            isHost: true,
            isReady: false,
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

        this.activeLobbies.set(lobbyId, newLobby);
        console.log(`LobbyManager: Lobby erstellt: ${lobbyId} von ${username} (ID: ${playerId})`);
        return this.getSerializableLobby(newLobby); // Rückgabe serialisierbarer Lobby
    }

    public joinLobby(lobbyId: string, playerId: number, username: string, socketId: string): { success: boolean; lobby?: Lobby; message?: string } {
        const lobby = this.activeLobbies.get(lobbyId);

        if (!lobby) {
            return { success: false, message: 'Lobby nicht gefunden.' };
        }
        if (lobby.players.has(playerId)) {
            // Spieler ist bereits drin, Socket ID aktualisieren?
            const existingPlayer = lobby.players.get(playerId)!;
            existingPlayer.socketId = socketId; // Update socket id in case of reconnect
            console.log(`LobbyManager: Spieler ${username} bereits in Lobby ${lobbyId}, Socket ID aktualisiert.`);
            return { success: true, lobby: this.getSerializableLobby(lobby) };
        }
        if (lobby.players.size >= lobby.maxPlayers) {
            return { success: false, message: 'Lobby ist voll.' };
        }

        const newPlayer: LobbyPlayer = {
            id: playerId,
            socketId: socketId,
            username: username,
            isHost: false,
            isReady: false,
            selectedFaction: null,
        };
        lobby.players.set(playerId, newPlayer);
        console.log(`LobbyManager: Spieler ${username} (ID: ${playerId}) ist Lobby ${lobbyId} beigetreten.`);
        return { success: true, lobby: this.getSerializableLobby(lobby) };
    }

    public leaveLobby(lobbyId: string, playerId: number): { lobbyDeleted: boolean, updatedLobby?: Lobby } {
        const lobby = this.activeLobbies.get(lobbyId);
        let lobbyDeleted = false;
        let updatedLobby: Lobby | undefined = undefined;

        if (!lobby || !lobby.players.has(playerId)) {
            console.warn(`LobbyManager: Spieler ${playerId} nicht in Lobby ${lobbyId} gefunden zum Verlassen.`);
            return { lobbyDeleted: false }; // Oder Fehler werfen/melden?
        }

        console.log(`LobbyManager: Spieler ${playerId} verlässt Lobby ${lobbyId}`);
        lobby.players.delete(playerId);

        if (lobby.players.size === 0) {
            this.activeLobbies.delete(lobbyId);
            lobbyDeleted = true;
            console.log(`LobbyManager: Lobby ${lobbyId} ist leer und wird gelöscht.`);
        } else if (lobby.hostId === playerId) {
            // Host hat verlassen, neuen Host bestimmen (erster verbleibender Spieler)
            const newHostEntry = lobby.players.entries().next().value;
             if (newHostEntry) {
                 const [newHostPlayerId, newHostPlayer] = newHostEntry;
                 newHostPlayer.isHost = true;
                 lobby.hostId = newHostPlayerId;
                 console.log(`LobbyManager: Neuer Host für Lobby ${lobbyId}: ${newHostPlayer.username}`);
                 updatedLobby = this.getSerializableLobby(lobby);
             } else {
                 // Sollte nicht passieren wenn size > 0
                 console.error(`LobbyManager: Konnte keinen neuen Host finden in Lobby ${lobbyId}. Lösche Lobby.`);
                 this.activeLobbies.delete(lobbyId);
                 lobbyDeleted = true;
             }
        } else {
             // Normaler Spieler hat verlassen
             updatedLobby = this.getSerializableLobby(lobby);
        }

        return { lobbyDeleted, updatedLobby };
    }

     public removePlayer(playerId: number): { affectedLobbyId?: string, lobbyDeleted: boolean, updatedLobby?: Lobby } {
        let affectedLobbyId: string | undefined = undefined;
        let result: { lobbyDeleted: boolean, updatedLobby?: Lobby } = { lobbyDeleted: false };

         for (const [lobbyId, lobby] of this.activeLobbies.entries()) {
             if (lobby.players.has(playerId)) {
                 affectedLobbyId = lobbyId;
                 console.log(`LobbyManager: Entferne Spieler ${playerId} (Disconnect) aus Lobby ${lobbyId}`);
                 result = this.leaveLobby(lobbyId, playerId); // Reuse leave logic
                 break; // Assume player can only be in one lobby
             }
         }
         return { affectedLobbyId, ...result };
     }

    public setFaction(lobbyId: string, playerId: number, faction: Faction): Lobby | null {
        const lobby = this.activeLobbies.get(lobbyId);
        const player = lobby?.players.get(playerId);

        if (lobby && player && !player.isReady) { // Allow change only if not ready
            player.selectedFaction = faction;
            console.log(`LobbyManager: Spieler ${player.username} in Lobby ${lobbyId} wählt Fraktion: ${faction}`);
            return this.getSerializableLobby(lobby);
        }
        return null; // Kein Update nötig/möglich
    }

    public setReady(lobbyId: string, playerId: number, isReady: boolean): Lobby | null {
        const lobby = this.activeLobbies.get(lobbyId);
        const player = lobby?.players.get(playerId);

        // Can only be ready if faction is selected
        if (lobby && player && player.selectedFaction) {
            player.isReady = isReady;
            console.log(`LobbyManager: Spieler ${player.username} in Lobby ${lobbyId} ist jetzt ${isReady ? 'bereit' : 'nicht bereit'}.`);
            return this.getSerializableLobby(lobby);
        }
         if(player && !player.selectedFaction && isReady){
             console.log(`LobbyManager: Spieler ${player.username} kann nicht bereit sein ohne Fraktion.`);
         }
        return null; // Kein Update nötig/möglich
    }

     public getLobby(lobbyId: string): Lobby | undefined {
         const lobby = this.activeLobbies.get(lobbyId);
         return lobby ? this.getSerializableLobby(lobby) : undefined;
     }

     // Prüft, ob eine Lobby bereit zum Starten ist (Host, Spielerzahl, Bereitschaft)
     public checkLobbyReadyForStart(lobbyId: string, requestingPlayerId: number): { ready: boolean; message?: string, lobby?: Lobby } {
        const lobby = this.activeLobbies.get(lobbyId);
        if (!lobby) {
            return { ready: false, message: 'Lobby nicht gefunden.' };
        }
        if (lobby.hostId !== requestingPlayerId) {
            return { ready: false, message: 'Nur der Host kann das Spiel starten.' };
        }
        if (lobby.players.size !== lobby.maxPlayers) {
            return { ready: false, message: 'Nicht genügend Spieler in der Lobby.' };
        }

        let allReady = true;
        for (const player of lobby.players.values()) {
            if (!player.isReady) {
                allReady = false;
                break;
            }
        }
        if (!allReady) {
             return { ready: false, message: 'Nicht alle Spieler sind bereit.' };
        }

        // Lobby ist bereit! Gib die serialisierte Lobby zurück.
        return { ready: true, lobby: this.getSerializableLobby(lobby) };
     }

    // Hilfsfunktion zum Erstellen einer serialisierbaren Lobby-Kopie
    private getSerializableLobby(lobby: Lobby): Lobby {
        return {
            ...lobby,
            players: new Map(lobby.players) // Erstellt Kopie der Map
        };
    }

    // Hilfsfunktion zum Konvertieren einer Lobby für die Übertragung (Map -> Array)
    private convertLobbyForEmit(lobby: Lobby): any {
         return {
             ...lobby,
             players: Array.from(lobby.players.values())
         };
    }

    // Erstellt die Liste für das globale 'lobby:list' Event
    public getSerializableLobbyList(): any[] {
        return Array.from(this.activeLobbies.values()).map(lobby => this.convertLobbyForEmit(lobby));
    }

     // Löscht eine Lobby (z.B. nach Spielstart)
     public deleteLobby(lobbyId: string): void {
         if (this.activeLobbies.has(lobbyId)) {
             this.activeLobbies.delete(lobbyId);
             console.log(`LobbyManager: Lobby ${lobbyId} gelöscht.`);
         }
     }
} 