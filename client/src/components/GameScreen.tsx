import React, { useEffect, useState, useMemo, useRef, Suspense } from 'react';
import { usePlayerStore } from '../store/playerStore';
import { useGameStore } from '../store/gameStore';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, Box, Plane, Sphere, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { PlayerInGame, PlacedUnit, GameState as ClientGameState, FigureState, ProjectileState } from '../types/game.types';
import { socket } from '../socket';
import { placeholderUnits, Unit } from '../../../server/src/units/unit.types';
import './GameScreen.css';

// --- Figure Mesh Component --- 
const FigureMesh: React.FC<{ figureData: FigureState }> = ({ figureData }) => {
    const meshRef = useRef<THREE.Group>(null!); // Ref für das Modell (Group)
    const interpolatedPosition = useRef(new THREE.Vector3(figureData.position.x, 0, figureData.position.z)); // Y = 0 für Basis
    const targetPosition = useMemo(() => new THREE.Vector3(figureData.position.x, 0, figureData.position.z), [
        figureData.position.x, figureData.position.z
    ]);

    // Lade das Modell nur für human_infantry
    const isSoldier = figureData.unitTypeId === 'human_infantry';
    // Pfad zum Modell - stelle sicher, dass es in public/models/ liegt!
    const modelPath = '/models/soldier.glb'; 
    const { scene } = useGLTF(isSoldier ? modelPath : ''); // Nur laden, wenn isSoldier true

    useFrame((state, delta) => {
        interpolatedPosition.current.lerp(targetPosition, 0.1);
        if (meshRef.current) {
            meshRef.current.position.copy(interpolatedPosition.current);
            // TODO: Rotation anpassen, wenn sich die Figur bewegt oder angreift?
        }
    });

    // Wenn es ein Soldat ist, rendere das Modell
    if (isSoldier && scene) {
        // Klonen der Szene ist wichtig, wenn mehrere Instanzen desselben Modells verwendet werden
        const clonedScene = useMemo(() => scene.clone(), [scene]);
        return (
            <primitive 
                ref={meshRef} 
                object={clonedScene} 
                scale={0.5} // Beispiel: Skalierung anpassen
                position={[figureData.position.x, 0, figureData.position.z]} // Y=0, da Modell Ursprung am Boden haben sollte
                // rotation={[0, Math.PI, 0]} // Beispiel: Drehung, falls nötig
                userData={{ figureId: figureData.figureId }}
            />
        );
    } else {
        // Fallback: Rendere die Kugel für andere Einheiten oder wenn Modell noch nicht geladen
        const color = figureData.playerId === usePlayerStore.getState().playerId ? "royalblue" : "indianred";
        return (
            <Sphere 
                // @ts-ignore - meshRef ist hier für Sphere nicht ganz korrekt, aber für Position ok
                ref={meshRef} 
                key={figureData.figureId} 
                args={[0.4, 16, 16]} 
                position={[figureData.position.x, 0.5, figureData.position.z]} // Kugel leicht anheben
                userData={{ figureId: figureData.figureId }}
            >
                <meshStandardMaterial color={color} />
            </Sphere>
        );
    }
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

// Komponente zur Darstellung der Platzierungs-Vorschau
const PlacementPreviewMesh: React.FC<{ unit: Unit, position: { x: number, z: number } }> = ({ unit, position }) => {
  console.log('[PlacementPreviewMesh] Rendering preview for', unit.id, 'at', position);
  const yOffset = 0.05; 
  return (
    <mesh 
      position={[position.x, yOffset, position.z]} 
      rotation={[-Math.PI / 2, 0, 0]} 
    >
      <planeGeometry args={[unit.width, unit.height]} /> 
      <meshBasicMaterial 
        color="yellow" 
        transparent 
        opacity={0.5} 
        side={THREE.DoubleSide}
      />
    </mesh>
  );
};

// NEU: Komponente zur Hervorhebung der Platzierungszone
const PlacementZoneHighlight: React.FC<{ gameState: ClientGameState, playerId: number | null }> = ({ gameState, playerId }) => {
  // Definiere Grid-Dimensionen (sollten mit Server übereinstimmen)
  const GRID_WIDTH = 50;
  const PLAYER_ZONE_DEPTH = 20;
  const NEUTRAL_ZONE_DEPTH = 10;
  const TOTAL_DEPTH = PLAYER_ZONE_DEPTH * 2 + NEUTRAL_ZONE_DEPTH;

  // Berechne Grid-Grenzen (Ecken)
  const gridMinX = -GRID_WIDTH / 2;
  const gridMaxX = GRID_WIDTH / 2;
  const gridMinZ = 0;
  const gridMaxZ = TOTAL_DEPTH;

  // Bestimme Spielerzone
  let playerMinZ: number | null = null;
  let playerMaxZ: number | null = null;

  if (playerId !== null) {
    const isHostPlacing = playerId === gameState.hostId;
    if (isHostPlacing) {
      playerMinZ = gridMinZ; // 0
      playerMaxZ = PLAYER_ZONE_DEPTH;
    } else {
      playerMinZ = PLAYER_ZONE_DEPTH + NEUTRAL_ZONE_DEPTH;
      playerMaxZ = gridMaxZ; // TOTAL_DEPTH
    }
  }

  // Definiere die Eckpunkte der Zone, wenn bekannt
  const points = useMemo(() => {
    if (playerMinZ === null || playerMaxZ === null) return [];
    // Eckpunkte definieren (im Uhrzeigersinn)
    const p1 = new THREE.Vector3(gridMinX, 0, playerMinZ);
    const p2 = new THREE.Vector3(gridMaxX, 0, playerMinZ);
    const p3 = new THREE.Vector3(gridMaxX, 0, playerMaxZ);
    const p4 = new THREE.Vector3(gridMinX, 0, playerMaxZ);
    // Liniensegmente: [p1, p2], [p2, p3], [p3, p4], [p4, p1]
    return [p1, p2, p2, p3, p3, p4, p4, p1];
  }, [gridMinX, gridMaxX, playerMinZ, playerMaxZ]);

  if (points.length === 0) return null; // Nichts rendern, wenn Zone unbekannt

  // BufferGeometry für die Linien
  const lineGeometry = useMemo(() => new THREE.BufferGeometry().setFromPoints(points), [points]);

  // Leicht erhöht, um über dem Grid/Plane zu schweben
  const yOffset = 0.01;

  return (
    <lineSegments geometry={lineGeometry} position={[0, yOffset, 0]}>
      <lineBasicMaterial color="green" linewidth={2} />
    </lineSegments>
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
    const meshRef = useRef<THREE.Mesh>(null!); 
    // Ähnliche Interpolation wie bei Figuren
    const interpolatedPosition = useRef(new THREE.Vector3(projectile.currentPos.x, 0.5, projectile.currentPos.z));
    const targetPosition = useMemo(() => new THREE.Vector3(projectile.currentPos.x, 0.5, projectile.currentPos.z), [
        projectile.currentPos.x, projectile.currentPos.z
    ]);

    useFrame((state, delta) => {
         // Einfachere Interpolation für Projektile (oder gar keine?)
         // Da sie sich geradlinig bewegen, könnten wir auch die Server-Position nehmen.
         // Testweise: Direkte Position vom Server
         // interpolatedPosition.current.lerp(targetPosition, 0.2); 
        interpolatedPosition.current.copy(targetPosition); // Direkt setzen

        if (meshRef.current) {
            meshRef.current.position.copy(interpolatedPosition.current);
        }
    });

    return (
        <Sphere 
            ref={meshRef}
            args={[0.15, 8, 8]}
            position={[projectile.currentPos.x, 0.5, projectile.currentPos.z]}
        >
            <meshBasicMaterial color="orange" />
        </Sphere>
    );
};

const GameScreen: React.FC = () => {
  const { playerId } = usePlayerStore();
  const { gameState, setGameState } = useGameStore();
  const [isUnlocking, setIsUnlocking] = useState<string | null>(null);
  const [selectedUnitForPlacement, setSelectedUnitForPlacement] = useState<Unit | null>(null);
  const [placementPreviewPosition, setPlacementPreviewPosition] = useState<{ x: number, z: number } | null>(null);
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

  // Handler für Mausbewegung auf dem Grid
  const handleGridPointerMove = (event: any /* ThreeEvent<PointerEvent> */) => {
    if (!selectedUnitForPlacement) {
        if (placementPreviewPosition !== null) {
            // console.log('[handleGridPointerMove] Resetting preview (no unit selected)');
            setPlacementPreviewPosition(null);
        }
        return;
    }
    const point = event.point;
    if (point) {
        const previewX = Math.round(point.x);
        const previewZ = Math.round(point.z);
        if (!placementPreviewPosition || placementPreviewPosition.x !== previewX || placementPreviewPosition.z !== previewZ) {
             console.log(`[handleGridPointerMove] Setting preview position: { x: ${previewX}, z: ${previewZ} }`);
             setPlacementPreviewPosition({ x: previewX, z: previewZ });
        }
    } else {
        if (placementPreviewPosition !== null) {
             console.log('[handleGridPointerMove] Resetting preview (pointer left grid)');
             setPlacementPreviewPosition(null);
        }
    }
  };

  // Handler für das Verlassen des Grids mit dem Mauszeiger
  const handleGridPointerOut = (event: any /* ThreeEvent<PointerEvent> */) => {
      if (placementPreviewPosition !== null) {
         console.log('[handleGridPointerOut] Resetting preview');
         setPlacementPreviewPosition(null);
      }
  };

  // Handler für Klick auf das 3D-Grid
  const handleGridClick = (event: any /* ThreeEvent<MouseEvent> */) => {
    console.log('[handleGridClick] Click detected.'); // Log Klick
    if (!selectedUnitForPlacement || !gameState || !selfPlayer) {
        console.log('[handleGridClick] Aborted (no unit/game/player).');
        return;
    }
    event.stopPropagation();
    const clickPoint = event.point;
    // Vorsicht: clickPoint kann null sein, wenn Klick knapp daneben geht?
    if (!clickPoint) {
        console.log('[handleGridClick] Aborted (no clickPoint).');
        return;
    }
    const gridX = Math.round(clickPoint.x);
    const gridZ = Math.round(clickPoint.z);
    
    console.log(`[handleGridClick] Calculated grid coords: (${gridX}, ${gridZ})`);
    setPlacementPreviewPosition(null); // Reset preview

    const placementData = {
        gameId: gameState.gameId,
        unitId: selectedUnitForPlacement.id,
        position: { x: gridX, z: gridZ }, 
    };
    console.log("[handleGridClick] Emitting 'game:place-unit' with data:", placementData);
    socket.emit('game:place-unit', placementData, (response: any) => {
        console.log('[handleGridClick] Server response:', response); // Log Server-Antwort
        if (!response?.success) {
            alert(`Fehler beim Platzieren: ${response?.message || 'Unbekannter Fehler'}`);
        }
        setSelectedUnitForPlacement(null);
    });
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
        <Canvas camera={{ position: [0, 50, 70], fov: 50 }}>
          <Suspense fallback={null}> 
            <CanvasUpdater containerRef={battlefieldContainerRef} /> 
            <ambientLight intensity={0.6} />
            <directionalLight position={[10, 20, 5]} intensity={0.8} />

            <Plane
              args={[100, 100]}
              rotation={[-Math.PI / 2, 0, 0]}
              position={[0, -0.01, 0]}
              onClick={handleGridClick}
              onPointerMove={handleGridPointerMove}
              onPointerOut={handleGridPointerOut}
            >
              <meshStandardMaterial color="#cccccc" side={THREE.DoubleSide} />
            </Plane>
           
            <OrbitControls />

            {gameState && gameState.phase === 'Preparation' && playerId !== null &&
                <PlacementZoneHighlight gameState={gameState} playerId={playerId} />
            }
           
            {allPlacedUnits.map(unit => (
                <PlacedUnitMesh key={unit.instanceId} placedUnit={unit} />
            ))}

            {selectedUnitForPlacement && placementPreviewPosition && 
                <PlacementPreviewMesh unit={selectedUnitForPlacement} position={placementPreviewPosition} />
            }

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
        <div className="unit-list">
          {availableUnits.map((unit: Unit) => {
            const isUnlocked = selfPlayer?.unlockedUnits.includes(unit.id);
            const canAffordUnlock = selfPlayer ? selfPlayer.credits >= unit.unlockCost : false;
            const canAffordPlacement = selfPlayer ? selfPlayer.credits >= unit.placementCost : false;
            const unlockingThis = isUnlocking === unit.id;
            const isSelectedForPlacement = selectedUnitForPlacement?.id === unit.id;

            return (
              <div key={unit.id} className={`unit-item ${isUnlocked ? 'unlocked' : ''} ${isSelectedForPlacement ? 'selected-for-placement' : ''}`}>
                <span>{unit.name} ({unit.icon})</span>
                <span>U:{unit.unlockCost} P:{unit.placementCost}</span>
                
                {!isUnlocked ? (
                  <button 
                     onClick={() => handleUnlockUnit(unit.id)}
                     disabled={!canAffordUnlock || !!isUnlocking}
                  >
                    {unlockingThis ? '...' : 'Freischalten'}
                  </button>
                ) : (
                  <button 
                     onClick={() => handleSelectUnitForPlacement(unit)}
                     disabled={!canAffordPlacement || !!selectedUnitForPlacement}
                  >
                    Platzieren
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default GameScreen; 