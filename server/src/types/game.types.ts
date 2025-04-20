import { Faction } from "./common.types";
import { GameMode } from "./lobby.types";

export type GamePhase = 'Preparation' | 'Combat' | 'RoundOver' | 'GameOver';
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
    // NEU: Cooldowns pro Waffe speichern
    weaponCooldowns: Map<string, number>; // Key: weapon.id, Value: Zeitstempel (ms)
}

// NEU: Zustand eines aktiven Projektils
export interface ProjectileState {
    projectileId: string;
    playerId: number;       // Spieler, der geschossen hat
    unitTypeId: string;     // Einheitentyp (für Schaden etc.)
    sourceUnitInstanceId: string; // NEU: Welche Instanz hat geschossen?
    weaponId: string; // NEU: ID der Waffe, die gefeuert hat
    damage: number;         // Schaden des Projektils
    projectileType: 'targeted' | 'ballistic'; // NEU: Art des Projektils
    speed: number;          // Fluggeschwindigkeit (für 'targeted' relevant)
    splashRadius: number;   // NEU: Radius für Flächenschaden (vom Unit übernommen)
    originPos: { x: number; z: number }; // Startpunkt (Boden)
    targetPos: { x: number; z: number }; // Zielpunkt (Boden) / Einschlagsort
    currentPos: { x: number; y: number; z: number }; // Aktuelle Position (inkl. Höhe)
    targetFigureId: string; // ID der Zielfigur (für 'targeted')
    createdAt: number;      // Zeitstempel der Erstellung (ms)
    totalFlightTime: number; // NEU: Berechnete Flugzeit in Sekunden (für 'ballistic')
}

// Struktur für eine platzierte Einheit (Server-Version)
export interface PlacedUnit {
    instanceId: string; // Eindeutige ID für diese spezifische Instanz auf dem Feld
    unitId: string;     // ID des Einheitentyps (z.B. 'human_infantry')
    playerId: number;   // ID des Besitzers
    // Die 'position' der PlacedUnit ist jetzt der ursprüngliche Platzierungspunkt (Mitte)
    // Die Figuren bewegen sich von hier aus.
    initialPosition: { x: number; z: number }; 
    rotation: 0 | 90; // NEU: Rotation der Einheit (0 oder 90 Grad)
    figures: FigureState[]; // Array der Figuren dieser Einheit
    // NEU: Erweiterte Statistik-Felder
    totalDamageDealt: number;
    totalKills: number;
    lastRoundDamageDealt: number;
    lastRoundKills: number;
}

// Zustand eines einzelnen Spielers innerhalb eines Spiels (Server-Version)
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
    combatStartTime?: number; // NEU: Zeitstempel (ms) für Start der Kampfphase
} 