import { Sequelize, DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../db/connect'; // Importiere die initialisierte Sequelize Instanz
import { Faction } from '../types/common.types';

// Interface für die FactionProgress Daten
interface FactionProgressData {
  unlockedUnits: string[];
  xp: number;
}

// Interface für die Attribute des Player-Modells
interface PlayerAttributes {
  id: number; // Sequelize fügt standardmäßig eine ID hinzu
  username: string;
  xp: number;
  // Speichert den Fortschritt als JSON-Objekt
  factionProgress: { [key in Faction]?: FactionProgressData };
  createdAt?: Date;
  updatedAt?: Date;
}

// Interface für die Erstellung eines neuen Players (id ist optional)
interface PlayerCreationAttributes extends Optional<PlayerAttributes, 'id' | 'xp' | 'factionProgress'> {}

// Definiere das Sequelize Modell für Player
class Player extends Model<PlayerAttributes, PlayerCreationAttributes> implements PlayerAttributes {
  public id!: number;
  public username!: string;
  public xp!: number;
  public factionProgress!: { [key in Faction]?: FactionProgressData };

  // Timestamps
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

// Initialisiere das Modell mit Attributen und Optionen
Player.init({
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  username: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
  },
  xp: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
  factionProgress: {
    type: DataTypes.JSON,
    allowNull: false,
    defaultValue: {},
    get(): { [key in Faction]?: FactionProgressData } { 
      const rawValue = this.getDataValue('factionProgress');
      try {
        if (typeof rawValue === 'string') {
            return JSON.parse(rawValue) as { [key in Faction]?: FactionProgressData };
        }
        // Prüfen, ob es ein Objekt ist (und nicht null)
        if (typeof rawValue === 'object' && rawValue !== null) {
             return rawValue as { [key in Faction]?: FactionProgressData };
        }
        // Fallback, wenn weder String noch erwartetes Objekt
        console.warn("Unerwarteter Wert im factionProgress getter:", rawValue);
        return {};
      } catch (e) {
          console.error("Fehler beim Parsen von factionProgress JSON:", rawValue, e);
          return {}; // Fallback bei Parsing-Fehler
      }
    },
    set(value: { [key in Faction]?: FactionProgressData }) {
      // Speichert das Objekt als JSON String
      this.setDataValue('factionProgress', JSON.stringify(value));
    }
  },
}, {
  sequelize, // Verbindunginstanz übergeben
  tableName: 'players', // Name der Tabelle in der Datenbank
  // `timestamps: true` ist Standard bei Sequelize, fügt createdAt und updatedAt hinzu
});

export { Player, PlayerAttributes, PlayerCreationAttributes }; 