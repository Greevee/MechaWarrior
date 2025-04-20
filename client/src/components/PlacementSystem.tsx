import React, { useState, useMemo, useEffect } from 'react';
import { Plane, Line, useTexture, Billboard } from '@react-three/drei';
import * as THREE from 'three';
import { GameState as ClientGameState, PlayerInGame, FigureState } from '../types/game.types'; // Pfad ggf. anpassen
import { Unit, placeholderUnits } from '../../../server/src/units/unit.types'; // Pfad ggf. anpassen
import { socket } from '../socket'; // Pfad ggf. anpassen

// Konstanten für die Grid-Dimensionen (ggf. auslagern oder aus gameState beziehen)
const GRID_WIDTH = 50;
const PLAYER_ZONE_DEPTH = 20;
const NEUTRAL_ZONE_DEPTH = 10;
const TOTAL_DEPTH = PLAYER_ZONE_DEPTH * 2 + NEUTRAL_ZONE_DEPTH;
const GRID_MIN_X = -GRID_WIDTH / 2;
const GRID_MAX_X = GRID_WIDTH / 2;
const GRID_MIN_Z = 0;
const GRID_MAX_Z = TOTAL_DEPTH;

// --- Placement Preview Mesh Component --- (Angepasst für Rotation)
const PlacementPreviewMesh: React.FC<{ 
    unit: Unit, 
    position: { x: number, z: number }, 
    isValid: boolean,
    isRotated: boolean // NEU: Rotationsstatus
}> = ({ unit, position, isValid, isRotated }) => {
    const yOffset = 0.05; 

    // NEU: Effektive Dimensionen basierend auf Rotation
    const effectiveWidth = isRotated ? unit.height : unit.width;
    const effectiveHeight = isRotated ? unit.width : unit.height;

    // Berechnung der endgültigen Platzierungsposition (zentriert auf Grid-Zellen)
    const halfW = effectiveWidth / 2;
    const halfH = effectiveHeight / 2;
    const minXCell = Math.floor(position.x - halfW + 0.5);
    const maxXCell = Math.floor(position.x + halfW - 0.5);
    const minZCell = Math.floor(position.z - halfH + 0.5);
    const maxZCell = Math.floor(position.z + halfH - 0.5);
    const finalCenterX = (minXCell + maxXCell) / 2;
    const finalCenterZ = (minZCell + maxZCell) / 2;
    const planeWidth = effectiveWidth; // Verwende effektive Dimensionen
    const planeHeight = effectiveHeight; // Verwende effektive Dimensionen

    const color = isValid ? 'green' : 'red';

    return (
        <mesh
            position={[finalCenterX + 0.5, yOffset, finalCenterZ + 0.5]}
            rotation={[-Math.PI / 2, 0, 0]}
        >
            {/* Verwende effektive Dimensionen für die Plane */}
            <planeGeometry args={[planeWidth, planeHeight]} /> 
            <meshBasicMaterial
                color={color} 
                transparent
                opacity={0.5}
                side={THREE.DoubleSide}
                depthWrite={false}
            />
        </mesh>
    );
};

// Hilfsfunktion zur Validierung der Platzierung (Angepasst für Rotation)
const isValidPlacement = (
    unit: Unit,
    targetCenterPos: { x: number, z: number },
    occupiedCells: Set<string>, 
    playerMinZ: number,
    playerMaxZ: number,
    isRotated: boolean // NEU: Rotationsstatus
): boolean => {
    if (!unit) return false;

    // NEU: Effektive Dimensionen basierend auf Rotation
    const effectiveWidth = isRotated ? unit.height : unit.width;
    const effectiveHeight = isRotated ? unit.width : unit.height;

    const halfW = effectiveWidth / 2;
    const halfH = effectiveHeight / 2;
    const minXCell = Math.floor(targetCenterPos.x - halfW + 0.5);
    const maxXCell = Math.floor(targetCenterPos.x + halfW - 0.5);
    const minZCell = Math.floor(targetCenterPos.z - halfH + 0.5);
    const maxZCell = Math.floor(targetCenterPos.z + halfH - 0.5);

    for (let x = minXCell; x <= maxXCell; x++) {
        for (let z = minZCell; z <= maxZCell; z++) {
            // 1. Prüfung: Innerhalb der globalen Grid-Grenzen?
            if (x < GRID_MIN_X || x >= GRID_MAX_X || z < GRID_MIN_Z || z >= GRID_MAX_Z) {
                return false;
            }
            // 2. Prüfung: Innerhalb der Spieler-Platzierungszone?
            if (z < playerMinZ || z >= playerMaxZ) { 
                return false;
            }
            // 3. Prüfung: Kollision mit anderer Einheit?
            if (occupiedCells.has(`${x},${z}`)) {
                return false;
            }
        }
    }
    
    return true; 
};

// --- Placement Zone Highlight Component --- (Aus GameScreen.tsx kopiert)
const PlacementZoneHighlight: React.FC<{ gameState: ClientGameState, playerId: number | null }> = ({ gameState, playerId }) => {
    const GRID_WIDTH = 50;
    const PLAYER_ZONE_DEPTH = 20;
    const NEUTRAL_ZONE_DEPTH = 10;
    const TOTAL_DEPTH = PLAYER_ZONE_DEPTH * 2 + NEUTRAL_ZONE_DEPTH;
    const gridMinX = -GRID_WIDTH / 2;
    const gridMaxX = GRID_WIDTH / 2;
    const gridMinZ = 0;
    const gridMaxZ = TOTAL_DEPTH;

    let playerMinZ: number | null = null;
    let playerMaxZ: number | null = null;

    if (playerId !== null && gameState) { // gameState hinzugefügt
        const isHostPlacing = playerId === gameState.hostId;
        if (isHostPlacing) {
            playerMinZ = gridMinZ;
            playerMaxZ = PLAYER_ZONE_DEPTH;
        } else {
            playerMinZ = PLAYER_ZONE_DEPTH + NEUTRAL_ZONE_DEPTH;
            playerMaxZ = gridMaxZ;
        }
    }

    const points = useMemo(() => {
        if (playerMinZ === null || playerMaxZ === null) return [];
        const p1 = new THREE.Vector3(gridMinX, 0, playerMinZ);
        const p2 = new THREE.Vector3(gridMaxX, 0, playerMinZ);
        const p3 = new THREE.Vector3(gridMaxX, 0, playerMaxZ);
        const p4 = new THREE.Vector3(gridMinX, 0, playerMaxZ);
        return [p1, p2, p2, p3, p3, p4, p4, p1];
    }, [gridMinX, gridMaxX, playerMinZ, playerMaxZ]);

    if (points.length === 0) return null;

    const lineGeometry = useMemo(() => new THREE.BufferGeometry().setFromPoints(points), [points]);
    const yOffset = 0.01;

    return (
        <lineSegments geometry={lineGeometry} position={[0, yOffset, 0]}>
            <lineBasicMaterial color="green" linewidth={2} />
        </lineSegments>
    );
};

// --- Placement Grid Cursor Component --- (Angepasst für Rotation)
const PlacementGridCursor: React.FC<{ 
    unit: Unit, 
    previewPosition: { x: number, z: number },
    isRotated: boolean // NEU: Rotationsstatus
}> = ({ unit, previewPosition, isRotated }) => {
    const yOffset = 0.02;
    const extension = 5;

    // NEU: Effektive Dimensionen basierend auf Rotation
    const effectiveWidth = isRotated ? unit.height : unit.width;
    const effectiveHeight = isRotated ? unit.width : unit.height;

    const halfW = effectiveWidth / 2;
    const halfH = effectiveHeight / 2;
    const minXCell = Math.floor(previewPosition.x - halfW + 0.5);
    const maxXCell = Math.floor(previewPosition.x + halfW - 0.5);
    const minZCell = Math.floor(previewPosition.z - halfH + 0.5);
    const maxZCell = Math.floor(previewPosition.z + halfH - 0.5);
    const finalCenterX = (minXCell + maxXCell) / 2;
    const finalCenterZ = (minZCell + maxZCell) / 2;
    const yellowCenterX = finalCenterX + 0.5;
    const yellowCenterZ = finalCenterZ + 0.5;
    
    // Verwende effektive Dimensionen für die Berechnung der Grid-Grenzen
    const yellowMinX = yellowCenterX - effectiveWidth / 2;
    const yellowMaxX = yellowCenterX + effectiveWidth / 2;
    const yellowMinZ = yellowCenterZ - effectiveHeight / 2;
    const yellowMaxZ = yellowCenterZ + effectiveHeight / 2;
    const gridMinX = Math.round(yellowMinX - extension);
    const gridMaxX = Math.round(yellowMaxX + extension);
    const gridMinZ = Math.round(yellowMinZ - extension);
    const gridMaxZ = Math.round(yellowMaxZ + extension);

    const lines: React.ReactElement[] = [];
    const calculateOpacity = (distance: number) => Math.max(0.05, 1.0 - distance * 0.2);

    // Verwende effektive Dimensionen für die Distanzberechnung
    for (let x = gridMinX; x <= gridMaxX; x++) {
        const dist = Math.max(0, Math.abs(x - yellowCenterX) - effectiveWidth / 2);
        const opacity = calculateOpacity(dist);
        const start = new THREE.Vector3(x, yOffset, gridMinZ);
        const end = new THREE.Vector3(x, yOffset, gridMaxZ);
        lines.push(<Line key={`v-${x}`} points={[start, end]} color="white" lineWidth={1} transparent opacity={opacity} />);
    }

    for (let z = gridMinZ; z <= gridMaxZ; z++) {
        const dist = Math.max(0, Math.abs(z - yellowCenterZ) - effectiveHeight / 2);
        const opacity = calculateOpacity(dist);
        const start = new THREE.Vector3(gridMinX, yOffset, z);
        const end = new THREE.Vector3(gridMaxX, yOffset, z);
        lines.push(<Line key={`h-${z}`} points={[start, end]} color="white" lineWidth={1} transparent opacity={opacity} />);
    }

    return <>{lines}</>;
};

// --- Placement System Wrapper Component --- 
interface PlacementSystemProps {
    gameState: ClientGameState | null;
    playerId: number | null;
    selfPlayer: PlayerInGame | null;
    selectedUnitForPlacement: Unit | null;
    setSelectedUnitForPlacement: (unit: Unit | null) => void;
}

export const PlacementSystem: React.FC<PlacementSystemProps> = ({
    gameState,
    playerId,
    selfPlayer,
    selectedUnitForPlacement,
    setSelectedUnitForPlacement,
}) => {
    const [placementPreviewPosition, setPlacementPreviewPosition] = useState<{ x: number, z: number } | null>(null);
    const [isCurrentPlacementValid, setIsCurrentPlacementValid] = useState<boolean>(false);
    const [isRotated, setIsRotated] = useState<boolean>(false); // NEU: Rotationszustand

    // Berechne Grenzen der Spielerzone
    const { playerMinZ, playerMaxZ } = useMemo(() => {
        let pMinZ: number | null = null;
        let pMaxZ: number | null = null;
        if (playerId !== null && gameState) {
            const isHostPlacing = playerId === gameState.hostId;
            if (isHostPlacing) {
                pMinZ = GRID_MIN_Z;
                pMaxZ = PLAYER_ZONE_DEPTH;
            } else {
                pMinZ = PLAYER_ZONE_DEPTH + NEUTRAL_ZONE_DEPTH;
                pMaxZ = GRID_MAX_Z;
            }
        }
        return { playerMinZ: pMinZ, playerMaxZ: pMaxZ };
    }, [gameState, playerId]);

    // Berechne besetzte Zellen (NEUE LOGIK)
    const occupiedCells = useMemo(() => {
        const cells = new Set<string>();
        if (!selfPlayer || !selfPlayer.placedUnits) return cells;

        selfPlayer.placedUnits.forEach(placedUnit => {
            // Finde die Basisdaten der Einheit
            const unitData = placeholderUnits.find(u => u.id === placedUnit.unitId);
            if (!unitData) return; // Überspringe, wenn Einheitendaten nicht gefunden werden

            // Berücksichtige die Rotation der platzierten Einheit
            const isRotated = placedUnit.rotation === 90;
            const effectiveWidth = isRotated ? unitData.height : unitData.width;
            const effectiveHeight = isRotated ? unitData.width : unitData.height;
            
            const centerPosition = placedUnit.initialPosition;
            const halfW = effectiveWidth / 2;
            const halfH = effectiveHeight / 2;

            // Berechne die Min/Max-Zellen, die von der Einheit abgedeckt werden
            const minXCell = Math.floor(centerPosition.x - halfW + 0.5);
            const maxXCell = Math.floor(centerPosition.x + halfW - 0.5);
            const minZCell = Math.floor(centerPosition.z - halfH + 0.5);
            const maxZCell = Math.floor(centerPosition.z + halfH - 0.5);

            // Füge ALLE Zellen im Bereich zum Set hinzu
            for (let x = minXCell; x <= maxXCell; x++) {
                for (let z = minZCell; z <= maxZCell; z++) {
                    cells.add(`${x},${z}`);
                }
            }
        });
        return cells;
    }, [selfPlayer]); // Abhängigkeit bleibt selfPlayer (genauer: selfPlayer.placedUnits)

    // NEU: Effekt für Tastatur-Listener zur Rotation
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            // Prüfe, ob 'r' gedrückt wurde UND eine Einheit ausgewählt ist
            if ((event.key === 'r' || event.key === 'R') && selectedUnitForPlacement) {
                 console.log("Rotate key pressed");
                 setIsRotated(prev => !prev); // Schalte Rotation um
            }
        };

        // Füge Listener hinzu, wenn Einheit ausgewählt ist
        if (selectedUnitForPlacement) {
            window.addEventListener('keydown', handleKeyDown);
            // console.log("Rotation listener added");
        }

        // Aufräumfunktion: Entferne Listener
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            // console.log("Rotation listener removed");
        };
    }, [selectedUnitForPlacement]); // Abhängig von der ausgewählten Einheit

    // NEU: Effekt zum Zurücksetzen der Rotation, wenn Einheit abgewählt wird
     useEffect(() => {
        if (!selectedUnitForPlacement) {
            setIsRotated(false);
        }
    }, [selectedUnitForPlacement]);

    // Effekt zur Validierung (jetzt auch abhängig von isRotated)
    useEffect(() => {
        if (selectedUnitForPlacement && placementPreviewPosition && playerMinZ !== null && playerMaxZ !== null) {
            const isValid = isValidPlacement(
                selectedUnitForPlacement,
                placementPreviewPosition,
                occupiedCells,
                playerMinZ,
                playerMaxZ,
                isRotated // Übergebe Rotationsstatus
            );
            setIsCurrentPlacementValid(isValid);
        } else {
            setIsCurrentPlacementValid(false); 
        }
    }, [selectedUnitForPlacement, placementPreviewPosition, occupiedCells, playerMinZ, playerMaxZ, isRotated]); // isRotated hinzugefügt

    // Event Handlers
    const handlePlacementPointerMove = (event: any) => {
        if (!selectedUnitForPlacement) return;
        const point = event.point;
        if (point && playerMinZ !== null && playerMaxZ !== null && point.z >= playerMinZ && point.z <= playerMaxZ) {
            // Runde auf die nächste Zelle für die Vorschau
            const previewX = Math.floor(point.x);
            const previewZ = Math.floor(point.z);
            // Setze Position nur, wenn sie sich geändert hat
             if (!placementPreviewPosition || placementPreviewPosition.x !== previewX || placementPreviewPosition.z !== previewZ) {
                 setPlacementPreviewPosition({ x: previewX, z: previewZ });
             }
        } else {
             if (placementPreviewPosition !== null) {
                 setPlacementPreviewPosition(null);
             }
        }
    };

    const handlePlacementPointerOut = (event: any) => {
        setPlacementPreviewPosition(null);
    };

    const handlePlacementClick = (event: any) => {
        if (!selectedUnitForPlacement || !gameState || !selfPlayer || !placementPreviewPosition || !isCurrentPlacementValid) {
             console.warn("[PlacementSystem:Click] Click ignored, placement invalid or missing data.");
            return; 
        }
        
        event.stopPropagation();

        // Effektive Dimensionen für finale Positionsberechnung
        const effectiveWidth = isRotated ? selectedUnitForPlacement.height : selectedUnitForPlacement.width;
        const effectiveHeight = isRotated ? selectedUnitForPlacement.width : selectedUnitForPlacement.height;

        const halfW = effectiveWidth / 2;
        const halfH = effectiveHeight / 2;
        const minXCell = Math.floor(placementPreviewPosition.x - halfW + 0.5);
        const maxXCell = Math.floor(placementPreviewPosition.x + halfW - 0.5);
        const minZCell = Math.floor(placementPreviewPosition.z - halfH + 0.5);
        const maxZCell = Math.floor(placementPreviewPosition.z + halfH - 0.5);
        const finalCenterX = (minXCell + maxXCell) / 2 + 0.5;
        const finalCenterZ = (minZCell + maxZCell) / 2 + 0.5;

        const placementData = {
            gameId: gameState.gameId,
            unitId: selectedUnitForPlacement.id,
            position: { x: finalCenterX, z: finalCenterZ },
            rotation: isRotated ? 90 : 0 // NEU: Rotation hinzufügen
        };
        console.log("[PlacementSystem:Click] Emitting 'game:place-unit'", placementData);
        socket.emit('game:place-unit', placementData, (response: any) => {
            if (!response?.success) {
                alert(`Placement Error: ${response?.message || 'Unknown error'}`);
            }
            // Auswahl nur bei Erfolg zurücksetzen? Oder immer?
            setSelectedUnitForPlacement(null); // Clear selection after attempt
        });
        setPlacementPreviewPosition(null); // Reset preview
    };

    // Render nichts, wenn nicht in Vorbereitung oder Daten fehlen
    if (!gameState || gameState.phase !== 'Preparation' || playerId === null || selfPlayer === null || playerMinZ === null || playerMaxZ === null) {
        return null;
    }
    
    // Berechne die Details der Interaktionsebene neu, da sie von playerMinZ/MaxZ abhängen
    const playerZoneWidth = GRID_MAX_X - GRID_MIN_X;
    const playerZoneDepth = playerMaxZ - playerMinZ;
    const playerZoneCenterX = (GRID_MIN_X + GRID_MAX_X) / 2; // Should be 0
    const playerZoneCenterZ = (playerMinZ + playerMaxZ) / 2;

    return (
        <>
            {/* Highlight für die eigene Platzierungszone (Immer sichtbar in Vorbereitung) */}
            <PlacementZoneHighlight gameState={gameState} playerId={playerId} />

            {/* Interaktionsebene, Vorschau, Gitter UND besetzte Zellen nur wenn Einheit ausgewählt ist */}
            {selectedUnitForPlacement && (
                <>
                    {/* Visualisierung der besetzten Zellen (Gelb) - JETZT HIER DRIN */}
                    {Array.from(occupiedCells).map(cellKey => {
                        const [xStr, zStr] = cellKey.split(',');
                        const x = parseInt(xStr, 10);
                        const z = parseInt(zStr, 10);
                        // Rendere nur, wenn die Zelle in der Spielerzone liegt
                        if (playerMinZ !== null && playerMaxZ !== null && z >= playerMinZ && z < playerMaxZ) {
                            return (
                                <Plane 
                                    key={`occupied-${x}-${z}`}
                                    args={[1, 1]} // Größe einer Zelle
                                    position={[x + 0.5, 0.02, z + 0.5]} // Leicht über dem Boden
                                    rotation={[-Math.PI / 2, 0, 0]}
                                >
                                    <meshBasicMaterial 
                                        color="yellow" 
                                        transparent 
                                        opacity={0.3} 
                                        side={THREE.DoubleSide} 
                                        depthWrite={false}
                                    />
                                </Plane>
                            );
                        }
                        return null;
                    })}

                    {/* Unsichtbare Ebene für Maus-Events */}
                    <Plane
                        args={[playerZoneWidth, playerZoneDepth]}
                        position={[playerZoneCenterX, 0.01, playerZoneCenterZ]} 
                        rotation={[-Math.PI / 2, 0, 0]}
                        visible={false} 
                        onPointerMove={handlePlacementPointerMove}
                        onPointerOut={handlePlacementPointerOut}
                        onClick={handlePlacementClick} 
                    />
                    {/* Sichtbare Vorschau (Rot/Grün) */} 
                    {placementPreviewPosition && (
                        <PlacementPreviewMesh 
                            unit={selectedUnitForPlacement} 
                            position={placementPreviewPosition} 
                            isValid={isCurrentPlacementValid}
                            isRotated={isRotated} 
                        />
                    )}
                    {/* Optional: Platzierungsgitter anzeigen */} 
                    {placementPreviewPosition && (
                       <PlacementGridCursor 
                            unit={selectedUnitForPlacement} 
                            previewPosition={placementPreviewPosition} 
                            isRotated={isRotated} 
                       />
                    )}
                </>
            )}
        </>
    );
};

export default PlacementSystem; 