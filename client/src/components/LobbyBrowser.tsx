import React, { useState, useEffect } from 'react';
import { socket } from '../socket';
import { usePlayerStore } from '../store/playerStore'; // Importiere den Store
import { GameMode, LobbyPlayer, LobbyData } from './../types/lobby.types'; // Expliziterer Pfad
// Später importieren wir hier Typen für die Lobby

// Interface für die Lobby-Daten, wie sie vom Server *gesendet* werden
// (mit Spieler-Array statt Map)

interface LobbyBrowserProps {
  // Keine Props nötig für den Moment
}

const LobbyBrowser: React.FC<LobbyBrowserProps> = () => {
  const [lobbies, setLobbies] = useState<LobbyData[]>([]); // Zustand für die Lobby-Liste
  const setCurrentLobbyId = usePlayerStore((state) => state.setCurrentLobbyId); // Hole die Aktion aus dem Store
  const [joiningLobbyId, setJoiningLobbyId] = useState<string | null>(null); // Zustand für Ladeanzeige

  useEffect(() => {
    // Listener für die Lobby-Liste
    socket.on('lobby:list', (lobbyList: LobbyData[]) => {
      setLobbies(lobbyList);
    });
    
    // Aufräumfunktion: Listener entfernen
    return () => {
      socket.off('lobby:list');
    };
  }, []); // Leeres Abhängigkeitsarray, damit der Effekt nur beim Mount/Unmount läuft

  const handleCreateLobby = () => {
    socket.emit('lobby:create', (response: { success: boolean; lobbyId?: string; message?: string }) => {
      if (response.success && response.lobbyId) {
        setCurrentLobbyId(response.lobbyId);
      } else {
        alert(response?.message || 'Lobby konnte nicht erstellt werden.');
      }
    });
  };

  const handleJoinLobby = (lobbyId: string) => {
    setJoiningLobbyId(lobbyId); // Zeige Ladezustand für diesen Button
    socket.emit('lobby:join', lobbyId, (response: { success: boolean; message?: string }) => {
      if (response.success) {
        setCurrentLobbyId(lobbyId);
      } else {
        alert(response?.message || 'Konnte Lobby nicht beitreten.');
      }
      setJoiningLobbyId(null); // Ladezustand beenden
    });
  };

  return (
    <div className="lobby-browser">
      <h2>Lobby Browser</h2>
      <div className="lobby-actions">
        <button onClick={handleCreateLobby}>Neue Lobby erstellen</button>
      </div>
      <div className="lobby-list">
        <h3>Aktive Lobbies ({lobbies.length})</h3>
        {lobbies.length === 0 ? (
          <p>Keine aktiven Lobbies gefunden.</p>
        ) : (
          lobbies.map((lobby) => {
            // Finde den Host-Namen
            const host = lobby.players.find(p => p.isHost);
            const isJoining = joiningLobbyId === lobby.id;
            return (
              <div key={lobby.id} className="lobby-item">
                <span>
                  Lobby von {host?.username || 'Unbekannt'} ({lobby.mode}) - ID: {lobby.id.substring(0, 6)}...
                </span>
                <span>
                  {lobby.players.length}/{lobby.maxPlayers} Spieler
                </span>
                <button 
                  onClick={() => handleJoinLobby(lobby.id)} 
                  disabled={lobby.players.length >= lobby.maxPlayers || !!joiningLobbyId} // Deaktivieren, wenn voll oder anderer Beitritt läuft
                >
                  {isJoining ? 'Beitreten...' : 'Beitreten'}
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default LobbyBrowser; 