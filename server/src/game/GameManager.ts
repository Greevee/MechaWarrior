import { Server as SocketIOServer, Socket } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import { GameState, PlayerInGame, PlacedUnit, FigureState, ProjectileState, FigureBehaviorState, GamePhase } from '../types/game.types';
import { Lobby, LobbyPlayer } from '../types/lobby.types';
import { Unit, placeholderUnits, parseFormation } from '../units/unit.types';
import { Faction } from "../types/common.types";
import { GameMode } from "../types/lobby.types";

const TICK_INTERVAL_MS = 50; // 40 Ticks pro Sekunde
const preparationDurationMs = 60 * 1000; // 60 Sekunden
const initialCredits = 200;
const initialBaseHealth = 10000;
const incomePerRound = 200; // Beispiel-Einkommen
const PLACEMENT_LIMIT_PER_ROUND = 3;

// Grid-Konstanten (könnten in eine config-Datei)
const GRID_WIDTH = 50;
const PLAYER_ZONE_DEPTH = 20;
const NEUTRAL_ZONE_DEPTH = 10;
const TOTAL_DEPTH = PLAYER_ZONE_DEPTH * 2 + NEUTRAL_ZONE_DEPTH;
const gridMinX = -Math.floor(GRID_WIDTH / 2);
const gridMaxX = Math.floor((GRID_WIDTH - 1) / 2);
const gridMinZ = 0;
const gridMaxZ = TOTAL_DEPTH - 1;

// Konstanten
const PREPARATION_TIME_SECONDS = 10; // z.B. 30 Sekunden Vorbereitungszeit
const ROUND_INTERVAL_SECONDS = 5; // Zeit zwischen den Runden
const MAX_PROJECTILE_ARC_HEIGHT = 5; // Maximale Höhe des Bogens für ballistische Projektile

// Hilfsfunktion: Lineare Interpolation
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

// NEU: Hilfsfunktion für Parabelhöhe (0 <= t <= 1)
const calculateParabolicHeight = (t: number, maxHeight: number): number => {
    // Einfache Parabelformel: y = 4 * h * t * (1 - t)
    // t=0 -> y=0; t=0.5 -> y=h; t=1 -> y=0
    return 4 * maxHeight * t * (1 - t);
};

export class GameManager {
    private activeGames = new Map<string, GameState>();
    private preparationTimers = new Map<string, NodeJS.Timeout>();
    private gameLoopInterval: NodeJS.Timeout | null = null;
    private io: SocketIOServer;
    private playerSockets = new Map<number, string>();
    private lastUpdateTime: number = Date.now();

    constructor(io: SocketIOServer) {
        this.io = io;
        this.startGlobalGameLoop();
    }

    // --- Spiel-Verwaltung --- 

    public startGame(lobby: Lobby): GameState | null {
        if (!lobby || !lobby.id) return null;

        const playersInGame = new Map<number, PlayerInGame>();
        for (const lobbyPlayer of lobby.players.values()) {
            if (!lobbyPlayer.selectedFaction) {
                console.error(`GameManager: Fehler beim Starten - Spieler ${lobbyPlayer.username} hat keine Fraktion!`);
                return null; // Spiel kann nicht gestartet werden
            }
            playersInGame.set(lobbyPlayer.id, {
                id: lobbyPlayer.id,
                username: lobbyPlayer.username,
                faction: lobbyPlayer.selectedFaction!,
                credits: initialCredits,
                baseHealth: initialBaseHealth,
                unlockedUnits: [],
                placedUnits: [],
                unitsPlacedThisRound: 0,
                unitsAtCombatStart: [],
            });
            this.playerSockets.set(lobbyPlayer.id, lobbyPlayer.socketId);
        }

        const initialGameState: GameState = {
            gameId: lobby.id,
            hostId: lobby.hostId,
            mode: lobby.mode,
            round: 1,
            phase: 'Preparation',
            preparationEndTime: Date.now() + preparationDurationMs,
            players: playersInGame,
            activeProjectiles: [],
        };

        this.activeGames.set(lobby.id, initialGameState);
        console.log(`GameManager: Spiel ${initialGameState.gameId} erstellt aus Lobby ${lobby.id}.`);

        this.startPreparationTimer(initialGameState.gameId);
        
        return this.getSerializableGameState(initialGameState);
    }

    public getGame(gameId: string): GameState | undefined {
        const game = this.activeGames.get(gameId);
        return game ? this.getSerializableGameState(game) : undefined;
    }

    public removePlayer(playerId: number): void {
        this.playerSockets.delete(playerId);
        // Geht durch alle Spiele und entfernt den Spieler oder beendet das Spiel
        this.activeGames.forEach((game, gameId) => {
            if (game.players.has(playerId)) {
                console.log(`GameManager: Spieler ${playerId} aus Spiel ${gameId} entfernt (Disconnect).`);
                // TODO: Logik implementieren, was passieren soll (Spiel beenden, pausieren, etc.)
                // Vorerst: Stoppe nur den Vorbereitungstimer, falls vorhanden
                this.clearPreparationTimer(gameId);
                // Hier könnte man das Spiel auch löschen:
                // this.activeGames.delete(gameId);
                // Oder eine Nachricht an die verbleibenden Spieler senden
                // game.players.delete(playerId);
                // this.emitGameStateUpdate(gameId, game); 
            }
        });
    }

    // --- Timer & Phasen-Management --- 

    private startPreparationTimer(gameId: string): void {
        this.clearPreparationTimer(gameId); // Sicherstellen, dass kein alter Timer läuft
        const timerId = setTimeout(() => {
            this.startCombatPhase(gameId);
        }, preparationDurationMs);
        this.preparationTimers.set(gameId, timerId);
         console.log(`GameManager: Vorbereitungstimer für Spiel ${gameId} gestartet (${preparationDurationMs}ms).`);
    }

    private clearPreparationTimer(gameId: string): void {
        const existingTimer = this.preparationTimers.get(gameId);
        if (existingTimer) {
            clearTimeout(existingTimer);
            this.preparationTimers.delete(gameId);
            console.log(`GameManager: Vorbereitungstimer für Spiel ${gameId} gelöscht.`);
        }
    }

    public startCombatPhase(gameId: string): void {
        const gameState = this.activeGames.get(gameId);
        if (!gameState || gameState.phase !== 'Preparation') {
             console.log(`GameManager: startCombatPhase für ${gameId} abgebrochen (falsche Phase oder Spiel nicht gefunden).`);
             return;
        }

        let allPlayersHaveZeroUnits = true;
        gameState.players.forEach(player => {
            if (player.placedUnits.length > 0) {
                allPlayersHaveZeroUnits = false;
            }
        });

        if (allPlayersHaveZeroUnits) {
            console.log(`GameManager: Spiel ${gameId}: Kampfphase übersprungen, da keine Einheiten platziert wurden. Runde ${gameState.round} wird sofort beendet.`);
            this.clearPreparationTimer(gameId);
            this.resetGameToPreparation(gameId);
            return;
        }

        console.log(`GameManager: Spiel ${gameId}: Starte Kampfphase.`);
        this.clearPreparationTimer(gameId);

        // NEU: Manuelle tiefe Kopie, die Maps erhält
        gameState.players.forEach(player => {
            player.unitsAtCombatStart = player.placedUnits.map(unit => ({
                ...unit, // Kopiere alle Top-Level-Eigenschaften der Unit
                figures: unit.figures.map(figure => ({
                    ...figure, // Kopiere alle Top-Level-Eigenschaften der Figur
                    // Erstelle eine *neue* Map für die Cooldowns
                    weaponCooldowns: new Map(figure.weaponCooldowns)
                }))
            }));
        });
        
        gameState.phase = 'Combat';
        gameState.preparationEndTime = undefined;
        gameState.combatStartTime = Date.now();
        this.emitGameStateUpdate(gameId, gameState);
    }

    public forceStartCombat(gameId: string, requestingPlayerId: number): { success: boolean, message?: string } {
        const gameState = this.activeGames.get(gameId);
        if (!gameState) {
            return { success: false, message: 'Spiel nicht gefunden.' };
        }
        if (gameState.hostId !== requestingPlayerId) {
            return { success: false, message: 'Nur der Host kann die Kampfphase starten.' };
        }
        if (gameState.phase !== 'Preparation') {
            return { success: false, message: 'Das Spiel ist nicht in der Vorbereitungsphase.' };
        }
        this.startCombatPhase(gameId);
        return { success: true };
    }

    // --- Spielaktionen --- 

    public unlockUnit(gameId: string, playerId: number, unitId: string): { success: boolean, message?: string } {
        const gameState = this.activeGames.get(gameId);
        if (!gameState || !gameState.players.has(playerId)) {
            return { success: false, message: 'Spiel oder Spieler nicht gefunden.' };
        }
        const playerState = gameState.players.get(playerId)!;
        const unitToUnlock = placeholderUnits.find(u => u.id === unitId);

        if (!unitToUnlock) return { success: false, message: 'Einheit nicht gefunden.' };
        if (unitToUnlock.faction !== playerState.faction) return { success: false, message: 'Einheit gehört nicht zu deiner Fraktion.' };
        if (playerState.unlockedUnits.includes(unitId)) return { success: false, message: 'Einheit bereits freigeschaltet.' };
        if (playerState.credits < unitToUnlock.unlockCost) return { success: false, message: 'Nicht genügend Credits.' };

        playerState.credits -= unitToUnlock.unlockCost;
        playerState.unlockedUnits.push(unitId);
        console.log(`GameManager: Spieler ${playerState.username} schaltet ${unitId} frei.`);
        this.emitGameStateUpdate(gameId, gameState);
        return { success: true };
    }

    public placeUnit(gameId: string, playerId: number, unitId: string, position: { x: number, z: number }, rotation: 0 | 90): { success: boolean, message?: string } {
        const gameState = this.activeGames.get(gameId);
        if (!gameState || !gameState.players.has(playerId)) {
            return { success: false, message: 'Spiel oder Spieler nicht gefunden.' };
        }
        const playerState = gameState.players.get(playerId)!;
        const unitData = placeholderUnits.find(u => u.id === unitId);

        if (gameState.phase !== 'Preparation') return { success: false, message: 'Nur in Vorbereitung platzierbar.' };
        if (!unitData) return { success: false, message: 'Unbekannter Einheitentyp.' };
        if (!playerState.unlockedUnits.includes(unitId)) return { success: false, message: 'Einheit nicht freigeschaltet.' };
        if (playerState.credits < unitData.placementCost) return { success: false, message: 'Nicht genügend Credits.' };
        if (playerState.unitsPlacedThisRound >= PLACEMENT_LIMIT_PER_ROUND) return { success: false, message: `Limit von ${PLACEMENT_LIMIT_PER_ROUND} erreicht.` };
        
        // Platzierungsvalidierung (Zone, Kollision)
        const validationResult = this.validatePlacement(gameState, playerId, unitData, position, rotation);
        if (!validationResult.success) {
            return validationResult;
        }

        // Platzieren!
        playerState.credits -= unitData.placementCost;
        playerState.unitsPlacedThisRound++;

        const figures = this.createFiguresForUnit(playerId, unitId, unitData, position, rotation);
        const unitInstanceId = uuidv4(); 
        figures.forEach(f => f.unitInstanceId = unitInstanceId);

        const newPlacedUnit: PlacedUnit = {
            instanceId: unitInstanceId,
            unitId: unitId,
            playerId: playerId,
            initialPosition: position,
            rotation: rotation,
            figures: figures,
            totalDamageDealt: 0,
            totalKills: 0,
            lastRoundDamageDealt: 0,
            lastRoundKills: 0
        };
        playerState.placedUnits.push(newPlacedUnit);
        console.log(`GameManager: Spieler ${playerState.username} platziert ${unitId} mit Rotation ${rotation}.`);
        this.emitGameStateUpdate(gameId, gameState);
        return { success: true };
    }

    private validatePlacement(gameState: GameState, playerId: number, unitData: Unit, position: { x: number, z: number }, rotation: 0 | 90): { success: boolean, message?: string } {
        // Zonenprüfung
        let playerMinZ, playerMaxZ;
        const isHostPlacing = playerId === gameState.hostId;
        if (isHostPlacing) {
            playerMinZ = gridMinZ;
            playerMaxZ = PLAYER_ZONE_DEPTH - 1;
        } else {
            playerMinZ = PLAYER_ZONE_DEPTH + NEUTRAL_ZONE_DEPTH;
            playerMaxZ = gridMaxZ;
        }
        if (position.x < gridMinX || position.x > gridMaxX || position.z < playerMinZ || position.z > playerMaxZ) {
            return { success: false, message: 'Position außerhalb des Platzierungsbereichs.' };
        }
        // Bounding Box / Grid Prüfung
        const effectiveWidth = rotation === 90 ? unitData.height : unitData.width;
        const effectiveHeight = rotation === 90 ? unitData.width : unitData.height;
        const unitHalfWidth = effectiveWidth / 2;
        const unitHalfDepth = effectiveHeight / 2;
        const newUnitBox = { minX: position.x - unitHalfWidth, maxX: position.x + unitHalfWidth, minZ: position.z - unitHalfDepth, maxZ: position.z + unitHalfDepth };
        const occupiedMinX = Math.floor(newUnitBox.minX);
        const occupiedMaxX = Math.ceil(newUnitBox.maxX) - 1;
        const occupiedMinZ = Math.floor(newUnitBox.minZ);
        const occupiedMaxZ = Math.ceil(newUnitBox.maxZ) - 1;
        if (occupiedMinX < gridMinX || occupiedMaxX > gridMaxX || occupiedMinZ < playerMinZ || occupiedMaxZ > playerMaxZ) {
            return { success: false, message: 'Einheit ragt aus dem Grid/Zone.' };
        }
        // Kollisionsprüfung
        for (const player of gameState.players.values()) {
            for (const placedUnit of player.placedUnits) {
                const existingUnitData = placeholderUnits.find(u => u.id === placedUnit.unitId);
                if (!existingUnitData) continue;
                const existingEffectiveWidth = placedUnit.rotation === 90 ? existingUnitData.height : existingUnitData.width;
                const existingEffectiveHeight = placedUnit.rotation === 90 ? existingUnitData.width : existingUnitData.height;
                const existingUnitHalfWidth = existingEffectiveWidth / 2;
                const existingUnitHalfDepth = existingEffectiveHeight / 2;
                const existingUnitBox = { minX: placedUnit.initialPosition.x - existingUnitHalfWidth, maxX: placedUnit.initialPosition.x + existingUnitHalfWidth, minZ: placedUnit.initialPosition.z - existingUnitHalfDepth, maxZ: placedUnit.initialPosition.z + existingUnitHalfDepth };
                const noOverlap = newUnitBox.maxX <= existingUnitBox.minX || newUnitBox.minX >= existingUnitBox.maxX || newUnitBox.maxZ <= existingUnitBox.minZ || newUnitBox.minZ >= existingUnitBox.maxZ;
                if (!noOverlap) {
                    return { success: false, message: 'Position blockiert.' };
                }
            }
        }
        return { success: true };
    }

    private createFiguresForUnit(playerId: number, unitId: string, unitData: Unit, centerPosition: { x: number, z: number }, rotation: 0 | 90): FigureState[] {
        const figures: FigureState[] = [];
        const formationInfo = parseFormation(unitData.formation);
        const useFormation = formationInfo && formationInfo.cols * formationInfo.rows >= unitData.squadSize;
        
        // Effektive Dimensionen für Formationsberechnung
        const effectiveWidth = rotation === 90 ? unitData.height : unitData.width;
        const effectiveHeight = rotation === 90 ? unitData.width : unitData.height;

        let cols = 1, rows = 1, spacingX = 1.0, spacingZ = 1.0;

        if (useFormation && formationInfo) {
            // Wenn rotiert, tausche cols/rows für die Berechnung
            cols = rotation === 90 ? formationInfo.rows : formationInfo.cols;
            rows = rotation === 90 ? formationInfo.cols : formationInfo.rows;
            // Spacing basiert auf den rotierten Dimensionen!
            spacingX = effectiveWidth > 0 ? effectiveWidth / cols : 1.0;
            spacingZ = effectiveHeight > 0 ? effectiveHeight / rows : 1.0;
        } else {
            // Fallback-Anordnung (einfaches Gitter), berücksichtigt Rotation
            cols = Math.ceil(Math.sqrt(unitData.squadSize));
            // Passe Spaltenanzahl für rotiertes Rechteck an
            if (rotation === 90 && unitData.width > unitData.height) {
                 cols = Math.ceil(unitData.squadSize / Math.floor(Math.sqrt(unitData.squadSize)));
            } else if (rotation === 0 && unitData.height > unitData.width) {
                 cols = Math.ceil(unitData.squadSize / Math.floor(Math.sqrt(unitData.squadSize)));
            } 
            rows = Math.ceil(unitData.squadSize / cols);
            spacingX = effectiveWidth > 0 ? effectiveWidth / cols : 1.0;
            spacingZ = effectiveHeight > 0 ? effectiveHeight / rows : 1.0;
        }
        
        const startOffsetX = -effectiveWidth / 2 + spacingX / 2;
        const startOffsetZ = -effectiveHeight / 2 + spacingZ / 2;

        for (let i = 0; i < unitData.squadSize; i++) {
            const col = i % cols;
            const row = Math.floor(i / cols);
            
            // Berechne Offset relativ zur effektiven Box
            const offsetX = startOffsetX + col * spacingX;
            const offsetZ = startOffsetZ + row * spacingZ;
            
            // Finale Position (Mitte + Offset)
            const finalX = centerPosition.x + offsetX;
            const finalZ = centerPosition.z + offsetZ;

            // Zufällige Abweichung (bleibt gleich)
            const spread = unitData.placementSpread ?? 0; 
            const randomOffsetX = (Math.random() - 0.5) * spread * 2; 
            const randomOffsetZ = (Math.random() - 0.5) * spread * 2; 
            const finalXWithOffset = finalX + randomOffsetX;
            const finalZWithOffset = finalZ + randomOffsetZ;
            
            // NEU: Initialisiere Cooldowns für alle Waffen der Einheit
            const initialCooldowns = new Map<string, number>();
            unitData.weapons.forEach(weapon => {
                initialCooldowns.set(weapon.id, 0); // Start-Cooldown ist 0
            });

            figures.push({
                figureId: uuidv4(),
                unitInstanceId: '', // Wird nach Erstellung gesetzt
                playerId: playerId,
                unitTypeId: unitId,
                position: { x: finalXWithOffset, z: finalZWithOffset },
                currentHP: unitData.hp,
                behavior: 'idle',
                targetFigureId: null,
                weaponCooldowns: initialCooldowns // Initialisierte Map zuweisen
            });
        }
        return figures;
    }

    // --- Game Loop & State Update --- 

    private startGlobalGameLoop(): void {
        if (this.gameLoopInterval) {
            clearInterval(this.gameLoopInterval);
        }
        this.gameLoopInterval = setInterval(() => {
            this.updateGameStates();
        }, TICK_INTERVAL_MS);
        console.log(`GameManager: Global game loop started (Interval: ${TICK_INTERVAL_MS}ms).`);
    }

    private updateGameStates(): void {
        const combatGames = Array.from(this.activeGames.values()).filter(g => g.phase === 'Combat');
        if (combatGames.length === 0) return; // Nichts zu tun, wenn keine Spiele im Kampf sind

        const deltaTimeSeconds = TICK_INTERVAL_MS / 1000.0;
        combatGames.forEach(gameState => {
            this.updateCombatState(gameState.gameId, deltaTimeSeconds);
        });
    }

    // Kollisionslogik und Kampftick
    private updateCombatState(gameId: string, deltaTimeSeconds: number): void {
        const gameState = this.activeGames.get(gameId);
        if (!gameState || gameState.phase !== 'Combat') {
             return; 
        }

        let unitsChanged = false;
        let projectilesChanged = false;
        let figuresRemoved = false;
        const now = Date.now();

        // 1. Aktive Figuren sammeln
        const figureMap = new Map<string, FigureState>();
        gameState.players.forEach(player => {
            player.placedUnits.forEach(unit => {
                unit.figures.forEach(fig => {
                    if (fig.currentHP > 0) figureMap.set(fig.figureId, fig);
                });
            });
        });

        // 1.5 Projektile aktualisieren
        if (!gameState.activeProjectiles) gameState.activeProjectiles = [];
        const remainingProjectiles: ProjectileState[] = [];
        gameState.activeProjectiles.forEach(p => {
            const elapsedTime = (now - p.createdAt) / 1000.0;

            // --- Ballistic Projectile Logic ---            
            if (p.projectileType === 'ballistic') {
                const progress = Math.min(1.0, elapsedTime / p.totalFlightTime);

                p.currentPos.x = lerp(p.originPos.x, p.targetPos.x, progress);
                p.currentPos.z = lerp(p.originPos.z, p.targetPos.z, progress);
                p.currentPos.y = calculateParabolicHeight(progress, MAX_PROJECTILE_ARC_HEIGHT);
                projectilesChanged = true;

                if (progress >= 1.0) {
                    const sourceUnit = gameState.players.get(p.playerId)?.placedUnits.find(u => u.instanceId === p.sourceUnitInstanceId);
                    figureMap.forEach(targetFigure => {
                        if (targetFigure.currentHP > 0) {
                             const distSq = this.calculateDistanceSq(p.targetPos, targetFigure.position);
                             if (distSq <= p.splashRadius * p.splashRadius) {
                                const hpBefore = targetFigure.currentHP;
                                this.applyDamage(targetFigure, p.damage);
                                const effectiveDamageDealt = Math.min(p.damage, hpBefore);
                                if (sourceUnit) {
                                    sourceUnit.totalDamageDealt += effectiveDamageDealt;
                                    sourceUnit.lastRoundDamageDealt += effectiveDamageDealt;
                                } else {
                                     console.warn(`[Game ${gameId}] (Ballistic Hit) Konnte Quell-Einheit ${p.sourceUnitInstanceId} für Schaden nicht finden.`);
                                }
                                if (targetFigure.currentHP <= 0) {
                                    figureMap.delete(targetFigure.figureId);
                                    figuresRemoved = true;
                                    if (sourceUnit) {
                                        sourceUnit.totalKills += 1;
                                        sourceUnit.lastRoundKills += 1;
                                    } else {
                                        console.warn(`[Game ${gameId}] (Ballistic Kill) Konnte Quell-Einheit ${p.sourceUnitInstanceId} für Kill nicht finden.`);
                                    }
                                } else {
                                    unitsChanged = true;
                                }
                             }
                        }
                    });
                } else {
                    remainingProjectiles.push(p);
                }

            // --- Targeted Projectile Logic ---    
            } else {
                const elapsedTime = (now - p.createdAt) / 1000.0;
                const unitData = placeholderUnits.find(u => u.id === p.unitTypeId);
                const speed = p.speed;
                const travelDist = speed * elapsedTime; // Gesamtstrecke seit Start
                
                // Direkte Distanz zum ursprünglichen Zielpunkt berechnen
                const dirX = p.targetPos.x - p.originPos.x;
                const dirZ = p.targetPos.z - p.originPos.z;
                const totalDistToTargetSq = dirX*dirX + dirZ*dirZ;
                const totalDistToTarget = Math.sqrt(totalDistToTargetSq);

                if (travelDist >= totalDistToTarget) {
                    // Treffer am ursprünglichen Zielort!
                    projectilesChanged = true; 
                    const targetFigure = figureMap.get(p.targetFigureId);
                    const sourceUnit = gameState.players.get(p.playerId)?.placedUnits.find(u => u.instanceId === p.sourceUnitInstanceId);

                    if (targetFigure && targetFigure.currentHP > 0) {
                        const healthBeforeDamage = targetFigure.currentHP;
                        this.applyDamage(targetFigure, p.damage);
                        unitsChanged = true;
                        const effectiveDamageDealt = Math.min(p.damage, healthBeforeDamage);
                        if (sourceUnit) {
                            sourceUnit.totalDamageDealt += effectiveDamageDealt;
                            sourceUnit.lastRoundDamageDealt += effectiveDamageDealt;
                        } else {
                             console.warn(`[Game ${gameId}] (Targeted Hit) Konnte Quell-Einheit ${p.sourceUnitInstanceId} für Schaden nicht finden.`);
                        }
                        console.log(`[Game ${gameId}] Targeted Projektil ${p.projectileId} trifft ${targetFigure.figureId} (HP: ${healthBeforeDamage} -> ${targetFigure.currentHP})`);
                        if (targetFigure.currentHP <= 0) {
                             console.log(`......Figur ${targetFigure.figureId} zerstört! (targeted)`);
                            figureMap.delete(targetFigure.figureId);
                            figuresRemoved = true;
                            if (sourceUnit) {
                                sourceUnit.totalKills += 1;
                                sourceUnit.lastRoundKills += 1;
                            } else {
                                 console.warn(`[Game ${gameId}] (Targeted Kill) Konnte Quell-Einheit ${p.sourceUnitInstanceId} für Kill nicht finden.`);
                            }
                        }
                    } 
                } else {
                    // Weiterfliegen: Position basierend auf Zeit berechnen
                    projectilesChanged = true;
                    const progress = travelDist / totalDistToTarget;
                    p.currentPos.x = lerp(p.originPos.x, p.targetPos.x, progress);
                    p.currentPos.z = lerp(p.originPos.z, p.targetPos.z, progress);
                    p.currentPos.y = 0; // Targeted fliegen auf Y=0
                    remainingProjectiles.push(p);
                }
            }
        });
        gameState.activeProjectiles = remainingProjectiles;

        // 2. Figuren Aktionen planen (NEUE LOGIK)
        const nextPositions = new Map<string, { x: number; z: number }>();
        figureMap.forEach(figure => {
             if (!figureMap.has(figure.figureId)) { 
                 return; 
             }
             const unitData = placeholderUnits.find(u => u.id === figure.unitTypeId)!;
             if (!unitData || !unitData.weapons || unitData.weapons.length === 0) {
                 console.warn(`[Game ${gameId}] Figur ${figure.figureId} hat keine Waffen definiert.`);
                 figure.behavior = 'idle';
                 return; // Kann nicht agieren ohne Waffen
             }

             // --- A. Primärziel-Logik (bleibt ähnlich) ---
             let primaryTarget: FigureState | null = null;
             let targetAcquired = false;
             // Prüfe aktuelles Ziel
             if (figure.targetFigureId && figureMap.has(figure.targetFigureId)) {
                 primaryTarget = figureMap.get(figure.targetFigureId)!;
                 targetAcquired = true;
             } else {
                 // Altes Ziel verloren/tot -> Neues suchen
                 figure.targetFigureId = null;
                 let nearestEnemy: FigureState | null = null;
                 let minOverallDistSq: number = Infinity; 

                 // Kann diese Einheit überhaupt Luftziele angreifen?
                 const canAttackAnyAir = unitData.weapons.some(w => w.canTargetAir === true);

                 figureMap.forEach((potentialTarget: FigureState) => {
                     if (potentialTarget.playerId !== figure.playerId) {
                         // --- NEUE ZIELPRÜFUNG --- 
                         const potentialTargetUnitData = placeholderUnits.find(u => u.id === potentialTarget.unitTypeId);
                         const targetIsAir = potentialTargetUnitData?.isAirUnit === true;
                         let isValidTarget = false;

                         if (targetIsAir) {
                             // Ziel ist Luft: Angreifer muss fähig sein, Luft anzugreifen
                             if (canAttackAnyAir) {
                                 isValidTarget = true;
                             }
                         } else {
                             // Ziel ist Boden: Kann immer (potenziell) anvisiert werden
                             isValidTarget = true;
                         }

                         if (isValidTarget) {
                             const distSq = this.calculateDistanceSq(figure.position, potentialTarget.position);
                             if (distSq < minOverallDistSq) {
                                 minOverallDistSq = distSq;
                                 nearestEnemy = potentialTarget;
                             }
                         }
                         // --- ENDE NEUE ZIELPRÜFUNG ---
                     }
                  });
                  // Nur zuweisen, wenn nearestEnemy nicht null ist
                  if (nearestEnemy) {
                      // Explizite Typassertion, um dem Compiler zu helfen
                      figure.targetFigureId = (nearestEnemy as FigureState).figureId; 
                      primaryTarget = nearestEnemy as FigureState;
                      targetAcquired = true;
                      unitsChanged = true; // Ziel hat sich geändert
                  }
             }
             
             // --- B. Bewegungs-Logik --- 
             let needsToMove = false;
             let isInOverallAttackRange = false; // Ist *mindestens eine* Waffe in Reichweite des Primärziels?
             if (targetAcquired && primaryTarget) {
                 isInOverallAttackRange = unitData.weapons.some(weapon => {
                     const rangeSq = weapon.range * weapon.range;
                     const distSq = this.calculateDistanceSq(figure.position, primaryTarget!.position);
                     return distSq <= rangeSq;
                 });

                 if (!isInOverallAttackRange) {
                     needsToMove = true;
                 }
             }

             const previousBehavior = figure.behavior;
             if (needsToMove && primaryTarget) {
                 figure.behavior = 'moving';
                 if (figure.behavior !== previousBehavior) unitsChanged = true;

                 // Bewegung zum Primärziel (einfach)
                 const dx = primaryTarget.position.x - figure.position.x;
                 const dz = primaryTarget.position.z - figure.position.z;
                 const distToTarget = Math.sqrt(dx * dx + dz * dz);
                 if (distToTarget > 0.01) { // Nur bewegen, wenn Distanz relevant ist
                     const moveAmount = unitData.speed * deltaTimeSeconds;
                      const moveFactor = Math.min(1, moveAmount / distToTarget); // Nicht übers Ziel hinausschießen
                      const intendedX = figure.position.x + dx * moveFactor;
                      const intendedZ = figure.position.z + dz * moveFactor;
                      nextPositions.set(figure.figureId, { x: intendedX, z: intendedZ });
                 } else {
                      nextPositions.set(figure.figureId, figure.position); // Nicht bewegen
                 }
             } else {
                 // Nicht bewegen (entweder kein Ziel, oder in Reichweite)
                 nextPositions.set(figure.figureId, figure.position);

                 // --- C. Angriffs-Logik (wenn nicht bewegt wird) ---
                 if (targetAcquired && primaryTarget) {
                     figure.behavior = 'attacking'; // Hauptverhalten ist Angreifen
                     if (figure.behavior !== previousBehavior) unitsChanged = true;

                     // Iteriere durch jede Waffe
                     unitData.weapons.forEach(weapon => {
                         const weaponCooldown = figure.weaponCooldowns.get(weapon.id) ?? 0;

                         // Prüfe, ob Waffe bereit ist (Cooldown)
                         if (now >= weaponCooldown) {
                             let targetForThisWeapon: FigureState | null = null;
                             const weaponRangeSq = weapon.range * weapon.range;
                             
                             // 1. Versuch: Primärziel angreifen?
                             const distToPrimaryTargetSq = this.calculateDistanceSq(figure.position, primaryTarget!.position);
                             if (distToPrimaryTargetSq <= weaponRangeSq) {
                                 targetForThisWeapon = primaryTarget; // Ja, Primärziel ist in Reichweite DIESER Waffe
                             } else {
                                 // 2. Versuch: Anderes Ziel in Reichweite DIESER Waffe finden?
                                 let nearestSecondaryTarget: FigureState | null = null;
                                 let minDistForWeaponSq = weaponRangeSq; // Nur Ziele innerhalb der Waffenreichweite

                                 // Kann DIESE Waffe Luftziele angreifen?
                                 const weaponCanAttackAir = weapon.canTargetAir === true;

                                 figureMap.forEach(potentialSecondaryTarget => {
                                     // --- NEUE SEKUNDÄRZIELPRÜFUNG ---
                                     if (potentialSecondaryTarget.playerId !== figure.playerId && 
                                         potentialSecondaryTarget.figureId !== primaryTarget?.figureId) { // Nicht das Primärziel erneut
                                        
                                        const potentialTargetUnitData = placeholderUnits.find(u => u.id === potentialSecondaryTarget.unitTypeId);
                                        const targetIsAir = potentialTargetUnitData?.isAirUnit === true;
                                        let isValidTargetForWeapon = false;

                                        if (targetIsAir) {
                                            // Ziel ist Luft: DIESE Waffe muss Luft angreifen können
                                            if (weaponCanAttackAir) {
                                                isValidTargetForWeapon = true;
                                            }
                                        } else {
                                            // Ziel ist Boden: Jede Waffe kann (potenziell) treffen
                                            isValidTargetForWeapon = true;
                                        }

                                        if (isValidTargetForWeapon) {
                                            const distSq = this.calculateDistanceSq(figure.position, potentialSecondaryTarget.position);
                                            if (distSq <= minDistForWeaponSq) { // Innerhalb Waffenreichweite UND näher als bisheriges Sekundärziel
                                                minDistForWeaponSq = distSq;
                                                nearestSecondaryTarget = potentialSecondaryTarget;
                                            }
                                        }
                                     }
                                     // --- ENDE NEUE SEKUNDÄRZIELPRÜFUNG ---
                                  });
                                  targetForThisWeapon = nearestSecondaryTarget;
                              }

                             // Feuern, wenn ein Ziel (primär oder sekundär) für DIESE Waffe gefunden wurde
                             if (targetForThisWeapon) {
                                 // Projektil erstellen mit Waffen-Daten
                                 let bulletSpeed = weapon.bulletSpeed; // Hole die definierte Geschwindigkeit
                                 let totalFlightTime = 1.0;
                                 const dist = Math.sqrt(this.calculateDistanceSq(figure.position, targetForThisWeapon.position));

                                 if (!bulletSpeed || bulletSpeed <= 0) {
                                     console.warn(`[Game ${gameId}] WARNUNG: Waffe ${weapon.id} hat keine gültige bulletSpeed (${bulletSpeed})! Fallback auf 1s Flugzeit.`);
                                     bulletSpeed = dist; 
                                     totalFlightTime = 1.0;
                                 } else {
                                     totalFlightTime = dist / bulletSpeed; 
                                 }
                                 totalFlightTime = Math.max(0.1, totalFlightTime);

                                 const newProjectile: ProjectileState = {
                                     projectileId: uuidv4(),
                                     playerId: figure.playerId,
                                     unitTypeId: figure.unitTypeId, // Behalte Unit-Typ für Referenz?
                                     sourceUnitInstanceId: figure.unitInstanceId,
                                     weaponId: weapon.id, // <<< NEU: ID der Waffe mitspeichern
                                     // *** Nimm Werte von der Waffe ***
                                     damage: weapon.damage,
                                     projectileType: weapon.projectileType,
                                     speed: bulletSpeed, 
                                     splashRadius: weapon.splashRadius, 
                                     // *******************************
                                     originPos: { ...figure.position },
                                     targetPos: { ...targetForThisWeapon.position }, 
                                     currentPos: { x: figure.position.x, y: 0, z: figure.position.z },
                                     targetFigureId: targetForThisWeapon.figureId, 
                                     createdAt: now,
                                     totalFlightTime: totalFlightTime, 
                                 };
                                 gameState.activeProjectiles.push(newProjectile);
                                 projectilesChanged = true;
                                 
                                 // Setze Cooldown FÜR DIESE WAFFE
                                 const cooldownDurationMs = 1000 / weapon.attackSpeed;
                                 figure.weaponCooldowns.set(weapon.id, now + cooldownDurationMs);
                                 unitsChanged = true; // Wegen Cooldown-Änderung
                             }
                         } // Ende Cooldown-Prüfung
                     }); // Ende Waffen-Iteration
                 } else { // Kein Ziel -> Idle
                      figure.behavior = 'idle';
                      if (figure.behavior !== previousBehavior) unitsChanged = true;
                 }
             } // Ende Nicht-Bewegen-Block
        }); // Ende figureMap.forEach für Aktionen

        // 3. Kollisionsbehandlung & Position finalisieren
         figureMap.forEach(figure => {
             if (!figureMap.has(figure.figureId)) return;
             const unitData = placeholderUnits.find(u => u.id === figure.unitTypeId)!;
             const currentPos = figure.position;
             const intendedPos = nextPositions.get(figure.figureId)!;
             const collisionRange = unitData.collisionRange ?? 0.4;
             let separationX = 0, separationZ = 0, collisionCount = 0;

             figureMap.forEach(other => {
                 if (figure.figureId === other.figureId || !nextPositions.has(other.figureId)) return;
                 const otherUnitData = placeholderUnits.find(u => u.id === other.unitTypeId)!;

                 // --- NEUE PRÜFUNG: Nur Kollision prüfen, wenn beide Einheiten denselben Bewegungstyp haben ---
                 const figureIsAir = unitData?.isAirUnit ?? false;
                 const otherIsAir = otherUnitData?.isAirUnit ?? false;
                 if (figureIsAir !== otherIsAir) {
                     return; // Überspringe Kollisionsprüfung, wenn eine Luft und eine Boden ist
                 }
                 // --- ENDE NEUE PRÜFUNG ---

                 const otherCollisionRange = otherUnitData.collisionRange ?? 0.4;
                 const otherPos = nextPositions.get(other.figureId)!;
                 const distSq = this.calculateDistanceSq(intendedPos, otherPos);
                 const requiredDist = collisionRange + otherCollisionRange;
                 if (distSq < requiredDist * requiredDist && distSq > 0.0001) {
                     collisionCount++;
                     const dist = Math.sqrt(distSq);
                     const overlap = requiredDist - dist;
                     const pushStrength = 0.5;
                     const pushFactor = (overlap / dist) * pushStrength;
                     separationX += (intendedPos.x - otherPos.x) * pushFactor;
                     separationZ += (intendedPos.z - otherPos.z) * pushFactor;
                 }
             });

             let finalX = intendedPos.x + separationX;
             let finalZ = intendedPos.z + separationZ;
             
             if (Math.abs(finalX - currentPos.x) > 0.001 || Math.abs(finalZ - currentPos.z) > 0.001) {
                 figure.position.x = finalX;
                 figure.position.z = finalZ;
                 unitsChanged = true;
             }
         });

        // 4. Spielzustand aufräumen (bleibt gleich)
        gameState.players.forEach(player => {
            player.placedUnits.forEach(unit => {
                const initialCount = unit.figures.length;
                unit.figures = unit.figures.filter(f => figureMap.has(f.figureId));
                if (unit.figures.length < initialCount) figuresRemoved = true;
            });
            player.placedUnits = player.placedUnits.filter(unit => unit.figures.length > 0);
        });

        // 5. Rundenende prüfen & ggf. resetten (bleibt gleich)
        let player1Alive = false;
        let player2Alive = false;
        const playerIds = Array.from(gameState.players.keys());
        let roundOver = false; 
        let timeLimitReached = false;

        // Prüfe Zeitlimit (90 Sekunden)
        const combatDurationSeconds = gameState.combatStartTime ? (now - gameState.combatStartTime) / 1000 : 0;
        if (combatDurationSeconds >= 90) {
            timeLimitReached = true;
            roundOver = true;
            console.log(`[Game ${gameId}] Kampfzeitlimit erreicht (${combatDurationSeconds.toFixed(1)}s).`);
        }

        if (playerIds.length === 2) {
             player1Alive = Array.from(figureMap.values()).some(f => f.playerId === playerIds[0]);
             player2Alive = Array.from(figureMap.values()).some(f => f.playerId === playerIds[1]);
             const enemyDefeated = !player1Alive || !player2Alive;
             const noProjectiles = gameState.activeProjectiles.length === 0;

             if (enemyDefeated && noProjectiles) {
                 roundOver = true;
                 console.log(`[Game ${gameId}] Spieler besiegt und keine Projektile mehr.`);
             }
        }

        if (roundOver) {
            console.log(`GameManager: Runde ${gameState.round} beendet in Spiel ${gameId}. Grund: ${timeLimitReached ? "Zeitlimit erreicht" : player1Alive ? `Spieler ${playerIds[1]} (${gameState.players.get(playerIds[1])?.username}) gewinnt` : `Spieler ${playerIds[0]} (${gameState.players.get(playerIds[0])?.username}) gewinnt`}`);

            // NEU: Basisschaden berechnen und anwenden
            let loserId: number | null = null;
            let winnerId: number | null = null;

            if (!player1Alive && player2Alive) { // Spieler 1 hat verloren
                loserId = playerIds[0];
                winnerId = playerIds[1];
            } else if (player1Alive && !player2Alive) { // Spieler 2 hat verloren
                loserId = playerIds[1];
                winnerId = playerIds[0];
            } else if (!player1Alive && !player2Alive) {
                // Unentschieden - Kein Basisschaden
                console.log(`GameManager: Runde ${gameState.round} endet unentschieden.`);
            }

            if (loserId !== null && winnerId !== null) {
                const winnerState = gameState.players.get(winnerId)!;
                const loserState = gameState.players.get(loserId)!;
                let totalDamage = 0;

                winnerState.placedUnits.forEach(survivingUnit => {
                    const unitData = placeholderUnits.find(u => u.id === survivingUnit.unitId);
                    if (unitData && unitData.squadSize > 0) { // Stelle sicher, dass squadSize vorhanden und > 0 ist
                        const initialFigureCount = unitData.squadSize;
                        const remainingFigureCount = survivingUnit.figures.length;
                        
                        // Berechne den Anteil der überlebenden Figuren
                        const survivingRatio = remainingFigureCount / initialFigureCount;
                        
                        // Berechne den proportionalen Schaden
                        const unitDamage = Math.round(unitData.placementCost * survivingRatio);
                        
                        // console.log(`  Einheit ${unitData.id}: ${remainingFigureCount}/${initialFigureCount} überlebt -> Schaden: ${unitDamage} (von ${unitData.placementCost})`);
                        totalDamage += unitDamage; 
                    }
                });

                if (totalDamage > 0) {
                    const previousHealth = loserState.baseHealth;
                    loserState.baseHealth = Math.max(0, loserState.baseHealth - totalDamage); // Wende Schaden an, min 0
                    console.log(`GameManager: Spieler ${loserState.username} (ID: ${loserId}) erleidet ${totalDamage} Basisschaden. HP: ${previousHealth} -> ${loserState.baseHealth}`);
                    unitsChanged = true; // Stelle sicher, dass das Update gesendet wird

                    // TODO: Spielende prüfen und behandeln
                    if (loserState.baseHealth <= 0) {
                        console.log(`GameManager: Spieler ${loserState.username} (ID: ${loserId}) hat keine Basis-HP mehr! Spiel ${gameId} vorbei.`);
                        gameState.phase = 'GameOver'; // Beispiel: Phase ändern
                        // Hier könnte man den Gewinner explizit markieren oder weitere Aufräumarbeiten durchführen.
                        // Fürs Erste ändern wir nur die Phase und der Reset wird nicht mehr aufgerufen.
                        this.emitGameStateUpdate(gameId, gameState); // Sende finalen Zustand
                        // Optional: Timer stoppen, Spiel aus activeGames entfernen etc.
                         this.clearPreparationTimer(gameId); // Timer sicherheitshalber stoppen
                         // this.activeGames.delete(gameId); // Spiel beenden?
                        return; // Verhindere den Reset zur Vorbereitung
                    }
                }
            }
            // ----- Ende Basisschaden Logik -----

            // Setze das Spiel für die nächste Runde zurück (nur wenn nicht GameOver)
            this.resetGameToPreparation(gameId);
            return; // Reset kümmert sich um Update, hier abbrechen
        }

        // 6. Update senden, wenn nötig (und Runde nicht vorbei ist)
        if (unitsChanged || figuresRemoved || projectilesChanged) {
            this.emitGameStateUpdate(gameId, gameState);
        }
    }

    // Setzt das Spiel auf Vorbereitung zurück (nach Rundenende)
    private resetGameToPreparation(gameId: string): void {
        const gameState = this.activeGames.get(gameId);
        if (!gameState) return;

        console.log(`GameManager: Spiel ${gameId} wird auf Vorbereitungsphase zurückgesetzt.`);
        gameState.phase = 'Preparation';
        gameState.round += 1;
        gameState.preparationEndTime = Date.now() + preparationDurationMs;
        gameState.activeProjectiles = [];

        gameState.players.forEach(player => {
            player.credits += incomePerRound * (gameState.round - 1); // Einkommen für vergangene Runde
            player.unitsPlacedThisRound = 0;
            
            const survivingUnitsMap = new Map<string, PlacedUnit>(player.placedUnits.map(u => [u.instanceId, u]));
            const nextRoundPlacedUnits: PlacedUnit[] = [];

            (player.unitsAtCombatStart || []).forEach(unitToRestore => {
                const survivor = survivingUnitsMap.get(unitToRestore.instanceId);
                const newUnit: PlacedUnit = JSON.parse(JSON.stringify(unitToRestore)); // Deep copy

                // Übertrage Gesamt-Stats vom Überlebenden (falls vorhanden), sonst 0
                newUnit.totalDamageDealt = survivor ? survivor.totalDamageDealt : 0;
                newUnit.totalKills = survivor ? survivor.totalKills : 0;

                // Setze Last-Round-Stats zurück
                newUnit.lastRoundDamageDealt = 0;
                newUnit.lastRoundKills = 0;

                // --- Reset der Figuren innerhalb der newUnit ---
                const unitData = placeholderUnits.find(ud => ud.id === newUnit.unitId);
                if (!unitData) {
                    console.warn(`GameManager Reset: Konnte UnitData für ${newUnit.unitId} nicht finden.`);
                    return; // Einheit kann nicht korrekt zurückgesetzt werden
                }
                
                const figures = newUnit.figures;
                const rotation = newUnit.rotation; 
                const effectiveWidth = rotation === 90 ? unitData.height : unitData.width;
                const effectiveHeight = rotation === 90 ? unitData.width : unitData.height;
                const formationInfo = parseFormation(unitData.formation);
                // WICHTIG: Nutze die Figurenanazahl aus unitData, nicht die (potentiell reduzierte) aus unitToRestore
                const targetFigureCount = unitData.squadSize; 
                const useFormation = formationInfo && formationInfo.cols * formationInfo.rows >= targetFigureCount;
                let cols = 1, rows = 1, spacingX = 1.0, spacingZ = 1.0;

                if (useFormation && formationInfo) {
                    cols = rotation === 90 ? formationInfo.rows : formationInfo.cols;
                    rows = rotation === 90 ? formationInfo.cols : formationInfo.rows;
                    spacingX = effectiveWidth > 0 ? effectiveWidth / cols : 1.0;
                    spacingZ = effectiveHeight > 0 ? effectiveHeight / rows : 1.0;
                } else {
                     cols = Math.ceil(Math.sqrt(targetFigureCount));
                    if (rotation === 90 && unitData.width > unitData.height) {
                        cols = Math.ceil(targetFigureCount / Math.floor(Math.sqrt(targetFigureCount)));
                    } else if (rotation === 0 && unitData.height > unitData.width) {
                        cols = Math.ceil(targetFigureCount / Math.floor(Math.sqrt(targetFigureCount)));
                    } 
                    rows = Math.ceil(targetFigureCount / cols);
                    spacingX = effectiveWidth > 0 ? effectiveWidth / cols : 1.0;
                    spacingZ = effectiveHeight > 0 ? effectiveHeight / rows : 1.0;
                }
                const startOffsetX = -effectiveWidth / 2 + spacingX / 2;
                const startOffsetZ = -effectiveHeight / 2 + spacingZ / 2;

                // Stelle sicher, dass figures die korrekte Anzahl hat (falls Figuren gestorben sind)
                while (figures.length < targetFigureCount) {
                     // Füge eine neue Standardfigur hinzu (oder kopiere eine vorhandene Struktur)
                     // Wichtig: Neue figureId generieren!
                     figures.push({
                        figureId: uuidv4(),
                        unitInstanceId: newUnit.instanceId,
                        playerId: player.id,
                        unitTypeId: newUnit.unitId,
                        position: { x: 0, z: 0 }, // Wird unten überschrieben
                        currentHP: unitData.hp,
                        behavior: 'idle',
                        targetFigureId: null,
                        weaponCooldowns: new Map<string, number>() // Initialisierte Map zuweisen
                     });
                }
                 // Entferne überschüssige Figuren (sollte nicht passieren, aber sicher ist sicher)
                figures.length = targetFigureCount; 

                figures.forEach((figure, i) => {
                    figure.currentHP = unitData.hp;
                    figure.behavior = 'idle';
                    figure.targetFigureId = null;
                    // NEU: Setze Cooldowns für alle Waffen zurück
                    figure.weaponCooldowns = new Map<string, number>();
                    unitData.weapons.forEach(weapon => {
                       figure.weaponCooldowns.set(weapon.id, 0);
                    });
                    const col = i % cols;
                    const row = Math.floor(i / cols);
                    const offsetX = startOffsetX + col * spacingX;
                    const offsetZ = startOffsetZ + row * spacingZ;
                    figure.position.x = newUnit.initialPosition.x + offsetX;
                    figure.position.z = newUnit.initialPosition.z + offsetZ;
                });
                // --- Ende Reset der Figuren ---

                nextRoundPlacedUnits.push(newUnit);
            });

            player.placedUnits = nextRoundPlacedUnits; // Ersetze die alte Liste durch die neu erstellte
        });

        this.startPreparationTimer(gameId); // Neuen Timer starten
        this.emitGameStateUpdate(gameId, gameState); // Update senden
    }

    // --- Hilfsfunktionen --- 

    private emitGameStateUpdate(gameId: string, gameState: GameState): void {
        gameState.players.forEach((player, playerId) => {
            const socketId = this.playerSockets.get(playerId);
            if (socketId) {
                // 1. Logisch filtern (erzeugt GameState mit Maps)
                const filteredGameState = this.filterGameStateForPlayer(gameState, playerId);
                // 2. Gefilterten Zustand serialisieren (konvertiert Maps zu Objekten)
                const serializableState = this.getSerializableGameState(filteredGameState);
                // 3. Senden
                this.io.to(socketId).emit('game:state-update', serializableState);
            } else {
                console.warn(`GameManager: Socket-ID für Spieler ${playerId} in Spiel ${gameId} nicht gefunden! Update fehlgeschlagen.`);
            }
        });
    }

    private filterGameStateForPlayer(gameState: GameState, targetPlayerId: number): GameState {
        // Nur filtern während der Vorbereitung
        if (gameState.phase !== 'Preparation') {
            return gameState; // Keine Filterung, Original zurückgeben
        }

        // Erstelle eine neue Map für die gefilterten Spielerdaten
        const filteredPlayersMap = new Map<number, PlayerInGame>();

        gameState.players.forEach((playerState, playerId) => {
            if (playerId === targetPlayerId) {
                // Eigener Spieler: Behalte den aktuellen Zustand
                // WICHTIG: Hier wird angenommen, dass playerState relativ unveränderlich ist
                // oder dass Änderungen neue Objekte erzeugen. Ansonsten wäre hier eine tiefe Kopie nötig.
                filteredPlayersMap.set(playerId, playerState); 
            } else {
                // Gegnerischer Spieler: Zeige nur Einheiten vom letzten Kampfstart
                // Erstelle eine Kopie des Spielerstatus und ersetze nur placedUnits
                const opponentStateCopy: PlayerInGame = {
                    ...playerState,
                    placedUnits: playerState.unitsAtCombatStart || [] // Enthält noch Maps!
                };
                filteredPlayersMap.set(playerId, opponentStateCopy);
            }
        });

        // Erstelle einen neuen GameState mit der gefilterten Spieler-Map
        const filteredGameState: GameState = {
            ...gameState,
            players: filteredPlayersMap, // Enthält noch Maps
        };
        return filteredGameState;
    }

    private getSerializableGameState(gameState: GameState): any {
        // Konvertiere Spieler-Map und Cooldown-Maps in serialisierbare Formate
        const serializablePlayers = Array.from(gameState.players.values()).map(player => ({
            ...player,
            placedUnits: player.placedUnits.map(unit => ({
                ...unit,
                figures: unit.figures.map(figure => ({
                    ...figure,
                    // Konvertiere weaponCooldowns Map zu Objekt
                    weaponCooldowns: figure.weaponCooldowns ? Object.fromEntries(figure.weaponCooldowns) : {} // Sicherstellen, dass es existiert
                }))
            })),
            // Konvertiere auch unitsAtCombatStart, falls vorhanden
            unitsAtCombatStart: (player.unitsAtCombatStart || []).map(unit => ({
                ...unit,
                figures: unit.figures.map(figure => ({
                    ...figure,
                    weaponCooldowns: figure.weaponCooldowns ? Object.fromEntries(figure.weaponCooldowns) : {} // Sicherstellen, dass es existiert
                }))
            }))
        }));

        return {
            ...gameState,
            players: serializablePlayers, // Verwende die serialisierte Spielerliste
            activeProjectiles: gameState.activeProjectiles || [], 
        };
    }

    private calculateDistanceSq(pos1: { x: number, z: number }, pos2: { x: number, z: number }): number {
        const dx = pos1.x - pos2.x;
        const dz = pos1.z - pos2.z;
        return dx * dx + dz * dz;
    }

    private applyDamage(figure: FigureState, damage: number): void {
        // TODO: Rüstung / Schadensreduktion berücksichtigen?
        figure.currentHP -= damage; 
        figure.currentHP = Math.max(0, figure.currentHP); // HP nicht unter 0
    }
} 