import React, { useState, useEffect, Suspense } from 'react';
import { socket, connectSocket } from './socket';
import { usePlayerStore } from './store/playerStore';
import { useGameStore } from './store/gameStore';
import { GameState as ClientGameState } from './types/game.types';
import { Socket } from 'socket.io-client';
import LobbyBrowser from './components/LobbyBrowser';
import LobbyMenu from './components/LobbyMenu';
import GameLoader from './components/GameLoader';
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
      console.warn('App: Socket getrennt', reason);
      resetState();
    };

    const handleGameStart = (initialGameState: ClientGameState) => {
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

  useEffect(() => {
    const handleGameStateUpdate = (updatedGameState: ClientGameState) => {
      // console.log('[App.tsx] game:state-update empfangen:', updatedGameState);
      setGameState(updatedGameState);
    };

    socket.on('game:state-update', handleGameStateUpdate);

    return () => {
      socket.off('game:state-update', handleGameStateUpdate);
    };
  }, [setGameState]);

  // Optional: Zustand loggen für Debugging
  // console.log('[App Render] Zustand:', { isConnected, username, playerId, currentLobbyId, gameState });

  // --- Rendering Logic ---
  let content;
  // console.log('[App Render] Evaluiere content...');
  if (!isConnected) {
      // console.log('[App Render] => Zweig: !isConnected');
      content = <p>Verbinde zum Server...</p>;
  } else if (!username) {
      // console.log('[App Render] => Zweig: !username (Login Form)');
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
      // console.log('[App Render] => Zweig: gameState -> GameLoader');
      content = <GameLoader />;
  } else if (currentLobbyId) {
      // console.log('[App Render] => Zweig: currentLobbyId');
      content = <LobbyMenu />;
  } else {
      // console.log('[App Render] => Zweig: else (LobbyBrowser)');
      content = <LobbyBrowser />;
  }
  // console.log('[App Render] Zugewiesener content:', content ? content.type.name || typeof content.type : 'null');

  return (
    <div className="App">
      <main>
        {content}
      </main>
    </div>
  );
}

export default App; 