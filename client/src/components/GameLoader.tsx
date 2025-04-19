import React, { useMemo, Suspense, useState, useEffect, useRef } from 'react';
import { useGameStore } from '../store/gameStore';
import { usePlayerStore } from '../store/playerStore';
import { useTexture, Html } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { placeholderUnits, Unit } from '../../../server/src/units/unit.types';
import GameScreen from './GameScreen';
import { FigureBehaviorState, PlayerInGame } from '../types/game.types';
import ErrorBoundary from './ErrorBoundary';
import { socket } from '../socket';
import './GameScreen.css';

// NEU: Komponente zum Laden einer einzelnen Textur
const SingleTextureLoader: React.FC<{ path: string }> = ({ path }) => {
    // Lädt nur eine Textur. Wirft Fehler bei ungültigem Pfad.
    // Der useTexture Hook suspendiert bei Bedarf oder wirft intern einen Fehler,
    // der von der äußeren ErrorBoundary (in AssetPreloader) gefangen wird.
    useTexture(path); 
    return null; // Rendert nichts
};

// NEU: AssetPreloader rendert jetzt viele SingleTextureLoaders mit Error Boundaries
const AssetPreloader: React.FC<{ paths: string[] }> = ({ paths }) => {
    return (
        <>
            {paths.map(path => (
                // Jede Textur wird einzeln versucht zu laden.
                // Schlägt es fehl, fängt die Boundary den Fehler und rendert null,
                // ohne das gesamte Preloading zu blockieren.
                <ErrorBoundary key={path} fallback={null} logErrors={false}> {/* Logging für Preload-Fehler deaktivieren */}
                    <Suspense fallback={null}> {/* Minimaler Suspense für den Ladevorgang */}
                        <SingleTextureLoader path={path} />
                    </Suspense>
                </ErrorBoundary>
            ))}
        </>
    );
};

// Fallback-Komponente für Suspense innerhalb der Canvas
const CanvasLoadingFallback: React.FC = () => {
    return (
        <Html center>
            <div style={{ color: 'white', backgroundColor: 'rgba(0,0,0,0.7)', padding: '10px 20px', borderRadius: '5px' }}>
                Lade Spielgrafiken...
            </div>
        </Html>
    );
};

// Hilfsfunktion zur Formatierung der verbleibenden Zeit (aus GameScreen übernommen)
const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
};

const GameLoader: React.FC = () => {
    const { gameState } = useGameStore();
    const { playerId } = usePlayerStore();

    // --- Zustand und Logik aus GameScreen hierher verschoben --- 
    const [isUnlocking, setIsUnlocking] = useState<string | null>(null);
    const [selectedUnitForPlacement, setSelectedUnitForPlacement] = useState<Unit | null>(null);
    const [timeRemaining, setTimeRemaining] = useState<number | null>(null);
    const battlefieldContainerRef = useRef<HTMLDivElement>(null);

    // Memoized Spielerdaten
    const selfPlayer = useMemo(() => gameState?.players.find((p: PlayerInGame) => p.id === playerId), [gameState, playerId]);
    const opponentPlayer = useMemo(() => gameState?.players.find((p: PlayerInGame) => p.id !== playerId), [gameState, playerId]);
    const availableUnits = useMemo(() => placeholderUnits.filter(unit => unit.faction === selfPlayer?.faction), [selfPlayer]);
    const isHost = useMemo(() => gameState && playerId !== null && gameState.hostId === playerId, [gameState, playerId]);

    // Countdown Timer Effekt
    useEffect(() => {
        if (gameState?.phase === 'Preparation' && gameState.preparationEndTime) {
            const calculateRemaining = () => {
                const remaining = Math.max(0, (gameState.preparationEndTime! - Date.now()) / 1000);
                setTimeRemaining(remaining);
            };
            calculateRemaining();
            const intervalId = setInterval(calculateRemaining, 1000);
            return () => clearInterval(intervalId);
        } else {
            setTimeRemaining(null);
        }
    }, [gameState?.phase, gameState?.preparationEndTime]);

    // Handler
    const handleUnlockUnit = (unitId: string) => {
        if (!gameState) return;
        setIsUnlocking(unitId);
        socket.emit('game:unlock-unit', { gameId: gameState.gameId, unitId }, (response: any) => {
            if (!response?.success) {
                alert(`Fehler beim Freischalten: ${response?.message || 'Unbekannter Fehler'}`);
            }
            setIsUnlocking(null);
        });
    };

    const handleSelectUnitForPlacement = (unit: Unit) => {
        if (!gameState || !selfPlayer) return;
        if (!selfPlayer.unlockedUnits.includes(unit.id)) return;
        if (selfPlayer.credits < unit.placementCost) return;
        setSelectedUnitForPlacement(unit);
    };

    const handleForceStartCombat = () => {
        if (!gameState || !playerId || !isHost || gameState.phase !== 'Preparation') return;
        socket.emit('game:force-start-combat', gameState.gameId, (response: any) => {
            if (!response?.success) {
                alert(`Fehler beim Starten des Kampfes: ${response?.message || 'Unbekannter Fehler'}`);
            }
        });
    };
    // --- Ende der verschobenen Logik --- 

    // Asset Pfad Logik (bleibt wie zuvor)
    const assetPaths = useMemo(() => {
        if (!gameState) return [];
        const factionsInGame = new Set(gameState.players.map(p => p.faction));
        const unitsToLoad = placeholderUnits.filter(u => factionsInGame.has(u.faction));
        const paths: string[] = [];
        const behaviors: FigureBehaviorState[] = ['idle', 'moving', 'attacking'];
        unitsToLoad.forEach(unit => {
            behaviors.forEach(behavior => {
                paths.push(`/assets/units/${unit.id}/${behavior}.png`);
            });
            if (unit.attackSpeed > 0) { 
                paths.push(`/assets/projectiles/${unit.id}_projectile.png`);
            }
            paths.push(`/assets/units/${unit.id}.png`);
        });
        paths.push('/assets/units/placeholder/figure_placeholder.png');
        const uniquePaths = [...new Set(paths)];
        // console.log('[GameLoader] Pfade zum Vorladen:', uniquePaths); // Auskommentiert
        return uniquePaths;
    }, [gameState]); 

    if (!gameState) {
        return <div>Warte auf initiale Spieldaten...</div>;
    }

    if (assetPaths.length === 0) {
        return <div>Berechne benötigte Spiel-Assets...</div>;
    }

    // GameLoader rendert jetzt die Canvas UND die UI-Elemente
    return (
        <div className="game-screen-wrapper"> 
            <div ref={battlefieldContainerRef} className="battlefield-container"> 
                <Canvas camera={{ position: [-70, 50, 0], fov: 50 }}>
                    <Suspense fallback={<CanvasLoadingFallback />}> 
                        <AssetPreloader paths={assetPaths} />
                        <GameScreen 
                            gameState={gameState} 
                            playerId={playerId} 
                            battlefieldContainerRef={battlefieldContainerRef}
                            selectedUnitForPlacement={selectedUnitForPlacement}
                            setSelectedUnitForPlacement={setSelectedUnitForPlacement}
                        /> 
                    </Suspense>
                </Canvas>
            </div>

            <div className="game-info player-info">
                <h3>{selfPlayer?.username || 'Spieler'} (Du)</h3>
                <p>HP: {selfPlayer?.baseHealth ?? '??'}</p>
                <p>Credits: {selfPlayer?.credits ?? '??'}</p>
            </div>
            <div className="game-info opponent-info">
                <h3>{opponentPlayer?.username || 'Gegner'}</h3>
                <p>HP: {opponentPlayer?.baseHealth ?? '??'}</p>
                <p>Credits: {opponentPlayer?.credits ?? '??'}</p>
            </div>

            <div className="game-controls unit-details">
                {gameState?.phase === 'Preparation' && (
                    <div className='preparation-controls'>
                        <h4>Vorbereitung</h4>
                        {timeRemaining !== null && (
                            <p>Verbleibende Zeit: <strong>{formatTime(timeRemaining)}</strong></p>
                        )}
                        {isHost && (
                            <button onClick={handleForceStartCombat}>Kampf starten</button>
                        )}
                        <hr /> 
                    </div>
                )}
                
                {selectedUnitForPlacement ? (
                    <div>
                        <h5>Einheit Details</h5>
                        <p>Platziere: {selectedUnitForPlacement.name}</p>
                        <p>Kosten: {selectedUnitForPlacement.placementCost} C</p>
                        <button onClick={() => setSelectedUnitForPlacement(null)}>Abbrechen</button>
                    </div>
                ) : (
                    gameState?.phase !== 'Preparation' && <p>Kampf läuft...</p>
                )}
            </div>
            <div className="game-controls unit-pool">
                <h4>Einheiten (Fraktion: {selfPlayer?.faction})</h4>
                <div className="unit-tiles-grid"> 
                {availableUnits.map((unit: Unit) => {
                    const isUnlocked = selfPlayer?.unlockedUnits.includes(unit.id); 
                    // console.log(`[GameLoader Render Tile] Einheit: ${unit.id}, isUnlocked: ${isUnlocked}`); // Auskommentiert
                    const canAffordUnlock = selfPlayer ? selfPlayer.credits >= unit.unlockCost : false;
                    const canAffordPlacement = selfPlayer ? selfPlayer.credits >= unit.placementCost : false;
                    const unlockingThis = isUnlocking === unit.id;
                    const isSelectedForPlacement = selectedUnitForPlacement?.id === unit.id;

                    const isDisabled = unlockingThis ||
                                    (!isUnlocked && !canAffordUnlock) ||
                                    (isUnlocked && !canAffordPlacement) ||
                                    (isUnlocked && !!selectedUnitForPlacement && !isSelectedForPlacement);

                    const handleClick = () => {
                        if (!isUnlocked) {
                            handleUnlockUnit(unit.id);
                        } else {
                            if (isSelectedForPlacement) {
                                setSelectedUnitForPlacement(null);
                            } else {
                                handleSelectUnitForPlacement(unit);
                            }
                        }
                    };

                    return (
                    <button 
                        key={unit.id} 
                        className={`unit-tile ${isUnlocked ? 'unlocked' : 'locked'} ${isSelectedForPlacement ? 'selected-for-placement' : ''}`}
                        onClick={handleClick}
                        disabled={isDisabled}
                        title={`${unit.name}\nUnlock: ${unit.unlockCost}C\nPlace: ${unit.placementCost}C${!isUnlocked ? '\n(Click to Unlock)' : '\n(Click to Place)'}`}
                    >
                        {!isUnlocked && (
                            <div className="unit-tile-lock" aria-hidden="true">🔒</div>
                        )}
                        <img 
                            src={`/assets/units/${unit.id}.png`} 
                            alt={unit.name} 
                            onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.nextElementSibling?.classList.remove('hidden'); }}
                        />
                        <span className="unit-tile-fallback hidden">{unit.icon || unit.id.substring(0,3)}</span>
                        <div className="unit-tile-cost">
                            {isUnlocked ? `${unit.placementCost} C` : `${unit.unlockCost} C`}
                        </div>
                    </button>
                    );
                })}
                </div>
            </div>
        </div>
    );
};

export default GameLoader; 