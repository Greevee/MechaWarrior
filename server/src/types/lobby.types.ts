import { Faction } from "./common.types";

// Mögliche Spielmodi
export type GameMode = '1on1' | '2on2';

// Repräsentation eines Spielers innerhalb einer Lobby
export interface LobbyPlayer {
  id: number; // Die Spieler-ID aus der Datenbank
  socketId: string;
  username: string;
  isHost: boolean;
  isReady: boolean;
  selectedFaction: Faction | null;
}

// Repräsentation einer Lobby
export interface Lobby {
  id: string; // Eindeutige Lobby-ID
  hostId: number; // Spieler-ID des Hosts
  mode: GameMode;
  players: Map<number, LobbyPlayer>; // Map von Spieler-ID zu LobbyPlayer-Objekt
  maxPlayers: number;
  createdAt: Date;
} 