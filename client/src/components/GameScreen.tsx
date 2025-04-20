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

// +++ NEU: FigureSprite Component (enthält die visuelle Darstellung und Animation) +++
interface FigureSpriteProps {
    figureId: string;
    unitTypeId: string; // Für Texturpfad
    behavior: FigureBehaviorState;
    attackCooldownEnd: number; // Für Rückstoß-Trigger
    position: { x: number; z: number }; // Nur X/Z für Zielposition
    modelScale: number;
    moveBobbingFrequency: number;
    moveBobbingAmplitude: number;
    recoilDurationMs: number;
    recoilDistance: number;
    spriteWidth: number;
    spriteHeight: number;
    texturePath: string; // Direkter Pfad zur Textur
    onClick: (event: any) => void; // Click Handler
    gamePhase: GamePhase; // Für Ausrichtung in Preparation
}

const FigureSprite: React.FC<FigureSpriteProps> = React.memo(({
    figureId,
    unitTypeId, // Wird noch für Debugging benötigt?
    behavior,
    attackCooldownEnd,
    position,
    modelScale, // Wird aktuell nicht direkt genutzt, aber ggf. für Skalierung? Behalten wir erstmal.
    moveBobbingFrequency,
    moveBobbingAmplitude,
    recoilDurationMs,
    recoilDistance,
    spriteWidth,
    spriteHeight,
    texturePath,
    onClick,
    gamePhase,
}) => {
    const meshRef = useRef<THREE.Group>(null!);
    // Initialposition mit korrektem Y-Offset (halbe Höhe)
    const yOffset = spriteHeight / 2;
    const interpolatedPosition = useRef(new THREE.Vector3(position.x, yOffset, position.z));
    const targetPosition = useMemo(() => new THREE.Vector3(position.x, yOffset, position.z), [
        position.x, position.z, yOffset // Y-Offset hinzufügen
    ]);
    const lastPosition = useRef(new THREE.Vector3().copy(interpolatedPosition.current));
    const facingScaleX = useRef(1);
    const prevBehaviorRef = useRef<FigureBehaviorState>(behavior);
    const prevAttackCooldownEndRef = useRef<number>(attackCooldownEnd);
    const recoilStartTime = useRef<number | null>(null);
    const recoilOffsetX = useRef(0);
    const movementDirection = useMemo(() => new THREE.Vector3(), []);

    // Lade die Textur mit dem übergebenen Pfad
    // Fehler/Suspense wird von der ErrorBoundary/Suspense in PlacedUnitMesh behandelt
    const spriteTexture = useTexture(texturePath);

    // Effekt zum Setzen des Farbraums der Textur
    useEffect(() => {
        if (spriteTexture) {
            spriteTexture.colorSpace = THREE.SRGBColorSpace;
            spriteTexture.needsUpdate = true;
        }
    }, [spriteTexture]);

    // Effekt zum Starten der Rückstoßanimation
    useEffect(() => {
        if (attackCooldownEnd !== prevAttackCooldownEndRef.current && behavior === 'attacking') {
            recoilStartTime.current = Date.now();
        }
        prevAttackCooldownEndRef.current = attackCooldownEnd;
        prevBehaviorRef.current = behavior; // Verhalten auch speichern, falls benötigt
    }, [attackCooldownEnd, behavior]);

    useFrame((state, delta) => {
        let bobbingOffsetY = 0;
        if (behavior === 'moving') {
            if (moveBobbingFrequency > 0 && moveBobbingAmplitude > 0) {
                bobbingOffsetY = Math.sin(state.clock.elapsedTime * moveBobbingFrequency * 2 * Math.PI) * moveBobbingAmplitude;
            }
        }

        const finalTargetY = yOffset + bobbingOffsetY;
        targetPosition.set(position.x, finalTargetY, position.z);

        interpolatedPosition.current.lerp(targetPosition, 0.1);
        movementDirection.copy(interpolatedPosition.current).sub(lastPosition.current);
        lastPosition.current.copy(interpolatedPosition.current);

        const moveThreshold = 0.001;
        const centerZ = 25;

        if (behavior === 'attacking') {
            if (position.z < centerZ) facingScaleX.current = 1; else facingScaleX.current = -1;
        } else if (gamePhase === 'Preparation' && behavior === 'idle') {
            if (position.z < centerZ) facingScaleX.current = 1; else facingScaleX.current = -1;
        } else {
            if (movementDirection.z < -moveThreshold) {
                facingScaleX.current = -1;
            } else if (movementDirection.z > moveThreshold) {
                facingScaleX.current = 1;
            }
        }

        if (recoilStartTime.current !== null) {
            const elapsedTime = Date.now() - recoilStartTime.current;
            if (elapsedTime < recoilDurationMs) {
                const progress = elapsedTime / recoilDurationMs;
                const recoilAmount = Math.sin(progress * Math.PI) * recoilDistance;
                recoilOffsetX.current = -facingScaleX.current * recoilAmount;
            } else {
                recoilStartTime.current = null;
                recoilOffsetX.current = 0;
            }
        } else {
             recoilOffsetX.current = 0; // Sicherstellen, dass Offset 0 ist
        }

        if (meshRef.current) {
            meshRef.current.position.copy(interpolatedPosition.current);
        }
    });

    return (
        <group ref={meshRef} onClick={onClick}>
            <Billboard>
                <Plane
                    args={[spriteWidth, spriteHeight]}
                    scale={[facingScaleX.current, 1, 1]}
                    position={[recoilOffsetX.current, 0, 0]}
                >
                    <meshBasicMaterial
                        color="white"
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

// --- Figure Mesh Component (Wrapper für Sprite und HealthBar) ---
// +++ NEU: Akzeptiert jetzt granulare Props +++
interface FigureMeshProps {
    figureId: string;
    unitTypeId: string;
    behavior: FigureBehaviorState;
    attackCooldownEnd: number;
    position: { x: number; z: number };
    currentHP: number;
    gamePhase: GamePhase;
    // Keine figureData mehr!
}

const FigureMesh: React.FC<FigureMeshProps> = React.memo(({
    figureId,
    unitTypeId,
    behavior,
    attackCooldownEnd,
    position,
    currentHP,
    gamePhase,
}) => {
    const { setSelectedFigureId } = useGameStore();

    // Hole Unit-Daten basierend auf unitTypeId
    const unitData = useMemo(() => placeholderUnits.find(u => u.id === unitTypeId), [unitTypeId]);
    const modelScale = unitData?.modelScale ?? 1;
    const maxHP = unitData?.hp ?? 100;
    const moveBobbingFrequency = unitData?.moveBobbingFrequency ?? 0;
    const moveBobbingAmplitude = unitData?.moveBobbingAmplitude ?? 0;
    const recoilDurationMs = unitData?.recoilDurationMs ?? 150;
    const recoilDistance = unitData?.recoilDistance ?? 0.15;

    // --- Berechne Sprite-Dimensionen und Pfad ---
    // Hilfsfunktion bleibt lokal oder wird ausgelagert
    const getTexturePath = (typeId: string, currentBehavior: FigureBehaviorState): string => {
        return `/assets/units/${typeId}/${currentBehavior}.png`;
    };
    const texturePath = useMemo(() => getTexturePath(unitTypeId, behavior), [unitTypeId, behavior]);

    // Lade Textur *hier temporär*, nur um die Dimensionen zu bekommen.
    // IDEAL: Dimensionen sollten Teil der unitData sein oder anders bezogen werden,
    // um doppelten Ladevorgang (hier und in FigureSprite) zu vermeiden.
    // Workaround: Wir laden sie hier, um Aspect Ratio zu berechnen.
    // TODO: Refaktorieren, um Textur-Dimensionen aus unitData zu holen.
    const tempTexture = useTexture(texturePath);
    const aspectWidth = tempTexture?.image?.width ?? 1;
    const aspectHeight = tempTexture?.image?.height ?? 1;
    const spriteAspect = aspectWidth / aspectHeight;
    const spriteHeight = 1.0 * modelScale;
    const spriteWidth = spriteHeight * spriteAspect;

    // Klick-Handler
    const handleClick = useCallback((event: any) => {
        event.stopPropagation();
        console.log(`Figure clicked: ${figureId}`);
        setSelectedFigureId(figureId);
    }, [figureId, setSelectedFigureId]); // Abhängigkeiten korrekt setzen

    return (
        // Leere Gruppe als Container, Key hier nicht mehr nötig, da in PlacedUnitMesh
        <group>
            {/* Rendere die Sprite-Komponente mit allen notwendigen Props */}
            <FigureSprite
                figureId={figureId}
                unitTypeId={unitTypeId}
                behavior={behavior}
                attackCooldownEnd={attackCooldownEnd}
                position={position}
                modelScale={modelScale}
                moveBobbingFrequency={moveBobbingFrequency}
                moveBobbingAmplitude={moveBobbingAmplitude}
                recoilDurationMs={recoilDurationMs}
                recoilDistance={recoilDistance}
                spriteWidth={spriteWidth}
                spriteHeight={spriteHeight}
                texturePath={texturePath}
                onClick={handleClick}
                gamePhase={gamePhase}
            />
            {/* Rendere HealthBar nur wenn nötig */}
            {currentHP < maxHP &&
                 <group position={[position.x, spriteHeight + 0.1, position.z]}> {/* Positioniere relativ */}
                    <HealthBar currentHP={currentHP} maxHP={maxHP} scale={spriteWidth * 0.8} />
                 </group>
            }
        </group>
    );
});

// --- Placed Unit Mesh (rendert jetzt FigureMesh mit Error Boundary und granularen Props) ---
const PlacedUnitMesh: React.FC<{ placedUnit: PlacedUnit, gamePhase: GamePhase }> = React.memo(({ placedUnit, gamePhase }) => {
    return (
        <group userData={{ unitInstanceId: placedUnit.instanceId }}>
            {placedUnit.figures.map((figure: FigureState) => {
                // +++ NEU: Extrahiere Props für FigureMesh +++
                const { figureId, unitTypeId, behavior, attackCooldownEnd, position, currentHP } = figure;

                // Definiere den Fallback für diese Figur
                const fallbackMesh = (color: string, wireframe = false) => (
                    <mesh position={[position.x, 0.5, position.z]}>
                        <boxGeometry args={[0.5, 0.5, 0.5]} />
                        <meshStandardMaterial color={color} wireframe={wireframe} />
                    </mesh>
                );

                return (
                    <ErrorBoundary
                        key={figureId} // Key hier setzen!
                        fallback={fallbackMesh("red")}
                    >
                        <Suspense fallback={fallbackMesh("yellow", true)}>
                            {/* Übergebe granulare Props an FigureMesh */}
                            <FigureMesh
                                figureId={figureId}
                                unitTypeId={unitTypeId}
                                behavior={behavior}
                                attackCooldownEnd={attackCooldownEnd}
                                position={position} // Position-Objekt ist ok, da es sich oft komplett ändert
                                currentHP={currentHP}
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

// +++ NEU: Instanced Projectile Component +++
interface InstancedProjectileMeshesProps {
    unitTypeId: string;
    projectiles: ProjectileState[];
}

const InstancedProjectileMeshes: React.FC<InstancedProjectileMeshesProps> = React.memo(({ unitTypeId, projectiles }) => {
    const meshRef = useRef<THREE.InstancedMesh>(null!); // Ref für InstancedMesh
    const dummyObject = useMemo(() => new THREE.Object3D(), []); // Hilfsobjekt für Matrix-Berechnung
    // +++ NEU: Wiederverwendbare Vektoren für useFrame +++
    const targetPositionVec = useMemo(() => new THREE.Vector3(), []); 

    // --- Sprite Loading (nur einmal pro Typ) ---
    const getProjectileTexturePath = (typeId: string): string => {
        return `/assets/projectiles/${typeId}_projectile.png`;
    };
    const texturePath = useMemo(() => getProjectileTexturePath(unitTypeId), [unitTypeId]);
    const spriteTexture = useTexture(texturePath); 

    const aspectWidth = spriteTexture?.image?.width ?? 1;
    const aspectHeight = spriteTexture?.image?.height ?? 1;
    const spriteAspect = aspectWidth / aspectHeight;
    const spriteHeight = 0.3; // Feste Größe für Projektile?
    const spriteWidth = spriteHeight * spriteAspect;
    const yOffset = spriteHeight / 2;

    // Textur-Setup
    useEffect(() => {
        if (spriteTexture) {
            spriteTexture.colorSpace = THREE.SRGBColorSpace;
            spriteTexture.needsUpdate = true;
        }
    }, [spriteTexture]);

    // --- Instanz-Updates (jetzt in useFrame) ---
    useFrame((state, delta) => {
        if (!meshRef.current || projectiles.length === 0) return;

        // Holen der Kamera-Position für Billboard-Effekt
        const cameraPosition = state.camera.position;

        projectiles.forEach((projectile, i) => {
            // Sicherheitscheck: Index muss im gültigen Bereich des InstancedMesh liegen
            if (i >= meshRef.current!.count) return;
            
            // Holen der letzten Matrix und Position
            meshRef.current!.getMatrixAt(i, dummyObject.matrix); 
            dummyObject.position.setFromMatrixPosition(dummyObject.matrix);
            
            // Ziel ist die aktuelle Position vom Server
            // WICHTIG: Die yOffset muss hier angewendet werden!
            const targetX = projectile.currentPos.x;
            const targetY = yOffset; // Ziel-Y ist der Offset
            const targetZ = projectile.currentPos.z;

            // Interpolieren zur Zielposition
            // Wir verwenden einen temporären Vektor, um das Ziel zu setzen
            // +++ NEU: Wiederverwendeten Vektor nutzen +++
            targetPositionVec.set(targetX, targetY, targetZ);
            dummyObject.position.lerp(targetPositionVec, 0.3); // Behalte LERP für Glättung

            // Billboard-Effekt: Richte Instanz zur Kamera aus
            dummyObject.lookAt(cameraPosition);

            // Matrix aktualisieren
            dummyObject.updateMatrix();
            meshRef.current!.setMatrixAt(i, dummyObject.matrix);
        });

        // Wichtig: Flag setzen, damit Three.js die Änderungen übernimmt
        meshRef.current.instanceMatrix.needsUpdate = true;
    });

    // Wir brauchen eine Geometrie und ein Material
    const planeGeometry = useMemo(() => new THREE.PlaneGeometry(spriteWidth, spriteHeight), [spriteWidth, spriteHeight]);
    const meshMaterial = useMemo(() => new THREE.MeshBasicMaterial({
        map: spriteTexture,
        color: "white",
        transparent: true,
        side: THREE.DoubleSide,
        alphaTest: 0.1,
        depthWrite: false // Oft gut für transparente Partikel/Billboards
    }), [spriteTexture]);

    // Rendere nichts, wenn keine Projektile da sind
    if (projectiles.length === 0) {
        return null;
    }

    // InstancedMesh benötigt count und die Geometrie/Material-Args
    // WICHTIG: Billboard-Verhalten müssen wir manuell in Matrix umsetzen oder Billboard um InstancedMesh?
    // Billboard um InstancedMesh funktioniert NICHT. Billboard muss pro Instanz passieren.
    // Einfachster Weg: Gar kein Billboard, Projektile schauen immer in eine Richtung (Y-Achse?).
    // Oder komplexer: In useFrame die Matrix jeder Instanz so rotieren, dass sie zur Kamera zeigt.
    // Kompromiss: Wir lassen Billboard erstmal weg, schauen, wie es aussieht.
    return (
        <instancedMesh 
            ref={meshRef} 
            args={[planeGeometry, meshMaterial, projectiles.length]} // Geometrie, Material, Anzahl
            frustumCulled={false} // Performance: Verhindert, dass Instanzen verschwinden, wenn Zentrum außerhalb des Sichtfelds ist
        />
    );
});
// +++ Ende Instanced Projectile Component +++

// +++ NEU: Line Projectile Component +++
interface LineProjectileEffectProps {
    projectile: ProjectileState;
}

const LineProjectileEffect: React.FC<LineProjectileEffectProps> = React.memo(({ projectile }) => {
    // Refs für Start-/Endpunkt der Linie zur Interpolation
    // Initialisiere mit der Startposition, um "Springen" zu vermeiden

    const TRAIL_LENGTH = 0.4; // Länge des Linien-Tracers
    const LINE_Y_OFFSET = 0.5; // Gleicher Y-Offset wie bei Sprites/Instanzen
    const FORWARD_OFFSET = 0.5; // NEU: Distanz, um die Linie nach vorne zu verschieben

    // Richtung einmalig berechnen (oder wenn sich Ziel ändert? Vorerst konstant)
    const direction = useMemo(() => {
        return new THREE.Vector3(
            projectile.targetPos.x - projectile.originPos.x,
            0, // Ignoriere Y-Unterschied für Richtungsvektor am Boden
            projectile.targetPos.z - projectile.originPos.z
        ).normalize();
    }, [projectile.originPos, projectile.targetPos]);

    // +++ NEU: Wiederverwendbare Vektoren für useFrame und Initialisierung +++
    const initialOffset = useMemo(() => direction.clone().multiplyScalar(FORWARD_OFFSET), [direction]); // Initial berechnen ok
    const offsetVector = useMemo(() => new THREE.Vector3(), []);
    const lerpTarget = useMemo(() => new THREE.Vector3(), []);
    const tempVec = useMemo(() => new THREE.Vector3(), []); // Für Zwischenberechnungen

    // NEU: Initialisiere Endpunkt mit Offset
    const endPointRef = useRef(new THREE.Vector3(
        projectile.originPos.x + initialOffset.x,
        LINE_Y_OFFSET,
        projectile.originPos.z + initialOffset.z
    ));
    // NEU: Initialisiere Startpunkt basierend auf initialem Endpunkt und Trail-Länge
    // (Direkt hier berechnen ist ok, da nur einmalig)
    const startPointRef = useRef(endPointRef.current.clone().sub(tempVec.copy(direction).multiplyScalar(TRAIL_LENGTH)));

    const geometryRef = useRef<THREE.BufferGeometry>(null!); // Ref für die Geometrie selbst

    useFrame(() => {
        // +++ NEU: Wiederverwendete Vektoren nutzen +++
        // Zielposition aus Serverdaten holen (lokale Variable OK)
        const targetEndPoint = tempVec.set(projectile.currentPos.x, LINE_Y_OFFSET, projectile.currentPos.z); // tempVec hier wiederverwenden

        // NEU: Zielposition für den Endpunkt mit Offset berechnen
        offsetVector.copy(direction).multiplyScalar(FORWARD_OFFSET); // offsetVector wiederverwenden
        lerpTarget.copy(targetEndPoint).add(offsetVector); // lerpTarget wiederverwenden

        // Endpunkt interpolieren (zum offset Ziel)
        endPointRef.current.lerp(lerpTarget, 0.4); // Etwas schnelleres LERP für Linien?

        // Startpunkt basierend auf interpoliertem (und verschobenem) Endpunkt und Richtung berechnen
        // (tempVec wird hier kurz für die Subtraktion wiederverwendet)
        startPointRef.current.copy(endPointRef.current).sub(tempVec.copy(direction).multiplyScalar(TRAIL_LENGTH)); 

        // Update der Geometrie der Linie
        const geom = geometryRef.current;
        if (geom) {
            const positions = geom.attributes.position.array as Float32Array;
            positions[0] = startPointRef.current.x;
            positions[1] = startPointRef.current.y;
            positions[2] = startPointRef.current.z;
            positions[3] = endPointRef.current.x;
            positions[4] = endPointRef.current.y;
            positions[5] = endPointRef.current.z;
            geom.attributes.position.needsUpdate = true; // Wichtig!
            geom.computeBoundingSphere(); // Wichtig für Sichtbarkeit
            
            // DEBUG: Konsolenausgabe (nur bei Bedarf aktivieren)
            // if (Math.random() < 0.01) { // Nur gelegentlich loggen
            //     console.log(`Projectile ${projectile.projectileId}: Start [${positions[0].toFixed(1)}, ${positions[1].toFixed(1)}, ${positions[2].toFixed(1)}] End [${positions[3].toFixed(1)}, ${positions[4].toFixed(1)}, ${positions[5].toFixed(1)}]`);
            // }
        }
    });

    // Definiere die Geometrie initial mit Platzhalterpunkten
    // Verwende useMemo, um die Geometrie nur einmal zu erstellen
    const lineGeometry = useMemo(() => {
        const points = [startPointRef.current.clone(), endPointRef.current.clone()];
        const geom = new THREE.BufferGeometry().setFromPoints(points);
        return geom;
    }, []); // Leeres Abhängigkeitsarray, nur einmal erstellen

    // Erstelle das Linienobjekt mit Material manuell für <primitive>
    const lineObject = useMemo(() => {
        const material = new THREE.LineBasicMaterial({
            color: "#ebd686", // NEU: Helleres Gelb
            linewidth: 1,
            transparent: true,
            opacity: 1
        });
        const line = new THREE.Line(lineGeometry, material);
        return line;
    }, [lineGeometry]); // Nur neu erstellen, wenn sich die Geometrie ändert (sollte nicht)

    // Weise die Ref der Geometrie zu, wenn das Objekt erstellt wird
    useEffect(() => {
        if (lineObject) {
            geometryRef.current = lineObject.geometry as THREE.BufferGeometry;
        }
    }, [lineObject]);

    return (
        // Verwende primitive, um Typkonflikte zu vermeiden
        <primitive object={lineObject} />
        
        /* // Alte Implementierung entfernt
        <line geometry={lineGeometry} ref={geometryRef as any /* Type workaround für Ref * /}>
             <lineBasicMaterial
                color="yellow"
                linewidth={1} // Test mit Breite 1
                transparent={true} // Sicherstellen, dass Transparenz möglich ist
                opacity={1} // Voll sichtbar
                // toneMapped={false} // Optional: Verhindert, dass die Linie von Licht beeinflusst wird
             />
        </line>
        */
    );
});
// +++ Ende Line Projectile Component +++

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

  // NEU: Gruppiere Projektile und trenne Infanterie-Projektile
  const { groupedProjectiles, infantryProjectiles } = useMemo(() => {
    const groups: { [key: string]: ProjectileState[] } = {};
    const infantry: ProjectileState[] = [];
    activeProjectiles.forEach(p => {
        if (p.unitTypeId === 'human_infantry') {
            infantry.push(p);
        } else {
            if (!groups[p.unitTypeId]) {
                groups[p.unitTypeId] = [];
            }
            groups[p.unitTypeId].push(p);
        }
    });
    return { groupedProjectiles: groups, infantryProjectiles: infantry };
  }, [activeProjectiles]);

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

        {/* Aktive Projektile (Instanced für die meisten Typen) */}
        {Object.entries(groupedProjectiles).map(([unitTypeId, projectilesOfType]) => {
            // Finde Unit-Daten für Fallback / Suspense (wie zuvor)
             const unitData = placeholderUnits.find(u => u.id === unitTypeId);
             // TODO: Ggf. Logik hinzufügen, um Projektile ohne Grafik nicht zu rendern.
            
             // Key für die Gruppe
             const groupKey = `projectiles-${unitTypeId}`;

            return (
                <ErrorBoundary
                    key={`${groupKey}-boundary`}
                    fallback={
                        // Einfacher Fallback für die *gesamte Gruppe* dieses Typs
                        // Wir können hier nicht mehr pro Projektil einen Fallback rendern.
                        // Zeige eine einzelne rote Kugel als Hinweis?
                         <mesh position={[0, 0.5, 25]}> {/* Beispielposition Mitte */}
                            <sphereGeometry args={[0.2, 8, 8]} />
                            <meshStandardMaterial color="red" />
                        </mesh>
                    }
                >
                    <Suspense fallback={
                         // Fallback, während die EINE Textur für diesen Typ lädt
                         <mesh position={[0, 0.5, 25]}> {/* Beispielposition Mitte */}
                            <sphereGeometry args={[0.2, 8, 8]} />
                            <meshStandardMaterial color="yellow" wireframe />
                        </mesh>
                    }>
                        <InstancedProjectileMeshes 
                            key={groupKey} // React Key für die Komponente
                            unitTypeId={unitTypeId}
                            projectiles={projectilesOfType}
                        />
                    </Suspense>
                </ErrorBoundary>
            );
        })}
        
        {/* NEU: Aktive Projektile (Linien für Infanterie) */}
        {infantryProjectiles.map(projectile => (
            // Keine spezielle Suspense/Boundary nötig für einfache Linien?
            // Aber Key ist wichtig für React
            <LineProjectileEffect 
                key={projectile.projectileId} 
                projectile={projectile} 
            />
        ))}
        
        {/* Aktive Impact-Effekte rendern (bleibt unverändert) */} 
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