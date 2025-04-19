import React, { useEffect, useState, useMemo, useRef, Suspense } from 'react';
import { usePlayerStore } from '../store/playerStore';
import { useGameStore } from '../store/gameStore';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, Box, Plane, Sphere, useGLTF, Billboard } from '@react-three/drei';
import * as THREE from 'three';
import { PlayerInGame, PlacedUnit, GameState as ClientGameState, FigureState, ProjectileState } from '../types/game.types';
import { socket } from '../socket';
import { placeholderUnits, Unit } from '../../../server/src/units/unit.types';
import './GameScreen.css';

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

    // Lade das Modell NUR für human_infantry
    const isSoldier = figureData.unitTypeId === 'human_infantry';
    const modelPath = '/models/soldier.glb'; 
    // Verwende useGLTF nur, wenn es ein Soldat ist
    const gltf = isSoldier ? useGLTF(modelPath) : null;
    const scene = gltf?.scene;

    // Effekt zum Berechnen des Y-Offsets, WENN das Modell geladen ist
    useEffect(() => {
        // Nur ausführen, wenn es ein Soldat ist, die Szene geladen wurde UND das Mesh-Ref existiert
        if (isSoldier && scene && meshRef.current) {
            // Stelle sicher, dass das Objekt sichtbar ist und eine Geometrie hat, bevor die Box berechnet wird
            let validObjectFound = false;
            scene.traverse((child) => {
                 // Linter-Fix: Prüfe, ob child ein Mesh ist, bevor auf Mesh-Eigenschaften zugegriffen wird
                if (!validObjectFound && child instanceof THREE.Mesh && child.geometry) {
                    validObjectFound = true;
                }
            });

            if (validObjectFound) {
                // Wende die Skalierung auf das meshRef AN, BEVOR die BBox berechnet wird
                meshRef.current.scale.set(modelScale, modelScale, modelScale);
                meshRef.current.updateMatrixWorld(true); // Erzwinge Matrix-Update

                const box = new THREE.Box3().setFromObject(meshRef.current);
                const modelHeightOffset = box.min.y; // Wie weit geht das Modell unter den Pivot?
                // Setze den Offset nur, wenn die Box gültig ist (nicht unendlich)
                if (box.min.y !== Infinity && box.min.y !== -Infinity) {
                     console.log(`Calculated Y offset for ${figureData.unitTypeId} (Scale: ${modelScale}): ${modelHeightOffset.toFixed(3)}`);
                     setYOffset(-modelHeightOffset);
                } else {
                    console.warn(`Could not calculate valid bounding box for ${figureData.unitTypeId}. Using Y-Offset 0.`);
                    setYOffset(0);
                }
                 // Skalierung nach Berechnung zurücksetzen? Nein, sie wird im Frame neu gesetzt.
            } else {
                 console.warn(`No valid mesh found in the loaded scene for ${figureData.unitTypeId} to calculate Y-Offset.`);
                 setYOffset(0);
            }
        } else if (!isSoldier) {
            // Für Nicht-Soldaten (Kugeln) den Offset zurücksetzen oder anpassen
            setYOffset(0.5 * modelScale); // Kugelmittelpunkt ist auf halber Höhe
        }
        // Füge modelScale als Abhängigkeit hinzu, falls sich die Skala ändern kann
    }, [scene, isSoldier, figureData.unitTypeId, modelScale]);

    useFrame((state, delta) => {
        // Zielposition inkl. dynamischem Y-Offset
        targetPosition.set(figureData.position.x, yOffset, figureData.position.z);
        interpolatedPosition.current.lerp(targetPosition, 0.1);
        
        const movementDirection = interpolatedPosition.current.clone().sub(lastPosition.current);
        lastPosition.current.copy(interpolatedPosition.current);

        if (meshRef.current) {
            meshRef.current.position.copy(interpolatedPosition.current);
             // Setze Skalierung für Modell ODER Kugel
            meshRef.current.scale.set(modelScale, modelScale, modelScale);

            const moveLengthSq = movementDirection.lengthSq();
            if (moveLengthSq > 0.0001) { 
                const angle = Math.atan2(movementDirection.x, movementDirection.z);
                 // Direkte Rotation, falls Lerp Probleme macht:
                 // meshRef.current.rotation.y = angle;
                // Sanfte Rotation:
                meshRef.current.rotation.y = THREE.MathUtils.lerp(meshRef.current.rotation.y, angle, 0.1);
            }
        }
    });

    // Entscheide, was gerendert wird (Modell oder Kugel)
    let figureVisual;
    // Zeige Modell NUR wenn isSoldier UND scene geladen ist
    if (isSoldier && scene) { 
        const clonedScene = useMemo(() => scene.clone(), [scene]);
        figureVisual = (
            <primitive 
                object={clonedScene} 
                // Skalierung und Position werden im Frame gesetzt
                userData={{ figureId: figureData.figureId }}
            />
        );
    } else {
        // Zeige Kugel für ALLE anderen Fälle (nicht Soldat ODER Szene noch nicht geladen)
        const color = figureData.playerId === usePlayerStore.getState().playerId ? "royalblue" : "indianred";
        figureVisual = (
            <Sphere 
                args={[0.4, 16, 16]} // Basisgröße, Skalierung erfolgt über Group
                // Position wird im Frame gesetzt
                userData={{ figureId: figureData.figureId }}
            >
                <meshStandardMaterial color={color} />
            </Sphere>
        );
        // Stelle sicher, dass der Y-Offset für die Kugel im Frame korrekt gesetzt wird
        // (passiert bereits im useEffect/useFrame oben)
    }

    return (
        // Group wird skaliert und positioniert
        <group ref={meshRef} key={figureData.figureId}>
            {figureVisual} 
            {figureData.currentHP < maxHP && 
                // Skaliere HealthBar NICHT hier, da die Group schon skaliert wird
                <HealthBar currentHP={figureData.currentHP} maxHP={maxHP} scale={1.0} /> // Skala 1, da Eltern-Group skaliert
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