import React, { useState, useEffect } from 'react';
import { socket, connectSocket } from './socket';
import { usePlayerStore } from './store/playerStore';
import { Socket } from 'socket.io-client'; // Importiere Socket für Typen
import { GameData } from './types/lobby.types'; // Importiere GameData
import LobbyBrowser from './components/LobbyBrowser'; // Importiere die neue Komponente
import LobbyMenu from './components/LobbyMenu'; // Importiere LobbyMenu
import './App.css'; // Erstellen wir gleich noch

function App() {
  const {
    isConnected,
    username,
    playerId,
    currentLobbyId, // Hole die aktuelle Lobby-ID aus dem Store
    currentGameData, // Hole Spieldaten aus dem Store
    setConnected,
    setUsername: setStoreUsername,
    setPlayerId,
    setCurrentLobbyId, // Hole Aktion
    setCurrentGameData, // Hole Aktion
    resetState,
  } = usePlayerStore();

  const [inputUsername, setInputUsername] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Effekt zum Aufbau der Socket-Verbindung und zum Abhören von Events
  useEffect(() => {
    // Funktion zum Verbinden und Setzen des Status im Store
    const handleConnect = () => {
      console.log('App: Socket verbunden');
      setConnected(true);
    };

    // Funktion zum Trennen und Zurücksetzen des Status/Spielerdaten
    const handleDisconnect = (reason: Socket.DisconnectReason) => {
      console.log('App: Socket getrennt', reason);
      resetState(); // Setzt username, playerId und isConnected zurück
    };

    // Listener für Spielstart
    const handleGameStart = (gameData: GameData) => {
        console.log('Spielstart-Event empfangen:', gameData);
        setCurrentGameData(gameData);
        setCurrentLobbyId(null); // Verlasse die Lobby-Ansicht
    };

    // Event-Listener hinzufügen
    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('game:start', handleGameStart); // Registriere neuen Listener

    // Versuche zu verbinden, wenn die Komponente gemountet wird
    connectSocket();

    // Aufräumfunktion: Listener entfernen, wenn die Komponente unmounted wird
    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('game:start', handleGameStart); // Entferne Listener
      // Optional: Verbindung trennen, wenn App unmounted wird?
      // disconnectSocket();
    };
  }, [setConnected, resetState, setCurrentGameData, setCurrentLobbyId]); // Abhängigkeiten für den Effekt

  // Handler für die Namensänderung im Input-Feld
  const handleUsernameChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setInputUsername(event.target.value);
  };

  // Handler für das Absenden des Benutzernamens
  const handleLogin = (event: React.FormEvent) => {
    event.preventDefault(); // Verhindert Neuladen der Seite
    if (inputUsername.trim() && isConnected) {
      setIsLoading(true);
      console.log(`Sende 'player:login' mit Benutzername: ${inputUsername}`);
      // Sende den Benutzernamen an den Server
      socket.emit('player:login', inputUsername.trim(), (response: any) => {
        console.log('Login-Antwort vom Server:', response);
        if (response?.success && response?.playerId) {
          setStoreUsername(inputUsername.trim());
          setPlayerId(response.playerId);
          setInputUsername('');
        } else {
          alert(response?.message || 'Login fehlgeschlagen');
        }
        setIsLoading(false);
      });
    }
  };

  // --- Rendering Logic ---
  let content;
  if (!isConnected) {
      content = <p>Verbinde zum Server...</p>;
  } else if (!username) {
      // Login Formular
      content = (
          <form onSubmit={handleLogin}>
              <h2>Benutzernamen eingeben</h2>
              <input
                  type="text"
                  value={inputUsername}
                  onChange={handleUsernameChange}
                  placeholder="Dein Name"
                  maxLength={16}
                  required
                  disabled={isLoading}
              />
              <button type="submit" disabled={!inputUsername.trim() || isLoading}>
                  {isLoading ? 'Beitreten...' : 'Beitreten'}
              </button>
          </form>
      );
  } else if (currentGameData) {
      // Spielansicht (Platzhalter)
      content = <div><h2>Spiel läuft! (Lobby: {currentGameData.lobbyId})</h2><p>Spielansicht hier implementieren...</p></div>; 
      // Später: content = <GameScreen gameData={currentGameData} />;
  } else if (currentLobbyId) {
      // Lobby Menü
      content = <LobbyMenu />;
  } else {
      // Lobby Browser
      content = <LobbyBrowser />;
  }

  return (
    <div className="App">
      <header className="App-header">
        <h1>Fracture Protocol</h1>
        <p>Verbindungsstatus: {isConnected ? 'Verbunden' : 'Nicht verbunden'}</p>
        {/* Zeige Status nur wenn eingeloggt */}
        {username && 
          <p>
            Eingeloggt als: {username} (ID: {playerId}) 
            {currentLobbyId ? `| In Lobby: ${currentLobbyId.substring(0,6)}...` : ''}
            {currentGameData ? `| Im Spiel (Lobby: ${currentGameData.lobbyId.substring(0,6)}...)` : ''}
          </p>
        }
      </header>
      <main>
        {content} { /* Rendere den ausgewählten Inhalt */ }
      </main>
    </div>
  );
}

export default App; 