import { io, Socket } from 'socket.io-client';

// Die URL deines Backend-Servers
// Vite stellt Umgebungsvariablen über import.meta.env bereit
// Nur Variablen mit dem Präfix VITE_ werden exposed.
// const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3000';

// Verwende den gleichen Hostnamen wie der Client, aber Port 3000
const serverHostname = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
const SERVER_URL = `http://${serverHostname}:3000`; 
console.log(`Versuche Verbindung zu Server auf: ${SERVER_URL}`); // Logging der verwendeten URL

// Erstelle die Socket-Instanz
// `autoConnect: false` bedeutet, dass wir die Verbindung manuell starten
export const socket: Socket = io(SERVER_URL, {
  autoConnect: false,
  // Optional: Füge hier weitere Konfigurationen hinzu, z.B. für Authentifizierung
});

// Exportiere die Funktion, um die Verbindung explizit herzustellen
export const connectSocket = () => {
  if (!socket.connected) {
    socket.connect();
    console.log('Versuche Socket zu verbinden...'); // Zusätzliches Logging
  }
};

// Exportiere die Funktion, um die Verbindung zu trennen
export const disconnectSocket = () => {
  if (socket.connected) {
    socket.disconnect();
  }
};

// Logge grundlegende Events (optional, aber nützlich für Debugging)
socket.on('connect', () => {
  console.log('Socket verbunden mit Server:', socket.id);
});

socket.on('disconnect', (reason) => {
  console.log('Socket getrennt:', reason);
});

socket.on('connect_error', (err) => {
  console.error('Socket Verbindungsfehler:', err);
});

// --- Entfernte redundante Funktionen ---
// isSocketConnected, closeSocket, openSocket, checkSocketConnection, 
// closeConnection, openConnection, verifyConnection