import { Faction } from '../types/common.types';

// +++ NEU: Waffendefinition +++
export interface Weapon {
  id: string; // Eindeutige ID für die Waffe, z.B. 'infantry_rifle'
  damage: number;
  attackSpeed: number; // Angriffe pro Sekunde
  splashRadius: number;
  range: number;
  canTargetAir?: boolean; // NEU: Kann diese Waffe Lufteinheiten angreifen? (Standard: false)
  bulletSpeed?: number;
  recoilDurationMs?: number; // Optional, nicht jede Waffe hat Rückstoß
  recoilDistance?: number;  // Optional
  projectileRenderType: 'image' | 'computer';
  projectileType: 'targeted' | 'ballistic';
  impactEffectImage?: boolean; // Zeigt an, ob beim Einschlag ein Effekt gezeigt wird
  impactEffectImagePath?: string; // NEU: Pfad zum Impact-Effekt-Bild (wenn impactEffectImage true ist)
  impactEffectImageScale?: number; // NEU: Skalierung für das Impact-Effekt-Bild (wenn impactEffectImage true ist, Default: 1)

  // Optional: Nur relevant wenn projectileRenderType === 'computer'
  projectileColor?: string;
  projectileLineWidth?: number;
  projectileTrailLength?: number;
  projectileOffsetY?: number;
  projectileForwardOffset?: number;

  // Optional: Nur relevant wenn projectileRenderType === 'image'
  projectileImagePath?: string; // NEU: Pfad zum Projektil-Bild
  projectileImageScale?: number;
}
// +++ Ende Waffendefinition +++

export interface Unit {
  id: string;
  name: string;
  faction: Faction;
  width: number;    // Anzahl Felder horizontal
  height: number;   // Anzahl Felder vertikal
  squadSize: number; // z.B. 10 für Infanteriegruppe
  hp: number;
  armor: number; // % Schaden reduziert
  damageReduction: number; // Flat Schaden reduziert
  shield: number; // Zusatz-HP, zuerst verbraucht
  placementCost: number; // Kosten zum Platzieren auf dem Feld
  unlockCost: number;    // Kosten zum einmaligen Freischalten pro Match
  icon: string;          // Pfad oder Name für das Einheiten-Icon (Platzhalter)
  speed: number;         // Bewegungsgeschwindigkeit (Felder pro Sekunde?)
  collisionRange?: number; // NEU: Radius für Kollisionserkennung (optional)
  formation: string;    // e.g., "5x2", "3x3", "1x1"
  placementSpread?: number; // NEU: Zufällige Platzierungsabweichung (Radius)
  moveBobbingFrequency?: number; // Wie oft pro Sekunde
  moveBobbingAmplitude?: number; // Wie hoch der Sprung ist

  // NEU: Waffen der Einheit
  weapons: Weapon[]; // Jede Einheit hat eine Liste von Waffen

  // NEU: Visuelle Skalierung der Einheit selbst
  renderScale?: number; // Multiplikator für die Standard-Sprite-Größe (1 = 100%)

  // NEU: Typ der Einheit
  isAirUnit?: boolean; // Ist es eine Lufteinheit? (Standard: false)

  // NEU: Index der Hauptwaffe (für Effekte wie Recoil)
  mainWeaponIndex?: number; // Standardmäßig 0, falls nicht angegeben
}

// +++ NEU: Platzhalter-Waffen Definitionen +++
export const infantryRifle: Weapon = {
    id: 'infantry_rifle',
    damage: 12,
    attackSpeed: 1,
    splashRadius: 0,
    range: 10,
    canTargetAir: true,
    bulletSpeed: 30,
    recoilDurationMs: 150,
    recoilDistance: 0.1,
    projectileRenderType: 'computer',
    projectileType: 'targeted',
    impactEffectImage: false, // Gewehrkugeln normalerweise kein großer Impact
    projectileColor: '#ebd686',
    projectileLineWidth: 1,
    projectileTrailLength: 0.3,
    projectileOffsetY: 0.5,
    projectileForwardOffset: 0.5
};

export const smallTankCannon: Weapon = {
    id: 'small_tank_cannon',
    damage: 600,
    attackSpeed: 0.3,
    splashRadius: 0.2,
    range: 12,
    canTargetAir: false,
    bulletSpeed: 15,
    recoilDurationMs: 250,
    recoilDistance: 0.25,
    projectileRenderType: 'image',
    projectileType: 'targeted',
    impactEffectImage: true,
    impactEffectImagePath: 'weapons/impacts/weapon_small_tank_cannon_impact.png',
    projectileImagePath: 'weapons/projectiles/small_tank_cannon_projectile.png',
    projectileImageScale: 0.5
};

export const catapultStone: Weapon = {
    id: 'catapult_stone',
    damage: 5000,
    attackSpeed: 0.2,
    splashRadius: 1.0,
    range: 12,
    canTargetAir: false,
    bulletSpeed: 10,
    projectileRenderType: 'image',
    projectileType: 'ballistic',
    impactEffectImage: true,
    impactEffectImagePath: 'weapons/impacts/weapon_catapult_stone_impact.png',
    projectileImagePath: 'weapons/projectiles/catapult_stone_projectile.png',
    projectileImageScale: 1,
    impactEffectImageScale: 4
};

// NEU: Waffe für Moloch
export const molochCannon: Weapon = {
    id: 'moloch_cannon',
    damage: 1200, // Starker Einzelschaden
    attackSpeed: 0.4, // Langsamer als Panzer
    splashRadius: 0.5, // Kleiner Splash
    range: 14, // Gute Reichweite
    canTargetAir: true, // Kann Boden & Luft
    bulletSpeed: 5,
    recoilDurationMs: 300, // Deutlicher Rückstoß
    recoilDistance: 0.3,
    projectileRenderType: 'image', // Großes Projektil-Sprite?
    projectileType: 'ballistic', // Fliegt im Bogen
    impactEffectImage: true,
    impactEffectImagePath: 'weapons/impacts/weapon_moloch_cannon_impact.png',
    projectileImagePath: 'weapons/projectiles/moloch_cannon_projectile.png',
    projectileImageScale: 1.2,// Großes Projektil
    impactEffectImageScale: 2
};

// Optional: Eine Sammlung aller Waffen für einfachen Zugriff?
export const placeholderWeapons: Weapon[] = [infantryRifle, smallTankCannon, catapultStone, molochCannon];
// +++ Ende Platzhalter-Waffen +++

export const placeholderUnits: Unit[] = [
  {
    id: 'human_infantry',
    name: 'Infantry Squad',
    faction: 'Human',
    width: 5,
    height: 2,
    squadSize: 15,
    hp: 50,
    armor: 0.1,
    damageReduction: 1,
    shield: 0,
    placementCost: 100,
    unlockCost: 0,
    icon: 'human_infantry_icon',
    speed: 1,
    collisionRange: 0.2,
    renderScale: 0.5,
    formation: '5x3',
    placementSpread: 0.1,
    moveBobbingFrequency: 2,
    moveBobbingAmplitude: 0.05,
    weapons: [infantryRifle],
    isAirUnit: false,
    mainWeaponIndex: 0
  },
  {
    id: 'human_small_tank',
    name: 'Small Tank',
    faction: 'Human',
    width: 5,
    height: 2,
    squadSize: 5,
    hp: 3000,
    armor: 0.2,
    damageReduction: 3,
    shield: 0,
    placementCost: 200,
    unlockCost: 0,
    icon: 'human_small_tank_icon',
    speed: 1.5,
    collisionRange: 0.5,
    renderScale: 1.2,
    formation: '5x1',
    placementSpread: 0.2,
    moveBobbingFrequency: 0.5,
    moveBobbingAmplitude: 0.02,
    weapons: [smallTankCannon],
    isAirUnit: false,
    mainWeaponIndex: 0
  },
  {
    id: 'human_catapult',
    name: 'Katapult',
    faction: 'Human',
    width: 3,
    height: 3,
    squadSize: 1,
    hp: 12000,
    armor: 0.1,
    damageReduction: 0,
    shield: 0,
    placementCost: 300,
    unlockCost: 100,
    icon: 'human_catapult_icon',
    speed: 0.6,
    collisionRange: 0.6,
    renderScale: 3,
    formation: '1x1',
    placementSpread: 0,
    weapons: [catapultStone],
    isAirUnit: false,
    mainWeaponIndex: 0
  },
  { // NEUE EINHEIT: Moloch
    id: 'human_moloch',
    name: 'Moloch Luftschiff',
    faction: 'Human',
    width: 4,
    height: 4,
    squadSize: 1, // Einzelne Einheit
    hp: 15000, // Sehr robust
    armor: 0.25, // Gut gepanzert
    damageReduction: 5,
    shield: 0,
    placementCost: 600, // Sehr teuer
    unlockCost: 0,
    icon: 'human_moloch_icon', // Platzhalter
    speed: 1.2, // Relativ langsam für eine Lufteinheit?
    collisionRange: 1.8, // Großer Kollisionsradius
    renderScale: 4, // Großes Sprite
    formation: '1x1',
    placementSpread: 0,
    weapons: [molochCannon, infantryRifle, infantryRifle], // Hauptkanone, zwei Gewehre
    isAirUnit: true, // Lufteinheit!
    mainWeaponIndex: 0 // Kanone verursacht sichtbaren Recoil
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