import { create } from 'zustand';
// Importiere den GameData-Typ
import { GameData } from '../types/lobby.types';

interface PlayerState {
  username: string | null;
  playerId: number | null; // Vorerst null, wird später vom Server gesetzt
  currentLobbyId: string | null; // ID der Lobby, in der sich der Spieler befindet
  currentGameData: GameData | null; // <-- Neu
  isConnected: boolean;
  setUsername: (username: string) => void;
  setPlayerId: (id: number) => void;
  setCurrentLobbyId: (lobbyId: string | null) => void; // Aktion zum Setzen/Zurücksetzen der Lobby-ID
  setCurrentGameData: (gameData: GameData | null) => void; // <-- Neu
  setConnected: (isConnected: boolean) => void;
  resetState: () => void;
}

export const usePlayerStore = create<PlayerState>((set) => ({
  // Initialer Zustand
  username: null,
  playerId: null,
  currentLobbyId: null,
  currentGameData: null, // <-- Neu
  isConnected: false,

  // Aktionen zum Ändern des Zustands
  setUsername: (username) => set({ username }),
  setPlayerId: (id) => set({ playerId: id }),
  setCurrentLobbyId: (lobbyId) => set({ currentLobbyId: lobbyId }),
  setCurrentGameData: (gameData) => set({ currentGameData: gameData }), // <-- Neu
  setConnected: (isConnected) => set({ isConnected }),
  resetState: () => set({
    username: null,
    playerId: null,
    currentLobbyId: null,
    currentGameData: null, // <-- Neu
    isConnected: false
  }),
})); 