import React, { useMemo, Suspense, useState, useEffect, useRef, useCallback } from 'react';
import { useGameStore } from '../store/gameStore';
import { usePlayerStore } from '../store/playerStore';
import { useTexture, Html } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { placeholderUnits, Unit } from '../../../server/src/units/unit.types';
import GameScreen from './GameScreen';
import { FigureBehaviorState, PlayerInGame, PlacedUnit, GamePhase, FigureState } from '../types/game.types';
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

// +++ NEU: Memoized UI-Komponenten +++

const PlayerInfoPanel = React.memo<{ player: PlayerInGame | undefined, isSelf: boolean }>(({ player, isSelf }) => {
    return (
        <div className={`game-info ${isSelf ? 'player-info' : 'opponent-info'}`}>
            <h3>{player?.username || (isSelf ? 'Spieler' : 'Gegner')} {isSelf && '(Du)'}</h3>
            <p>HP: {player?.baseHealth ?? '??'}</p>
        </div>
    );
});

const SelectedUnitStatsPanel = React.memo<{ data: { unit: PlacedUnit, baseData: Unit | undefined } | null }>(({ data }) => {
    if (!data) return null;
    return (
        <div className="game-info selected-unit-stats">
            <h4>Ausgewählte Einheit</h4>
            <p>Typ: {data.baseData?.name ?? data.unit.unitId}</p>
            {/* Zweispaltiges Layout für Stats (wie zuvor implementiert) */}
             <div style={{ display: 'flex', gap: '20px' }}>
                 <div className="stats-column">
                    {/* Optional: Hier Basiswerte anzeigen, wenn gewünscht */}
                 </div>
                 <div className="stats-column">
                    <p>Schaden (LR): {data.unit.lastRoundDamageDealt}</p>
                    <p>Schaden (Ges): {data.unit.totalDamageDealt}</p>
                    <p>Kills (LR): {data.unit.lastRoundKills}</p>
                    <p>Kills (Ges): {data.unit.totalKills}</p>
                </div>
            </div>
        </div>
    );
});

const UnitDetailsPanel = React.memo<{ 
    selectedFigureData: { figure: FigureState, baseData: Unit | undefined, ownerUsername: string } | null, 
    selectedPlacedUnitData: { unit: PlacedUnit, baseData: Unit | undefined } | null 
}>(({ selectedFigureData, selectedPlacedUnitData }) => {
     return (
        <div className="game-controls unit-details"> 
            {selectedFigureData && selectedFigureData.baseData ? (
                <div>
                    <h4>{selectedFigureData.baseData.name}</h4> 
                    <div className="unit-details-content"> 
                        <img 
                            src={`/assets/units/${selectedFigureData.baseData.id}.png`} 
                            alt={selectedFigureData.baseData.name}
                            className="unit-details-icon" 
                            onError={(e) => { e.currentTarget.src = '/assets/units/placeholder/figure_placeholder.png'; }} 
                        />
                        <div className="unit-details-stats" style={{ display: 'flex', gap: '20px' }}> 
                            <div className="stats-column">
                                <p>HP: {selectedFigureData.figure.currentHP} / {selectedFigureData.baseData.hp}</p>
                                <p>Schaden (Basis): {selectedFigureData.baseData.damage}</p>
                                <p>Reichweite: {selectedFigureData.baseData.range}</p>
                                <p>Geschw.: {selectedFigureData.baseData.speed}</p>
                            </div>
                            {/* Integrierte Statistiken (aus zweiter Spalte des vorherigen Panels) */}
                            {selectedPlacedUnitData && (
                                <div className="stats-column">
                                    <p>Schaden (LR): {selectedPlacedUnitData.unit.lastRoundDamageDealt}</p>
                                    <p>Schaden (Ges): {selectedPlacedUnitData.unit.totalDamageDealt}</p>
                                    <p>Kills (LR): {selectedPlacedUnitData.unit.lastRoundKills}</p>
                                    <p>Kills (Ges): {selectedPlacedUnitData.unit.totalKills}</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            ) : (
                <div>
                    <h4>Einheit Details</h4>
                    <p>Keine Einheit ausgewählt. Klicke eine Figur im Feld an.</p>
                </div>
                )}
        </div>
     );
});

const CreditsDisplayPanel = React.memo<{ credits: number | undefined }>(({ credits }) => {
    if (credits === undefined) return null;
    return (
        <div className="game-controls credits-display"> 
            <span>Credits: {credits} C</span>
        </div>
    );
});

const UnitPoolPanel = React.memo<{ 
    availableUnits: Unit[], 
    selfPlayer: PlayerInGame | undefined, 
    isUnlocking: string | null, 
    selectedUnitForPlacement: Unit | null,
    onUnlockUnit: (unitId: string) => void,
    onSelectUnitForPlacement: (unit: Unit | null) => void // Erlaube null zum Deselektieren
}>(({ 
    availableUnits, 
    selfPlayer, 
    isUnlocking, 
    selectedUnitForPlacement,
    onUnlockUnit,
    onSelectUnitForPlacement
}) => {
    return (
        <div className="game-controls unit-pool">
            <h4>Einheiten (Fraktion: {selfPlayer?.faction})</h4>
            <div className="unit-tiles-grid"> 
                {availableUnits.map((unit: Unit) => {
                    const isUnlocked = selfPlayer?.unlockedUnits.includes(unit.id);
                    const canAffordUnlock = selfPlayer ? selfPlayer.credits >= unit.unlockCost : false;
                    const canAffordPlacement = selfPlayer ? selfPlayer.credits >= unit.placementCost : false;
                    const unlockingThis = isUnlocking === unit.id;
                    const isSelectedForPlacement = selectedUnitForPlacement?.id === unit.id;
                    const canPlaceMore = selfPlayer ? selfPlayer.unitsPlacedThisRound < PLACEMENT_LIMIT_PER_ROUND : false;

                    const isDisabled = unlockingThis ||
                        (!isUnlocked && !canAffordUnlock) ||
                        (isUnlocked && (!canAffordPlacement || !canPlaceMore)) || // Check Platzierungslimit
                        (isUnlocked && !!selectedUnitForPlacement && !isSelectedForPlacement);

                    const handleClick = () => {
                        if (!isUnlocked) {
                            onUnlockUnit(unit.id);
                        } else {
                             // Nur auswählen, wenn Platzierung möglich ist
                             if (canAffordPlacement && canPlaceMore) {
                                if (isSelectedForPlacement) {
                                    onSelectUnitForPlacement(null); // Deselektieren
                                } else {
                                    onSelectUnitForPlacement(unit); // Selektieren
                                }
                             } else {
                                 // Optional: Hinweis geben, warum nicht ausgewählt werden kann
                                 // z.B. alert("Nicht genug Credits oder Limit erreicht.");
                             }
                        }
                    };

                    let title = `${unit.name}\nUnlock: ${unit.unlockCost}C\nPlace: ${unit.placementCost}C`;
                    if (!isUnlocked) {
                         title += '\n(Click to Unlock)';
                    } else if (!canAffordPlacement) {
                        title += '\n(Not enough credits to place)';
                    } else if (!canPlaceMore) {
                         title += `\n(Placement limit ${PLACEMENT_LIMIT_PER_ROUND} reached)`;
                    } else {
                        title += '\n(Click to Place/Deselect)';
                    }

                    return (
                        <button 
                            key={unit.id} 
                            className={`unit-tile ${isUnlocked ? 'unlocked' : 'locked'} ${isSelectedForPlacement ? 'selected-for-placement' : ''}`}
                            onClick={handleClick}
                            disabled={isDisabled}
                            title={title}
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
    );
});

const TopCenterPanel = React.memo<{ 
    phase: GamePhase, 
    round: number, 
    timeRemaining: number | null, 
    isHost: boolean, 
    onForceStartCombat: () => void 
}>(({ phase, round, timeRemaining, isHost, onForceStartCombat }) => {
    if (phase !== 'Preparation') return null;
    return (
        <div className="game-info top-center-info">
            <h4>Vorbereitung (Runde {round})</h4>
            {timeRemaining !== null && (
                <p>Verbleibende Zeit: <strong>{formatTime(timeRemaining)}</strong></p>
            )}
            {isHost && (
                <button onClick={onForceStartCombat}>Kampf starten</button>
            )}
        </div>
    );
});

const PhaseIndicator = React.memo<{ show: boolean, text: string | null }>(({ show, text }) => {
    if (!show || !text) return null;
    return (
        <div className="phase-indicator">
            {text}
        </div>
    );
});

// --- Konstante außerhalb der Komponente ---
const PLACEMENT_LIMIT_PER_ROUND = 3; // Muss konsistent mit Server sein

// --- Hauptkomponente GameLoader ---
const GameLoader: React.FC = () => {
    const { gameState, selectedFigureId, setSelectedFigureId } = useGameStore();
    const { playerId } = usePlayerStore();

    // --- Zustand und Logik aus GameScreen hierher verschoben --- 
    const [isUnlocking, setIsUnlocking] = useState<string | null>(null);
    const [selectedUnitForPlacement, setSelectedUnitForPlacement] = useState<Unit | null>(null);
    const [timeRemaining, setTimeRemaining] = useState<number | null>(null);
    const battlefieldContainerRef = useRef<HTMLDivElement>(null);
    const prevPhaseRef = useRef<GamePhase | null>(null);
    const combatAudioRef = useRef<HTMLAudioElement | null>(null);
    // NEU: Zustand für Phasenanzeige
    const [displayedPhase, setDisplayedPhase] = useState<string | null>(null);
    const [showPhaseIndicator, setShowPhaseIndicator] = useState<boolean>(false);
    const phaseTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    // Memoized Spielerdaten
    const selfPlayer = useMemo(() => gameState?.players.find((p: PlayerInGame) => p.id === playerId), [gameState?.players, playerId]);
    const opponentPlayer = useMemo(() => gameState?.players.find((p: PlayerInGame) => p.id !== playerId), [gameState?.players, playerId]);
    const availableUnits = useMemo(() => placeholderUnits.filter(unit => unit.faction === selfPlayer?.faction), [selfPlayer?.faction]);
    const isHost = useMemo(() => gameState !== null && playerId !== null && gameState.hostId === playerId, [gameState?.hostId, playerId]);

    // Memoized Daten für die ausgewählte FIGUR (via Klick)
    const selectedFigureData = useMemo(() => {
        if (!gameState || !selectedFigureId) return null;
        let foundFigure: FigureState | null = null;
        let ownerId: number | null = null;

        // Direkter Zugriff auf gameState.players Array
        const players = gameState.players || [];
        for (const player of players) {
            for (const unit of player.placedUnits) {
                const figure = unit.figures.find(f => f.figureId === selectedFigureId);
                if (figure) {
                    foundFigure = figure;
                    ownerId = player.id;
                    break;
                }
            }
            if (foundFigure) break;
        }

        if (!foundFigure) return null;

        const baseUnitData = placeholderUnits.find(u => u.id === foundFigure!.unitTypeId);
        const ownerUsername = players.find(p => p.id === ownerId)?.username ?? '??';

        return { 
            figure: foundFigure,
            baseData: baseUnitData,
            ownerUsername: ownerUsername
        };
    }, [gameState?.players, selectedFigureId]);

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

    // Effekt für Phasenwechsel (Anzeige-Text setzen & Musik)
    useEffect(() => {
        const currentPhase = gameState?.phase;
        const previousPhase = prevPhaseRef.current;

        // Phasenanzeige Logik - Nur Text setzen und Sichtbarkeit triggern
        if (currentPhase && currentPhase !== previousPhase) {
            let phaseText = '';
            switch (currentPhase) {
                case 'Preparation': phaseText = `Runde ${gameState?.round} - Vorbereitung`; break;
                case 'Combat': phaseText = `Runde ${gameState?.round} - Kampf beginnt!`; break;
                case 'GameOver': phaseText = 'Spiel vorbei!'; break;
                default: phaseText = currentPhase; break;
            }
            
            setDisplayedPhase(phaseText);
            setShowPhaseIndicator(true); // Löst den nächsten Effekt aus
        }

        // Musik Logik (unverändert)
        if (previousPhase === 'Preparation' && currentPhase === 'Combat') {
            console.log("Combat phase started, playing music...");
            // Optional: Stoppe vorherige Musik
            // if (preparationAudioRef.current) preparationAudioRef.current.pause();

            // Erstelle und spiele Kampfmusik
            if (!combatAudioRef.current) {
                combatAudioRef.current = new Audio('/assets/music/combat_start.mp3');
            }
            combatAudioRef.current.play().catch(error => {
                console.error("Fehler beim Abspielen der Kampfmusik:", error);
                // Optional: Fallback oder Nutzerhinweis
            });
        } 
        // Optional: Musik stoppen, wenn Kampf vorbei ist?
        // else if (previousPhase === 'Combat' && currentPhase !== 'Combat') {
        //     if (combatAudioRef.current) {
        //          combatAudioRef.current.pause();
        //          combatAudioRef.current.currentTime = 0; // Zurücksetzen
        //     }
        // }

        // Speichere aktuelle Phase für nächsten Render
        prevPhaseRef.current = currentPhase ?? null;

    }, [gameState?.phase, gameState?.round]); // Abhängig von Phase und Runde (für Rundennummer)

    // NEU: Separater Effekt für das Ausblenden per Timeout
    useEffect(() => {
        // Wenn der Indikator sichtbar werden soll...
        if (showPhaseIndicator) {
            // ... lösche alten Timeout (falls vorhanden) und starte neuen.
            if (phaseTimeoutRef.current) {
                clearTimeout(phaseTimeoutRef.current);
            }
            phaseTimeoutRef.current = setTimeout(() => {
                setShowPhaseIndicator(false);
            }, 3000); // 3 Sekunden anzeigen
        }

        // Cleanup: Timeout löschen, wenn Komponente unmountet oder showPhaseIndicator false wird
        return () => {
             if (phaseTimeoutRef.current) {
                clearTimeout(phaseTimeoutRef.current);
            }
        };
    }, [showPhaseIndicator]); // Abhängig vom Sichtbarkeits-Status

    // Handler
    const handleUnlockUnit = useCallback((unitId: string) => {
        if (!gameState?.gameId) return;
        setIsUnlocking(unitId);
        socket.emit('game:unlock-unit', { gameId: gameState.gameId, unitId }, (response: any) => {
            if (!response?.success) {
                alert(`Fehler beim Freischalten: ${response?.message || 'Unbekannter Fehler'}`);
            }
            setIsUnlocking(null);
        });
    }, [gameState?.gameId]);

    const handleSelectUnitForPlacementCallback = useCallback((unit: Unit | null) => {
         // Prüfungen hierhin verschoben, um Callback stabil zu halten?
         // Oder Props an UnitPool übergeben, damit es selbst prüft?
         // Behalten wir die Logik erstmal im Handler, der an UnitPool übergeben wird.
         
         // Alte Logik von UnitPool hierher:
         if (unit !== null) { // Wenn eine Einheit ausgewählt wird
             if (!selfPlayer || !selfPlayer.unlockedUnits.includes(unit.id) || selfPlayer.credits < unit.placementCost || selfPlayer.unitsPlacedThisRound >= PLACEMENT_LIMIT_PER_ROUND) {
                 // Auswahl nicht möglich, tue nichts oder gib Feedback
                 return;
             }
         }
         setSelectedUnitForPlacement(unit);
         if (unit) {
            setSelectedFigureId(null); // Auswahl der Figur aufheben, wenn Unit für Platzierung gewählt wird
         }
    }, [selfPlayer, setSelectedFigureId]);

    const handleForceStartCombat = useCallback(() => {
        if (!gameState?.gameId || !playerId || !isHost || gameState.phase !== 'Preparation') return;
        socket.emit('game:force-start-combat', gameState.gameId, (response: any) => {
            if (!response?.success) {
                alert(`Fehler beim Starten des Kampfes: ${response?.message || 'Unbekannter Fehler'}`);
            }
        });
    }, [gameState?.gameId, playerId, isHost, gameState?.phase]);
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

    // Memoized Daten für die ausgewählte UNIT (basierend auf selectedFigureId)
    const selectedPlacedUnitData = useMemo(() => {
        if (!gameState || !selectedFigureId) return null;
        let foundUnit: PlacedUnit | null = null;

        for (const player of gameState.players) {
            for (const unit of player.placedUnits) {
                const figureExists = unit.figures.some(f => f.figureId === selectedFigureId);
                if (figureExists) {
                    foundUnit = unit;
                    break;
                }
            }
            if (foundUnit) break;
        }

        if (!foundUnit) return null;

        const baseUnitData = placeholderUnits.find(u => u.id === foundUnit!.unitId);

        return { 
            unit: foundUnit,
            baseData: baseUnitData
        };
    }, [gameState, selectedFigureId]);

    if (!gameState) {
        return <div>Warte auf initiale Spieldaten...</div>;
    }

    if (assetPaths.length === 0) {
        return <div>Berechne benötigte Spiel-Assets...</div>;
    }

    // GameLoader rendert jetzt die Canvas UND die memoized UI-Elemente
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

            {/* Verwende memoized Komponenten */}
            <PlayerInfoPanel player={selfPlayer} isSelf={true} />
            <PlayerInfoPanel player={opponentPlayer} isSelf={false} />
            
            <TopCenterPanel 
                phase={gameState.phase}
                round={gameState.round}
                timeRemaining={timeRemaining}
                isHost={isHost}
                onForceStartCombat={handleForceStartCombat}
            />

            <PhaseIndicator show={showPhaseIndicator} text={displayedPhase} />

            <UnitDetailsPanel 
                selectedFigureData={selectedFigureData}
                selectedPlacedUnitData={selectedPlacedUnitData}
            />
            
            <CreditsDisplayPanel credits={selfPlayer?.credits} />

            <UnitPoolPanel 
                availableUnits={availableUnits}
                selfPlayer={selfPlayer}
                isUnlocking={isUnlocking}
                selectedUnitForPlacement={selectedUnitForPlacement}
                onUnlockUnit={handleUnlockUnit}
                onSelectUnitForPlacement={handleSelectUnitForPlacementCallback}
            />
        </div>
    );
};

export default GameLoader; 