const { v4: uuidv4 } = require('uuid');

module.exports = function (io) {
    const nsp = io.of('/territory-wars');

    const lobbies = {};
    const playerLobbies = {};

    // ─── Constants ───────────────────────────────────────────────
    const TICK_RATE = 15;
    const TICK_MS = 1000 / TICK_RATE;
    const MATCH_DURATION = 5 * 60; // 5 minutes
    const MAX_PLAYERS = 8;
    const MIN_PLAYERS = 2;

    const GRID_W = 120;
    const GRID_H = 80;
    const GRID_SIZE = GRID_W * GRID_H;

    // Resource & Game settings
    const ENERGY_MAX = 200;
    const ENERGY_REGEN_PER_PIXEL = 0.015; // per owned pixel per second
    const ENERGY_BASE_REGEN = 0.5; // base per second
    
    const BASE_MAX_TROOPS = 3;
    const TROOPS_PER_HOUSE = 5;

    const COSTS = {
        farm: { energy: 25 },
        megafarm: { coins: 150 },
        post: { energy: 50 },
        house: { energy: 40 },
        fort: { energy: 30 },
        infantry: { coins: 10 },
        cavalry: { coins: 25 },
        tank: { coins: 60 },
        kaboom: { coins: 40 }
    };

    const TROOP_SPEEDS = {
        infantry: 0.2,
        cavalry: 0.45,
        tank: 0.12,
        kaboom: 0.35
    };

    const PLAYER_COLORS = [
        '#FF3366', '#33CCFF', '#66FF33', '#FFCC00',
        '#CC33FF', '#FF6633', '#33FFCC', '#FF33CC'
    ];

    // ─── Map Definitions ────────────────────────────────────────
    // 0 = wall/water, 1 = land
    // Maps are generated procedurally with a function for each template

    const MAP_DEFS = {
        islands: {
            name: 'Islands',
            desc: 'Multiple small islands separated by water',
            icon: '🏝️',
            generate: () => generateIslandsMap(),
        },
        continents: {
            name: 'Continents',
            desc: 'Large landmasses with narrow straits',
            icon: '🌍',
            generate: () => generateContinentsMap(),
        },
        arena: {
            name: 'Arena',
            desc: 'Wide open circle — pure combat',
            icon: '⚔️',
            generate: () => generateArenaMap(),
        },
        labyrinth: {
            name: 'Labyrinth',
            desc: 'Maze-like corridors and chambers',
            icon: '🔀',
            generate: () => generateLabyrinthMap(),
        },
        bridges: {
            name: 'Bridges',
            desc: 'Platforms connected by narrow bridges',
            icon: '🌉',
            generate: () => generateBridgesMap(),
        },
        volcanic: {
            name: 'Volcanic',
            desc: 'Ring-shaped land around a central crater',
            icon: '🌋',
            generate: () => generateVolcanicMap(),
        },
    };

    // ─── Map Generators ─────────────────────────────────────────

    function createEmptyTerrain() {
        return new Uint8Array(GRID_SIZE); // all 0 = water
    }

    function setCell(terrain, x, y, val) {
        if (x >= 0 && x < GRID_W && y >= 0 && y < GRID_H) {
            terrain[y * GRID_W + x] = val;
        }
    }

    function getCell(terrain, x, y) {
        if (x < 0 || x >= GRID_W || y < 0 || y >= GRID_H) return 0;
        return terrain[y * GRID_W + x];
    }

    function fillCircle(terrain, cx, cy, r, val) {
        for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
                if (dx * dx + dy * dy <= r * r) {
                    setCell(terrain, cx + dx, cy + dy, val);
                }
            }
        }
    }

    function fillRect(terrain, x1, y1, w, h, val) {
        for (let y = y1; y < y1 + h; y++) {
            for (let x = x1; x < x1 + w; x++) {
                setCell(terrain, x, y, val);
            }
        }
    }

    function fillEllipse(terrain, cx, cy, rx, ry, val) {
        for (let dy = -ry; dy <= ry; dy++) {
            for (let dx = -rx; dx <= rx; dx++) {
                if ((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1) {
                    setCell(terrain, cx + dx, cy + dy, val);
                }
            }
        }
    }

    function generateIslandsMap() {
        const terrain = createEmptyTerrain();
        // Generate 8-12 random islands
        const islandCount = 8 + Math.floor(Math.random() * 5);
        for (let i = 0; i < islandCount; i++) {
            const cx = 10 + Math.floor(Math.random() * (GRID_W - 20));
            const cy = 8 + Math.floor(Math.random() * (GRID_H - 16));
            const rx = 6 + Math.floor(Math.random() * 10);
            const ry = 5 + Math.floor(Math.random() * 8);
            fillEllipse(terrain, cx, cy, rx, ry, 1);
        }
        // Add some small scattered dots
        for (let i = 0; i < 30; i++) {
            const x = Math.floor(Math.random() * GRID_W);
            const y = Math.floor(Math.random() * GRID_H);
            fillCircle(terrain, x, y, 2 + Math.floor(Math.random() * 3), 1);
        }
        return terrain;
    }

    function generateContinentsMap() {
        const terrain = createEmptyTerrain();
        // Two large continents
        fillEllipse(terrain, 30, 40, 25, 30, 1);
        fillEllipse(terrain, 90, 40, 25, 30, 1);
        // Land bridge / strait area
        fillRect(terrain, 52, 35, 8, 10, 1);
        // Add irregular coastlines with noise
        for (let i = 0; i < 40; i++) {
            const cx = Math.floor(Math.random() * GRID_W);
            const cy = Math.floor(Math.random() * GRID_H);
            const r = 3 + Math.floor(Math.random() * 6);
            // Only add near existing land
            if (getCell(terrain, cx, cy) === 1 ||
                getCell(terrain, cx + r, cy) === 1 ||
                getCell(terrain, cx - r, cy) === 1) {
                fillCircle(terrain, cx, cy, r, 1);
            }
        }
        // Carve out some water inlets
        for (let i = 0; i < 8; i++) {
            const cx = 10 + Math.floor(Math.random() * (GRID_W - 20));
            const cy = 10 + Math.floor(Math.random() * (GRID_H - 20));
            fillCircle(terrain, cx, cy, 3 + Math.floor(Math.random() * 4), 0);
        }
        return terrain;
    }

    function generateArenaMap() {
        const terrain = createEmptyTerrain();
        // Large circle
        fillCircle(terrain, GRID_W / 2, GRID_H / 2, 35, 1);
        // Add some texture with small obstacles
        for (let i = 0; i < 6; i++) {
            const angle = (i / 6) * Math.PI * 2;
            const cx = Math.floor(GRID_W / 2 + Math.cos(angle) * 18);
            const cy = Math.floor(GRID_H / 2 + Math.sin(angle) * 14);
            fillCircle(terrain, cx, cy, 2, 0);
        }
        return terrain;
    }

    function generateLabyrinthMap() {
        const terrain = createEmptyTerrain();
        // Fill everything with land first
        fillRect(terrain, 2, 2, GRID_W - 4, GRID_H - 4, 1);
        // Carve maze-like walls
        // Vertical walls with gaps
        for (let wx = 15; wx < GRID_W - 10; wx += 15) {
            const gapY = 5 + Math.floor(Math.random() * (GRID_H - 15));
            const gapSize = 6 + Math.floor(Math.random() * 6);
            for (let y = 3; y < GRID_H - 3; y++) {
                if (y < gapY || y > gapY + gapSize) {
                    fillRect(terrain, wx - 1, y, 3, 1, 0);
                }
            }
        }
        // Horizontal walls with gaps
        for (let wy = 15; wy < GRID_H - 10; wy += 18) {
            const gapX = 5 + Math.floor(Math.random() * (GRID_W - 15));
            const gapSize = 6 + Math.floor(Math.random() * 8);
            for (let x = 3; x < GRID_W - 3; x++) {
                if (x < gapX || x > gapX + gapSize) {
                    fillRect(terrain, x, wy - 1, 1, 3, 0);
                }
            }
        }
        // Open up some chambers
        for (let i = 0; i < 5; i++) {
            const cx = 15 + Math.floor(Math.random() * (GRID_W - 30));
            const cy = 10 + Math.floor(Math.random() * (GRID_H - 20));
            fillCircle(terrain, cx, cy, 4 + Math.floor(Math.random() * 3), 1);
        }
        return terrain;
    }

    function generateBridgesMap() {
        const terrain = createEmptyTerrain();
        // Create 4-6 platforms
        const platforms = [
            { x: 15, y: 15, rx: 12, ry: 10 },
            { x: 105, y: 15, rx: 12, ry: 10 },
            { x: 15, y: 65, rx: 12, ry: 10 },
            { x: 105, y: 65, rx: 12, ry: 10 },
            { x: 60, y: 40, rx: 14, ry: 12 },
        ];
        for (const p of platforms) {
            fillEllipse(terrain, p.x, p.y, p.rx, p.ry, 1);
        }
        // Connect with narrow bridges (3 pixels wide)
        // Top-left to center
        fillRect(terrain, 27, 18, 33, 3, 1);
        fillRect(terrain, 18, 25, 3, 15, 1);
        // Top-right to center
        fillRect(terrain, 74, 18, 31, 3, 1);
        fillRect(terrain, 102, 25, 3, 15, 1);
        // Bottom-left to center
        fillRect(terrain, 27, 60, 33, 3, 1);
        fillRect(terrain, 18, 42, 3, 18, 1);
        // Bottom-right to center
        fillRect(terrain, 74, 60, 31, 3, 1);
        fillRect(terrain, 102, 42, 3, 18, 1);
        // Cross bridges through center
        fillRect(terrain, 55, 28, 3, 24, 1);
        return terrain;
    }

    function generateVolcanicMap() {
        const terrain = createEmptyTerrain();
        const cx = GRID_W / 2;
        const cy = GRID_H / 2;
        // Outer ring
        fillCircle(terrain, cx, cy, 36, 1);
        // Inner crater (water/lava)
        fillCircle(terrain, cx, cy, 14, 0);
        // Add some radial cracks/channels
        for (let i = 0; i < 5; i++) {
            const angle = (i / 5) * Math.PI * 2 + Math.random() * 0.3;
            for (let d = 14; d < 36; d++) {
                const x = Math.floor(cx + Math.cos(angle) * d);
                const y = Math.floor(cy + Math.sin(angle) * d);
                setCell(terrain, x, y, 0);
                setCell(terrain, x + 1, y, 0);
            }
        }
        // Add some outcrops on the outer edge
        for (let i = 0; i < 8; i++) {
            const angle = (i / 8) * Math.PI * 2;
            const ox = Math.floor(cx + Math.cos(angle) * 34);
            const oy = Math.floor(cy + Math.sin(angle) * 28);
            fillCircle(terrain, ox, oy, 4, 1);
        }
        return terrain;
    }

    // ─── Spawn Location Selection ───────────────────────────────

    function selectSpawnLocations(terrain, playerCount) {
        // Find all land cells
        const landCells = [];
        for (let y = 0; y < GRID_H; y++) {
            for (let x = 0; x < GRID_W; x++) {
                if (getCell(terrain, x, y) === 1) {
                    landCells.push({ x, y });
                }
            }
        }

        if (landCells.length === 0) return [];

        // Use corner/edge strategy to spread players apart
        const cx = GRID_W / 2, cy = GRID_H / 2;
        const targetPositions = [
            { x: 10, y: 10 },
            { x: GRID_W - 10, y: 10 },
            { x: 10, y: GRID_H - 10 },
            { x: GRID_W - 10, y: GRID_H - 10 },
            { x: cx, y: 8 },
            { x: cx, y: GRID_H - 8 },
            { x: 8, y: cy },
            { x: GRID_W - 8, y: cy },
        ];

        const spawns = [];
        const usedCells = new Set();

        for (let p = 0; p < playerCount && p < targetPositions.length; p++) {
            const target = targetPositions[p];
            let best = null, bestDist = Infinity;

            for (const cell of landCells) {
                const key = `${cell.x},${cell.y}`;
                if (usedCells.has(key)) continue;

                const dx = cell.x - target.x;
                const dy = cell.y - target.y;
                const dist = dx * dx + dy * dy;

                // Also ensure minimum distance from other spawns
                let tooClose = false;
                for (const s of spawns) {
                    const sdx = cell.x - s.x;
                    const sdy = cell.y - s.y;
                    if (sdx * sdx + sdy * sdy < 400) { // min 20 cells apart
                        tooClose = true;
                        break;
                    }
                }

                if (!tooClose && dist < bestDist) {
                    bestDist = dist;
                    best = cell;
                }
            }

            if (best) {
                spawns.push(best);
                // Mark a 5x5 area around spawn as used
                for (let dy = -2; dy <= 2; dy++) {
                    for (let dx = -2; dx <= 2; dx++) {
                        usedCells.add(`${best.x + dx},${best.y + dy}`);
                    }
                }
            }
        }

        return spawns;
    }

    // ─── Utility ────────────────────────────────────────────────
    
    function stampSpawn(lobby, pid, spawnPos) {
        if (!spawnPos) return;
        lobby.players[pid].spawned = true;
        const pidx = lobby.players[pid].playerIndex;
        const sx = spawnPos.x;
        const sy = spawnPos.y;
        for (let dy = -3; dy <= 3; dy++) {
            for (let dx = -3; dx <= 3; dx++) {
                if (dx * dx + dy * dy <= 10) { // circular-ish
                    const px = sx + dx;
                    const py = sy + dy;
                    if (px >= 0 && px < GRID_W && py >= 0 && py < GRID_H) {
                        const idx = py * GRID_W + px;
                        if (lobby.terrain[idx] === 1) {
                            lobby.grid[idx] = pidx;
                        }
                    }
                }
            }
        }
    }

    function demolishBuildingAt(lobby, idx, changedPixels) {
        if (!lobby.buildings[idx]) return;
        const hx = idx % GRID_W;
        const hy = Math.floor(idx / GRID_W);
        let hitId = null;
        for (const b of Object.values(lobby.buildingInstances || {})) {
            if (hx >= b.x && hx < b.x + b.w && hy >= b.y && hy < b.y + b.h) {
                hitId = b.id;
                break;
            }
        }
        if (hitId) {
            const b = lobby.buildingInstances[hitId];
            for (let dy = 0; dy < b.h; dy++) {
                for (let dx = 0; dx < b.w; dx++) {
                    const bx = b.x + dx;
                    const by = b.y + dy;
                    const bi = by * GRID_W + bx;
                    if (lobby.buildings[bi]) {
                        lobby.buildings[bi] = 0;
                        changedPixels.push({ x: bx, y: by, owner: lobby.grid[bi], building: 0 });
                    }
                }
            }
            const p = Object.values(lobby.players).find(pl => pl.playerIndex === b.owner);
            if (p && p.buildingCounts[b.type] > 0) p.buildingCounts[b.type]--;
            if (p && b.type === 'house') p.maxTroops = Math.max(BASE_MAX_TROOPS, p.maxTroops - TROOPS_PER_HOUSE);
            delete lobby.buildingInstances[hitId];
        } else {
             lobby.buildings[idx] = 0;
        }
    }

    // ─── Game Tick ───────────────────────────────────────────────

    function gameTick(lobbyId) {
        const lobby = lobbies[lobbyId];
        if (!lobby) return;

        if (lobby.gameState === 'starting') {
            lobby.startCountdown--;
            if (lobby.startCountdown <= 0) {
                lobby.gameState = 'playing';
                const playerIds = Object.keys(lobby.players);
                const unspawned = playerIds.filter(pid => !lobby.players[pid].spawned);
                if (unspawned.length > 0) {
                    const spawns = selectSpawnLocations(lobby.terrain, unspawned.length);
                    unspawned.forEach((pid, i) => {
                        stampSpawn(lobby, pid, spawns[i]);
                    });
                }
                recountPixels(lobby);
                nsp.to(lobbyId).emit('gameStateUpdate', { gameState: 'playing' });
                broadcastGameState(lobbyId);
            } else if (lobby.tickCount % TICK_RATE === 0) {
                nsp.to(lobbyId).emit('gameStateUpdate', { startCountdown: Math.ceil(lobby.startCountdown / TICK_RATE) });
            }
            lobby.tickCount++;
            return;
        }

        if (lobby.gameState !== 'playing') return;

        lobby.tickCount++;
        const changedPixels = [];

        // ── Energy and Coin regeneration (every tick) ──
        const playerIds = Object.keys(lobby.players);
        for (const pid of playerIds) {
            const p = lobby.players[pid];
            if (p.eliminated) continue;

            const pixelCount = p.pixelCount || 0;
            const regenRate = (ENERGY_BASE_REGEN + pixelCount * ENERGY_REGEN_PER_PIXEL) / TICK_RATE;
            p.energy = Math.min(ENERGY_MAX, (p.energy || 0) + regenRate);
            
            const coinRegen = ((p.buildingCounts.farm || 0) * 1 + (p.buildingCounts.megafarm || 0) * 5) / TICK_RATE;
            p.coins = (p.coins || 0) + coinRegen;
        }

        // ── Auto-growth (removed) ──
        
        // ── Troop Movement and Combat ──
        const troopsByCell = {};
        for (const [id, t] of Object.entries(lobby.troops)) {
            // move t towards t.tx, t.ty
            if (t.x !== t.tx || t.y !== t.ty) {
                let dx = t.tx - t.x;
                let dy = t.ty - t.y;
                let dist = Math.sqrt(dx*dx + dy*dy);
                let speed = TROOP_SPEEDS[t.type] || 0.1;
                if (dist <= speed) {
                    t.x = t.tx; t.y = t.ty;
                } else {
                    t.x += (dx / dist) * speed;
                    t.y += (dy / dist) * speed;
                }
            }
            const cx = Math.floor(t.x);
            const cy = Math.floor(t.y);
            const idx = cy * GRID_W + cx;
            if (!troopsByCell[idx]) troopsByCell[idx] = [];
            troopsByCell[idx].push(t);
        }

        for (const idxStr in troopsByCell) {
            const idx = parseInt(idxStr);
            const cellTroops = troopsByCell[idx];
            const owners = new Set(cellTroops.map(t => t.owner));
            
            let winnerOwner = cellTroops[0].owner;
            
            if (owners.size > 1) {
                // Combat! Group by owner
                const groups = {};
                for (const t of cellTroops) {
                    groups[t.owner] = (groups[t.owner] || 0) + 1;
                }
                // Simplified chance battle
                let total = cellTroops.length;
                let roll = Math.random() * total;
                let accum = 0;
                for (const [owner, count] of Object.entries(groups)) {
                    accum += count;
                    if (roll <= accum) { winnerOwner = parseInt(owner); break; }
                }
                // Destroy all non-winner troops in this cell
                for (const t of cellTroops) {
                    if (t.owner !== winnerOwner) {
                        delete lobby.troops[t.id];
                        const p = Object.values(lobby.players).find(pl => pl.playerIndex === t.owner);
                        if (p) p.activeTroops--;
                    }
                }
            }
            
            // After combat, surviving troops process the cell
            const survivingTroops = cellTroops.filter(t => t.owner === winnerOwner);
            if (survivingTroops.length > 0) {
                const oldOwner = lobby.grid[idx];
                const terrainType = lobby.terrain[idx];
                
                if (oldOwner !== winnerOwner && terrainType === 1) {
                    const hasKaboom = survivingTroops.some(t => t.type === 'kaboom');
                    const hasTank = survivingTroops.some(t => t.type === 'tank');
                    
                    if (lobby.buildings[idx] === 5) { // Fort
                        if (hasKaboom) {
                            demolishBuildingAt(lobby, idx, changedPixels);
                            lobby.grid[idx] = 0;
                            
                            const kaboom = survivingTroops.find(t => t.type === 'kaboom');
                            if (kaboom) {
                                delete lobby.troops[kaboom.id];
                                const kp = Object.values(lobby.players).find(p => p.playerIndex === kaboom.owner);
                                if (kp) kp.activeTroops--;
                            }
                            
                            changedPixels.push({ x: idx % GRID_W, y: Math.floor(idx / GRID_W), owner: 0, building: 0 });
                            
                            // Explosion radius
                            const kx = idx % GRID_W;
                            const ky = Math.floor(idx / GRID_W);
                            for (let ey = ky - 1; ey <= ky + 1; ey++) {
                                for (let ex = kx - 1; ex <= kx + 1; ex++) {
                                    if (ex >= 0 && ex < GRID_W && ey >= 0 && ey < GRID_H) {
                                        const eidx = ey * GRID_W + ex;
                                        lobby.grid[eidx] = 0;
                                        if (lobby.buildings[eidx]) demolishBuildingAt(lobby, eidx, changedPixels);
                                        changedPixels.push({ x: ex, y: ey, owner: 0, building: 0 });
                                    }
                                }
                            }
                        }
                    } else {
                        // Normal tile or non-fort building
                        lobby.grid[idx] = winnerOwner;
                        if (lobby.buildings[idx]) {
                            demolishBuildingAt(lobby, idx, changedPixels);
                        }
                        changedPixels.push({ x: idx % GRID_W, y: Math.floor(idx / GRID_W), owner: winnerOwner, building: 0 });
                    }
                } else if (terrainType === 1) {
                    // Check if kaboom reached its target
                    const kaboom = survivingTroops.find(t => t.type === 'kaboom' && Math.abs(t.tx - t.x) < 0.1 && Math.abs(t.ty - t.y) < 0.1);
                    if (kaboom && oldOwner === winnerOwner) {
                         // Explode on own land if target reached
                         delete lobby.troops[kaboom.id];
                         const kp = Object.values(lobby.players).find(p => p.playerIndex === kaboom.owner);
                         if (kp) kp.activeTroops--;
                         
                         const kx = idx % GRID_W;
                         const ky = Math.floor(idx / GRID_W);
                         for (let ey = ky - 1; ey <= ky + 1; ey++) {
                             for (let ex = kx - 1; ex <= kx + 1; ex++) {
                                 if (ex >= 0 && ex < GRID_W && ey >= 0 && ey < GRID_H) {
                                     const eidx = ey * GRID_W + ex;
                                     if (lobby.terrain[eidx] === 1) {
                                        lobby.grid[eidx] = 0;
                                        if (lobby.buildings[eidx]) demolishBuildingAt(lobby, eidx, changedPixels);
                                        changedPixels.push({ x: ex, y: ey, owner: 0, building: 0 });
                                     }
                                 }
                             }
                         }
                    }
                }
            }
        }

        // ── Recount pixels ──
        if (lobby.tickCount % TICK_RATE === 0 || changedPixels.length > 0) {
            recountPixels(lobby);
        }

        // ── Timer (every second) ──
        if (lobby.tickCount % TICK_RATE === 0) {
            lobby.timeRemaining--;

            // Elimination check
            for (const pid of playerIds) {
                const p = lobby.players[pid];
                if (!p.eliminated && p.pixelCount === 0 && lobby.tickCount > TICK_RATE * 5) {
                    p.eliminated = true;
                    nsp.to(lobbyId).emit('playerEliminated', { playerId: pid });
                }
            }

            const remaining = playerIds.filter(id => !lobby.players[id].eliminated);
            if (remaining.length <= 1 && lobby.initialPlayerCount >= 2) {
                endGame(lobbyId, 'elimination');
                return;
            }

            if (lobby.timeRemaining <= 0) {
                endGame(lobbyId, 'time');
                return;
            }
        }

        // ── Broadcast delta ──
        if (changedPixels.length > 0) {
            nsp.to(lobbyId).emit('pixelDelta', changedPixels);
        }

        // ── Broadcast full state periodically (every 1s) ──
        if (lobby.tickCount % TICK_RATE === 0) {
            broadcastGameState(lobbyId);
        }
    }

    function recountPixels(lobby) {
        const counts = {};
        const playerIds = Object.keys(lobby.players);
        for (const pid of playerIds) {
            counts[lobby.players[pid].playerIndex] = 0;
        }

        for (let i = 0; i < GRID_SIZE; i++) {
            const owner = lobby.grid[i];
            if (owner > 0 && counts[owner] !== undefined) {
                counts[owner]++;
            }
        }

        for (const pid of playerIds) {
            lobby.players[pid].pixelCount = counts[lobby.players[pid].playerIndex] || 0;
        }
    }

    // ─── Actions ───────────────────────────────────────────

    const BUILDING_TYPES = {
        farm: 1,
        megafarm: 2,
        post: 3,
        house: 4,
        fort: 5
    };
    
    const BUILDING_SIZES = {
        farm: { w: 2, h: 2 },
        megafarm: { w: 4, h: 4 },
        post: { w: 1, h: 1 },
        house: { w: 2, h: 2 },
        fort: { w: 3, h: 3 }
    };

    function handleBuild(lobby, socket, data) {
        const player = lobby.players[socket.id];
        if (!player || player.eliminated) return;
        const { type, x, y } = data;
        const size = BUILDING_SIZES[type];
        if (!size) return;
        const { w, h } = size;

        // Verify area
        for (let dy = 0; dy < h; dy++) {
            for (let dx = 0; dx < w; dx++) {
                const nx = x + dx;
                const ny = y + dy;
                if (nx < 0 || nx >= GRID_W || ny < 0 || ny >= GRID_H) return;
                const i = ny * GRID_W + nx;
                if (lobby.terrain[i] !== 1) return; // not land
                if (lobby.grid[i] !== player.playerIndex) return; // not owned
                if (lobby.buildings[i] !== 0) return; // already a building
            }
        }

        const cost = COSTS[type];
        if (!cost) return;
        const bType = BUILDING_TYPES[type];
        if (!bType) return;
        
        // Limits
        if (type === 'megafarm' && player.buildingCounts.megafarm >= 1) return;
        if (type === 'post' && player.buildingCounts.post >= 3) return;

        if (cost.energy && player.energy >= cost.energy) {
            player.energy -= cost.energy;
        } else if (cost.coins && player.coins >= cost.coins) {
            player.coins -= cost.coins;
        } else {
            return; // Not enough resources
        }

        const bId = lobby.buildingIdCounter++;
        lobby.buildingInstances[bId] = { id: bId, type, x, y, w, h, owner: player.playerIndex };

        const changedPixels = [];
        for (let dy = 0; dy < h; dy++) {
            for (let dx = 0; dx < w; dx++) {
                const nx = x + dx;
                const ny = y + dy;
                const i = ny * GRID_W + nx;
                lobby.buildings[i] = bType;
                changedPixels.push({ x: nx, y: ny, owner: player.playerIndex, building: bType });
            }
        }

        player.buildingCounts[type]++;
        if (type === 'house') {
            player.maxTroops += TROOPS_PER_HOUSE;
        }

        recountPixels(lobby);
        nsp.to(lobby.id).emit('pixelDelta', changedPixels);
        socket.emit('energyUpdate', { energy: player.energy, coins: player.coins });
    }

    function handleTrain(lobby, socket, data) {
        const player = lobby.players[socket.id];
        if (!player || player.eliminated) return;
        const { type, x, y, tx, ty } = data;
        
        const cost = COSTS[type];
        if (!cost || player.coins < cost.coins) return;
        
        if (player.activeTroops >= player.maxTroops) return;

        const idx = y * GRID_W + x;
        if (lobby.buildings[idx] !== BUILDING_TYPES.post || lobby.grid[idx] !== player.playerIndex) return;

        player.coins -= cost.coins;
        player.activeTroops++;

        const troopId = 't_' + lobby.troopIdCounter++;
        lobby.troops[troopId] = {
            id: troopId,
            type: type,
            owner: player.playerIndex,
            x: x,
            y: y,
            tx: tx,
            ty: ty
        };
        
        socket.emit('energyUpdate', { energy: player.energy, coins: player.coins });
    }

    function handleMoveTroops(lobby, socket, data) {
        const player = lobby.players[socket.id];
        if (!player || player.eliminated) return;
        const { startX, startY, tx, ty } = data;
        
        // Find troops near startX, startY owned by player
        for (const [id, t] of Object.entries(lobby.troops)) {
            if (t.owner === player.playerIndex) {
                const dist = Math.sqrt((t.x - startX)**2 + (t.y - startY)**2);
                if (dist < 3) {
                    t.tx = tx;
                    t.ty = ty;
                }
            }
        }
    }

    // ─── Broadcast ──────────────────────────────────────────────

    function broadcastGameState(lobbyId) {
        const lobby = lobbies[lobbyId];
        if (!lobby) return;

        const playerStates = {};
        for (const [id, p] of Object.entries(lobby.players)) {
            playerStates[id] = {
                color: p.color,
                playerIndex: p.playerIndex,
                pixelCount: p.pixelCount || 0,
                energy: Math.floor(p.energy || 0),
                coins: Math.floor(p.coins || 0),
                activeTroops: p.activeTroops || 0,
                maxTroops: p.maxTroops || BASE_MAX_TROOPS,
                eliminated: !!p.eliminated,
            };
        }

        const troopsData = Object.values(lobby.troops).map(t => ({
            id: t.id,
            type: t.type,
            owner: t.owner,
            x: t.x,
            y: t.y,
            tx: t.tx,
            ty: t.ty
        }));

        nsp.to(lobbyId).emit('gameStateUpdate', {
            players: playerStates,
            timeRemaining: lobby.timeRemaining,
            troops: troopsData,
            buildings: Object.values(lobby.buildingInstances || {}),
            startCountdown: Math.ceil((lobby.startCountdown || 0) / TICK_RATE),
            gameState: lobby.gameState
        });
    }

    function endGame(lobbyId, reason) {
        const lobby = lobbies[lobbyId];
        if (!lobby) return;

        stopGameLoop(lobbyId);
        lobby.gameState = 'gameover';

        // Count total land
        let totalLand = 0;
        for (let i = 0; i < GRID_SIZE; i++) {
            if (lobby.terrain[i] === 1) totalLand++;
        }

        const results = [];
        for (const [id, p] of Object.entries(lobby.players)) {
            results.push({
                id,
                color: p.color,
                playerIndex: p.playerIndex,
                pixelCount: p.pixelCount || 0,
                percentage: totalLand > 0 ? Math.round(((p.pixelCount || 0) / totalLand) * 100) : 0,
                eliminated: !!p.eliminated,
            });
        }

        results.sort((a, b) => b.pixelCount - a.pixelCount);

        nsp.to(lobbyId).emit('gameOver', { results, reason });
        broadcastActiveLobbies();

        setTimeout(() => {
            if (!lobbies[lobbyId]) return;
            lobby.gameState = 'lobby';
            lobby.grid = null;
            lobby.terrain = null;
            Object.values(lobby.players).forEach(p => {
                p.isReady = false;
                p.eliminated = false;
                p.energy = 0;
                p.coins = 0;
                p.maxTroops = BASE_MAX_TROOPS;
                p.activeTroops = 0;
                p.buildingCounts = { farm: 0, megafarm: 0, post: 0, house: 0, fort: 0 };
                p.pixelCount = 0;
            });
            broadcastLobbyState(lobbyId);
            broadcastActiveLobbies();
            nsp.to(lobbyId).emit('resetToLobby');
        }, 8000);
    }

    // ─── Lobby Helpers ──────────────────────────────────────────

    function broadcastLobbyState(lobbyId) {
        const lobby = lobbies[lobbyId];
        if (!lobby) return;

        nsp.to(lobbyId).emit('lobbyState', {
            id: lobby.id,
            name: lobby.name,
            creatorId: lobby.creatorId,
            selectedMap: lobby.selectedMap,
            players: Object.values(lobby.players).map(p => ({
                id: p.id,
                isReady: p.isReady,
                color: p.color,
            })),
            gameState: lobby.gameState,
        });
    }

    function broadcastActiveLobbies() {
        const publicLobbies = Object.values(lobbies).map(l => ({
            id: l.id,
            name: l.name,
            playerCount: Object.keys(l.players).length,
            gameState: l.gameState,
            selectedMap: l.selectedMap,
        }));
        nsp.emit('activeLobbies', publicLobbies);
    }

    function startGameLoop(lobbyId) {
        const lobby = lobbies[lobbyId];
        if (!lobby) return;
        if (lobby.gameLoopInterval) clearInterval(lobby.gameLoopInterval);
        lobby.gameLoopInterval = setInterval(() => gameTick(lobbyId), TICK_MS);
    }

    function stopGameLoop(lobbyId) {
        const lobby = lobbies[lobbyId];
        if (lobby && lobby.gameLoopInterval) {
            clearInterval(lobby.gameLoopInterval);
            lobby.gameLoopInterval = null;
        }
    }

    function startGame(lobbyId) {
        const lobby = lobbies[lobbyId];
        if (!lobby) return;

        const mapKey = lobby.selectedMap || 'arena';
        const mapDef = MAP_DEFS[mapKey];
        if (!mapDef) return;

        const terrain = mapDef.generate();
        const playerIds = Object.keys(lobby.players);

        // Create ownership grid (0 = neutral)
        const grid = new Uint8Array(GRID_SIZE);

        // Assign player indices and initialize properties
        for (let i = 0; i < playerIds.length; i++) {
            const pid = playerIds[i];
            const pidx = i + 1; // 1-based player index
            lobby.players[pid].playerIndex = pidx;
            lobby.players[pid].energy = ENERGY_MAX / 2; // start with half energy
            lobby.players[pid].coins = 0;
            lobby.players[pid].pixelCount = 0;
            lobby.players[pid].maxTroops = BASE_MAX_TROOPS;
            lobby.players[pid].activeTroops = 0;
            lobby.players[pid].buildingCounts = { farm: 0, megafarm: 0, post: 0, house: 0, fort: 0 };
            lobby.players[pid].spawned = false;
        }

        lobby.terrain = terrain;
        lobby.grid = grid;
        lobby.buildings = new Uint8Array(GRID_SIZE);
        lobby.buildingInstances = {};
        lobby.buildingIdCounter = 1;
        lobby.troops = {};
        lobby.troopIdCounter = 1;
        lobby.tickCount = 0;
        lobby.timeRemaining = MATCH_DURATION;
        lobby.gameState = 'starting';
        lobby.startCountdown = 150; // 150 ticks = 10s
        lobby.initialPlayerCount = playerIds.length;

        recountPixels(lobby);

        // Send terrain + initial grid as arrays
        const terrainArr = Array.from(terrain);
        const gridArr = Array.from(grid);
        const buildingsArr = Array.from(lobby.buildings);

        nsp.to(lobbyId).emit('gameStart', {
            terrain: terrainArr,
            grid: gridArr,
            buildings: buildingsArr,
            buildingInstances: Object.values(lobby.buildingInstances),
            gridW: GRID_W,
            gridH: GRID_H,
            mapKey: mapKey,
            mapName: mapDef.name,
            players: Object.fromEntries(
                playerIds.map(id => [id, {
                    color: lobby.players[id].color,
                    playerIndex: lobby.players[id].playerIndex,
                    energy: lobby.players[id].energy,
                    coins: lobby.players[id].coins,
                    maxTroops: lobby.players[id].maxTroops,
                    pixelCount: lobby.players[id].pixelCount,
                }])
            ),
            timeRemaining: MATCH_DURATION,
            startCountdown: 10,
            gameState: 'starting'
        });

        broadcastActiveLobbies();
        startGameLoop(lobbyId);
    }

    // ─── Get available maps for client ──────────────────────────

    function getMapList() {
        return Object.entries(MAP_DEFS).map(([key, def]) => ({
            key,
            name: def.name,
            desc: def.desc,
            icon: def.icon,
        }));
    }

    // Generate a preview thumbnail (simplified terrain as array)
    function getMapPreview(mapKey) {
        const def = MAP_DEFS[mapKey];
        if (!def) return null;
        const terrain = def.generate();
        return Array.from(terrain);
    }

    // ─── Socket Handlers ────────────────────────────────────────

    nsp.on('connection', (socket) => {
        console.log('[Territory Wars] User connected:', socket.id);
        broadcastActiveLobbies();
        // Send map list
        socket.emit('mapList', getMapList());

        socket.on('createLobby', (opts) => {
            const lobbyId = uuidv4().substring(0, 8);
            lobbies[lobbyId] = {
                id: lobbyId,
                name: `${socket.id.substring(0, 4)}'s War`,
                creatorId: socket.id,
                selectedMap: (opts && opts.mapKey) || 'arena',
                players: {},
                gameState: 'lobby',
                gameLoopInterval: null,
                terrain: null,
                grid: null,
                tickCount: 0,
                timeRemaining: MATCH_DURATION,
            };
            joinLobby(socket, lobbyId);
            broadcastActiveLobbies();
        });

        socket.on('joinLobby', (lobbyId) => {
            if (lobbies[lobbyId] && lobbies[lobbyId].gameState === 'lobby') {
                if (Object.keys(lobbies[lobbyId].players).length < MAX_PLAYERS) {
                    joinLobby(socket, lobbyId);
                } else {
                    socket.emit('lobbyError', 'Lobby is full (max 8 players).');
                }
            } else {
                socket.emit('lobbyError', 'Lobby not found or game already in progress.');
            }
        });

        socket.on('leaveLobby', () => {
            leaveLobby(socket);
        });

        socket.on('renameLobby', (newName) => {
            const lobbyId = playerLobbies[socket.id];
            if (!lobbyId || !lobbies[lobbyId]) return;
            const lobby = lobbies[lobbyId];
            if (lobby.creatorId === socket.id && newName && typeof newName === 'string') {
                lobby.name = newName.substring(0, 30);
                broadcastLobbyState(lobbyId);
                broadcastActiveLobbies();
            }
        });

        socket.on('selectMap', (mapKey) => {
            const lobbyId = playerLobbies[socket.id];
            if (!lobbyId || !lobbies[lobbyId]) return;
            const lobby = lobbies[lobbyId];
            if (lobby.creatorId === socket.id && lobby.gameState === 'lobby' && MAP_DEFS[mapKey]) {
                lobby.selectedMap = mapKey;
                broadcastLobbyState(lobbyId);
            }
        });

        socket.on('getMapPreview', (mapKey) => {
            const preview = getMapPreview(mapKey);
            if (preview) {
                socket.emit('mapPreview', { mapKey, terrain: preview, gridW: GRID_W, gridH: GRID_H });
            }
        });

        socket.on('toggleReady', () => {
            const lobbyId = playerLobbies[socket.id];
            if (!lobbyId || !lobbies[lobbyId]) return;
            const lobby = lobbies[lobbyId];

            if (lobby.players[socket.id] && lobby.gameState === 'lobby') {
                lobby.players[socket.id].isReady = !lobby.players[socket.id].isReady;
                broadcastLobbyState(lobbyId);

                const playerKeys = Object.keys(lobby.players);
                if (playerKeys.length >= MIN_PLAYERS && playerKeys.every(id => lobby.players[id].isReady)) {
                    startGame(lobbyId);
                }
            }
        });

        // ── In-Game Actions ──
        socket.on('buildStructure', (data) => {
            const lobbyId = playerLobbies[socket.id];
            if (!lobbyId || !lobbies[lobbyId]) return;
            const lobby = lobbies[lobbyId];
            if (lobby.gameState !== 'playing') return;
            handleBuild(lobby, socket, data);
        });

        socket.on('trainTroop', (data) => {
            const lobbyId = playerLobbies[socket.id];
            if (!lobbyId || !lobbies[lobbyId]) return;
            const lobby = lobbies[lobbyId];
            if (lobby.gameState !== 'playing') return;
            handleTrain(lobby, socket, data);
        });

        socket.on('commandTroops', (data) => {
            const lobbyId = playerLobbies[socket.id];
            if (!lobbyId || !lobbies[lobbyId]) return;
            const lobby = lobbies[lobbyId];
            if (lobby.gameState !== 'playing') return;
            const player = lobby.players[socket.id];
            if (!player || player.eliminated) return;
            const { troopIds, tx, ty } = data;
            
            if (!Array.isArray(troopIds)) return;
            for (const tid of troopIds) {
                const t = lobby.troops[tid];
                if (t && t.owner === player.playerIndex) {
                    t.tx = tx;
                    t.ty = ty;
                }
            }
        });

        socket.on('selectSpawn', (data) => {
            const lobbyId = playerLobbies[socket.id];
            if (!lobbyId || !lobbies[lobbyId]) return;
            const lobby = lobbies[lobbyId];
            if (lobby.gameState !== 'starting') return;
            
            const player = lobby.players[socket.id];
            if (!player || player.eliminated || player.spawnPos) return;
            
            const { x, y } = data;
            if (x < 0 || x >= GRID_W || y < 0 || y >= GRID_H) return;
            const idx = y * GRID_W + x;
            if (lobby.terrain[idx] !== 1) return;
            
            // Check distance to other known spawns
            let valid = true;
            for (const p of Object.values(lobby.players)) {
                if (p.id !== socket.id && p.spawnPos) {
                    const dx = p.spawnPos.x - x;
                    const dy = p.spawnPos.y - y;
                    if (dx*dx + dy*dy < 64) { // 8 blocks
                        valid = false;
                        break;
                    }
                }
            }
            if (valid) {
                player.spawnPos = { x, y };
                stampSpawn(lobby, socket.id, player.spawnPos);
                recountPixels(lobby);
                broadcastGameState(lobbyId);
                // Also broadcast delta so people immediately see the stamp
                const changedPixels = [];
                for (let dy = -3; dy <= 3; dy++) {
                    for (let dx = -3; dx <= 3; dx++) {
                        if (dx * dx + dy * dy <= 10) {
                            const px = x + dx;
                            const py = y + dy;
                            if (px >= 0 && px < GRID_W && py >= 0 && py < GRID_H) {
                                const didx = py * GRID_W + px;
                                if (lobby.terrain[didx] === 1) {
                                    changedPixels.push({ x: px, y: py, owner: player.playerIndex, building: 0 });
                                }
                            }
                        }
                    }
                }
                nsp.to(lobbyId).emit('pixelDelta', changedPixels);
            }
        });

        socket.on('disconnect', () => {
            console.log('[Territory Wars] User disconnected:', socket.id);
            leaveLobby(socket);
        });

        function joinLobby(sock, lobbyId) {
            const lobby = lobbies[lobbyId];
            if (!lobby) return;
            leaveLobby(sock);

            sock.join(lobbyId);
            playerLobbies[sock.id] = lobbyId;

            const playerIndex = Object.keys(lobby.players).length;
            lobby.players[sock.id] = {
                id: sock.id,
                color: PLAYER_COLORS[playerIndex % PLAYER_COLORS.length],
                playerIndex: playerIndex + 1,
                isReady: false,
                eliminated: false,
                energy: 0,
                coins: 0,
                pixelCount: 0,
                maxTroops: BASE_MAX_TROOPS,
                activeTroops: 0,
                buildingCounts: { farm: 0, megafarm: 0, post: 0, house: 0, fort: 0 }
            };

            sock.emit('lobbyJoined', lobbyId);
            sock.emit('mapList', getMapList());
            broadcastLobbyState(lobbyId);
            broadcastActiveLobbies();
        }

        function leaveLobby(sock) {
            const lobbyId = playerLobbies[sock.id];
            if (!lobbyId || !lobbies[lobbyId]) return;

            const lobby = lobbies[lobbyId];
            
            // Capture player index before removing the player record
            const pidx = lobby.players[sock.id] ? lobby.players[sock.id].playerIndex : null;

            delete lobby.players[sock.id];
            delete playerLobbies[sock.id];

            sock.leave(lobbyId);
            sock.emit('lobbyLeft');

            // If in game, clear player's pixels, troops, and buildings
            if ((lobby.gameState === 'playing' || lobby.gameState === 'starting') && lobby.grid && pidx) {
                const changedPixels = [];
                for (let i = 0; i < GRID_SIZE; i++) {
                    if (lobby.grid[i] === pidx) {
                        lobby.grid[i] = 0;
                        lobby.buildings[i] = 0; // Clear building layer too
                        changedPixels.push({
                            x: i % GRID_W,
                            y: Math.floor(i / GRID_W),
                            owner: 0,
                            building: 0
                        });
                    }
                }
                
                // Clear building instances
                if (lobby.buildingInstances) {
                    for (const bId in lobby.buildingInstances) {
                        if (lobby.buildingInstances[bId].owner === pidx) {
                            delete lobby.buildingInstances[bId];
                        }
                    }
                }
                
                // Clear troops
                if (lobby.troops) {
                    for (const tId in lobby.troops) {
                        if (lobby.troops[tId].owner === pidx) {
                            delete lobby.troops[tId];
                        }
                    }
                }

                if (changedPixels.length > 0) {
                    nsp.to(lobbyId).emit('pixelDelta', changedPixels);
                }
            }

            if (Object.keys(lobby.players).length === 0) {
                stopGameLoop(lobbyId);
                delete lobbies[lobbyId];
                broadcastActiveLobbies();
                return;
            }

            if (lobby.creatorId === sock.id) {
                lobby.creatorId = Object.keys(lobby.players)[0];
            }

            // Reassign colors
            const playerKeys = Object.keys(lobby.players);
            playerKeys.forEach((id, index) => {
                lobby.players[id].color = PLAYER_COLORS[index % PLAYER_COLORS.length];
            });

            nsp.to(lobbyId).emit('playerDisconnected', sock.id);
            broadcastLobbyState(lobbyId);
            broadcastActiveLobbies();
        }
    });
};
