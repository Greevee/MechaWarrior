import { create } from 'zustand';
// Importiere die *Client*-Typen für den Spielzustand
import { GameState as ClientGameState, PlayerInGame as ClientPlayerInGame } from '../types/game.types';

// Interface für den Store-Zustand
interface GameStoreState {
    gameState: ClientGameState | null;
    setGameState: (newState: ClientGameState) => void;
    updatePlayerState: (playerId: number, updates: Partial<ClientPlayerInGame>) => void;
    resetGame: () => void;
    // Ggf. weitere Aktionen für Runden, Phasen etc.
}

// Hilfsfunktion nicht mehr nötig, wenn Server bereits serialisierte Daten sendet

export const useGameStore = create<GameStoreState>((set, get) => ({
    gameState: null,
    // Erwartet bereits den serialisierten Zustand vom Server
    setGameState: (newState) => set({ gameState: newState }), 
    updatePlayerState: (playerId, updates) => set(state => {
        if (!state.gameState) return state;
        // Finde den Spieler im Array und aktualisiere ihn
        const updatedPlayers = state.gameState.players.map(player => {
            if (player.id === playerId) {
                return { ...player, ...updates };
            }
            return player;
        });
        return {
            gameState: {
                ...state.gameState,
                players: updatedPlayers,
            }
        };
    }),
    resetGame: () => set({ gameState: null }),
})); 