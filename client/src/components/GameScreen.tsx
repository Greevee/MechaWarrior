import React, { useEffect, useState, useMemo, useRef, Suspense, useCallback } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, Box, Plane, Sphere, useGLTF, Billboard, useTexture, Line, Html, Stats, Sky } from '@react-three/drei';
import * as THREE from 'three';
import { PlacedUnit, GameState as ClientGameState, FigureState, ProjectileState, FigureBehaviorState, GamePhase } from '../types/game.types';
import { placeholderUnits, Unit } from '../../../server/src/units/unit.types';
import './GameScreen.css';
import PlacementSystem from './PlacementSystem.tsx';
import ErrorBoundary from './ErrorBoundary';
import { v4 as uuidv4 } from 'uuid';
import { useGameStore } from '../store/gameStore'; // Store importieren

// Konstanten für die Grid-Dimensionen (ggf. auslagern)
const GRID_WIDTH = 50;
const PLAYER_ZONE_DEPTH = 20;
const NEUTRAL_ZONE_DEPTH = 10;
const TOTAL_DEPTH = PLAYER_ZONE_DEPTH * 2 + NEUTRAL_ZONE_DEPTH;
const GRID_MIN_X = -GRID_WIDTH / 2;
const GRID_MAX_X = GRID_WIDTH / 2;
const GRID_MIN_Z = 0;
const GRID_MAX_Z = TOTAL_DEPTH;

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
    const { setSelectedFigureId } = useGameStore(); // NEU: Setter für FigureId holen
    const prevBehaviorRef = useRef<FigureBehaviorState>(figureData.behavior); // Vorheriges Verhalten speichern
    // NEU: Ref für vorherigen Cooldown-Wert
    const prevAttackCooldownEndRef = useRef<number>(figureData.attackCooldownEnd);

    // NEU: Ref für Rückstoß-Animation
    const recoilStartTime = useRef<number | null>(null);
    const recoilOffsetX = useRef(0); // NEU: Ref für den Offset, um Linter-Fehler zu beheben

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

    // NEU: Effekt zum Starten der Rückstoßanimation - JETZT BASIEREND AUF COOLDOWN
    useEffect(() => {
        // Nur auslösen, wenn sich der Cooldown geändert hat UND die Figur angreift
        if (figureData.attackCooldownEnd !== prevAttackCooldownEndRef.current && 
            figureData.behavior === 'attacking') {
            recoilStartTime.current = Date.now();
            // console.log(`Figure ${figureData.figureId} starts recoil (cooldown change)`);
        }
        // Aktuellen Cooldown für den nächsten Vergleich speichern
        prevAttackCooldownEndRef.current = figureData.attackCooldownEnd;
        // Aktuelles Verhalten für den nächsten Vergleich speichern (optional, kann aber bleiben)
        prevBehaviorRef.current = figureData.behavior;
    }, [figureData.attackCooldownEnd, figureData.behavior, figureData.figureId]); // Abhängigkeiten aktualisiert

    useFrame((state, delta) => {
        // --- NEU: Hüpf-Offset Berechnung ---
        let bobbingOffsetY = 0;
        if (figureData.behavior === 'moving') {
            const frequency = unitData?.moveBobbingFrequency ?? 0; // Standard: Kein Hüpfen
            const amplitude = unitData?.moveBobbingAmplitude ?? 0; // Standard: Kein Hüpfen

            if (frequency > 0 && amplitude > 0) {
                // state.clock.elapsedTime gibt die seit Start vergangene Zeit in Sekunden
                bobbingOffsetY = Math.sin(state.clock.elapsedTime * frequency * 2 * Math.PI) * amplitude;
            }
        }

        // --- Zielposition Berechnung (inkl. Standard-Y-Offset und Hüpfen) ---
        // Der Standard-Y-Offset (halbe Sprite-Höhe) wird immer angewendet
        // Der bobbingOffsetY wird nur bei Bewegung hinzugefügt
        const finalTargetY = yOffset + bobbingOffsetY;
        targetPosition.set(figureData.position.x, finalTargetY, figureData.position.z);

        // --- Positionsinterpolation (bleibt gleich, zielt jetzt auf finalTargetY) ---
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
            // NUR Richtung ändern, wenn Bewegung über dem Schwellenwert liegt
            if (movementDirection.z < -moveThreshold) {
                facingScaleX.current = -1; // Nach -Z bewegen
            } else if (movementDirection.z > moveThreshold) {
                facingScaleX.current = 1; // Nach +Z bewegen
            }
            // WENN Bewegung unter dem Schwellenwert liegt, wird facingScaleX.current NICHT geändert
            // und behält seinen vorherigen Wert bei.
        }

        // --- NEU: Rückstoß-Offset Berechnung ---
        if (recoilStartTime.current !== null) {
            // Werte aus unitData holen oder Standardwerte verwenden
            const recoilDuration = unitData?.recoilDurationMs ?? 150; // Standard: 150ms
            const recoilDistance = unitData?.recoilDistance ?? 0.15; // Standard: 0.15

            const elapsedTime = Date.now() - recoilStartTime.current;
            if (elapsedTime < recoilDuration) {
                // Einfache Sinus-Halbwelle für einen weichen Ein-/Ausstieg
                const progress = elapsedTime / recoilDuration;
                const recoilAmount = Math.sin(progress * Math.PI) * recoilDistance;
                // Richtung ist entgegengesetzt zur Blickrichtung (facingScaleX)
                recoilOffsetX.current = -facingScaleX.current * recoilAmount; // Wert in Ref speichern
            } else {
                // Animation beendet, Zeit zurücksetzen
                recoilStartTime.current = null;
                recoilOffsetX.current = 0; // Offset zurücksetzen
                // console.log(`Figure ${figureData.figureId} ends recoil`);
            }
        } else {
            // Sicherstellen, dass der Offset 0 ist, wenn keine Animation läuft
            recoilOffsetX.current = 0;
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

    const handleClick = (event: any) => {
        event.stopPropagation(); 
        console.log(`Figure clicked: ${figureData.figureId}`);
        setSelectedFigureId(figureData.figureId); // NEU: Setze FigureId
    };

    return (
        // Group wird NUR noch positioniert
        <group ref={meshRef} key={figureData.figureId} onClick={handleClick}>
            <Billboard>             
                 {/* Original Sprite-Plane */}
                 <Plane 
                    args={[spriteWidth, spriteHeight]} 
                    scale={[facingScaleX.current, 1, 1]}
                    position={[recoilOffsetX.current, 0, 0]} // Horizontaler Offset für Rückstoß (Wert aus Ref lesen)
                >
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

// NEU: Impact Effect Component
interface ImpactEffectProps {
    id: string; // Eindeutige ID für diesen Effekt
    position: THREE.Vector3;
    unitTypeId: string;
    onComplete: (id: string) => void; // Callback zum Entfernen
    duration?: number; // Dauer des Effekts in Sekunden
}

const ImpactEffect: React.FC<ImpactEffectProps> = ({ 
    id, 
    position, 
    unitTypeId, 
    onComplete, 
    duration = 1.0 // Dauer jetzt 1 Sekunde
}) => {
    const meshRef = useRef<THREE.Mesh>(null!);
    const materialRef = useRef<THREE.MeshBasicMaterial>(null!);
    const startTime = useRef(Date.now());
    const texturePath = `/assets/units/${unitTypeId}/impact/impact.png`;

    // Lade die Impact-Textur
    // Fehler werden durch Suspense/ErrorBoundary außen behandelt
    const impactTexture = useTexture(texturePath);

    // Ladefehler abfangen und Standardwerte verwenden
    const aspectWidth = impactTexture?.image?.width ?? 1;
    const aspectHeight = impactTexture?.image?.height ?? 1;
    const spriteAspect = aspectWidth / aspectHeight;
    
    const spriteHeight = 0.5; // Größe des Impacts (anpassen nach Bedarf)
    const spriteWidth = spriteHeight * spriteAspect;

    useEffect(() => {
        if (impactTexture) {
            impactTexture.colorSpace = THREE.SRGBColorSpace;
            impactTexture.needsUpdate = true;
        }
    }, [impactTexture]);

    useFrame(() => {
        const elapsedTime = (Date.now() - startTime.current) / 1000; // Zeit in Sekunden
        const progress = Math.min(1, elapsedTime / duration); // Progress wieder berechnen

        // Fading-Logik wieder aktiviert
        if (materialRef.current) {
            materialRef.current.opacity = 1 - progress; // Fade out
            materialRef.current.needsUpdate = true;
        }

        // Nach Ablauf der Dauer entfernen
        if (progress >= 1) { 
            onComplete(id); // Effekt beendet, entfernen
        }
    });

    // Wir verwenden jetzt Billboard, damit die Grafik immer zur Kamera zeigt.
    return (
        <Billboard position={position}> {/* Billboard umschließt jetzt die Plane */} 
             <mesh ref={meshRef}> {/* Mesh ist jetzt innerhalb von Billboard, nur für Refs? Oder direkt Plane? */} 
                <Plane args={[spriteWidth, spriteHeight]}>
                    <meshBasicMaterial
                        ref={materialRef}
                        map={impactTexture}
                        transparent={true}
                        opacity={1} // Startet voll sichtbar
                        side={THREE.DoubleSide}
                        alphaTest={0.1} 
                        depthWrite={false} 
                    />
                </Plane>
            </mesh>
        </Billboard>
    );
};

// NEU: Komponente für Fog of War Overlay
const FogOfWarOverlay: React.FC<{ gameState: ClientGameState, playerId: number | null }> = ({ gameState, playerId }) => {
    // Rendere nichts, wenn nicht in Vorbereitung oder Spieler-ID fehlt
    if (gameState.phase !== 'Preparation' || playerId === null) {
        return null;
    }

    const { opponentZoneMinZ, opponentZoneMaxZ } = useMemo(() => {
        let oppMinZ: number | null = null;
        let oppMaxZ: number | null = null;
        const isHost = playerId === gameState.hostId;

        if (isHost) {
            // Wenn ich Host bin, ist Gegnerzone hinten
            oppMinZ = PLAYER_ZONE_DEPTH + NEUTRAL_ZONE_DEPTH;
            oppMaxZ = GRID_MAX_Z;
        } else {
            // Wenn ich nicht Host bin, ist Gegnerzone vorne
            oppMinZ = GRID_MIN_Z;
            oppMaxZ = PLAYER_ZONE_DEPTH;
        }
        return { opponentZoneMinZ: oppMinZ, opponentZoneMaxZ: oppMaxZ };
    }, [gameState.hostId, playerId]);

    // Wenn Zonen nicht berechnet werden konnten (sollte nicht passieren)
    if (opponentZoneMinZ === null || opponentZoneMaxZ === null) {
        return null;
    }

    const zoneWidth = GRID_MAX_X - GRID_MIN_X;
    const zoneDepth = opponentZoneMaxZ - opponentZoneMinZ;
    const zoneCenterX = (GRID_MIN_X + GRID_MAX_X) / 2; // Sollte 0 sein
    const zoneCenterZ = (opponentZoneMinZ + opponentZoneMaxZ) / 2;
    const yOffset = 0.03; // Leicht über den gelben Highlights

    return (
        <Plane
            args={[zoneWidth, zoneDepth]}
            position={[zoneCenterX, yOffset, zoneCenterZ]}
            rotation={[-Math.PI / 2, 0, 0]}
        >
            <meshBasicMaterial 
                color="black" 
                transparent 
                opacity={0.4} // Dunkelheit anpassen
                side={THREE.DoubleSide} 
                depthWrite={false} // Um Sortierungsprobleme zu vermeiden
            />
        </Plane>
    );
};

// NEU: Definiere Props für GameScreen
interface GameScreenProps {
    gameState: ClientGameState;
    playerId: number | null;
    battlefieldContainerRef: React.RefObject<HTMLDivElement | null>;
    // Props für Platzierung von GameLoader erhalten
    selectedUnitForPlacement: Unit | null;
    setSelectedUnitForPlacement: React.Dispatch<React.SetStateAction<Unit | null>>;
}

// Interface für einen aktiven Impact-Effekt im State
interface ActiveImpactEffect {
    id: string;
    position: THREE.Vector3;
    unitTypeId: string;
}

// NEU: Komponente für die umgebende Landschaft
const SurroundingLandscape = () => {
  // Annahme: Du hast eine passende Textur unter public/assets/sand.png
  const sandTexture = useTexture('/assets/sand.png');
  const landscapeSize = 500; // Größe der umgebenden Landschaft (viel größer als das Schlachtfeld)
  const textureRepeat = 50; // Wie oft die Textur wiederholt wird

  // Textur konfigurieren (ähnlich wie bei GroundPlane)
  useEffect(() => {
    if (sandTexture) {
        sandTexture.wrapS = sandTexture.wrapT = THREE.RepeatWrapping;
        sandTexture.repeat.set(textureRepeat, textureRepeat); 
        // sandTexture.rotation = 0; // Keine Rotation nötig?
        sandTexture.anisotropy = 16; 
        sandTexture.colorSpace = THREE.SRGBColorSpace;
        sandTexture.needsUpdate = true;
    }
  }, [sandTexture]);

  return (
    <Plane 
        args={[landscapeSize, landscapeSize]} 
        rotation={[-Math.PI / 2, 0, 0]} 
        // Leicht unter der Haupt-GroundPlane positionieren, um Z-Fighting zu vermeiden
        position={[0, -0.05, 25]} 
    >
        <meshStandardMaterial 
            map={sandTexture} // Wüsten-Textur anwenden
            color="white" 
            side={THREE.DoubleSide} 
        />
    </Plane>
  );
}

const GameScreen: React.FC<GameScreenProps> = ({ 
    gameState, 
    playerId, 
    battlefieldContainerRef,
    selectedUnitForPlacement,
    setSelectedUnitForPlacement,
}) => {
  const { camera } = useThree(); 
  
  // Zustand für die aktuell sichtbaren Impact-Effekte
  const [activeImpactEffects, setActiveImpactEffects] = useState<ActiveImpactEffect[]>([]);
  
  // Ref, um den vorherigen GameState für den Vergleich zu speichern
  const prevGameStateRef = useRef<ClientGameState | null>(null);
  // Ref, um die IDs der aktuell gerenderten Projektile zu speichern
  const currentProjectileIdsRef = useRef<Set<string>>(new Set());


  // Berechnungen, die *nur* für die 3D-Szene relevant sind:
  const allPlacedUnits = useMemo(() => gameState?.players.flatMap(p => p.placedUnits) ?? [], [gameState?.players]);
  const activeProjectiles = useMemo(() => gameState?.activeProjectiles ?? [], [gameState?.activeProjectiles]);
  const selfPlayer = useMemo(() => gameState?.players.find(p => p.id === playerId), [gameState, playerId]); 

  // Update der aktuell gerenderten Projektil-IDs bei jeder Änderung
   useEffect(() => {
        currentProjectileIdsRef.current = new Set(activeProjectiles.map(p => p.projectileId));
    }, [activeProjectiles]);

  // Effekt zum Erkennen von entfernten Projektilen und Hinzufügen von Impacts
   useEffect(() => {
        if (prevGameStateRef.current && gameState) {
            const prevProjectiles = prevGameStateRef.current.activeProjectiles ?? [];
            const currentProjectileIds = currentProjectileIdsRef.current; // Verwende die Ref

            prevProjectiles.forEach(prevProjectile => {
                // Wenn ein Projektil im vorherigen Frame da war, aber jetzt nicht mehr...
                if (!currentProjectileIds.has(prevProjectile.projectileId)) {
                    
                    // Finde die Unit-Daten des Projektils
                    const unitData = placeholderUnits.find(u => u.id === prevProjectile.unitTypeId);

                    // Prüfe, ob die Einheit einen Impact-Effekt hat
                    if (unitData?.impactEffectImage) {
                        // console.log(`Impact detected for projectile ${prevProjectile.projectileId} from unit ${unitData.id}`);
                        
                        // Erstelle einen neuen Impact-Effekt an der letzten Position
                        const impactPosition = new THREE.Vector3(
                            prevProjectile.currentPos.x, 
                            0.5, // Höhe des Impacts (anpassen?)
                            prevProjectile.currentPos.z
                        );
                        
                        const newEffect: ActiveImpactEffect = {
                            id: uuidv4(), // Eindeutige ID generieren
                            position: impactPosition,
                            unitTypeId: unitData.id,
                        };

                        // Füge den neuen Effekt zum State hinzu
                        setActiveImpactEffects(prevEffects => [...prevEffects, newEffect]);
                    }
                }
            });
        }

        // Speichere den aktuellen gameState für den nächsten Vergleich
        // WICHTIG: Erstelle eine tiefe Kopie, um Referenzprobleme zu vermeiden,
        // oder stelle sicher, dass gameState unveränderlich ist.
        // Wenn gameState direkt mutiert wird, funktioniert dieser Vergleich nicht.
        // Annahme: gameState wird bei jedem Update neu erstellt (z.B. durch State-Management).
        prevGameStateRef.current = gameState; 

    }, [gameState]); // Abhängigkeit nur von gameState

    // Callback-Funktion zum Entfernen eines Effekts aus dem State
    const handleImpactComplete = useCallback((idToRemove: string) => {
        // console.log(`Removing impact effect ${idToRemove}`);
        setActiveImpactEffects(prevEffects => prevEffects.filter(effect => effect.id !== idToRemove));
    }, []); // Keine Abhängigkeiten, Funktion bleibt stabil


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
    return <div>Lade Spielzustand...</div>;
  }

  return (
    <>
        {/* FPS Anzeige */} 
        <Stats /> 

        {/* NEU: Skybox hinzufügen */} 
        <Sky distance={450000} sunPosition={[0, 1, 0]} inclination={0} azimuth={0.25} />

        {/* GameScreen rendert jetzt nur noch den Inhalt der Canvas */}
        <CanvasUpdater containerRef={battlefieldContainerRef} /> 
        <ambientLight intensity={0.6} />
        <directionalLight position={[10, 20, 5]} intensity={0.8} />

        {/* NEU: Achsen-Helfer */}
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

        {/* Boden-Plane */}
        <GroundPlane />
       
        {/* NEU: Umgebende Landschaft hinzufügen */}
        <SurroundingLandscape />
       
        {/* NEU: Fog of War Overlay (nur in Vorbereitung sichtbar) */} 
        <FogOfWarOverlay gameState={gameState} playerId={playerId} />
       
        <OrbitControls 
          enableRotate={true} 
          enablePan={true}     
          mouseButtons={{
            LEFT: THREE.MOUSE.ROTATE, 
            MIDDLE: THREE.MOUSE.DOLLY, 
            RIGHT: THREE.MOUSE.PAN 
          }}
          screenSpacePanning={false}
          target={[0, 0, 25]} 
            minAzimuthAngle={-3 * Math.PI / 4} 
            maxAzimuthAngle={-Math.PI / 4}   
            maxPolarAngle={Math.PI / 2} 
        /> 

        {/* Platziersystem rendern */}
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
            // Finde Unit-Daten, um zu prüfen, ob ein Projektil überhaupt gerendert werden soll
             const unitData = placeholderUnits.find(u => u.id === projectile.unitTypeId);
             // Wenn keine Unit-Daten gefunden oder keine Projektil-Grafik erwartet wird, überspringen?
             // Oder Fallback verwenden? Hier wird aktuell immer versucht zu rendern.
             // TODO: Ggf. Logik hinzufügen, um Projektile ohne Grafik nicht zu rendern.

            return (
                <ErrorBoundary
                    key={`${projectile.projectileId}-boundary`}
                    fallback={/* ... (Fallback bleibt gleich) ... */
                        <mesh position={[projectile.currentPos.x, 0.5, projectile.currentPos.z]}>
                            <sphereGeometry args={[0.1, 8, 8]} />
                            <meshStandardMaterial color="red" />
                        </mesh>
                    }
                >
                    <Suspense fallback={/* ... (Fallback bleibt gleich) ... */
                         <mesh position={[projectile.currentPos.x, 0.5, projectile.currentPos.z]}>
                            <sphereGeometry args={[0.1, 8, 8]} />
                            <meshStandardMaterial color="yellow" wireframe />
                        </mesh>
                    }>
                        <ProjectileMesh 
                            key={projectile.projectileId} // Key bleibt hier wichtig für React
                            projectile={projectile}
                        />
                    </Suspense>
                </ErrorBoundary>
            );
        })}
        
        {/* NEU: Aktive Impact-Effekte rendern */}
        {activeImpactEffects.map(effect => {
             // Finde Unit-Daten für den Fallback / Suspense
            const unitData = placeholderUnits.find(u => u.id === effect.unitTypeId);
            const impactTexturePath = unitData ? `/assets/units/${unitData.id}/impact/impact.png` : ''; // Pfad für useTexture

             return (
                <ErrorBoundary
                    key={`${effect.id}-boundary`} // Eindeutiger Key für Boundary
                    fallback={
                        // Fallback, wenn Textur im ImpactEffect nicht geladen werden kann
                        <mesh position={effect.position}>
                            <boxGeometry args={[0.2, 0.2, 0.2]} />
                            <meshStandardMaterial color="magenta" />
                        </mesh>
                    }
                >
                     <Suspense fallback={
                        // Fallback, während die Impact-Textur lädt
                         <mesh position={effect.position}>
                            <boxGeometry args={[0.2, 0.2, 0.2]} />
                            <meshStandardMaterial color="cyan" wireframe />
                        </mesh>
                     }>
                        <ImpactEffect
                            key={effect.id} // Eindeutiger Key für den Effekt selbst
                            id={effect.id}
                            position={effect.position}
                            unitTypeId={effect.unitTypeId}
                            onComplete={handleImpactComplete}
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