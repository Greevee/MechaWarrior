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
  impactEffectImage?: boolean; // NEU: Zeigt an, ob ein Standard-Aufprall-Effekt verwendet wird (assets/units/<id>/impact/impact.png)
  collisionRange?: number; // NEU: Radius für Kollisionserkennung (optional)
  modelScale?: number; // NEU: Skalierungsfaktor für das 3D-Modell (optional)
  formation: string;    // e.g., "5x2", "3x3", "1x1"
  placementSpread?: number; // NEU: Zufällige Platzierungsabweichung (Radius)
  recoilDurationMs?: number;
  recoilDistance?: number;
  // NEU: Hüpf-Animation beim Bewegen
  moveBobbingFrequency?: number; // Wie oft pro Sekunde
  moveBobbingAmplitude?: number; // Wie hoch der Sprung ist
}

export const placeholderUnits: Unit[] = [
  {
    id: 'human_infantry',
    name: 'Infantry Squad',
    faction: 'Human',
    width: 5,
    height: 2,
    squadSize: 15,
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
    speed: 1,
    bulletSpeed: 30,
    collisionRange: 0.2,
    modelScale: 0.5,
    formation: '5x3',
    placementSpread: 0.1,
    recoilDurationMs: 150,
    recoilDistance: 0.1,
    moveBobbingFrequency: 2, // Beispielwert: 2 Sprünge pro Sekunde
    moveBobbingAmplitude: 0.05 // Beispielwert: Kleine Höhe
  },
  {
    id: 'human_small_tank',
    name: 'Small Tank',
    faction: 'Human',
    width: 5,
    height: 2,
    squadSize: 5,
    damage: 600,
    attackSpeed: 0.3,
    splashRadius: 0.2,
    range: 12,
    hp: 3000,
    armor: 0.2,
    damageReduction: 3,
    shield: 0,
    placementCost: 200,
    unlockCost: 0,
    icon: 'human_small_tank_icon',
    speed: 1.5,
    bulletSpeed: 15,
    collisionRange: 0.5,
    modelScale: 1.2,
    formation: '5x1',
    placementSpread: 0.2,
    impactEffectImage: true,
    recoilDurationMs: 250,
    recoilDistance: 0.25,
    moveBobbingFrequency: 0.5, // Panzer hüpft langsamer
    moveBobbingAmplitude: 0.02 // Panzer hüpft weniger hoch
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