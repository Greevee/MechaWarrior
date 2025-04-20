import React, { useEffect, useState, useMemo, useRef, Suspense } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, Box, Plane, Sphere, useGLTF, Billboard, useTexture, Line, Html, Stats } from '@react-three/drei';
import * as THREE from 'three';
import { PlacedUnit, GameState as ClientGameState, FigureState, ProjectileState, FigureBehaviorState, GamePhase } from '../types/game.types';
import { placeholderUnits, Unit } from '../../../server/src/units/unit.types';
import './GameScreen.css';
import PlacementSystem from './PlacementSystem.tsx';
import ErrorBoundary from './ErrorBoundary';

// --- Health Bar Component ---
const HealthBar: React.FC<{ currentHP: number, maxHP: number, scale: number }> = React.memo(({ currentHP, maxHP, scale }) => {
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
});

// --- Figure Mesh Component --- 
const FigureMesh: React.FC<{ figureData: FigureState, gamePhase: GamePhase }> = React.memo(({ figureData, gamePhase }) => {
    const meshRef = useRef<THREE.Group>(null!); 
    const interpolatedPosition = useRef(new THREE.Vector3(figureData.position.x, 0, figureData.position.z));
    const targetPosition = useMemo(() => new THREE.Vector3(figureData.position.x, 0, figureData.position.z), [
        figureData.position.x, figureData.position.z
    ]);
    const lastPosition = useRef(new THREE.Vector3().copy(interpolatedPosition.current));
    const [yOffset, setYOffset] = useState(0);
    const facingScaleX = useRef(1); // Ref für die horizontale Ausrichtung (1 = rechts, -1 = links)

    const unitData = useMemo(() => placeholderUnits.find(u => u.id === figureData.unitTypeId), [figureData.unitTypeId]);
    const modelScale = unitData?.modelScale ?? 1;
    const maxHP = unitData?.hp ?? 100; 

    // --- Sprite Loading ---
    // Hilfsfunktion zum Erstellen des dynamischen Pfads
    const getTexturePath = (unitTypeId: string, behavior: FigureBehaviorState): string => {
        // ACHTUNG: unitTypeId muss exakt dem Ordnernamen entsprechen (Groß/Kleinschreibung)!
        // Gib einfach den primären Pfad zurück. Das Laden/Fehlerbehandlung erfolgt durch useTexture/Suspense/ErrorBoundary.
        return `/assets/units/${unitTypeId}/${behavior}.png`;
    };

    // Erstelle den Pfad basierend auf dem aktuellen Zustand
    const texturePath = useMemo(() => {
         return getTexturePath(figureData.unitTypeId, figureData.behavior);
    }, [figureData.unitTypeId, figureData.behavior]); // Neu berechnen, wenn sich Typ oder Verhalten ändert

    // Lade die dynamische Textur
    // Wenn dieser Pfad ungültig ist, wirft useTexture einen Fehler, der von einer
    // React Error Boundary oder dem Suspense Fallback (je nach Konfiguration)
    // behandelt werden muss.
    const spriteTexture = useTexture(texturePath); 
    
    // Ladefehler abfangen und Standardwerte verwenden (für Aspect Ratio)
    const aspectWidth = spriteTexture?.image?.width ?? 1;
    const aspectHeight = spriteTexture?.image?.height ?? 1;
    const spriteAspect = aspectWidth / aspectHeight;

    const spriteHeight = 1.0 * modelScale; // Basis-Höhe, skaliert mit modelScale
    const spriteWidth = spriteHeight * spriteAspect;

    // Effekt zum Setzen des Farbraums der Textur
    useEffect(() => {
        if (spriteTexture) {
            spriteTexture.colorSpace = THREE.SRGBColorSpace; // Explizit setzen
            spriteTexture.needsUpdate = true;
        }
    }, [spriteTexture]);

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

        const moveThreshold = 0.001; // Kleiner Schwellenwert
        const centerZ = 25; // Mittellinie

        // Priorität 1: Im Kampf (attacking) immer zum Gegner (basierend auf Z)
        if (figureData.behavior === 'attacking') {
            if (figureData.position.z < centerZ) {
                facingScaleX.current = 1; 
            } else {
                facingScaleX.current = -1;
            }
        // Priorität 2: In Vorbereitung (Preparation) und untätig (idle) immer zum Gegner (basierend auf Z)
        } else if (gamePhase === 'Preparation' && figureData.behavior === 'idle') {
             if (figureData.position.z < centerZ) {
                facingScaleX.current = 1; 
            } else {
                facingScaleX.current = -1;
            }
        // Priorität 3: Ansonsten (moving oder idle außerhalb von Preparation) basierend auf Bewegung
        } else {
            if (movementDirection.z < -moveThreshold) {
                facingScaleX.current = -1; // Nach -Z bewegen
            } else if (movementDirection.z > moveThreshold) {
                facingScaleX.current = 1; // Nach +Z bewegen
            }
            // Bei sehr kleiner Bewegung: Richtung beibehalten
        }

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

    return (
        // Group wird NUR noch positioniert
        <group ref={meshRef} key={figureData.figureId}>
            <Billboard>             
                 {/* Original Sprite-Plane */}
                 <Plane args={[spriteWidth, spriteHeight]} scale={[facingScaleX.current, 1, 1]}>
                      <meshBasicMaterial
                         color="white" // Explizit auf Weiß setzen
                         map={spriteTexture} // Verwende die dynamisch geladene Textur
                         transparent={true}
                         side={THREE.DoubleSide} 
                         alphaTest={0.1} 
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
});

// Eine Fallback-Komponente, die den Placeholder rendert
// Wird benötigt, da wir Props an FigureMesh übergeben müssen.
const FigurePlaceholderFallback: React.FC<{ figureData: FigureState }> = ({ figureData }) => {
    // Erstelle ein modifiziertes figureData-Objekt, das nur den Placeholder-Pfad verwendet
    const placeholderFigureData = useMemo(() => ({
        ...figureData,
        // Überschreibe behavior temporär, um sicherzustellen, dass getTexturePath
        // nicht erneut fehlschlägt, wenn wir es komplexer machen würden.
        // Oder, noch einfacher: Wir laden die Textur direkt mit dem Placeholder-Pfad.
        // (Wir bleiben bei der jetzigen Struktur, wo useTexture den Pfad nimmt)
    }), [figureData]);

    // Wir geben die originalen figureData weiter, aber der `useTexture` Aufruf 
    // IN DER ERROR BOUNDARY wird den Fehler auslösen und DIESE Komponente rendern.
    // Eine bessere Lösung wäre, einen spezifischen Prop für den Pfad zu haben.
    // Für jetzt: Wir übergeben die originalen Daten und verlassen uns darauf,
    // dass die ErrorBoundary *diese* Instanz rendert.
    
    // ALTERNATIVE (Sauberer): FigureMesh so umbauen, dass es einen texturePath-Prop akzeptiert.
    // Dann könnte man hier aufrufen: <FigureMesh figureData={figureData} texturePath="/assets/units/placeholder/figure_placeholder.png" />
    
    // Aktueller Ansatz: Rendere FigureMesh normal, die Boundary fängt den Fehler.
    // Der Fallback der Boundary ist dann ein einfacher Text oder eine andere Komponente.
    // Wir müssen den Fallback also in der Nutzung der ErrorBoundary definieren.
    
    // Simplifizierter Fallback: Einfach nichts oder eine Box rendern?
    // return <Box args={[1, 1, 1]} position={[figureData.position.x, 0.5, figureData.position.z]} />; 
    // Vorerst geben wir NULL zurück, die Boundary zeigt die globale Meldung.
    return null; 
};

// --- Placed Unit Mesh (rendert jetzt FigureMesh-Komponenten) ---
// --- Placed Unit Mesh (rendert jetzt FigureMesh mit Error Boundary) ---
const PlacedUnitMesh: React.FC<{ placedUnit: PlacedUnit, gamePhase: GamePhase }> = React.memo(({ placedUnit, gamePhase }) => {
    return (
        <group userData={{ unitInstanceId: placedUnit.instanceId }}> 
            {placedUnit.figures.map((figure: FigureState) => {
                // Jede Figur wird von einer ErrorBoundary umschlossen.
                return (
                    <ErrorBoundary 
                        key={figure.figureId} 
                        fallback={
                            // Definiere hier den Fallback, der angezeigt wird, wenn useTexture in FigureMesh fehlschlägt.
                            // Wir rendern eine einfache Box an der Position der Figur als visuellen Hinweis.
                            <mesh position={[figure.position.x, 0.5, figure.position.z]}>
                                <boxGeometry args={[0.5, 0.5, 0.5]} />
                                <meshStandardMaterial color="red" />
                            </mesh>
                        }
                    >
                        {/* Suspense für das Laden der Textur in FigureMesh */}
                        <Suspense fallback={
                            // Optional: Ein anderer Fallback *während* des Ladens (kann auch die rote Box sein)
                            <mesh position={[figure.position.x, 0.5, figure.position.z]}>
                                <boxGeometry args={[0.5, 0.5, 0.5]} />
                                <meshStandardMaterial color="yellow" wireframe />
                            </mesh>
                        }>
                            <FigureMesh 
                                figureData={figure}
                                gamePhase={gamePhase}
                            />
                        </Suspense>
                    </ErrorBoundary>
                );
            })}
        </group>
    );
});

// Hilfskomponente zur Anpassung der Canvas-Größe
const CanvasUpdater: React.FC<{ containerRef: React.RefObject<HTMLDivElement | null> }> = React.memo(({ containerRef }) => {
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
});

// Hilfsfunktion zur Formatierung der verbleibenden Zeit
const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
};

// --- Projectile Mesh Component ---
const ProjectileMesh: React.FC<{ projectile: ProjectileState }> = React.memo(({ projectile }) => {
    const meshRef = useRef<THREE.Group>(null!); 
    // Ähnliche Interpolation wie bei Figuren
    const interpolatedPosition = useRef(new THREE.Vector3(projectile.currentPos.x, 0.5, projectile.currentPos.z));
    const targetPosition = useMemo(() => new THREE.Vector3(projectile.currentPos.x, 0.5, projectile.currentPos.z), [
        projectile.currentPos.x, projectile.currentPos.z
    ]);

     // --- Sprite Loading ---
    // Erstelle den Pfad zur Projektil-Grafik dynamisch
    const getProjectileTexturePath = (unitTypeId: string): string => {
        // Annahme: /assets/projectiles/{unitTypeId}_projectile.png
        // TODO: Bessere Fehlerbehandlung / Fallback
        console.log(`Generiere Projektil-Pfad für useTexture: /assets/projectiles/${unitTypeId}_projectile.png`);
        return `/assets/projectiles/${unitTypeId}_projectile.png`;
    };

    const texturePath = useMemo(() => {
        return getProjectileTexturePath(projectile.unitTypeId);
    }, [projectile.unitTypeId]);

    // Lade die dynamische Textur
    // Fehler werden durch Suspense/ErrorBoundary außen behandelt
    const spriteTexture = useTexture(texturePath);

    // Ladefehler abfangen und Standardwerte verwenden
    const aspectWidth = spriteTexture?.image?.width ?? 1;
    const aspectHeight = spriteTexture?.image?.height ?? 1;
    const spriteAspect = aspectWidth / aspectHeight;

    const spriteHeight = 0.3; // Feste Größe für Projektile?
    const spriteWidth = spriteHeight * spriteAspect;
    const yOffset = spriteHeight / 2; // Höhe anpassen

    // Effekt zum Setzen des Farbraums der Textur
    useEffect(() => {
        if (spriteTexture) {
            spriteTexture.colorSpace = THREE.SRGBColorSpace; // Explizit setzen
            spriteTexture.needsUpdate = true;
        }
    }, [spriteTexture]);

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
                        color="white" // Explizit auf Weiß setzen
                        map={spriteTexture} 
                        transparent={true} 
                        side={THREE.DoubleSide} 
                        alphaTest={0.1} 
                    />
                </Plane>
            </Billboard>
        </group>
    );
});

// NEU: Definiere Props für GameScreen
interface GameScreenProps {
    gameState: ClientGameState;
    playerId: number | null;
    battlefieldContainerRef: React.RefObject<HTMLDivElement | null>;
    // Props für Platzierung von GameLoader erhalten
    selectedUnitForPlacement: Unit | null;
    setSelectedUnitForPlacement: React.Dispatch<React.SetStateAction<Unit | null>>;
}

const GameScreen: React.FC<GameScreenProps> = ({ 
    gameState, 
    playerId, 
    battlefieldContainerRef,
    selectedUnitForPlacement, // Prop empfangen
    setSelectedUnitForPlacement, // Prop empfangen
}) => {
  const { camera } = useThree(); // Kamera-Objekt wieder hinzufügen

  // Zustand und Logik für UI-Elemente wurden nach GameLoader verschoben
  // Wir benötigen hier nur noch die Logik, die *direkt* die 3D-Szene beeinflusst.

  // selectedUnitForPlacement wird weiterhin benötigt für PlacementSystem
  // Lokaler State entfernt, wird jetzt als Prop empfangen.

  // Berechnungen, die *nur* für die 3D-Szene relevant sind:
  const allPlacedUnits = useMemo(() => gameState?.players.flatMap(p => p.placedUnits) ?? [], [gameState?.players]);
  const activeProjectiles = useMemo(() => gameState?.activeProjectiles ?? [], [gameState?.activeProjectiles]);
  const selfPlayer = useMemo(() => gameState?.players.find(p => p.id === playerId), [gameState, playerId]); // Wird für PlacementSystem benötigt

  // Define axis length for helper
  const axisLength = 10;

  // Effekt zum einmaligen Setzen der initialen Kameraposition und des Ziels
  useEffect(() => {
    // const initialPosition = new THREE.Vector3(-25, 5, 25);
    // const targetPosition = new THREE.Vector3(-20, 0, 25); // Blick entlang X mit 45° Neigung von y=5 auf y=0
    const initialPosition = new THREE.Vector3(-25, 25, 25); 
    const targetPosition = new THREE.Vector3(0, 0, 25); 

    camera.position.copy(initialPosition);
    camera.lookAt(targetPosition);
  }, [camera]);

  if (!gameState) {
    // Sollte nicht passieren, da GameLoader wartet
    return <div>Lade Spielzustand...</div>;
  }

  return (
    <>
        {/* FPS Anzeige */} 
        <Stats /> 

        {/* GameScreen rendert jetzt nur noch den Inhalt der Canvas */}
        {/* Die äußeren Container und die Canvas selbst sind in GameLoader */} 

        <CanvasUpdater containerRef={battlefieldContainerRef} /> 
        <ambientLight intensity={0.6} />
        <directionalLight position={[10, 20, 5]} intensity={0.8} />

        {/* NEU: Achsen-Helfer (direkt nutzbar) */}
        <axesHelper args={[axisLength]} />
        
        {/* Axis Labels */}
        <Html position={[axisLength + 1, 0, 0]} center>
           <span style={{ color: 'red', fontWeight: 'bold', fontSize: '1.5em' }}>X</span>
        </Html>
        <Html position={[0, axisLength + 1, 0]} center>
           <span style={{ color: 'green', fontWeight: 'bold', fontSize: '1.5em' }}>Y</span>
        </Html>
        <Html position={[0, 0, axisLength + 1]} center>
           <span style={{ color: 'blue', fontWeight: 'bold', fontSize: '1.5em' }}>Z</span>
        </Html>

        {/* Boden-Plane mit neuer Textur */}
        <GroundPlane />
       
        <OrbitControls 
          enableRotate={true} // Rotation generell erlauben
          enablePan={true}     
          mouseButtons={{
            LEFT: THREE.MOUSE.ROTATE, // Linke Taste für Rotation
            MIDDLE: THREE.MOUSE.DOLLY, 
            RIGHT: THREE.MOUSE.PAN    // Rechte Taste für Panning (Bewegung)
          }}
          screenSpacePanning={false}
          target={[0, 0, 25]} // Explizit das Ziel für OrbitControls setzen
            // Vertikale Rotation: Keine Einschränkung
            // Horizontale Rotation: ±45° von der Startrichtung (-90°)
            minAzimuthAngle={-3 * Math.PI / 4} // -135°
            maxAzimuthAngle={-Math.PI / 4}   // -45°
        /> 

        {/* NEU: Platziersystem rendern */}
        <PlacementSystem 
            gameState={gameState}
            playerId={playerId}
            selfPlayer={selfPlayer ?? null}
            selectedUnitForPlacement={selectedUnitForPlacement}
            setSelectedUnitForPlacement={setSelectedUnitForPlacement}
        />
       
        {/* Platziere Einheiten */}
        {allPlacedUnits.map(unit => (
            <PlacedUnitMesh 
                key={unit.instanceId} 
                placedUnit={unit} 
                gamePhase={gameState.phase}
            />
        ))}

        {/* Aktive Projektile */}
        {activeProjectiles.map(projectile => {
            return (
                // Umschließe mit ErrorBoundary und Suspense
                <ErrorBoundary
                    key={`${projectile.projectileId}-boundary`}
                    fallback={
                        // Fallback für Ladefehler (z.B. rote Kugel)
                        <mesh position={[projectile.currentPos.x, 0.5, projectile.currentPos.z]}>
                            <sphereGeometry args={[0.1, 8, 8]} />
                            <meshStandardMaterial color="red" />
                        </mesh>
                    }
                >
                    <Suspense fallback={
                        // Fallback während des Ladens (z.B. gelbe Kugel)
                         <mesh position={[projectile.currentPos.x, 0.5, projectile.currentPos.z]}>
                            <sphereGeometry args={[0.1, 8, 8]} />
                            <meshStandardMaterial color="yellow" wireframe />
                        </mesh>
                    }>
                        <ProjectileMesh 
                            key={projectile.projectileId} 
                            projectile={projectile}
                        />
                    </Suspense>
                </ErrorBoundary>
            );
        })}

    </>
  );
};

// NEU: Eigene Komponente für die Boden-Plane, um Textur zu laden
const GroundPlane = () => {
  const groundTexture = useTexture('/assets/ground.png');

  // Sicherstellen, dass die Textur korrekt konfiguriert ist
  useEffect(() => {
    if (groundTexture) {
        groundTexture.wrapS = groundTexture.wrapT = THREE.RepeatWrapping;
        groundTexture.repeat.set(10, 10); // Skalierung: Wiederholt sich doppelt so oft -> 1/4 Größe
        groundTexture.rotation = Math.PI / 2; // Rotation um 90 Grad
        groundTexture.anisotropy = 16; 
        groundTexture.colorSpace = THREE.SRGBColorSpace;
        groundTexture.needsUpdate = true;
    }
  }, [groundTexture]);

  return (
    <Plane args={[50, 50]} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 25]}>
        <meshStandardMaterial 
            map={groundTexture} // Textur anwenden
            color="white" // Helligkeit: Stelle sicher, dass Material nicht abdunkelt
            side={THREE.DoubleSide} 
        />
    </Plane>
  );
}

export default GameScreen;