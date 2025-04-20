import React, { useEffect, useState, useMemo, useRef, Suspense, useCallback } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, Box, Plane, Sphere, useGLTF, Billboard, useTexture, Line, Html, Stats, Sky } from '@react-three/drei';
import * as THREE from 'three';
import { PlacedUnit, GameState as ClientGameState, FigureState, ProjectileState, FigureBehaviorState, GamePhase } from '../types/game.types';
import { placeholderUnits, Unit, Weapon } from '../../../server/src/units/unit.types';
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

// +++ NEU: Konstante für Flughöhe +++
const FLIGHT_HEIGHT = 2.0;

// +++ NEU: Hilfsfunktionen und Konstanten für Client-Simulation +++
const MAX_PROJECTILE_ARC_HEIGHT = 5; // Muss mit Server übereinstimmen!
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const calculateParabolicHeight = (t: number, maxHeight: number): number => {
    // Einfache Parabelformel: y = 4 * h * t * (1 - t)
    return 4 * maxHeight * t * (1 - t);
};
// +++ Ende Hilfsfunktionen +++

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
    position: { x: number; z: number }; // Nur X/Z für Zielposition
    moveBobbingFrequency: number;
    moveBobbingAmplitude: number;
    // NEU: Recoil-Parameter von der Hauptwaffe & Cooldowns
    mainWeaponId: string | null; // ID der Hauptwaffe (oder null wenn keine)
    weaponCooldowns: { [weaponId: string]: number }; // Aktuelle Cooldowns
    recoilDurationMs: number; // Von Hauptwaffe
    recoilDistance: number;  // Von Hauptwaffe
    spriteWidth: number;
    spriteHeight: number;
    texturePath: string; // Direkter Pfad zur Textur
    onClick: (event: any) => void; // Click Handler
    gamePhase: GamePhase; // Für Ausrichtung in Preparation
    isAirUnit: boolean; // NEU
}

const FigureSprite: React.FC<FigureSpriteProps> = React.memo(({
    figureId,
    unitTypeId, // Wird noch für Debugging benötigt?
    behavior,
    position,
    moveBobbingFrequency,
    moveBobbingAmplitude,
    mainWeaponId,
    weaponCooldowns,
    recoilDurationMs,
    recoilDistance,
    spriteWidth,
    spriteHeight,
    texturePath,
    onClick,
    gamePhase,
    isAirUnit, // Empfangen
}) => {
    const meshRef = useRef<THREE.Group>(null!);
    // NEU: Berechne Basis-Y-Position inkl. Flughöhe
    const baseYPosition = useMemo(() => {
        return (isAirUnit ? FLIGHT_HEIGHT : 0) + spriteHeight / 2;
    }, [isAirUnit, spriteHeight]);
    const interpolatedPosition = useRef(new THREE.Vector3(position.x, baseYPosition, position.z));
    const targetPosition = useMemo(() => new THREE.Vector3(position.x, baseYPosition, position.z), [
        position.x, position.z, baseYPosition // Basis-Y verwenden
    ]);
    const lastPosition = useRef(new THREE.Vector3().copy(interpolatedPosition.current));
    const facingScaleX = useRef(1);
    const prevBehaviorRef = useRef<FigureBehaviorState>(behavior);
    const recoilOffsetX = useRef(0); // Ref für den Rückstoß-Offset
    const movementDirection = useMemo(() => new THREE.Vector3(), []);
    const prevWeaponCooldownsRef = useRef<{ [weaponId: string]: number }>(weaponCooldowns);
    const recoilStartTime = useRef<number | null>(null);

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

    // Effekt zum Starten der Rückstoßanimation - Reaktiviert & Modifiziert
    useEffect(() => {
        // +++ Debug Log +++
        console.log(`FigureSprite ${figureId}: useEffect triggered. mainWpnId=${mainWeaponId}`, weaponCooldowns);
        // Prüfe nur, wenn eine Hauptwaffe definiert ist
        if (mainWeaponId) {
            const currentCooldown = weaponCooldowns[mainWeaponId] ?? 0;
            const prevCooldown = prevWeaponCooldownsRef.current[mainWeaponId] ?? 0;

            // +++ Debug Log +++
            console.log(`FigureSprite ${figureId}: Checking cooldowns. Current=${currentCooldown}, Prev=${prevCooldown}`);

            // Wenn der Cooldown gestiegen ist, hat die Hauptwaffe gefeuert
            if (currentCooldown > prevCooldown) {
                // +++ Debug Log +++
                console.log(`FigureSprite ${figureId}: Main weapon ${mainWeaponId} fired! Starting recoil at ${Date.now()}.`);
                recoilStartTime.current = Date.now();
            }
        }

        // Speichere aktuellen Cooldown-Status für nächsten Vergleich
        prevWeaponCooldownsRef.current = weaponCooldowns;
        prevBehaviorRef.current = behavior; 
    }, [weaponCooldowns, mainWeaponId, behavior]);

    useFrame((state, delta) => {
        let bobbingOffsetY = 0;
        // Bobbing nur für Bodeneinheiten?
        if (!isAirUnit && behavior === 'moving') { 
            if (moveBobbingFrequency > 0 && moveBobbingAmplitude > 0) {
                bobbingOffsetY = Math.sin(state.clock.elapsedTime * moveBobbingFrequency * 2 * Math.PI) * moveBobbingAmplitude;
            }
        }

        // NEU: Finale Ziel-Y Position inkl. Flughöhe und Bobbing
        const finalTargetY = baseYPosition + bobbingOffsetY;
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

        // Rückstoß-Berechnung - Reaktiviert
        if (recoilStartTime.current !== null) {

            const elapsedTime = Date.now() - recoilStartTime.current;
            // +++ Debug Log +++
            // console.log(`FigureSprite ${figureId}: Recoil active. elapsedTime=${elapsedTime}, duration=${recoilDurationMs}, distance=${recoilDistance}`);
            // Verwende die übergebenen Parameter der Hauptwaffe
            if (recoilDurationMs > 0 && elapsedTime < recoilDurationMs) { 
                const progress = elapsedTime / recoilDurationMs;
                const recoilAmount = Math.sin(progress * Math.PI) * recoilDistance;
                recoilOffsetX.current = -facingScaleX.current * recoilAmount;
                // +++ Debug Log +++
                // console.log(`FigureSprite ${figureId}: Recoil progress=${progress.toFixed(2)}, offset=${recoilOffsetX.current.toFixed(2)}`);
            } else {
                // +++ Debug Log +++
                // console.log(`FigureSprite ${figureId}: Recoil ended.`);
                recoilStartTime.current = null;
                recoilOffsetX.current = 0;
            }
        } else {
             // Sicherstellen, dass Offset 0 ist, wenn keine Animation läuft
             recoilOffsetX.current = 0; 
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
                    position={[recoilOffsetX.current, 0, 0]} // Greife auf .current zu
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
    position: { x: number; z: number };
    currentHP: number;
    weaponCooldowns: { [weaponId: string]: number };
    gamePhase: GamePhase;
    isAirUnit: boolean; // NEU
}

const FigureMesh: React.FC<FigureMeshProps> = React.memo(({
    figureId,
    unitTypeId,
    behavior,
    position,
    currentHP,
    weaponCooldowns,
    gamePhase,
    isAirUnit, // Empfangen
}) => {
    const { setSelectedFigureId } = useGameStore();

    // Hole Unit-Daten basierend auf unitTypeId
    const unitData = useMemo(() => placeholderUnits.find(u => u.id === unitTypeId), [unitTypeId]);
    const renderScale = unitData?.renderScale ?? 1;
    const maxHP = unitData?.hp ?? 100;
    const moveBobbingFrequency = unitData?.moveBobbingFrequency ?? 0;
    const moveBobbingAmplitude = unitData?.moveBobbingAmplitude ?? 0;
    // NEU: Hole Hauptwaffe und deren Recoil-Parameter
    const mainWeaponIndex = unitData?.mainWeaponIndex ?? 0;
    const mainWeapon = (unitData?.weapons && unitData.weapons.length > mainWeaponIndex) 
                         ? unitData.weapons[mainWeaponIndex] 
                         : null;
    const mainWeaponId = mainWeapon?.id ?? null;
    const recoilDurationMs = mainWeapon?.recoilDurationMs ?? 0;
    const recoilDistance = mainWeapon?.recoilDistance ?? 0;

    // --- Berechne Sprite-Dimensionen und Pfad ---
    // +++ Debug Log +++
    // console.log(`FigureMesh ${figureId}: mainWpnId=${mainWeaponId}, recoilDur=${recoilDurationMs}, recoilDist=${recoilDistance}, cooldowns=`, weaponCooldowns);

    const getTexturePath = (typeId: string, currentBehavior: FigureBehaviorState): string => {
        return `/assets/units/${typeId}/${currentBehavior}.png`;
    };
    const texturePath = useMemo(() => getTexturePath(unitTypeId, behavior), [unitTypeId, behavior]);

    // Temporäre Textur für Dimensionen (bestehender Workaround)
    // TODO: Refaktorieren, um Textur-Dimensionen aus unitData zu holen.
    const tempTexture = useTexture(texturePath);
    const aspectWidth = tempTexture?.image?.width ?? 1;
    const aspectHeight = tempTexture?.image?.height ?? 1;
    const spriteAspect = aspectWidth / aspectHeight;
    const baseSpriteHeight = 1.0; // Standardhöhe für Skalierung 1.0
    const spriteHeight = baseSpriteHeight * renderScale;
    const spriteWidth = spriteHeight * spriteAspect;

    // Klick-Handler
    const handleClick = useCallback((event: any) => {
        event.stopPropagation();
        console.log(`Figure clicked: ${figureId}`);
        setSelectedFigureId(figureId);
    }, [figureId, setSelectedFigureId]);

    return (
        <group>
            <FigureSprite
                figureId={figureId}
                unitTypeId={unitTypeId}
                behavior={behavior}
                position={position}
                moveBobbingFrequency={moveBobbingFrequency}
                moveBobbingAmplitude={moveBobbingAmplitude}
                mainWeaponId={mainWeaponId}
                weaponCooldowns={weaponCooldowns}
                recoilDurationMs={recoilDurationMs}
                recoilDistance={recoilDistance}
                spriteWidth={spriteWidth}
                spriteHeight={spriteHeight}
                texturePath={texturePath}
                onClick={handleClick}
                gamePhase={gamePhase}
                isAirUnit={isAirUnit} // Weitergeben
            />
            {/* Rendere HealthBar nur wenn nötig */}
            {currentHP < maxHP &&
                 <group position={[position.x, spriteHeight + 0.1, position.z]}>
                    <HealthBar currentHP={currentHP} maxHP={maxHP} scale={spriteWidth * 0.8} />
                 </group>
            }
        </group>
    );
});

// --- Placed Unit Mesh (rendert jetzt FigureMesh mit Error Boundary und granularen Props) ---
const PlacedUnitMesh: React.FC<{ placedUnit: PlacedUnit, gamePhase: GamePhase }> = React.memo(({ placedUnit, gamePhase }) => {
    // Hole unitData einmal für die ganze Einheit
    // NEU: Verwende unitId aus PlacedUnit
    const unitData = useMemo(() => placeholderUnits.find(u => u.id === placedUnit.unitId), [placedUnit.unitId]);
    const isAirUnit = unitData?.isAirUnit ?? false;

    return (
        <group userData={{ unitInstanceId: placedUnit.instanceId }}>
            {placedUnit.figures.map((figure: FigureState) => {
                // Extrahiere Props für FigureMesh
                const { figureId, unitTypeId, behavior, position, currentHP, weaponCooldowns } = figure; // unitTypeId wird hier geholt

                // Definiere den Fallback für diese Figur
                const fallbackMesh = (color: string, wireframe = false) => (
                    <mesh position={[position.x, 0.5, position.z]}> 
                        <boxGeometry args={[0.5, 0.5, 0.5]} />
                        <meshStandardMaterial color={color} wireframe={wireframe} />
                    </mesh>
                );

                return (
                    <ErrorBoundary
                        key={figureId} 
                        fallback={fallbackMesh("red")}
                    >
                        <Suspense fallback={fallbackMesh("yellow", true)}>
                            {/* Übergebe granulare Props an FigureMesh */} 
                            <FigureMesh
                                figureId={figureId}
                                unitTypeId={unitTypeId}
                                behavior={behavior}
                                position={position} 
                                currentHP={currentHP}
                                weaponCooldowns={weaponCooldowns}
                                gamePhase={gamePhase}
                                isAirUnit={isAirUnit} // NEU: Übergeben
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
    // +++ DEBUG LOG: Check if component renders and received projectiles +++
    console.log(`InstancedProjectileMeshes rendering for ${unitTypeId}`, projectiles);
    // +++ END DEBUG LOG +++

    const meshRef = useRef<THREE.InstancedMesh>(null!); // Ref für InstancedMesh
    const dummyObject = useMemo(() => new THREE.Object3D(), []); // Hilfsobjekt für Matrix-Berechnung
    const targetPositionVec = useMemo(() => new THREE.Vector3(), []); 

    // --- WICHTIG: Hole weaponId vom ersten Projektil --- 
    // Annahme: Alle Projektile in diesem Array gehören zur selben Waffe (da nach unitTypeId gruppiert)
    const weaponId = useMemo(() => projectiles[0]?.weaponId, [projectiles]);

    // +++ NEU: Hole unitData, um Skalierungsfaktor zu bekommen +++
    const unitData = useMemo(() => placeholderUnits.find(u => u.id === unitTypeId), [unitTypeId]);
    // Skalierung weiterhin über unitData/erste Waffe? Oder sollte das spezifischer sein?
    const scaleModifier = unitData?.weapons[0]?.projectileImageScale ?? 1; 

    // --- Sprite Loading (angepasster Pfad) --- 
    // Entferne alte Helper-Funktion
    // Baue Pfad direkt mit weaponId (falls vorhanden)
    const texturePath = useMemo(() => {
        if (!weaponId) {
            console.warn(`InstancedProjectileMeshes (${unitTypeId}): Keine weaponId gefunden, um Projektil-Textur zu laden.`);
            // Fallback oder leeren String zurückgeben, um Fehler zu vermeiden?
            return '/assets/placeholder.png'; // Oder ein anderer Fallback?
        }
        return `/assets/weapons/projectiles/${weaponId}_projectile.png`;
    }, [weaponId, unitTypeId]); // Abhängigkeit von weaponId hinzugefügt
    
    const spriteTexture = useTexture(texturePath); 

    // Textur-Setup und Dimensionsberechnung bleiben ähnlich...
    const aspectWidth = spriteTexture?.image?.width ?? 1;
    const aspectHeight = spriteTexture?.image?.height ?? 1;
    const spriteAspect = aspectWidth / aspectHeight;
    
    // +++ NEU: Wende Skalierungsfaktor an +++
    const baseSpriteHeight = 0.3; // Basisgröße definieren
    const spriteHeight = baseSpriteHeight * scaleModifier;
    const spriteWidth = spriteHeight * spriteAspect;
    const yOffset = spriteHeight / 2; // Y-Offset basiert auf finaler Höhe

    // useEffect zum Setzen der initialen/aktuellen Matrizen (bleibt wichtig für Start/Reset)
    useEffect(() => {
        if (!meshRef.current || projectiles.length === 0) return;

        projectiles.forEach((projectile, i) => {
            if (i >= meshRef.current!.count) return;

            // Initialposition direkt vom Server setzen
            const currentX = projectile.currentPos.x;
            // Verwende originPos.y für die initiale Höhe!
            const currentY = projectile.originPos.y ?? projectile.currentPos.y; 
            const currentZ = projectile.currentPos.z;

            dummyObject.position.set(currentX, currentY, currentZ);
            dummyObject.updateMatrix();
            meshRef.current!.setMatrixAt(i, dummyObject.matrix);
        });

        meshRef.current.instanceMatrix.needsUpdate = true;

    }, [projectiles, spriteWidth, spriteHeight]); 

    // --- Instanz-Updates (jetzt in useFrame mit Client-Simulation) ---
    useFrame((state, delta) => {
        if (!meshRef.current || projectiles.length === 0) return;

        const cameraPosition = state.camera.position;
        const now = Date.now(); // Aktuelle Client-Zeit

        projectiles.forEach((projectile, i) => {
            if (i >= meshRef.current!.count) return;
            
            // Holen der letzten Matrix ist nicht mehr nötig für Positionsberechnung,
            // aber wir überschreiben sie ja eh.
            // meshRef.current!.getMatrixAt(i, dummyObject.matrix); 
            // dummyObject.position.setFromMatrixPosition(dummyObject.matrix);
            
            let finalX: number, finalY: number, finalZ: number;

            // Unterscheide Logik basierend auf Projektiltyp
            if (projectile.projectileType === 'ballistic') {
                // Client-seitige Simulation der ballistischen Flugbahn
                const clientElapsedTime = (now - projectile.createdAt) / 1000.0;
                const progress = Math.min(1.0, clientElapsedTime / projectile.totalFlightTime);

                finalX = lerp(projectile.originPos.x, projectile.targetPos.x, progress);
                finalZ = lerp(projectile.originPos.z, projectile.targetPos.z, progress);
                // Verwende die client-seitige Höhenberechnung und ADDIERE sie zur Starthöhe
                const originY = projectile.originPos.y ?? 0; // Fallback für den Fall, dass Y fehlt
                finalY = originY + calculateParabolicHeight(progress, MAX_PROJECTILE_ARC_HEIGHT);
                
            } else { // 'targeted' oder unbekannt (Fallback: Interpolation zur Server-Position)
                // Ziel ist die aktuelle Position vom Server
                const targetX = projectile.currentPos.x;
                // Für gezielte Projektile nehmen wir Y vom Server (sollte jetzt korrekt sein)
                const targetY = projectile.currentPos.y;
                const targetZ = projectile.currentPos.z;

                // Holen der aktuellen Position aus der Matrix für LERP
                meshRef.current!.getMatrixAt(i, dummyObject.matrix); 
                dummyObject.position.setFromMatrixPosition(dummyObject.matrix);

                targetPositionVec.set(targetX, targetY, targetZ);
                dummyObject.position.lerp(targetPositionVec, 0.3); // Interpoliere zur Server-Position

                // Die interpolierte Position verwenden
                finalX = dummyObject.position.x;
                finalY = dummyObject.position.y;
                finalZ = dummyObject.position.z;
            }

            // Setze die berechnete/interpolierte Position
            dummyObject.position.set(finalX, finalY, finalZ);

            // Billboard-Effekt (bleibt gleich)
            dummyObject.lookAt(cameraPosition);

            // +++ DEBUG LOG: Check calculated position before matrix update +++
            // Logge nur gelegentlich, um die Konsole nicht zu fluten (z.B. alle 60 Frames)
            if (state.clock.elapsedTime % 1 < delta) { // Annahme: delta ist ca. 1/60s
                console.log(`InstancedProjectileMeshes (${unitTypeId})[${i}]: finalPos=`, finalX.toFixed(2), finalY.toFixed(2), finalZ.toFixed(2));
            }
            // +++ END DEBUG LOG +++

            // Matrix aktualisieren & setzen
            dummyObject.updateMatrix();
            meshRef.current!.setMatrixAt(i, dummyObject.matrix);
        });

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
    // NEU: Konfigurationsparameter als Props
    color: string;
    linewidth: number;
    trailLength: number;
    offsetY: number;
    forwardOffset: number;
    // unitTypeId?: string; // Nicht mehr direkt benötigt?
}

const LineProjectileEffect: React.FC<LineProjectileEffectProps> = React.memo(({
    projectile,
    // NEU: Destrukturierte Props mit Defaults (Sicherheitsnetz)
    color = "#FFFF00",
    linewidth = 1,
    trailLength = 0.6,
    offsetY = 0.5,
    forwardOffset = 0.2,
}) => {
    // Refs bleiben gleich
    const geometryRef = useRef<THREE.BufferGeometry>(null!); 

    // Richtung einmalig berechnen
    const direction = useMemo(() => {
        return new THREE.Vector3(
            projectile.targetPos.x - projectile.originPos.x,
            0, // Vorerst Y ignorieren für Richtungsvektor am Boden
            projectile.targetPos.z - projectile.originPos.z
        ).normalize();
    }, [projectile.originPos, projectile.targetPos]);

    // Wiederverwendbare Vektoren
    // +++ NEU: Verwende Props für Offsets/Länge bei Initialisierung +++
    const initialOffsetVec = useMemo(() => direction.clone().multiplyScalar(forwardOffset), [direction, forwardOffset]);
    const offsetVector = useMemo(() => new THREE.Vector3(), []);
    const lerpTarget = useMemo(() => new THREE.Vector3(), []);
    const tempVec = useMemo(() => new THREE.Vector3(), []); // Für Zwischenberechnungen

    // --- NEU: Verwende originPos.y für die Starthöhe --- 
    const originY = projectile.originPos.y ?? 0; // Fallback

    const endPointRef = useRef(new THREE.Vector3(
        projectile.originPos.x + initialOffsetVec.x,
        originY + offsetY, // Kombiniere Starthöhe und relativen Offset
        projectile.originPos.z + initialOffsetVec.z
    ));
    // Initialer Startpunkt basiert auf initialem Endpunkt und Trail-Länge
    const startPointRef = useRef(endPointRef.current.clone().sub(tempVec.copy(direction).multiplyScalar(trailLength))); 

    useFrame(() => {
        // Zielposition aus Serverdaten holen (currentPos sollte jetzt korrekte Y haben)
        const targetEndPoint = tempVec.set(projectile.currentPos.x, projectile.currentPos.y, projectile.currentPos.z); 

        // Zielposition für den Endpunkt mit Offset berechnen
        // Beachte: Offset wird hier nur in X/Z-Richtung addiert
        offsetVector.copy(direction).multiplyScalar(forwardOffset); // NEU: Prop forwardOffset
        lerpTarget.copy(targetEndPoint).add(offsetVector);

        endPointRef.current.lerp(lerpTarget, 0.4); 

        // Startpunkt basierend auf Endpunkt und Richtung berechnen
        startPointRef.current.copy(endPointRef.current).sub(tempVec.copy(direction).multiplyScalar(trailLength)); // NEU: Prop trailLength

        // Update der Geometrie
        const geom = geometryRef.current;
        if (geom) {
            const positions = geom.attributes.position.array as Float32Array;
            positions[0] = startPointRef.current.x;
            positions[1] = startPointRef.current.y;
            positions[2] = startPointRef.current.z;
            positions[3] = endPointRef.current.x;
            positions[4] = endPointRef.current.y;
            positions[5] = endPointRef.current.z;
            geom.attributes.position.needsUpdate = true;
            geom.computeBoundingSphere();
        }
    });

    // Geometrie nur einmal erstellen
    const lineGeometry = useMemo(() => {
        const points = [startPointRef.current.clone(), endPointRef.current.clone()];
        const geom = new THREE.BufferGeometry().setFromPoints(points);
        return geom;
    }, []); 

    // Material wird jetzt dynamisch im useMemo erstellt, um auf Prop-Änderungen zu reagieren
    // (Obwohl sich color/linewidth selten ändern sollten, ist dies sicherer)
    const lineMaterial = useMemo(() => new THREE.LineBasicMaterial({
        color: color, // NEU: Prop
        linewidth: linewidth, // NEU: Prop
        transparent: true,
        opacity: 1
    }), [color, linewidth]);

    // Linienobjekt mit Ref zur Geometrie
    const lineObject = useMemo(() => {
        const line = new THREE.Line(lineGeometry, lineMaterial);
        geometryRef.current = line.geometry as THREE.BufferGeometry; // Weise Ref hier zu
        return line;
    }, [lineGeometry, lineMaterial]); // Abhängig von Geometrie und Material

    return (
        <primitive object={lineObject} />
    );
});
// +++ Ende Line Projectile Component +++

// NEU: Impact Effect Component
interface ImpactEffectProps {
    id: string; // Eindeutige ID für diesen Effekt
    position: THREE.Vector3;
    // unitTypeId wird nicht mehr benötigt, wenn impactTexturePath vorhanden ist
    // unitTypeId?: string; 
    impactTexturePath: string; // NEU: Erforderlicher Pfad zur Textur
    onComplete: (id: string) => void; // Callback zum Entfernen
    duration?: number; // Dauer des Effekts in Sekunden
}

const ImpactEffect: React.FC<ImpactEffectProps> = ({ 
    id, 
    position, 
    // unitTypeId, // Entfernt
    impactTexturePath, // NEU
    onComplete, 
    duration = 1.0 // Dauer jetzt 1 Sekunde
}) => {
    const meshRef = useRef<THREE.Mesh>(null!);
    const materialRef = useRef<THREE.MeshBasicMaterial>(null!);
    const startTime = useRef(Date.now());
    // Korrigierter Pfad:
    const texturePath = `/assets/${impactTexturePath}`;

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
    impactTexturePath?: string;
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
  
  // +++ DEBUG LOG: Check incoming activeProjectiles +++
  console.log("GameScreen received gameState.activeProjectiles:", gameState?.activeProjectiles);
  // +++ END DEBUG LOG +++

  // Zustand für die aktuell sichtbaren Impact-Effekte
  const [activeImpactEffects, setActiveImpactEffects] = useState<ActiveImpactEffect[]>([]);
  
  // Ref, um den vorherigen GameState für den Vergleich zu speichern
  const prevGameStateRef = useRef<ClientGameState | null>(null);
  // NEU: Ref, um die IDs der Projektile des *vorherigen* Frames zu speichern
  const prevProjectileIdsRef = useRef<Set<string>>(new Set());


  // Berechnungen, die *nur* für die 3D-Szene relevant sind:
  const allPlacedUnits = useMemo(() => gameState?.players.flatMap(p => p.placedUnits) ?? [], [gameState?.players]);
  const activeProjectiles = useMemo(() => gameState?.activeProjectiles ?? [], [gameState?.activeProjectiles]);
  const selfPlayer = useMemo(() => gameState?.players.find(p => p.id === playerId), [gameState, playerId]); 

  // +++ NEU: Gruppiere Projektile nach Render-Typ und WAFFEN-ID +++
  const { imageProjectilesGrouped, computerProjectilesWithConfig } = useMemo(() => {
    // WICHTIG: imgGroups jetzt nach weaponId gruppieren!
    const imgGroups: { [weaponId: string]: ProjectileState[] } = {}; 
    // compWithConfig speichert jetzt { projectile, weaponData }
    const compWithConfig: { projectile: ProjectileState, weaponData: Weapon }[] = []; 

    activeProjectiles.forEach(p => {
        // Finde zuerst die Unit-Daten (für Kontext, falls nötig)
        const unitData = placeholderUnits.find(u => u.id === p.unitTypeId);
        if (!unitData || !unitData.weapons) return; // Einheit oder Waffen nicht gefunden, überspringen

        // Finde die spezifischen Waffen-Daten anhand der weaponId aus dem Projektil
        const weaponData = unitData.weapons.find(w => w.id === p.weaponId);
        if (!weaponData) { // Waffe nicht in Unit-Definition gefunden, überspringen
             console.warn(`Weapon ${p.weaponId} not found for unit ${p.unitTypeId} while processing projectile ${p.projectileId}`);
             return; 
        }

        // Entscheide basierend auf dem Render-Typ der *spezifischen* Waffe
        if (weaponData.projectileRenderType === 'computer') {
            // Füge Projektil und seine *Waffen*-Konfiguration zur Liste hinzu
            compWithConfig.push({ projectile: p, weaponData: weaponData });
        } else { // Annahme: 'image' oder nicht definiert -> 'image' als Default?
            // Gruppiere nach weaponId für Instancing
            if (!imgGroups[p.weaponId]) {
                imgGroups[p.weaponId] = [];
            }
            imgGroups[p.weaponId].push(p);
        }
    });
    return { imageProjectilesGrouped: imgGroups, computerProjectilesWithConfig: compWithConfig };
  }, [activeProjectiles]);

  // Effekt zum Erkennen von entfernten Projektilen und Hinzufügen von Impacts
   useEffect(() => {
        // Hole aktuelle Projektile und deren IDs
        const currentProjectiles = gameState?.activeProjectiles ?? [];
        const currentProjectileIds = new Set(currentProjectiles.map(p => p.projectileId));
        // Hole die IDs aus dem vorherigen Frame
        const prevProjectileIds = prevProjectileIdsRef.current;

        // Finde entfernte Projektil-IDs: IDs, die im vorherigen Set waren, aber nicht im aktuellen
        const removedProjectileIds = new Set(
            [...prevProjectileIds].filter(id => !currentProjectileIds.has(id))
        );

        // Nur fortfahren, wenn Projektile entfernt wurden UND ein vorheriger Zustand existiert
        if (removedProjectileIds.size > 0 && prevGameStateRef.current) {
            // Erstelle eine Map der *vorherigen* Projektile für schnellen Zugriff
            const prevProjectilesLookup = new Map(
                 (prevGameStateRef.current.activeProjectiles ?? []).map(p => [p.projectileId, p])
            );

            // Verarbeite jede entfernte Projektil-ID
            removedProjectileIds.forEach(removedId => {
                const prevProjectile = prevProjectilesLookup.get(removedId);
                // Sollte nicht passieren, aber sicher ist sicher
                if (!prevProjectile) return; 

                // Finde die Unit-Daten des entfernten Projektils
                const unitData = placeholderUnits.find(u => u.id === prevProjectile.unitTypeId);
                const weapon = unitData?.weapons?.[0];

                // Prüfe, ob Impact-Effekt angezeigt werden soll (inkl. Pfad-Check)
                if (unitData && weapon?.impactEffectImage && weapon.impactEffectImagePath) {
                    const path = weapon.impactEffectImagePath;
                    // Erstelle Position aus dem *vorherigen* Projektilzustand
                    const impactPosition = new THREE.Vector3(
                        prevProjectile.currentPos.x,
                        0.5, // Höhe des Impacts (anpassen?)
                        prevProjectile.currentPos.z
                    );

                    const newEffect: ActiveImpactEffect = {
                        id: uuidv4(),
                        position: impactPosition,
                        unitTypeId: unitData.id,
                        impactTexturePath: path
                    };

                    // Füge den neuen Effekt zum State hinzu
                    // Wichtig: Verwende die funktionale Form von setState, um Race Conditions zu vermeiden
                    setActiveImpactEffects(prevEffects => [...prevEffects, newEffect]);

                } else if (unitData && weapon?.impactEffectImage && !weapon.impactEffectImagePath) {
                    // Warnung, wenn Flag gesetzt, aber Pfad fehlt
                    console.warn(`Weapon ${weapon.id} of unit ${unitData.id} has impactEffectImage=true but no impactEffectImagePath defined.`);
                }
            });
        }

        // Aktualisiere die Refs für den nächsten Render NACH der Verarbeitung
        prevProjectileIdsRef.current = currentProjectileIds;
        // Speichere den aktuellen gameState für den nächsten Vergleich.
        // ACHTUNG: Dies ist nur sicher, wenn gameState als immutable behandelt wird.
        // Eine tiefe Kopie wäre sicherer, ist hier aber schwierig wegen THREE.Vector3 etc.
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

        {/* 1. Computer-gerenderte Projektile (Linien) */} 
        {computerProjectilesWithConfig.map(({ projectile, weaponData }) => {
            // Hole die Konfiguration direkt aus den übergebenen weaponData
            return (
                <LineProjectileEffect
                    key={projectile.projectileId}
                    projectile={projectile}
                    // Übergebe Konfigurationswerte aus den spezifischen weaponData (mit Defaults)
                    color={weaponData.projectileColor ?? '#FFFF00'} 
                    linewidth={weaponData.projectileLineWidth ?? 1}
                    trailLength={weaponData.projectileTrailLength ?? 0.6}
                    offsetY={weaponData.projectileOffsetY ?? 0.5}
                    forwardOffset={weaponData.projectileForwardOffset ?? 0.2}
                />
            );
        })}
        
        {/* 2. Bild-basierte Projektile (Instanced Sprites) */} 
        {/* Iteriere über die nach weaponId gruppierten Projektile */}
        {Object.entries(imageProjectilesGrouped).map(([weaponId, projectilesOfType]) => {
             // Hole die unitTypeId vom ersten Projektil (wird für Key/Fallback benötigt)
             const unitTypeId = projectilesOfType[0]?.unitTypeId;
             if (!unitTypeId) return null; // Sicherheitshalber

             const groupKey = `projectiles-${unitTypeId}-${weaponId}`;

             // Rendere nichts, wenn keine Projektile da sind
             if (projectilesOfType.length === 0) {
                 return null;
             }

             return (
                 <ErrorBoundary
                     key={`${groupKey}-boundary`}
                     fallback={ /* Fallback Mesh bleibt gleich */
                          <mesh position={[0, 0.5, 25]}> 
                             <sphereGeometry args={[0.2, 8, 8]} />
                             <meshStandardMaterial color="red" />
                         </mesh>
                     }
                 >
                     <Suspense fallback={ /* Fallback Mesh bleibt gleich */
                          <mesh position={[0, 0.5, 25]}> 
                             <sphereGeometry args={[0.2, 8, 8]} />
                             <meshStandardMaterial color="yellow" wireframe />
                         </mesh>
                     }>
                         <InstancedProjectileMeshes
                             key={groupKey} // Key beinhaltet jetzt unitTypeId und weaponId
                             // unitTypeId wird weiterhin übergeben, da InstancedProjectileMeshes es intern noch verwendet
                             // (z.B. um scaleModifier zu holen - TODO: Das könnte man auch an weaponData koppeln)
                             unitTypeId={unitTypeId} 
                             projectiles={projectilesOfType}
                         />
                     </Suspense>
                 </ErrorBoundary>
             );
        })}
        
        {/* Aktive Impact-Effekte rendern */} 
        {activeImpactEffects.map(effect => {
             // Überspringe Rendering, wenn kein Pfad vorhanden ist (sollte nicht passieren durch Logik oben)
             if (!effect.impactTexturePath) {
                 console.warn(`Impact effect ${effect.id} hat keinen impactTexturePath.`);
                 return null;
             }

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
                            // Korrekte Prop übergeben:
                            impactTexturePath={effect.impactTexturePath} 
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