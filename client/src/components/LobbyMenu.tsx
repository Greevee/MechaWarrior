import React, { useState, useEffect } from 'react';
import { socket } from '../socket';
import { usePlayerStore } from '../store/playerStore';
import { LobbyData, LobbyPlayer, Faction } from './../types/lobby.types';

interface LobbyMenuProps {
  // Keine expliziten Props, da wir die Lobby-ID aus dem Store holen
}

const LobbyMenu: React.FC<LobbyMenuProps> = () => {
  const { currentLobbyId, playerId, setCurrentLobbyId } = usePlayerStore();
  const [lobbyDetails, setLobbyDetails] = useState<LobbyData | null>(null);
  const [selectedFaction, setSelectedFaction] = useState<Faction | '' >('');
  const [isReady, setIsReady] = useState(false);
  const [isStartingGame, setIsStartingGame] = useState(false); // Ladezustand für Start-Button

  useEffect(() => {
    if (!currentLobbyId) return; // Frühzeitiger Ausstieg, wenn keine Lobby-ID vorhanden ist

    // Listener für Lobby-Updates
    const handleLobbyUpdate = (updatedLobby: LobbyData) => {
      console.log('Lobby-Update empfangen:', updatedLobby);
      if(updatedLobby.id === currentLobbyId) {
          setLobbyDetails(updatedLobby);
          // Eigenen Bereitschaftsstatus aktualisieren (falls geändert)
          const self = updatedLobby.players.find((p: LobbyPlayer) => p.id === playerId);
          if (self) setIsReady(self.isReady);
      }
    };

    // Listener registrieren
    socket.on('lobby:update', handleLobbyUpdate);

    // Fordere initiale Lobby-Details an (falls nicht schon durch Update erhalten)
    console.log(`Fordere Details für Lobby ${currentLobbyId} an...`);
    socket.emit('lobby:get-details', currentLobbyId, (response: any) => {
      if (response?.success && response?.lobby) {
        setLobbyDetails(response.lobby);
         const self = response.lobby.players.find((p: LobbyPlayer) => p.id === playerId);
         if (self) setIsReady(self.isReady);
      } else {
        console.error('Konnte Lobby-Details nicht laden:', response?.message);
        // Lobby existiert nicht mehr? Zurück zum Browser
        setCurrentLobbyId(null);
      }
    });

    // Aufräumfunktion
    return () => {
      socket.off('lobby:update', handleLobbyUpdate);
    };
  }, [currentLobbyId, setCurrentLobbyId, playerId]);

  const handleLeaveLobby = () => {
    if (currentLobbyId) {
      console.log(`Verlasse Lobby ${currentLobbyId}...`);
      socket.emit('lobby:leave', currentLobbyId, (response: any) => {
        if (response?.success) {
          setCurrentLobbyId(null); // Setzt Zustand zurück -> wechselt zur LobbyBrowser Ansicht
          setLobbyDetails(null);
          setIsReady(false);
          setSelectedFaction('');
        } else {
          alert(response?.message || 'Konnte Lobby nicht verlassen.');
        }
      });
    }
  };
  
  const handleFactionChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const faction = event.target.value as Faction;
    setSelectedFaction(faction);
    // Sende Update an Server (optional, könnte auch mit "Ready" geschehen)
     if (currentLobbyId) {
       socket.emit('lobby:set-faction', { lobbyId: currentLobbyId, faction: faction});
     }
  };
  
  const handleReadyToggle = () => {
      if (currentLobbyId) {
          const newReadyState = !isReady;
          console.log(`Setze Bereitschaftsstatus auf ${newReadyState}`);
          socket.emit('lobby:set-ready', { lobbyId: currentLobbyId, isReady: newReadyState });
          // Der Server sollte mit lobby:update antworten, was den lokalen State aktualisiert
      }
  }

  const handleStartGame = () => {
    if (!currentLobbyId || !isHost) return;

    setIsStartingGame(true);
    console.log(`Sende 'lobby:start-game' für Lobby ${currentLobbyId}`);
    socket.emit('lobby:start-game', currentLobbyId, (response: any) => {
      console.log('Antwort vom Server (lobby:start-game):', response);
      if (!response?.success) {
        alert(response?.message || 'Spiel konnte nicht gestartet werden.');
      }
      // Wenn erfolgreich, wird der 'game:start' Event empfangen,
      // der dann den Wechsel zur Spielansicht auslöst (nächster Schritt).
      setIsStartingGame(false);
    });
  };

  if (!currentLobbyId || !lobbyDetails) {
    return <div>Lade Lobby-Details...</div>;
  }

  const selfPlayer = lobbyDetails.players.find((p: LobbyPlayer) => p.id === playerId);
  const isHost = selfPlayer?.isHost || false;

  // Prüfen, ob alle Spieler bereit sind
  const allPlayersReady = lobbyDetails.players.length === lobbyDetails.maxPlayers &&
                         lobbyDetails.players.every(p => p.isReady);

  return (
    <div className="lobby-menu">
      <h2>Lobby: {lobbyDetails.id.substring(0, 6)}... ({lobbyDetails.mode})</h2>
      <button onClick={handleLeaveLobby}>Lobby verlassen</button>

      <div className="lobby-players">
        <h3>Spieler ({lobbyDetails.players.length}/{lobbyDetails.maxPlayers})</h3>
        <ul>
          {lobbyDetails.players.map((player: LobbyPlayer) => (
            <li key={player.id}>
              {player.username} {player.isHost ? '(Host)' : ''} - {player.selectedFaction || 'Wählt Fraktion...'} - {player.isReady ? 'Bereit' : 'Nicht bereit'}
            </li>
          ))}
        </ul>
      </div>

      <div className="lobby-controls">
        <h3>Deine Einstellungen</h3>
        <div>
          <label htmlFor="faction-select">Fraktion wählen: </label>
          <select id="faction-select" value={selectedFaction} onChange={handleFactionChange} disabled={isReady}>
            <option value="">-- Bitte wählen --</option>
            <option value="Human">Menschen</option>
            <option value="Machine">Maschinen</option>
            <option value="Alien">Alien</option>
          </select>
        </div>
         <button onClick={handleReadyToggle} disabled={!selectedFaction}>
            {isReady ? 'Nicht mehr Bereit' : 'Bereit'}
          </button>
      </div>

      {isHost && (
        <div className="lobby-host-controls">
          <h3>Host Aktionen</h3>
          <button 
            onClick={handleStartGame} 
            disabled={!allPlayersReady || isStartingGame}
          >
            {isStartingGame ? 'Starte Spiel...' : 'Spiel starten'}
          </button>
        </div>
      )}
    </div>
  );
};

export default LobbyMenu; 