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

// --- Placement Preview Mesh Component --- (Angepasst für Farbwechsel)
const PlacementPreviewMesh: React.FC<{ 
    unit: Unit, 
    position: { x: number, z: number }, 
    isValid: boolean 
}> = ({ unit, position, isValid }) => {
    const yOffset = 0.05; // Leicht über dem Boden und den gelben Highlights

    // Berechnung der endgültigen Platzierungsposition (zentriert auf Grid-Zellen)
    const halfW = unit.width / 2;
    const halfH = unit.height / 2;
    const minXCell = Math.floor(position.x - halfW + 0.5);
    const maxXCell = Math.floor(position.x + halfW - 0.5);
    const minZCell = Math.floor(position.z - halfH + 0.5);
    const maxZCell = Math.floor(position.z + halfH - 0.5);
    const finalCenterX = (minXCell + maxXCell) / 2;
    const finalCenterZ = (minZCell + maxZCell) / 2;
    const planeWidth = unit.width;
    const planeHeight = unit.height;

    const color = isValid ? 'green' : 'red';

    return (
        <mesh
            position={[finalCenterX + 0.5, yOffset, finalCenterZ + 0.5]}
            rotation={[-Math.PI / 2, 0, 0]}
        >
            <planeGeometry args={[planeWidth, planeHeight]} />
            <meshBasicMaterial
                color={color} // Farbe basierend auf Gültigkeit
                transparent
                opacity={0.5}
                side={THREE.DoubleSide}
                depthWrite={false} // Verhindert Probleme mit Transparenz-Sortierung
            />
        </mesh>
    );
};

// Hilfsfunktion zur Validierung der Platzierung
const isValidPlacement = (
    unit: Unit,
    targetCenterPos: { x: number, z: number },
    occupiedCells: Set<string>, // Set von "x,z" Strings
    playerMinZ: number,
    playerMaxZ: number
): boolean => {
    if (!unit) return false;

    const halfW = unit.width / 2;
    const halfH = unit.height / 2;
    const minXCell = Math.floor(targetCenterPos.x - halfW + 0.5);
    const maxXCell = Math.floor(targetCenterPos.x + halfW - 0.5);
    const minZCell = Math.floor(targetCenterPos.z - halfH + 0.5);
    const maxZCell = Math.floor(targetCenterPos.z + halfH - 0.5);

    for (let x = minXCell; x <= maxXCell; x++) {
        for (let z = minZCell; z <= maxZCell; z++) {
            // 1. Prüfung: Innerhalb der globalen Grid-Grenzen?
            if (x < GRID_MIN_X || x >= GRID_MAX_X || z < GRID_MIN_Z || z >= GRID_MAX_Z) {
                // console.log(`Validation failed: Out of global bounds at ${x},${z}`);
                return false;
            }
            // 2. Prüfung: Innerhalb der Spieler-Platzierungszone?
            if (z < playerMinZ || z >= playerMaxZ) { // Z-Grenzen sind exklusiv oben
                // console.log(`Validation failed: Out of player Z bounds (${playerMinZ}-${playerMaxZ}) at ${x},${z}`);
                return false;
            }
            // 3. Prüfung: Kollision mit anderer Einheit?
            if (occupiedCells.has(`${x},${z}`)) {
                // console.log(`Validation failed: Collision at ${x},${z}`);
                return false;
            }
        }
    }
    
    // console.log(`Validation success at ${targetCenterPos.x},${targetCenterPos.z}`);
    return true; // Alle Zellen sind gültig
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

// --- Placement Grid Cursor Component --- (Aus GameScreen.tsx kopiert)
const PlacementGridCursor: React.FC<{ unit: Unit, previewPosition: { x: number, z: number } }> = ({ unit, previewPosition }) => {
    const yOffset = 0.02;
    const extension = 5;

    const halfW = unit.width / 2;
    const halfH = unit.height / 2;
    const minXCell = Math.floor(previewPosition.x - halfW + 0.5);
    const maxXCell = Math.floor(previewPosition.x + halfW - 0.5);
    const minZCell = Math.floor(previewPosition.z - halfH + 0.5);
    const maxZCell = Math.floor(previewPosition.z + halfH - 0.5);
    const finalCenterX = (minXCell + maxXCell) / 2;
    const finalCenterZ = (minZCell + maxZCell) / 2;
    const yellowCenterX = finalCenterX + 0.5;
    const yellowCenterZ = finalCenterZ + 0.5;
    const yellowMinX = yellowCenterX - unit.width / 2;
    const yellowMaxX = yellowCenterX + unit.width / 2;
    const yellowMinZ = yellowCenterZ - unit.height / 2;
    const yellowMaxZ = yellowCenterZ + unit.height / 2;
    const gridMinX = Math.round(yellowMinX - extension);
    const gridMaxX = Math.round(yellowMaxX + extension);
    const gridMinZ = Math.round(yellowMinZ - extension);
    const gridMaxZ = Math.round(yellowMaxZ + extension);

    const lines: React.ReactElement[] = [];
    const calculateOpacity = (distance: number) => Math.max(0.05, 1.0 - distance * 0.2);

    for (let x = gridMinX; x <= gridMaxX; x++) {
        const dist = Math.max(0, Math.abs(x - yellowCenterX) - unit.width / 2);
        const opacity = calculateOpacity(dist);
        const start = new THREE.Vector3(x, yOffset, gridMinZ);
        const end = new THREE.Vector3(x, yOffset, gridMaxZ);
        lines.push(<Line key={`v-${x}`} points={[start, end]} color="white" lineWidth={1} transparent opacity={opacity} />);
    }

    for (let z = gridMinZ; z <= gridMaxZ; z++) {
        const dist = Math.max(0, Math.abs(z - yellowCenterZ) - unit.height / 2);
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

    // Berechne besetzte Zellen des aktuellen Spielers
    const occupiedCells = useMemo(() => {
        const cells = new Set<string>();
        if (!selfPlayer || !selfPlayer.placedUnits) return cells;

        selfPlayer.placedUnits.forEach(unit => {
            unit.figures.forEach(figure => {
                const cellX = Math.floor(figure.position.x);
                const cellZ = Math.floor(figure.position.z);
                cells.add(`${cellX},${cellZ}`);
            });
        });
        return cells;
    }, [selfPlayer]);

    // Effekt zur Validierung, wenn sich Vorschauposition oder Auswahl ändert
    useEffect(() => {
        if (selectedUnitForPlacement && placementPreviewPosition && playerMinZ !== null && playerMaxZ !== null) {
            const isValid = isValidPlacement(
                selectedUnitForPlacement,
                placementPreviewPosition,
                occupiedCells,
                playerMinZ,
                playerMaxZ
            );
            setIsCurrentPlacementValid(isValid);
        } else {
            setIsCurrentPlacementValid(false); // Ungültig, wenn nichts ausgewählt/positioniert ist
        }
    }, [selectedUnitForPlacement, placementPreviewPosition, occupiedCells, playerMinZ, playerMaxZ]);

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
            return; // Klick ignorieren, wenn Platzierung nicht gültig ist
        }
        
        event.stopPropagation();

        // Berechne die finale Mittelpunkt-Position basierend auf den Zellen
        const halfW = selectedUnitForPlacement.width / 2;
        const halfH = selectedUnitForPlacement.height / 2;
        const minXCell = Math.floor(placementPreviewPosition.x - halfW + 0.5);
        const maxXCell = Math.floor(placementPreviewPosition.x + halfW - 0.5);
        const minZCell = Math.floor(placementPreviewPosition.z - halfH + 0.5);
        const maxZCell = Math.floor(placementPreviewPosition.z + halfH - 0.5);
        const finalCenterX = (minXCell + maxXCell) / 2 + 0.5;
        const finalCenterZ = (minZCell + maxZCell) / 2 + 0.5;

        const placementData = {
            gameId: gameState.gameId,
            unitId: selectedUnitForPlacement.id,
             // Sende die berechnete Mittelpunkt-Position an den Server
            position: { x: finalCenterX, z: finalCenterZ },
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
            {/* Highlight für die eigene Platzierungszone */}
            <PlacementZoneHighlight gameState={gameState} playerId={playerId} />

            {/* Visualisierung der besetzten Zellen (Gelb) */}
            {Array.from(occupiedCells).map(cellKey => {
                const [xStr, zStr] = cellKey.split(',');
                const x = parseInt(xStr, 10);
                const z = parseInt(zStr, 10);
                // Rendere nur, wenn die Zelle in der Spielerzone liegt
                if (z >= playerMinZ && z < playerMaxZ) {
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

            {/* Interaktionsebene, Vorschau und Gitter nur wenn Einheit ausgewählt ist */}
            {selectedUnitForPlacement && (
                <>
                    {/* Unsichtbare Ebene für Maus-Events */}
                    <Plane
                        args={[playerZoneWidth, playerZoneDepth]}
                        position={[playerZoneCenterX, 0.01, playerZoneCenterZ]} // Position und Größe basierend auf Spielerzone
                        rotation={[-Math.PI / 2, 0, 0]}
                        visible={false} // Unsichtbar, nur für Pointer Events
                        onPointerMove={handlePlacementPointerMove}
                        onPointerOut={handlePlacementPointerOut}
                        onClick={handlePlacementClick} // Klick-Handler hier
                    />
                    {/* Sichtbare Vorschau (Rot/Grün) */} 
                    {placementPreviewPosition && (
                        <PlacementPreviewMesh 
                            unit={selectedUnitForPlacement} 
                            position={placementPreviewPosition} 
                            isValid={isCurrentPlacementValid}
                        />
                    )}
                    {/* Optional: Platzierungsgitter anzeigen */} 
                    {placementPreviewPosition && (
                       <PlacementGridCursor unit={selectedUnitForPlacement} previewPosition={placementPreviewPosition}/>
                    )}
                </>
            )}
        </>
    );
};

export default PlacementSystem; 