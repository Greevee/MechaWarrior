import React, { useState, useMemo } from 'react';
import { Plane, Line, useTexture, Billboard } from '@react-three/drei';
import * as THREE from 'three';
import { GameState as ClientGameState, PlayerInGame, FigureState } from '../types/game.types'; // Pfad ggf. anpassen
import { Unit, placeholderUnits } from '../../../server/src/units/unit.types'; // Pfad ggf. anpassen
import { socket } from '../socket'; // Pfad ggf. anpassen

// --- Placement Preview Mesh Component --- (Aus GameScreen.tsx kopiert & angepasst)
const PlacementPreviewMesh: React.FC<{ unit: Unit, position: { x: number, z: number } }> = ({ unit, position }) => {
    const yOffset = 0.05;

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

    // console.log(`[PlacementPreviewMesh] Unit ${unit.id} (${unit.width}x${unit.height}) at grid (${position.x}, ${position.z}) -> Cells X:[${minXCell}-${maxXCell}], Z:[${minZCell}-${maxZCell}] -> Centering Plane at (${(finalCenterX + 0.5).toFixed(2)}, ${(finalCenterZ + 0.5).toFixed(2)})`);

    return (
        <mesh
            position={[finalCenterX + 0.5, yOffset, finalCenterZ + 0.5]}
            rotation={[-Math.PI / 2, 0, 0]}
        >
            <planeGeometry args={[planeWidth, planeHeight]} />
            <meshBasicMaterial
                color="yellow"
                transparent
                opacity={0.5}
                side={THREE.DoubleSide}
            />
        </mesh>
    );
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

    // Berechne Grenzen der Spielerzone für die Interaktionsebene
    const { playerZoneWidth, playerZoneDepth, playerZoneCenterX, playerZoneCenterZ, playerMinZ, playerMaxZ } = useMemo(() => {
        const GRID_WIDTH = 50;
        const PLAYER_ZONE_DEPTH = 20;
        const NEUTRAL_ZONE_DEPTH = 10;
        const TOTAL_DEPTH = PLAYER_ZONE_DEPTH * 2 + NEUTRAL_ZONE_DEPTH;
        const gridMinX = -GRID_WIDTH / 2;
        const gridMaxX = GRID_WIDTH / 2;
        const gridMinZ = 0;
        const gridMaxZ = TOTAL_DEPTH;
        let pMinZ: number | null = null;
        let pMaxZ: number | null = null;

        if (playerId !== null && gameState) {
            const isHostPlacing = playerId === gameState.hostId;
            if (isHostPlacing) {
                pMinZ = gridMinZ;
                pMaxZ = PLAYER_ZONE_DEPTH;
            } else {
                pMinZ = PLAYER_ZONE_DEPTH + NEUTRAL_ZONE_DEPTH;
                pMaxZ = gridMaxZ;
            }
        }
        const pZoneWidth = gridMaxX - gridMinX;
        const pZoneDepth = (pMinZ !== null && pMaxZ !== null) ? pMaxZ - pMinZ : 0;
        const pZoneCenterX = (gridMinX + gridMaxX) / 2; // Should be 0
        const pZoneCenterZ = (pMinZ !== null && pMaxZ !== null) ? (pMinZ + pMaxZ) / 2 : 0;

        return { playerZoneWidth: pZoneWidth, playerZoneDepth: pZoneDepth, playerZoneCenterX: pZoneCenterX, playerZoneCenterZ: pZoneCenterZ, playerMinZ: pMinZ, playerMaxZ: pMaxZ };
    }, [gameState, playerId]);

    // Event Handlers
    const handlePlacementPointerMove = (event: any) => {
        if (!selectedUnitForPlacement) return;
        const point = event.point;
         // Check if the point is within the allowed Z range for this player
        if (point && playerMinZ !== null && playerMaxZ !== null && point.z >= playerMinZ && point.z <= playerMaxZ) {
            const previewX = Math.round(point.x);
            const previewZ = Math.round(point.z);
            if (!placementPreviewPosition || placementPreviewPosition.x !== previewX || placementPreviewPosition.z !== previewZ) {
                setPlacementPreviewPosition({ x: previewX, z: previewZ });
            }
        } else {
            if (placementPreviewPosition !== null) {
                setPlacementPreviewPosition(null); // Reset if outside zone or invalid
            }
        }
    };

    const handlePlacementPointerOut = (event: any) => {
        if (placementPreviewPosition !== null) {
            setPlacementPreviewPosition(null);
        }
    };

    const handlePlacementClick = (event: any) => {
        if (!selectedUnitForPlacement || !gameState || !selfPlayer || !placementPreviewPosition) {
            return;
        }
        // Check again if the final preview position is valid (redundant if PointerMove checks correctly)
        if (playerMinZ === null || playerMaxZ === null || placementPreviewPosition.z < playerMinZ || placementPreviewPosition.z > playerMaxZ) {
             console.warn("[PlacementSystem:Click] Click ignored, position outside placement zone.");
             return;
        }

        event.stopPropagation();

        const placementData = {
            gameId: gameState.gameId,
            unitId: selectedUnitForPlacement.id,
            position: { x: placementPreviewPosition.x, z: placementPreviewPosition.z },
        };
        console.log("[PlacementSystem:Click] Emitting 'game:place-unit'", placementData);
        socket.emit('game:place-unit', placementData, (response: any) => {
            if (!response?.success) {
                alert(`Placement Error: ${response?.message || 'Unknown error'}`);
            }
            setSelectedUnitForPlacement(null); // Clear selection after attempt
        });
        setPlacementPreviewPosition(null); // Reset preview
    };

    // Render nichts, wenn nicht in Vorbereitung oder Daten fehlen
    if (!gameState || gameState.phase !== 'Preparation' || playerId === null || selfPlayer === null || playerMinZ === null || playerMaxZ === null) {
        return null;
    }

    return (
        <>
            {/* Unsichtbare Ebene für Interaktion NUR wenn eine Einheit ausgewählt ist */}
            {selectedUnitForPlacement && (
                <Plane
                    args={[playerZoneWidth, playerZoneDepth]}
                    position={[playerZoneCenterX, 0.005, playerZoneCenterZ]} // Minimal über Boden, unter Highlights
                    rotation={[-Math.PI / 2, 0, 0]}
                    visible={false}
                    onPointerMove={handlePlacementPointerMove}
                    onPointerOut={handlePlacementPointerOut}
                    onClick={handlePlacementClick}
                />
            )}

            {/* Visuelle Hilfen */}
            <PlacementZoneHighlight gameState={gameState} playerId={playerId} />

            {selectedUnitForPlacement && placementPreviewPosition && (
                <>
                    <PlacementPreviewMesh unit={selectedUnitForPlacement} position={placementPreviewPosition} />
                    <PlacementGridCursor unit={selectedUnitForPlacement} previewPosition={placementPreviewPosition} />
                </>
            )}
        </>
    );
};

export default PlacementSystem; 