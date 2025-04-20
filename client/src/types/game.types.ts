// Client-seitige Definitionen für Spielzustandstypen
// Sollten mit server/src/types/game.types.ts synchron gehalten werden

// import { Faction } from "./common.types"; // Vorübergehend entfernt
import { GameMode } from "./lobby.types";

// WORKAROUND: Definiere Faction hier direkt
export type Faction = 'Human' | 'Machine' | 'Alien';

// +++ NEU: Waffen-Typ vom Server übernehmen +++
export interface Weapon {
  id: string; 
  damage: number;
  attackSpeed: number; 
  splashRadius: number;
  range: number;
  bulletSpeed?: number;
  canTargetAir?: boolean;
  recoilDurationMs?: number;
  recoilDistance?: number;
  projectileRenderType: 'image' | 'computer';
  projectileType: 'targeted' | 'ballistic';
  impactEffectImage?: boolean;
  impactEffectImagePath?: string;
  projectileColor?: string;
  projectileLineWidth?: number;
  projectileTrailLength?: number;
  projectileOffsetY?: number;
  projectileForwardOffset?: number;
  projectileImageScale?: number;
}

// +++ NEU: Unit-Typ vom Server übernehmen (ggf. anpassen) +++
export interface Unit {
  id: string;
  name: string;
  faction: Faction;
  width: number;
  height: number;
  squadSize: number;
  hp: number;
  armor: number;
  damageReduction: number;
  shield: number;
  placementCost: number;
  unlockCost: number;
  icon: string;
  speed: number;
  collisionRange?: number;
  formation: string;
  placementSpread?: number;
  moveBobbingFrequency?: number;
  moveBobbingAmplitude?: number;
  weapons: Weapon[]; // Wichtig: Waffe-Typ verwenden
  renderScale?: number;
  isAirUnit?: boolean;
  mainWeaponIndex?: number; // NEU
}

export type GamePhase = 'Preparation' | 'Combat' | 'RoundOver' | 'GameOver';
export type FigureBehaviorState = 'idle' | 'moving' | 'attacking' | 'dead';

// Zustand einer einzelnen Figur auf dem Schlachtfeld (vom Server kopiert)
export interface FigureState {
    figureId: string;
    unitInstanceId: string;
    playerId: number;
    unitTypeId: string;
    position: { x: number; z: number };
    currentHP: number;
    behavior: FigureBehaviorState;
    targetFigureId?: string;
    // NEU: Cooldowns pro Waffe (vom Server synchronisiert)
    // WICHTIG: Map wird oft als Objekt übertragen, Typ entsprechend anpassen!
    weaponCooldowns: { [weaponId: string]: number }; // Objekt statt Map für JSON-Übertragung
}

// Zustand eines aktiven Projektils
export interface ProjectileState {
    projectileId: string;
    playerId: number;       
    unitTypeId: string;     
    sourceUnitInstanceId: string; // NEU: Welche Instanz hat geschossen?
    weaponId: string; // NEU: ID der Waffe, die gefeuert hat
    damage: number;         
    projectileType: 'targeted' | 'ballistic'; // NEU: Art des Projektils
    speed: number;          
    splashRadius: number;   // NEU: Radius für Flächenschaden
    originPos: { x: number; z: number }; 
    targetPos: { x: number; z: number }; 
    currentPos: { x: number; y: number; z: number }; // NEU: Inklusive Y-Koordinate
    targetFigureId: string; 
    createdAt: number;      
    totalFlightTime: number; // NEU: Berechnete Flugzeit in Sekunden
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