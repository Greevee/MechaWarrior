import React, { useEffect, useState, useMemo, useRef, Suspense } from 'react';
import { usePlayerStore } from '../store/playerStore';
import { useGameStore } from '../store/gameStore';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, Box, Plane, Sphere, useGLTF, Billboard, useTexture, Line } from '@react-three/drei';
import * as THREE from 'three';
import { PlayerInGame, PlacedUnit, GameState as ClientGameState, FigureState, ProjectileState } from '../types/game.types';
import { socket } from '../socket';
import { placeholderUnits, Unit } from '../../../server/src/units/unit.types';
import './GameScreen.css';
import PlacementSystem from './PlacementSystem';

// --- Health Bar Component ---
const HealthBar: React.FC<{ currentHP: number, maxHP: number, scale: number }> = ({ currentHP, maxHP, scale }) => {
    const healthRatio = Math.max(0, currentHP / maxHP);
    const barWidth = 1.0 * scale; // Basisbreite des Balkens, skaliert mit Modell
    const barHeight = 0.1 * scale; // Basishöhe des Balkens, skaliert mit Modell
    const yOffset = 1.0 * scale; // Wie weit über dem Figuren-Ursprung (skaliert)

    return (
        <Billboard position={[0, yOffset, 0]}>
            {/* Hintergrund (Rot/Dunkel) */}
            <Plane args={[barWidth, barHeight]}>
                <meshBasicMaterial color="#660000" side={THREE.DoubleSide} />
            </Plane>
            {/* Vordergrund (Grün) */}
            <Plane 
                args={[barWidth * healthRatio, barHeight]} 
                // Positioniere linksbündig auf dem Hintergrund
                position={[-(barWidth * (1 - healthRatio)) / 2, 0, 0.01]} // Leicht davor
            >
                <meshBasicMaterial color="#00cc00" side={THREE.DoubleSide} />
            </Plane>
        </Billboard>
    );
};

// --- Figure Mesh Component --- 
const FigureMesh: React.FC<{ figureData: FigureState }> = ({ figureData }) => {
    const meshRef = useRef<THREE.Group>(null!); 
    const interpolatedPosition = useRef(new THREE.Vector3(figureData.position.x, 0, figureData.position.z));
    const targetPosition = useMemo(() => new THREE.Vector3(figureData.position.x, 0, figureData.position.z), [
        figureData.position.x, figureData.position.z
    ]);
    const lastPosition = useRef(new THREE.Vector3().copy(interpolatedPosition.current));
    const [yOffset, setYOffset] = useState(0);

    const unitData = useMemo(() => placeholderUnits.find(u => u.id === figureData.unitTypeId), [figureData.unitTypeId]);
    const modelScale = unitData?.modelScale ?? 1;
    const maxHP = unitData?.hp ?? 100; 

    // --- Sprite Loading ---
    // TODO: Dynamischen Pfad basierend auf figureData.unitTypeId verwenden
    const spriteTexture = useTexture('/sprites/figure_placeholder.png'); 
    // Ladefehler abfangen und Standardwerte verwenden
    const aspectWidth = spriteTexture?.image?.width ?? 1;
    const aspectHeight = spriteTexture?.image?.height ?? 1;
    const spriteAspect = aspectWidth / aspectHeight;

    const spriteHeight = 1.0 * modelScale; // Basis-Höhe, skaliert mit modelScale
    const spriteWidth = spriteHeight * spriteAspect;

    // Einfacher Y-Offset für Sprites (halbe Höhe)
    useEffect(() => {
        setYOffset(spriteHeight / 2);
    }, [spriteHeight]);

    useFrame((state, delta) => {
        // Zielposition inkl. dynamischem Y-Offset
        targetPosition.set(figureData.position.x, yOffset, figureData.position.z);
        interpolatedPosition.current.lerp(targetPosition, 0.1);
        
        const movementDirection = interpolatedPosition.current.clone().sub(lastPosition.current);
        lastPosition.current.copy(interpolatedPosition.current);

        if (meshRef.current) {
            meshRef.current.position.copy(interpolatedPosition.current);
             // Skalierung wird jetzt über die Plane-args gesteuert, nicht mehr über die Group
            // meshRef.current.scale.set(modelScale, modelScale, modelScale); // Entfernt

            // Sprite-Ausrichtung zur Bewegungsrichtung (optional, hier vereinfacht)
            // const moveLengthSq = movementDirection.lengthSq();
            // if (moveLengthSq > 0.0001) { 
                 // const angle = Math.atan2(movementDirection.x, movementDirection.z);
                 // Bei Billboards ist Rotation oft nicht nötig oder wirkt seltsam.
                 // meshRef.current.rotation.y = THREE.MathUtils.lerp(meshRef.current.rotation.y, angle, 0.1);
            // }
        }
    });

    // Entferne GLTF-Lade-Logik
    // const isSoldier = figureData.unitTypeId === 'human_infantry';
    // const modelPath = '/models/soldier.glb'; 
    // const gltf = isSoldier ? useGLTF(modelPath) : null;
    // const scene = gltf?.scene;
    // useEffect(() => { ... }, [scene, isSoldier, figureData.unitTypeId, modelScale]); // Entfernt

    // Entferne bedingtes Rendern von Modell/Kugel
    // let figureVisual;
    // if (isSoldier && scene) { ... } else { ... } // Entfernt

    return (
        // Group wird NUR noch positioniert
        <group ref={meshRef} key={figureData.figureId}>
            <Billboard>
                 {/* NEU: Schwarzer Umriss (dahinter und etwas größer) */}
                 <Plane args={[spriteWidth + 0.08, spriteHeight + 0.08]}>
                    <meshBasicMaterial
                        color="black"
                        transparent={true} // Muss transparent sein, um alphaTest/Map zu nutzen
                        alphaMap={spriteTexture} // Benutze Alpha der Originaltextur
                        alphaTest={0.1}        // Gleicher Alpha-Test
                        side={THREE.DoubleSide}
                    />
                </Plane>
                 {/* Original Sprite-Plane (leicht davor) */}
                 <Plane args={[spriteWidth, spriteHeight]} position={[0, 0, 0.01]}>
                     <meshBasicMaterial
                        map={spriteTexture}
                        transparent={true}
                        side={THREE.DoubleSide} // Wichtig für Billboards
                        alphaTest={0.1} // Verhindert teiltransparente Ränder
                    />
                </Plane>
            </Billboard>
            {figureData.currentHP < maxHP && 
                 // Position der HealthBar relativ zur Sprite-Höhe anpassen
                 // Skaliere HealthBar relativ zur Sprite-Breite
                 <group position={[0, spriteHeight, 0]}> {/* Leicht über dem Sprite */}
                    <HealthBar currentHP={figureData.currentHP} maxHP={maxHP} scale={spriteWidth * 0.8} /> 
                 </group>
            }
        </group>
    );
};

// --- Placed Unit Mesh (rendert jetzt FigureMesh-Komponenten) ---
const PlacedUnitMesh: React.FC<{ placedUnit: PlacedUnit }> = ({ placedUnit }) => {
    return (
        <group userData={{ unitInstanceId: placedUnit.instanceId }}> 
            {placedUnit.figures.map((figure: FigureState) => (
                <FigureMesh key={figure.figureId} figureData={figure} />
            ))}
        </group>
    );
};

// Hilfskomponente zur Anpassung der Canvas-Größe
const CanvasUpdater: React.FC<{ containerRef: React.RefObject<HTMLDivElement | null> }> = ({ containerRef }) => {
  const { gl, camera, size } = useThree();

  useFrame(() => {
    if (!containerRef.current) return;

    const { clientWidth: width, clientHeight: height } = containerRef.current;

    // Sicherstellen, dass die Kamera eine PerspectiveCamera ist
    const perspectiveCamera = camera as THREE.PerspectiveCamera;

    // Prüfen, ob sich die Größe des Containers *deutlich* von der Canvas-Größe unterscheidet
    const widthDiff = Math.abs(size.width - width);
    const heightDiff = Math.abs(size.height - height);

    if (width > 0 && height > 0 && (widthDiff > 1 || heightDiff > 1)) { // Nur bei > 1px Unterschied ändern
      console.log(`Resizing Canvas from ${size.width}x${size.height} to ${width}x${height}`);
      // Renderer-Größe aktualisieren
      gl.setSize(width, height);
      
      // Nur das Aspektverhältnis aktualisieren, wenn es sich tatsächlich um eine PerspectiveCamera handelt
      if (perspectiveCamera.isPerspectiveCamera) {
          perspectiveCamera.aspect = width / height;
          // Kamera-Projektionsmatrix aktualisieren
          perspectiveCamera.updateProjectionMatrix();
      }
    }
  });

  return null; // Diese Komponente rendert nichts Sichtbares
};

// Hilfsfunktion zur Formatierung der verbleibenden Zeit
const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
};

// --- Projectile Mesh Component ---
const ProjectileMesh: React.FC<{ projectile: ProjectileState }> = ({ projectile }) => {
    const meshRef = useRef<THREE.Group>(null!); // Ref auf Group ändern
    // Ähnliche Interpolation wie bei Figuren
    const interpolatedPosition = useRef(new THREE.Vector3(projectile.currentPos.x, 0.5, projectile.currentPos.z));
    const targetPosition = useMemo(() => new THREE.Vector3(projectile.currentPos.x, 0.5, projectile.currentPos.z), [
        projectile.currentPos.x, projectile.currentPos.z
    ]);

     // --- Sprite Loading ---
    // TODO: Dynamischen Pfad basierend auf projectile.unitTypeId verwenden?
    const spriteTexture = useTexture('/sprites/projectile.png');
    // Ladefehler abfangen und Standardwerte verwenden
    const aspectWidth = spriteTexture?.image?.width ?? 1;
    const aspectHeight = spriteTexture?.image?.height ?? 1;
    const spriteAspect = aspectWidth / aspectHeight;

    const spriteHeight = 0.3; // Feste Größe für Projektile?
    const spriteWidth = spriteHeight * spriteAspect;
    const yOffset = spriteHeight / 2; // Höhe anpassen

    useFrame((state, delta) => {
         // Höhe in Zielposition berücksichtigen
        targetPosition.set(projectile.currentPos.x, yOffset, projectile.currentPos.z);
        // Interpolation hinzufügen, um die Bewegung zu glätten
        interpolatedPosition.current.lerp(targetPosition, 0.3); // Faktor ggf. anpassen

        if (meshRef.current) {
            meshRef.current.position.copy(interpolatedPosition.current);
        }
    });

    return (
        // Group wird positioniert
        <group ref={meshRef} position={[interpolatedPosition.current.x, yOffset, interpolatedPosition.current.z]}>
             <Billboard>
                <Plane args={[spriteWidth, spriteHeight]}>
                     <meshBasicMaterial 
                        map={spriteTexture} 
                        transparent={true} 
                        side={THREE.DoubleSide} 
                        alphaTest={0.1} 
                    />
                </Plane>
            </Billboard>
        </group>
    );
};

const GameScreen: React.FC = () => {
  const { playerId } = usePlayerStore();
  const { gameState, setGameState } = useGameStore();
  const [isUnlocking, setIsUnlocking] = useState<string | null>(null);
  const [selectedUnitForPlacement, setSelectedUnitForPlacement] = useState<Unit | null>(null);
  const battlefieldContainerRef = useRef<HTMLDivElement>(null);
  const gameScreenWrapperRef = useRef<HTMLDivElement>(null);
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null); // State für Countdown

  useEffect(() => {
    const handleGameStateUpdate = (updatedGameState: any) => {
      console.log('Game state update empfangen:', updatedGameState);
      setGameState(updatedGameState);
    };
    
    socket.on('game:state-update', handleGameStateUpdate);

    return () => {
      socket.off('game:state-update', handleGameStateUpdate);
    };
  }, [setGameState]);

  useEffect(() => {
    const logSizes = () => {
        const wrapper = gameScreenWrapperRef.current;
        const container = battlefieldContainerRef.current;
        if (wrapper) {
            console.log(`Wrapper Size: ${wrapper.clientWidth}x${wrapper.clientHeight}`);
        }
        if (container) {
            console.log(`Container Size (battlefield): ${container.clientWidth}x${container.clientHeight}`);
        }
    }
    
    logSizes(); // Beim Mounten loggen
    
    // Optional: Bei Fenster-Resize erneut loggen
    window.addEventListener('resize', logSizes);
    return () => window.removeEventListener('resize', logSizes);

  }, []);

  // Effekt für den Countdown-Timer
  useEffect(() => {
      if (gameState?.phase === 'Preparation' && gameState.preparationEndTime) {
          const calculateRemaining = () => {
              const remaining = Math.max(0, (gameState.preparationEndTime! - Date.now()) / 1000);
              setTimeRemaining(remaining);
              if (remaining === 0) {
                  // Timer ist clientseitig abgelaufen (Server sollte Phase ändern)
                  // Keine Aktion hier nötig, da Server die Phase umstellt.
              }
          };
          
          calculateRemaining(); // Sofort berechnen
          const intervalId = setInterval(calculateRemaining, 1000); // Jede Sekunde aktualisieren
          
          return () => clearInterval(intervalId); // Interval beim Verlassen oder Phasenwechsel löschen
      } else {
          setTimeRemaining(null); // Timer zurücksetzen, wenn nicht in Vorbereitung
      }
  }, [gameState?.phase, gameState?.preparationEndTime]); // Abhängig von Phase und Endzeit

  const handleUnlockUnit = (unitId: string) => {
    if (!gameState) return;
    setIsUnlocking(unitId);
    console.log(`Sende 'game:unlock-unit' für Einheit ${unitId}`);
    socket.emit('game:unlock-unit', { gameId: gameState.gameId, unitId }, (response: any) => {
      if (!response?.success) {
        alert(`Fehler beim Freischalten: ${response?.message || 'Unbekannter Fehler'}`);
      }
      setIsUnlocking(null);
    });
  };

  const handleSelectUnitForPlacement = (unit: Unit) => {
    if (!gameState || !selfPlayer) return;
    if (!selfPlayer.unlockedUnits.includes(unit.id)) {
      console.warn("Versuch, nicht freigeschaltete Einheit zum Platzieren auszuwählen.");
      return;
    }
    if (selfPlayer.credits < unit.placementCost) {
      console.warn("Nicht genug Credits zum Platzieren dieser Einheit.");
      return;
    }
    console.log(`Einheit zum Platzieren ausgewählt: ${unit.name}`);
    setSelectedUnitForPlacement(unit);
  };

  // NEU: Handler für "Kampf starten" Button
  const handleForceStartCombat = () => {
      if (!gameState || !playerId || gameState.hostId !== playerId || gameState.phase !== 'Preparation') {
          console.warn('Versuch, Kampfstart außerhalb der erlaubten Bedingungen zu erzwingen.');
          return;
      }
      console.log(`[${playerId}] Erzwinge Kampfstart für Spiel ${gameState.gameId}`);
      socket.emit('game:force-start-combat', gameState.gameId, (response: any) => {
          if (!response?.success) {
              alert(`Fehler beim Starten des Kampfes: ${response?.message || 'Unbekannter Fehler'}`);
          }
          // Der GameState wird durch das 'game:state-update' Event aktualisiert
      });
  };

  if (!gameState) {
    return <div>Lade Spielzustand...</div>;
  }

  const selfPlayer = gameState.players.find((p: PlayerInGame) => p.id === playerId);
  const opponentPlayer = gameState.players.find((p: PlayerInGame) => p.id !== playerId);

  const availableUnits = placeholderUnits.filter(unit => unit.faction === selfPlayer?.faction);

  // Memoize die Listen, um unnötige Neuzuordnungen zu vermeiden
  const allPlacedUnits = useMemo(() => gameState?.players.flatMap(p => p.placedUnits) ?? [], [gameState?.players]);
  const activeProjectiles = useMemo(() => gameState?.activeProjectiles ?? [], [gameState?.activeProjectiles]);

  const isHost = gameState && playerId !== null && gameState.hostId === playerId;

  console.log('[GameScreen Render] Units:', allPlacedUnits.length, 'Projectiles:', activeProjectiles.length);
  return (
    <div ref={gameScreenWrapperRef} className="game-screen-wrapper">
      <div ref={battlefieldContainerRef} className="battlefield-container">
        <Canvas camera={{ position: [70, 50, 0], fov: 50 }}>
          <Suspense fallback={null}> 
            <CanvasUpdater containerRef={battlefieldContainerRef} /> 
            <ambientLight intensity={0.6} />
            <directionalLight position={[10, 20, 5]} intensity={0.8} />

            {/* NEU: Achsen-Helfer (direkt nutzbar) */}
            <axesHelper args={[10]} />

            {/* Boden-Plane OHNE Platzierungs-Handler */}
            <Plane args={[50, 50]} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 25]}>
              <meshStandardMaterial color="#cccccc" side={THREE.DoubleSide} />
            </Plane>
           
            <OrbitControls 
              enableRotate={false} 
              enablePan={true}     
              mouseButtons={{
                LEFT: THREE.MOUSE.PAN,   
                MIDDLE: THREE.MOUSE.DOLLY, 
              }}
              screenSpacePanning={false}
            /> 

            {/* NEU: Platziersystem rendern */}
            <PlacementSystem 
                gameState={gameState}
                playerId={playerId}
                selfPlayer={selfPlayer}
                selectedUnitForPlacement={selectedUnitForPlacement}
                setSelectedUnitForPlacement={setSelectedUnitForPlacement}
            />
           
            {/* Platziere Einheiten */}
            {allPlacedUnits.map(unit => (
                <PlacedUnitMesh key={unit.instanceId} placedUnit={unit} />
            ))}

            {/* Aktive Projektile */}
            {activeProjectiles.map(projectile => (
                <ProjectileMesh key={projectile.projectileId} projectile={projectile} />
            ))}

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
            const canAffordUnlock = selfPlayer ? selfPlayer.credits >= unit.unlockCost : false;
            const canAffordPlacement = selfPlayer ? selfPlayer.credits >= unit.placementCost : false;
            const unlockingThis = isUnlocking === unit.id;
            const isSelectedForPlacement = selectedUnitForPlacement?.id === unit.id;

            // Bestimme, ob die Kachel überhaupt klickbar sein soll
            const isDisabled = unlockingThis || // Wenn gerade freigeschaltet wird
                             (!isUnlocked && !canAffordUnlock) || // Wenn gesperrt & nicht leisten können
                             (isUnlocked && !canAffordPlacement) || // Wenn frei & nicht leisten können
                             (isUnlocked && !!selectedUnitForPlacement && !isSelectedForPlacement); // Wenn frei, aber ANDERE Einheit gewählt ist

            const handleClick = () => {
                if (!isUnlocked) {
                    handleUnlockUnit(unit.id);
                } else {
                    // Wenn diese bereits ausgewählt ist, Auswahl aufheben
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
                {/* Schloss-Icon (wenn gesperrt) */}
                {!isUnlocked && (
                    <div className="unit-tile-lock" aria-hidden="true">🔒</div>
                )}

                {/* --- HIER kommt die Grafik rein --- */}
                <img 
                    src={`/assets/units/${unit.id}.png`} 
                    alt={unit.name} 
                    onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.nextElementSibling?.classList.remove('hidden'); }} // Bild verstecken, Text zeigen bei Fehler
                    loading="lazy"
                />
                {/* Fallback-Text, falls Bild nicht lädt */}
                <span className="unit-tile-fallback hidden">{unit.icon || unit.id.substring(0,3)}</span> 
                
                {/* Kostenanzeige */}
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

export default GameScreen;