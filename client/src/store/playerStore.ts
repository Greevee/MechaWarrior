import { create } from 'zustand';

interface PlayerState {
  username: string | null;
  playerId: number | null; // Vorerst null, wird später vom Server gesetzt
  currentLobbyId: string | null; // ID der Lobby, in der sich der Spieler befindet
  isConnected: boolean;
  setUsername: (username: string) => void;
  setPlayerId: (id: number) => void;
  setCurrentLobbyId: (lobbyId: string | null) => void; // Aktion zum Setzen/Zurücksetzen der Lobby-ID
  setConnected: (isConnected: boolean) => void;
  resetState: () => void;
}

export const usePlayerStore = create<PlayerState>((set) => ({
  // Initialer Zustand
  username: null,
  playerId: null,
  currentLobbyId: null,
  isConnected: false,

  // Aktionen zum Ändern des Zustands
  setUsername: (username) => set({ username }),
  setPlayerId: (id) => set({ playerId: id }),
  setCurrentLobbyId: (lobbyId) => set({ currentLobbyId: lobbyId }),
  setConnected: (isConnected) => set({ isConnected }),
  resetState: () => set({ username: null, playerId: null, currentLobbyId: null, isConnected: false }),
})); 