import { Faction } from "./common.types";
import { GameMode } from "./lobby.types";

export type GamePhase = 'Preparation' | 'Combat' | 'GameOver';
export type FigureBehaviorState = 'idle' | 'moving' | 'attacking';

// NEU: Zustand einer einzelnen Figur auf dem Schlachtfeld
export interface FigureState {
    figureId: string;         // Eindeutige ID für diese Figur
    unitInstanceId: string; // ID der PlacedUnit, zu der sie gehört
    playerId: number;       // ID des Besitzers
    unitTypeId: string;     // ID des Einheitentyps (für Basiswerte)
    position: { x: number; z: number };
    currentHP: number;
    behavior: FigureBehaviorState;
    targetFigureId: string | null; // ID der Zielfigur
    attackCooldownEnd: number; // Zeitstempel (ms), wann nächster Angriff möglich ist
}

// NEU: Zustand eines aktiven Projektils
export interface ProjectileState {
    projectileId: string;
    playerId: number;       // Spieler, der geschossen hat
    unitTypeId: string;     // Einheitentyp (für Schaden etc.)
    damage: number;         // Schaden des Projektils
    speed: number;          // Fluggeschwindigkeit
    originPos: { x: number; z: number }; // Startpunkt
    targetPos: { x: number; z: number }; // Zielpunkt (Position des Ziels beim Feuern)
    currentPos: { x: number; z: number }; // Aktuelle Position
    targetFigureId: string; // ID der Zielfigur
    createdAt: number;      // Zeitstempel der Erstellung (ms)
}

// Struktur für eine platzierte Einheit (enthält jetzt Figuren)
export interface PlacedUnit {
    instanceId: string; // Eindeutige ID für diese spezifische Instanz auf dem Feld
    unitId: string;     // ID des Einheitentyps (z.B. 'human_infantry')
    playerId: number;   // ID des Besitzers
    // Die 'position' der PlacedUnit ist jetzt der ursprüngliche Platzierungspunkt (Mitte)
    // Die Figuren bewegen sich von hier aus.
    initialPosition: { x: number; z: number }; 
    figures: FigureState[]; // Array der Figuren dieser Einheit
}

// Zustand eines einzelnen Spielers innerhalb eines Spiels
export interface PlayerInGame {
    id: number;
    username: string;
    faction: Faction; 
    credits: number;
    baseHealth: number; 
    unlockedUnits: string[]; 
    placedUnits: PlacedUnit[]; // Aktuelle Einheiten auf dem Feld
    unitsPlacedThisRound: number; 
    unitsAtCombatStart: PlacedUnit[]; // NEU: Zustand der Einheiten zu Beginn der letzten Kampfphase
}

// Der gesamte Zustand eines laufenden Spiels
export interface GameState {
    gameId: string; 
    hostId: number; 
    mode: GameMode;
    round: number;
    phase: GamePhase;
    preparationEndTime?: number; 
    players: Map<number, PlayerInGame>; 
    activeProjectiles: ProjectileState[]; // NEU: Array für aktive Projektile 
} 