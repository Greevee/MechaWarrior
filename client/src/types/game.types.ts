// Client-seitige Definitionen für Spielzustandstypen
// Sollten mit server/src/types/game.types.ts synchron gehalten werden

// import { Faction } from "./common.types"; // Vorübergehend entfernt
import { GameMode } from "./lobby.types";

// WORKAROUND: Definiere Faction hier direkt
export type Faction = 'Human' | 'Machine' | 'Alien';

export type GamePhase = 'Preparation' | 'Combat' | 'GameOver';
export type FigureBehaviorState = 'idle' | 'moving' | 'attacking'; // Hinzugefügt

// Zustand einer einzelnen Figur auf dem Schlachtfeld (vom Server kopiert)
export interface FigureState {
    figureId: string;
    unitInstanceId: string;
    playerId: number;
    unitTypeId: string;
    position: { x: number; z: number };
    currentHP: number;
    behavior: FigureBehaviorState;
    targetFigureId: string | null;
    attackCooldownEnd: number;
}

// Zustand eines aktiven Projektils
export interface ProjectileState {
    projectileId: string;
    playerId: number;       
    unitTypeId: string;     
    sourceUnitInstanceId: string; // NEU: Welche Instanz hat geschossen?
    damage: number;         
    speed: number;          
    originPos: { x: number; z: number }; 
    targetPos: { x: number; z: number }; 
    currentPos: { x: number; z: number }; 
    targetFigureId: string; 
    createdAt: number;      
}

// Struktur für eine platzierte Einheit (Client-Version, vom Server kopiert)
export interface PlacedUnit {
    instanceId: string;
    unitId: string;
    playerId: number;
    initialPosition: { x: number; z: number }; // Geändert von position
    rotation: 0 | 90; // NEU: Hinzugefügt (synchron mit Server)
    figures: FigureState[]; // Hinzugefügt
    // NEU: Erweiterte Statistik-Felder
    totalDamageDealt: number;
    totalKills: number;
    lastRoundDamageDealt: number;
    lastRoundKills: number;
}

// Zustand eines einzelnen Spielers innerhalb eines Spiels (Client-Version)
export interface PlayerInGame {
    id: number;
    username: string;
    faction: Faction; 
    credits: number;
    baseHealth: number; 
    unlockedUnits: string[]; 
    placedUnits: PlacedUnit[]; // Verwendet jetzt die angepasste PlacedUnit
    unitsPlacedThisRound: number; // NEU (vom Server synchronisiert)
    unitsAtCombatStart: PlacedUnit[]; // NEU (vom Server synchronisiert)
}

// Der gesamte Zustand eines laufenden Spiels (Client-Version)
export interface GameState {
    gameId: string; 
    hostId: number;
    mode: GameMode;
    round: number;
    phase: GamePhase;
    preparationEndTime?: number; // Optional: Unix-Timestamp (ms) vom Server
    players: PlayerInGame[]; // Spieler als Array, wie es oft vom Server kommt
    activeProjectiles: ProjectileState[]; // Hinzugefügt
} 