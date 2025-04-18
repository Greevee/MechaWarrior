import { Sequelize } from 'sequelize';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

// Pfad zur SQLite-Datenbankdatei. Standardmäßig im Projekt-Root.
// Kann über die Umgebungsvariable DB_STORAGE angepasst werden.
const storagePath = process.env.DB_STORAGE || path.join(__dirname, '..', '..', 'database.sqlite');

// Initialisiere Sequelize mit SQLite
export const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: storagePath, // Pfad zur Datenbankdatei
  logging: false, // Deaktiviere SQL-Logs in der Konsole (optional aktivieren für Debugging)
});

// Funktion zum Testen der Verbindung und Synchronisieren der Modelle
export const connectDB = async () => {
  try {
    await sequelize.authenticate(); // Testet die Verbindung
    console.log('SQLite Verbindung erfolgreich hergestellt.');

    // Synchronisiere alle definierten Modelle mit der Datenbank.
    // `force: false` bedeutet, dass Tabellen nicht gelöscht werden, wenn sie bereits existieren.
    // Für Entwicklung kann `force: true` nützlich sein, um Tabellen neu zu erstellen.
    await sequelize.sync({ force: false });
    console.log('Datenbank synchronisiert.');

  } catch (error) {
    console.error('Fehler bei der Verbindung oder Synchronisierung mit SQLite:', error);
    process.exit(1); // Beendet den Prozess bei kritischem DB-Fehler
  }
}; 