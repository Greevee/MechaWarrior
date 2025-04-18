import React, { useState, useEffect } from 'react';
import { socket, connectSocket } from './socket';
import { usePlayerStore } from './store/playerStore';
import { useGameStore } from './store/gameStore';
import { GameState as ClientGameState } from './types/game.types';
import { Socket } from 'socket.io-client';
import LobbyBrowser from './components/LobbyBrowser';
import LobbyMenu from './components/LobbyMenu';
import GameScreen from './components/GameScreen';
import './App.css';

function App() {
  const {
    isConnected,
    username,
    playerId,
    currentLobbyId,
    setConnected,
    setUsername: setStoreUsername,
    setPlayerId,
    setCurrentLobbyId,
    resetState,
  } = usePlayerStore();
  const { gameState, setGameState } = useGameStore();

  const [inputUsername, setInputUsername] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const handleConnect = () => setConnected(true);
    const handleDisconnect = (reason: Socket.DisconnectReason) => {
      console.log('App: Socket getrennt', reason);
      resetState();
    };

    const handleGameStart = (initialGameState: ClientGameState) => {
        console.log('Spielstart-Event empfangen:', initialGameState);
        setGameState(initialGameState);
        setCurrentLobbyId(null);
    };

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('game:start', handleGameStart);

    connectSocket();

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('game:start', handleGameStart);
    };
  }, [setConnected, resetState, setCurrentLobbyId, setGameState]);

  const handleUsernameChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      setInputUsername(event.target.value);
  };
  
  const handleLogin = (event: React.FormEvent) => {
      event.preventDefault(); 
      if (inputUsername.trim() && isConnected) {
          setIsLoading(true);
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

  // --- Debugging Log ---
  console.log('[App Render] Zustand:', {
    isConnected,
    username,
    playerId,
    currentLobbyId,
    gameState,
  });

  // --- Rendering Logic ---
  let content;
  console.log('[App Render] Evaluiere content...'); // Log Start
  if (!isConnected) {
      console.log('[App Render] => Zweig: !isConnected');
      content = <p>Verbinde zum Server...</p>;
  } else if (!username) {
      console.log('[App Render] => Zweig: !username (Login Form)');
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
  } else if (gameState) { 
      console.log('[App Render] => Zweig: gameState');
      content = <GameScreen />;
  } else if (currentLobbyId) {
      console.log('[App Render] => Zweig: currentLobbyId');
      content = <LobbyMenu />;
  } else {
      console.log('[App Render] => Zweig: else (LobbyBrowser)');
      content = <LobbyBrowser />;
  }
  console.log('[App Render] Zugewiesener content:', content ? content.type.name || typeof content.type : 'null'); // Logge Typ des Inhalts

  return (
    <div className="App">
      <header className="App-header">
        <h1>Fracture Protocol</h1>
        <p>Verbindungsstatus: {isConnected ? 'Verbunden' : 'Nicht verbunden'}</p>
        {username && 
          <p>
            Eingeloggt als: {username} (ID: {playerId}) 
            {currentLobbyId ? `| In Lobby: ${currentLobbyId.substring(0,6)}...` : ''}
            {gameState ? `| Im Spiel (ID: ${gameState.gameId.substring(0,6)}...)` : ''}
          </p>
        }
      </header>
      <main>
        {content}
      </main>
    </div>
  );
}

export default App; 