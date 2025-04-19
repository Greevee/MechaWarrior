import { Server as SocketIOServer } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import { GameState, PlayerInGame, PlacedUnit, FigureState, ProjectileState, FigureBehaviorState, GamePhase } from '../types/game.types';
import { Lobby, LobbyPlayer } from '../types/lobby.types';
import { Unit, placeholderUnits, parseFormation } from '../units/unit.types';

const TICK_INTERVAL_MS = 100; // 10 Ticks pro Sekunde
const preparationDurationMs = 60 * 1000; // 60 Sekunden
const initialCredits = 200;
const initialBaseHealth = 1000;
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

export class GameManager {
    private activeGames = new Map<string, GameState>();
    private preparationTimers = new Map<string, NodeJS.Timeout>();
    private gameLoopInterval: NodeJS.Timeout | null = null;
    private io: SocketIOServer;

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
        if (gameState && gameState.phase === 'Preparation') {
            console.log(`GameManager: Spiel ${gameId}: Starte Kampfphase.`);
            this.clearPreparationTimer(gameId); // Timer stoppen

            gameState.players.forEach(player => {
                player.unitsAtCombatStart = JSON.parse(JSON.stringify(player.placedUnits));
            });
            
            gameState.phase = 'Combat';
            gameState.preparationEndTime = undefined;
            this.emitGameStateUpdate(gameId, gameState);
        }
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

    public placeUnit(gameId: string, playerId: number, unitId: string, position: { x: number, z: number }): { success: boolean, message?: string } {
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
        const validationResult = this.validatePlacement(gameState, playerId, unitData, position);
        if (!validationResult.success) {
            return validationResult;
        }

        // Platzieren!
        playerState.credits -= unitData.placementCost;
        playerState.unitsPlacedThisRound++;

        const figures = this.createFiguresForUnit(playerId, unitId, unitData, position);
        const unitInstanceId = uuidv4(); 
        figures.forEach(f => f.unitInstanceId = unitInstanceId);

        const newPlacedUnit: PlacedUnit = {
            instanceId: unitInstanceId,
            unitId: unitId,
            playerId: playerId,
            initialPosition: position,
            figures: figures,
        };
        playerState.placedUnits.push(newPlacedUnit);
        console.log(`GameManager: Spieler ${playerState.username} platziert ${unitId}.`);
        this.emitGameStateUpdate(gameId, gameState);
        return { success: true };
    }

    private validatePlacement(gameState: GameState, playerId: number, unitData: Unit, position: { x: number, z: number }): { success: boolean, message?: string } {
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
        const unitHalfWidth = unitData.width / 2;
        const unitHalfDepth = unitData.height / 2;
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
                const existingUnitHalfWidth = existingUnitData.width / 2;
                const existingUnitHalfDepth = existingUnitData.height / 2;
                const existingUnitBox = { minX: placedUnit.initialPosition.x - existingUnitHalfWidth, maxX: placedUnit.initialPosition.x + existingUnitHalfWidth, minZ: placedUnit.initialPosition.z - existingUnitHalfDepth, maxZ: placedUnit.initialPosition.z + existingUnitHalfDepth };
                const noOverlap = newUnitBox.maxX <= existingUnitBox.minX || newUnitBox.minX >= existingUnitBox.maxX || newUnitBox.maxZ <= existingUnitBox.minZ || newUnitBox.minZ >= existingUnitBox.maxZ;
                if (!noOverlap) {
                    return { success: false, message: 'Position blockiert.' };
                }
            }
        }
        return { success: true };
    }

    private createFiguresForUnit(playerId: number, unitId: string, unitData: Unit, centerPosition: { x: number, z: number }): FigureState[] {
        const figures: FigureState[] = [];
        const formationInfo = parseFormation(unitData.formation);
        const useFormation = formationInfo && formationInfo.cols * formationInfo.rows >= unitData.squadSize;
        let cols = 1, rows = 1, spacingX = 1.0, spacingZ = 1.0;

        if (useFormation && formationInfo) {
            cols = formationInfo.cols;
            rows = formationInfo.rows;
            spacingX = unitData.width > 0 ? unitData.width / cols : 1.0;
            spacingZ = unitData.height > 0 ? unitData.height / rows : 1.0;
            // console.log(`Creating figures with formation ${cols}x${rows} for ${unitData.id}. Spacing X=${spacingX.toFixed(2)}, Z=${spacingZ.toFixed(2)}`);
        } else {
            // console.warn(`Using fallback arrangement for ${unitData.id}.`);
            cols = Math.ceil(Math.sqrt(unitData.squadSize));
            rows = Math.ceil(unitData.squadSize / cols);
            spacingX = unitData.width > 0 ? unitData.width / cols : 1.0;
            spacingZ = unitData.height > 0 ? unitData.height / rows : 1.0;
        }
        const startOffsetX = -unitData.width / 2 + spacingX / 2;
        const startOffsetZ = -unitData.height / 2 + spacingZ / 2;

        for (let i = 0; i < unitData.squadSize; i++) {
            const col = i % cols;
            const row = Math.floor(i / cols);
            const offsetX = startOffsetX + col * spacingX;
            const offsetZ = startOffsetZ + row * spacingZ;
            const finalX = centerPosition.x + offsetX;
            const finalZ = centerPosition.z + offsetZ;
            
            // console.log(`  Figure ${i}: Col=${col}, Row=${row} -> PosX=${finalX.toFixed(2)}, PosZ=${finalZ.toFixed(2)}`);
            figures.push({
                figureId: uuidv4(),
                unitInstanceId: '', // Wird nach Erstellung gesetzt
                playerId: playerId,
                unitTypeId: unitId,
                position: { x: finalX, z: finalZ },
                currentHP: unitData.hp,
                behavior: 'idle',
                targetFigureId: null,
                attackCooldownEnd: 0
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
        if (!gameState || gameState.phase !== 'Combat') return; // Double check

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
        if (figureMap.size === 0) return; // Kein Kampf mehr möglich?

        // 1.5 Projektile aktualisieren
        if (!gameState.activeProjectiles) gameState.activeProjectiles = [];
        const remainingProjectiles: ProjectileState[] = [];
        gameState.activeProjectiles.forEach(p => {
            const travelTime = (now - p.createdAt) / 1000.0;
            const totalDist = Math.sqrt(this.calculateDistanceSq(p.originPos, p.targetPos));
            const distCovered = p.speed * travelTime;

            if (distCovered >= totalDist) { // Treffer!
                projectilesChanged = true;
                const target = figureMap.get(p.targetFigureId);
                if (target) {
                    target.currentHP -= p.damage; // Einfacher Schadensabzug
                    unitsChanged = true;
                    if (target.currentHP <= 0) figureMap.delete(target.figureId); // Aus Map entfernen bei Tod
                }
            } else { // Weiterfliegen
                projectilesChanged = true;
                const ratio = distCovered / totalDist;
                p.currentPos.x = p.originPos.x + (p.targetPos.x - p.originPos.x) * ratio;
                p.currentPos.z = p.originPos.z + (p.targetPos.z - p.originPos.z) * ratio;
                remainingProjectiles.push(p);
            }
        });
        gameState.activeProjectiles = remainingProjectiles;
        
        // 2. Figuren Aktionen planen (Zielsuche, Bewegung, Angriff)
        const nextPositions = new Map<string, { x: number; z: number }>();
        figureMap.forEach(figure => {
             if (!figureMap.has(figure.figureId)) { // Sicherstellen, dass Figur noch lebt
                 nextPositions.set(figure.figureId, figure.position);
                 return; 
             }
             const unitData = placeholderUnits.find(u => u.id === figure.unitTypeId)!;
             let targetAcquired = false;

             // Ziel suchen/prüfen
             if (figure.targetFigureId && figureMap.has(figure.targetFigureId)) {
                 targetAcquired = true; // Ziel existiert noch
             } else {
                 figure.targetFigureId = null; // Altes Ziel verloren/tot
                 let nearestTarget: FigureState | null = null;
                 let minDistSq: number = Infinity; // Start mit unendlicher Distanz
                 figureMap.forEach((potentialTarget: FigureState) => {
                     if (potentialTarget.playerId !== figure.playerId) {
                         const distSq = this.calculateDistanceSq(figure.position, potentialTarget.position);
                         if (distSq < minDistSq) {
                             minDistSq = distSq;
                             nearestTarget = potentialTarget;
                         }
                     }
                 });
                 // Nur zuweisen, wenn nearestTarget nicht null ist
                 if (nearestTarget !== null) {
                     figure.targetFigureId = (nearestTarget as FigureState).figureId; // Erneute explizite Assertion
                     targetAcquired = true;
                     unitsChanged = true;
                 }
             }

             // Verhalten festlegen & Aktionen planen
             let intendedX = figure.position.x;
             let intendedZ = figure.position.z;
             if (targetAcquired && figure.targetFigureId) {
                 const target = figureMap.get(figure.targetFigureId)!;
                 const distSq = this.calculateDistanceSq(figure.position, target.position);
                 const rangeSq = unitData.range * unitData.range;
                 if (distSq <= rangeSq) { // In Reichweite -> Angreifen
                     if (figure.behavior !== 'attacking') unitsChanged = true;
                     figure.behavior = 'attacking';
                     // Angriff auslösen (Projektil erstellen)
                     if (now >= figure.attackCooldownEnd) {
                         const bulletSpeed = unitData.bulletSpeed ?? 10;
                         const newProjectile: ProjectileState = { projectileId: uuidv4(), playerId: figure.playerId, unitTypeId: figure.unitTypeId, damage: unitData.damage, speed: bulletSpeed, originPos: { ...figure.position }, targetPos: { ...target.position }, currentPos: { ...figure.position }, targetFigureId: target.figureId, createdAt: now };
                         gameState.activeProjectiles.push(newProjectile);
                         projectilesChanged = true;
                         figure.attackCooldownEnd = now + (1000 / unitData.attackSpeed);
                     }
                 } else { // Außerhalb -> Bewegen
                      if (figure.behavior !== 'moving') unitsChanged = true;
                      figure.behavior = 'moving';
                      const dx = target.position.x - figure.position.x;
                      const dz = target.position.z - figure.position.z;
                      const dist = Math.sqrt(distSq);
                      if (dist > 0.01) {
                           const moveAmount = unitData.speed * deltaTimeSeconds;
                           intendedX += (dx / dist) * moveAmount;
                           intendedZ += (dz / dist) * moveAmount;
                      }
                 }
             } else { // Kein Ziel -> Idle
                  if (figure.behavior !== 'idle') unitsChanged = true;
                  figure.behavior = 'idle';
                  figure.targetFigureId = null;
             }
             nextPositions.set(figure.figureId, { x: intendedX, z: intendedZ });
        }); // Ende Figuren Aktionen planen

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
             // TODO: Clamp position to grid boundaries? 

             if (Math.abs(finalX - currentPos.x) > 0.001 || Math.abs(finalZ - currentPos.z) > 0.001) {
                 figure.position.x = finalX;
                 figure.position.z = finalZ;
                 unitsChanged = true;
             }
         }); // Ende Kollision & Position

         // 4. Spielzustand aufräumen (tote Figuren aus placedUnits entfernen)
         gameState.players.forEach(player => {
             player.placedUnits.forEach(unit => {
                 const initialCount = unit.figures.length;
                 unit.figures = unit.figures.filter(f => figureMap.has(f.figureId));
                 if (unit.figures.length < initialCount) figuresRemoved = true;
             });
             player.placedUnits = player.placedUnits.filter(unit => unit.figures.length > 0);
         });

        // 5. Rundenende prüfen & ggf. resetten
        let player1Alive = false;
        let player2Alive = false;
        const playerIds = Array.from(gameState.players.keys());
        if (playerIds.length === 2) {
             player1Alive = Array.from(figureMap.values()).some(f => f.playerId === playerIds[0]);
             player2Alive = Array.from(figureMap.values()).some(f => f.playerId === playerIds[1]);
             if (!player1Alive || !player2Alive) {
                 console.log(`GameManager: Runde ${gameState.round} beendet in Spiel ${gameId}.`);
                 this.resetGameToPreparation(gameId);
                 return; // Reset kümmert sich um Update, hier abbrechen
             }
        }

        // 6. Update senden, wenn nötig
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
            // Einheiten auf Startzustand zurücksetzen
            player.placedUnits = JSON.parse(JSON.stringify(player.unitsAtCombatStart || []));

            // Figurenpositionen und HP zurücksetzen
            player.placedUnits.forEach(unit => {
                const unitData = placeholderUnits.find(ud => ud.id === unit.unitId);
                if (!unitData) return;

                const figures = unit.figures;
                const formationInfo = parseFormation(unitData.formation);
                const useFormation = formationInfo && formationInfo.cols * formationInfo.rows >= figures.length;
                let cols = 1, rows = 1, spacingX = 1.0, spacingZ = 1.0;

                if (useFormation && formationInfo) {
                    cols = formationInfo.cols;
                    rows = formationInfo.rows;
                    spacingX = unitData.width > 0 ? unitData.width / cols : 1.0;
                    spacingZ = unitData.height > 0 ? unitData.height / rows : 1.0;
                } else {
                    cols = Math.ceil(Math.sqrt(figures.length));
                    rows = Math.ceil(figures.length / cols);
                    spacingX = unitData.width > 0 ? unitData.width / cols : 1.0;
                    spacingZ = unitData.height > 0 ? unitData.height / rows : 1.0;
                }
                const startOffsetX = -unitData.width / 2 + spacingX / 2;
                const startOffsetZ = -unitData.height / 2 + spacingZ / 2;

                figures.forEach((figure, i) => {
                    figure.currentHP = unitData.hp;
                    figure.behavior = 'idle';
                    figure.targetFigureId = null;
                    figure.attackCooldownEnd = 0;
                    const col = i % cols;
                    const row = Math.floor(i / cols);
                    const offsetX = startOffsetX + col * spacingX;
                    const offsetZ = startOffsetZ + row * spacingZ;
                    figure.position.x = unit.initialPosition.x + offsetX;
                    figure.position.z = unit.initialPosition.z + offsetZ;
                });
            });
        });

        this.startPreparationTimer(gameId); // Neuen Timer starten
        this.emitGameStateUpdate(gameId, gameState); // Update senden
    }

    // --- Hilfsfunktionen --- 

    private emitGameStateUpdate(gameId: string, gameState: GameState): void {
        const serializableState = this.getSerializableGameState(gameState);
        this.io.to(gameId).emit('game:state-update', serializableState);
    }

    private getSerializableGameState(gameState: GameState): any {
        return {
            ...gameState,
            players: Array.from(gameState.players.values()),
            // Sicherstellen, dass activeProjectiles immer ein Array ist
            activeProjectiles: gameState.activeProjectiles || [], 
        };
    }

     // Wird von updateCombatState verwendet
     private calculateDistanceSq(pos1: { x: number, z: number }, pos2: { x: number, z: number }): number {
        const dx = pos1.x - pos2.x;
        const dz = pos1.z - pos2.z;
        return dx * dx + dz * dz;
    }
} 