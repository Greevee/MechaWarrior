// Diese Typen sollten idealerweise mit den Server-Typen übereinstimmen
// (server/src/types/lobby.types.ts und server/src/types/common.types.ts)

// Dupliziert aus server/src/types/common.types.ts
export type Faction = 'Human' | 'Machine' | 'Alien';

// Dupliziert aus server/src/types/lobby.types.ts
export type GameMode = '1on1' | '2on2';

// Dupliziert aus server/src/types/lobby.types.ts
export interface LobbyPlayer {
  id: number; // Die Spieler-ID aus der Datenbank
  socketId: string;
  username: string;
  isHost: boolean;
  isReady: boolean;
  selectedFaction: Faction | null;
}

// Interface für die Lobby-Daten, wie sie vom Server *gesendet* werden
// (mit Spieler-Array statt Map)
export interface LobbyData {
  id: string;
  hostId: number;
  mode: GameMode;
  players: LobbyPlayer[]; // Spieler als Array
  maxPlayers: number;
  createdAt: string; // Datum kommt oft als String über JSON
}

// Kein kompletter Lobby-Typ hier nötig, da wir nur LobbyData verwenden
// (Interface LobbyData ist in LobbyBrowser.tsx definiert) 