import { Faction } from '../types/common.types';

export interface Unit {
  id: string;
  name: string;
  faction: Faction;
  width: number;    // Anzahl Felder horizontal
  height: number;   // Anzahl Felder vertikal
  squadSize: number; // z.B. 10 für Infanteriegruppe
  damage: number;
  attackSpeed: number; // Angriffe pro Sekunde
  splashRadius: number; // 0 = kein Splash
  range: number; // Reichweite in Feldern
  hp: number;
  armor: number; // % Schaden reduziert
  damageReduction: number; // Flat Schaden reduziert
  shield: number; // Zusatz-HP, zuerst verbraucht
  placementCost: number; // Kosten zum Platzieren auf dem Feld
  unlockCost: number;    // Kosten zum einmaligen Freischalten pro Match
  icon: string;          // Pfad oder Name für das Einheiten-Icon (Platzhalter)
  speed: number;         // Bewegungsgeschwindigkeit (Felder pro Sekunde?)
  bulletSpeed?: number; // NEU: Geschwindigkeit der Geschosse (optional)
  collisionRange?: number; // NEU: Radius für Kollisionserkennung (optional)
  modelScale?: number; // NEU: Skalierungsfaktor für das 3D-Modell (optional)
  formation: string;    // e.g., "5x2", "3x3", "1x1"
}

export const placeholderUnits: Unit[] = [
  {
    id: 'human_infantry',
    name: 'Infantry Squad',
    faction: 'Human',
    width: 5,
    height: 2,
    squadSize: 10,
    damage: 12,
    attackSpeed: 1,
    splashRadius: 0,
    range: 10,
    hp: 50,
    armor: 0.1,
    damageReduction: 1,
    shield: 0,
    placementCost: 100,
    unlockCost: 0,
    icon: 'human_infantry_icon',
    speed: 2,
    bulletSpeed: 15,
    collisionRange: 0.5,
    modelScale: 0.5,
    formation: '5x2'
  },
  {
    id: 'human_sniper',
    name: 'Sniper Team',
    faction: 'Human',
    width: 1,
    height: 1,
    squadSize: 1,
    damage: 75,
    attackSpeed: 0.25,
    splashRadius: 2,
    range: 30,
    hp: 60,
    armor: 0.05,
    damageReduction: 0,
    shield: 0,
    placementCost: 100,
    unlockCost: 0,
    icon: 'human_sniper_icon',
    speed: 1.5,
    bulletSpeed: 40,
    collisionRange: 0.4,
    modelScale: 0.5,
    formation: '1x1'
  },
  {
    id: 'machine_guardian',
    name: 'Guardian Drone',
    faction: 'Machine',
    width: 3,
    height: 2,
    squadSize: 4,
    damage: 20,
    attackSpeed: 0.6,
    splashRadius: 1,
    range: 4,
    hp: 300,
    armor: 0.25,
    damageReduction: 2,
    shield: 50,
    placementCost: 150,
    unlockCost: 100,
    icon: 'machine_guardian_icon',
    speed: 1.5,
    bulletSpeed: 20,
    collisionRange: 0.8,
    modelScale: 1.0,
    formation: '3x3'
  },
  {
    id: 'alien_stalker',
    name: 'Void Stalker',
    faction: 'Alien',
    width: 1,
    height: 1,
    squadSize: 1,
    damage: 40,
    attackSpeed: 1.5,
    splashRadius: 0,
    range: 5,
    hp: 100,
    armor: 0,
    damageReduction: 0,
    shield: 25,
    placementCost: 200,
    unlockCost: 150,
    icon: 'alien_stalker_icon',
    speed: 3,
    bulletSpeed: 25,
    collisionRange: 0.4,
    modelScale: 0.8,
    formation: '1x1'
  }
];

export function parseFormation(formation: string): { cols: number; rows: number } | null {
  if (!formation || !formation.includes('x')) return null;
  const parts = formation.split('x');
  if (parts.length !== 2) return null;
  const cols = parseInt(parts[0], 10);
  const rows = parseInt(parts[1], 10);
  if (isNaN(cols) || isNaN(rows) || cols <= 0 || rows <= 0) return null;
  return { cols, rows };
} 