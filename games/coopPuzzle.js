const { v4: uuidv4 } = require('uuid');

module.exports = function (io) {
    const nsp = io.of('/coop-puzzle');

    const lobbies = {};
    const playerLobbies = {};
    const customLevels = []; // In-memory custom level storage
    let customLevelIdCounter = 0;

    // ---- Constants ----
    const TILE = 32;
    const GRAVITY = 0.6;
    const TERMINAL_VEL = 14;
    const JUMP_VEL = -11;
    const MOVE_SPEED = 4;
    const PLAYER_W = 24;
    const PLAYER_H = 28;
    const KEY_SIZE = 20;
    const DOOR_W = 32;
    const DOOR_H = 48;
    const BLOCK_SPEED = 1.5;

    const PLAYER_COLORS = [
        '#FF4466', '#44AAFF', '#66FF66', '#FFCC44',
        '#FF88FF', '#44FFDD', '#FF8844', '#AABB44'
    ];

    // ---- Level Definitions ----
    const LEVELS = [
        // Level 1: The Gap
        {
            name: 'The Gap',
            description: 'Bridge the gap together!',
            width: 30,
            height: 17,
            theme: 'cave',
            spawns: [
                { x: 2, y: 13 }, { x: 3, y: 13 }, { x: 4, y: 13 }, { x: 5, y: 13 },
                { x: 2, y: 11 }, { x: 3, y: 11 }, { x: 4, y: 11 }, { x: 5, y: 11 }
            ],
            key: { x: 15, y: 8 },
            door: { x: 27, y: 12 },
            heavyBlocks: [],
            tiles: (function () {
                const t = [];
                for (let y = 0; y < 17; y++) {
                    t[y] = [];
                    for (let x = 0; x < 30; x++) {
                        if (y === 0 || y === 16 || x === 0 || x === 29) t[y][x] = 1; // walls
                        else if (y === 15) t[y][x] = 1; // floor
                        else if (y === 14 && (x >= 8 && x <= 22)) t[y][x] = 0; // gap in floor
                        else if (y === 14) t[y][x] = 1; // floor level 2
                        else if (y === 10 && x >= 13 && x <= 17) t[y][x] = 1; // key platform
                        else t[y][x] = 0;
                    }
                }
                return t;
            })()
        },
        // Level 2: Heavy Lift
        {
            name: 'Heavy Lift',
            description: 'Push the block together!',
            width: 30,
            height: 17,
            theme: 'factory',
            spawns: [
                { x: 2, y: 14 }, { x: 3, y: 14 }, { x: 4, y: 14 }, { x: 5, y: 14 },
                { x: 2, y: 12 }, { x: 3, y: 12 }, { x: 4, y: 12 }, { x: 5, y: 12 }
            ],
            key: { x: 5, y: 10 },
            door: { x: 27, y: 13 },
            heavyBlocks: [
                { x: 16, y: 13, w: 2, h: 2, weight: 3 }
            ],
            tiles: (function () {
                const t = [];
                for (let y = 0; y < 17; y++) {
                    t[y] = [];
                    for (let x = 0; x < 30; x++) {
                        if (y === 0 || y === 16 || x === 0 || x === 29) t[y][x] = 1;
                        else if (y === 15) t[y][x] = 1;
                        else if (y === 12 && x >= 3 && x <= 7) t[y][x] = 2; // platform for key
                        else t[y][x] = 0;
                    }
                }
                return t;
            })()
        },
        // Level 3: The Tower
        {
            name: 'The Tower',
            description: 'Build a human tower to reach the key!',
            width: 30,
            height: 20,
            theme: 'sky',
            spawns: [
                { x: 3, y: 17 }, { x: 4, y: 17 }, { x: 5, y: 17 }, { x: 6, y: 17 },
                { x: 3, y: 15 }, { x: 4, y: 15 }, { x: 5, y: 15 }, { x: 6, y: 15 }
            ],
            key: { x: 15, y: 3 },
            door: { x: 27, y: 16 },
            heavyBlocks: [],
            tiles: (function () {
                const t = [];
                for (let y = 0; y < 20; y++) {
                    t[y] = [];
                    for (let x = 0; x < 30; x++) {
                        if (y === 0 || y === 19 || x === 0 || x === 29) t[y][x] = 1;
                        else if (y === 18) t[y][x] = 1; // floor
                        else if (y === 5 && x >= 13 && x <= 17) t[y][x] = 1; // key platform (high)
                        else t[y][x] = 0;
                    }
                }
                return t;
            })()
        },
        // Level 4: Double Push
        {
            name: 'Double Push',
            description: 'Push two blocks into the pits!',
            width: 35,
            height: 17,
            theme: 'dungeon',
            spawns: [
                { x: 2, y: 14 }, { x: 3, y: 14 }, { x: 4, y: 14 }, { x: 5, y: 14 },
                { x: 2, y: 12 }, { x: 3, y: 12 }, { x: 4, y: 12 }, { x: 5, y: 12 }
            ],
            key: { x: 17, y: 10 },
            door: { x: 32, y: 13 },
            heavyBlocks: [
                { x: 10, y: 13, w: 2, h: 2, weight: 2 },
                { x: 22, y: 13, w: 2, h: 2, weight: 2 }
            ],
            tiles: (function () {
                const t = [];
                for (let y = 0; y < 17; y++) {
                    t[y] = [];
                    for (let x = 0; x < 35; x++) {
                        if (y === 0 || y === 16 || x === 0 || x === 34) t[y][x] = 1;
                        else if (y === 15) {
                            if ((x >= 14 && x <= 15) || (x >= 26 && x <= 27)) t[y][x] = 0; // pits
                            else t[y][x] = 1;
                        }
                        else if (y === 12 && x >= 15 && x <= 19) t[y][x] = 2; // key platform
                        else t[y][x] = 0;
                    }
                }
                return t;
            })()
        },
        // Level 5: Gauntlet
        {
            name: 'The Gauntlet',
            description: 'The ultimate co-op challenge!',
            width: 40,
            height: 20,
            theme: 'neon',
            spawns: [
                { x: 2, y: 17 }, { x: 3, y: 17 }, { x: 4, y: 17 }, { x: 5, y: 17 },
                { x: 2, y: 15 }, { x: 3, y: 15 }, { x: 4, y: 15 }, { x: 5, y: 15 }
            ],
            key: { x: 20, y: 3 },
            door: { x: 37, y: 16 },
            heavyBlocks: [
                { x: 25, y: 16, w: 2, h: 2, weight: 3 }
            ],
            tiles: (function () {
                const t = [];
                for (let y = 0; y < 20; y++) {
                    t[y] = [];
                    for (let x = 0; x < 40; x++) {
                        if (y === 0 || y === 19 || x === 0 || x === 39) t[y][x] = 1;
                        else if (y === 18) {
                            if (x >= 10 && x <= 13) t[y][x] = 0; // pit 1
                            else if (x >= 30 && x <= 32) t[y][x] = 0; // pit 2
                            else t[y][x] = 1;
                        }
                        // Stepped platforms going up to key
                        else if (y === 15 && x >= 8 && x <= 10) t[y][x] = 1;
                        else if (y === 12 && x >= 13 && x <= 15) t[y][x] = 1;
                        else if (y === 9 && x >= 17 && x <= 19) t[y][x] = 1;
                        else if (y === 6 && x >= 13 && x <= 15) t[y][x] = 1;
                        else if (y === 5 && x >= 18 && x <= 22) t[y][x] = 1; // key platform
                        // Wall blocking the door
                        else if (x === 28 && y >= 10 && y <= 18) t[y][x] = 1;
                        // Gap in wall that requires block push
                        else if (x === 28 && y >= 16 && y <= 18) t[y][x] = 0;
                        else t[y][x] = 0;
                    }
                }
                // Re-fix the wall gap explicitly
                t[16][28] = 0;
                t[17][28] = 0;
                t[18][28] = 1; // keep floor
                return t;
            })()
        }
    ];

    // ---- Custom Level Helpers ----
    function getAllLevels() {
        return [...LEVELS, ...customLevels];
    }

    function getLevel(index) {
        const all = getAllLevels();
        return all[index] || null;
    }

    function validateCustomLevel(data) {
        const errors = [];
        if (!data.name || typeof data.name !== 'string' || data.name.trim().length === 0) {
            errors.push('Level name is required.');
        }
        if (!data.width || data.width < 10 || data.width > 50) {
            errors.push('Width must be between 10 and 50.');
        }
        if (!data.height || data.height < 10 || data.height > 30) {
            errors.push('Height must be between 10 and 30.');
        }
        const validThemes = Object.keys({ cave: 1, factory: 1, sky: 1, dungeon: 1, neon: 1 });
        if (!data.theme || !validThemes.includes(data.theme)) {
            errors.push('Invalid theme.');
        }
        if (!data.tiles || !Array.isArray(data.tiles) || data.tiles.length !== data.height) {
            errors.push('Tiles array must match height.');
        } else {
            for (let y = 0; y < data.height; y++) {
                if (!Array.isArray(data.tiles[y]) || data.tiles[y].length !== data.width) {
                    errors.push(`Tiles row ${y} must match width.`);
                    break;
                }
            }
        }
        if (!data.key || typeof data.key.x !== 'number' || typeof data.key.y !== 'number') {
            errors.push('Key position is required.');
        }
        if (!data.door || typeof data.door.x !== 'number' || typeof data.door.y !== 'number') {
            errors.push('Door position is required.');
        }
        if (!data.spawns || !Array.isArray(data.spawns) || data.spawns.length < 2) {
            errors.push('At least 2 spawn points are required.');
        }
        if (data.spawns && data.spawns.length > 8) {
            errors.push('Maximum 8 spawn points.');
        }
        if (!data.heavyBlocks) data.heavyBlocks = [];
        return errors;
    }

    // ---- Helpers ----
    function broadcastLobbyState(lobbyId) {
        const lobby = lobbies[lobbyId];
        if (!lobby) return;
        const allLevels = getAllLevels();
        nsp.to(lobbyId).emit('lobbyState', {
            id: lobby.id,
            name: lobby.name,
            creatorId: lobby.creatorId,
            selectedLevel: lobby.selectedLevel,
            players: Object.values(lobby.players).map(p => ({
                id: p.id,
                isReady: p.isReady,
                color: p.color,
                index: p.index
            })),
            gameState: lobby.gameState,
            levels: allLevels.map((l, i) => ({
                index: i,
                name: l.name,
                description: l.description,
                isCustom: i >= LEVELS.length
            }))
        });
    }

    function broadcastActiveLobbies() {
        const allLevels = getAllLevels();
        const publicLobbies = Object.values(lobbies).map(l => ({
            id: l.id,
            name: l.name,
            playerCount: Object.keys(l.players).length,
            gameState: l.gameState,
            levelName: allLevels[l.selectedLevel] ? allLevels[l.selectedLevel].name : 'Unknown'
        }));
        nsp.emit('activeLobbies', publicLobbies);
    }

    function getTile(level, tx, ty) {
        if (ty < 0 || ty >= level.height || tx < 0 || tx >= level.width) return 1; // out of bounds = solid
        return level.tiles[ty][tx];
    }

    function rectOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
        return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
    }

    function startGameLoop(lobbyId) {
        const lobby = lobbies[lobbyId];
        if (!lobby) return;
        if (lobby.gameLoopInterval) clearInterval(lobby.gameLoopInterval);

        lobby.gameLoopInterval = setInterval(() => {
            updatePhysics(lobbyId);
        }, 1000 / 30);
    }

    function stopGameLoop(lobbyId) {
        const lobby = lobbies[lobbyId];
        if (lobby && lobby.gameLoopInterval) {
            clearInterval(lobby.gameLoopInterval);
            lobby.gameLoopInterval = null;
        }
    }

    function initGameState(lobby) {
        const level = getLevel(lobby.selectedLevel);
        const playerKeys = Object.keys(lobby.players);

        lobby.keyCollected = false;
        lobby.levelComplete = false;
        lobby.heavyBlocks = level.heavyBlocks.map(b => ({
            x: b.x * TILE,
            y: b.y * TILE,
            w: b.w * TILE,
            h: b.h * TILE,
            weight: b.weight,
            pushersLeft: [],
            pushersRight: [],
            fallen: false
        }));

        playerKeys.forEach((id, i) => {
            const spawn = level.spawns[i % level.spawns.length];
            const p = lobby.players[id];
            p.x = spawn.x * TILE;
            p.y = spawn.y * TILE;
            p.vx = 0;
            p.vy = 0;
            p.onGround = false;
            p.facingRight = true;
            p.atDoor = false;
            p.alive = true;
            p.input = { left: false, right: false, jump: false };
        });
    }

    function updatePhysics(lobbyId) {
        const lobby = lobbies[lobbyId];
        if (!lobby || lobby.gameState !== 'playing' || lobby.levelComplete) return;

        const level = getLevel(lobby.selectedLevel);
        const playerKeys = Object.keys(lobby.players);
        const alivePlayers = playerKeys.filter(id => lobby.players[id].alive);
        const players = lobby.players;

        // --- Reset per-frame data ---
        for (const id of alivePlayers) {
            const p = players[id];
            p.onGround = false;
        }

        // --- Reset block pushers ---
        for (const block of lobby.heavyBlocks) {
            block.pushersLeft = [];
            block.pushersRight = [];
        }

        // --- Apply input & gravity ---
        for (const id of alivePlayers) {
            const p = players[id];

            // Horizontal movement
            if (p.input.left) {
                p.vx = -MOVE_SPEED;
                p.facingRight = false;
            } else if (p.input.right) {
                p.vx = MOVE_SPEED;
                p.facingRight = true;
            } else {
                p.vx = 0;
            }

            // Gravity
            p.vy += GRAVITY;
            if (p.vy > TERMINAL_VEL) p.vy = TERMINAL_VEL;
        }

        // --- Move X & resolve tile collisions ---
        for (const id of alivePlayers) {
            const p = players[id];
            p.x += p.vx;

            // Tile collision X
            const left = Math.floor(p.x / TILE);
            const right = Math.floor((p.x + PLAYER_W - 0.001) / TILE);
            const top = Math.floor(p.y / TILE);
            const bottom = Math.floor((p.y + PLAYER_H - 0.001) / TILE);

            for (let ty = top; ty <= bottom; ty++) {
                for (let tx = left; tx <= right; tx++) {
                    const tile = getTile(level, tx, ty);
                    if (tile === 1) {
                        // Solid collision
                        if (p.vx > 0) {
                            p.x = tx * TILE - PLAYER_W;
                        } else if (p.vx < 0) {
                            p.x = (tx + 1) * TILE;
                        }
                    }
                }
            }

            // Heavy block collision X
            for (const block of lobby.heavyBlocks) {
                if (block.fallen) continue;
                if (rectOverlap(p.x, p.y, PLAYER_W, PLAYER_H, block.x, block.y, block.w, block.h)) {
                    if (p.vx > 0) {
                        p.x = block.x - PLAYER_W;
                        block.pushersLeft.push(id);
                    } else if (p.vx < 0) {
                        p.x = block.x + block.w;
                        block.pushersRight.push(id);
                    }
                }
            }
        }

        // --- Move Y & resolve tile collisions ---
        for (const id of alivePlayers) {
            const p = players[id];
            p.y += p.vy;

            const left = Math.floor(p.x / TILE);
            const right = Math.floor((p.x + PLAYER_W - 0.001) / TILE);
            const top = Math.floor(p.y / TILE);
            const bottom = Math.floor((p.y + PLAYER_H - 0.001) / TILE);

            for (let ty = top; ty <= bottom; ty++) {
                for (let tx = left; tx <= right; tx++) {
                    const tile = getTile(level, tx, ty);
                    if (tile === 1) {
                        if (p.vy > 0) {
                            p.y = ty * TILE - PLAYER_H;
                            p.vy = 0;
                            p.onGround = true;
                        } else if (p.vy < 0) {
                            p.y = (ty + 1) * TILE;
                            p.vy = 0;
                        }
                    } else if (tile === 2) {
                        // Platform — only collide going down and from above
                        if (p.vy > 0) {
                            const platTop = ty * TILE;
                            const prevBottom = p.y + PLAYER_H - p.vy;
                            if (prevBottom <= platTop + 2) {
                                p.y = platTop - PLAYER_H;
                                p.vy = 0;
                                p.onGround = true;
                            }
                        }
                    }
                }
            }

            // Heavy block collision Y
            for (const block of lobby.heavyBlocks) {
                if (block.fallen) continue;
                if (rectOverlap(p.x, p.y, PLAYER_W, PLAYER_H, block.x, block.y, block.w, block.h)) {
                    if (p.vy > 0) {
                        p.y = block.y - PLAYER_H;
                        p.vy = 0;
                        p.onGround = true;
                    } else if (p.vy < 0) {
                        p.y = block.y + block.h;
                        p.vy = 0;
                    }
                }
            }
        }

        // --- Player-on-player collision (stacking + side) ---
        for (let i = 0; i < alivePlayers.length; i++) {
            for (let j = i + 1; j < alivePlayers.length; j++) {
                const a = players[alivePlayers[i]];
                const b = players[alivePlayers[j]];

                // Check if overlapping
                if (!rectOverlap(a.x, a.y, PLAYER_W, PLAYER_H, b.x, b.y, PLAYER_W, PLAYER_H)) continue;

                // Calculate overlap on each axis
                const overlapLeft = (a.x + PLAYER_W) - b.x;
                const overlapRight = (b.x + PLAYER_W) - a.x;
                const overlapTop = (a.y + PLAYER_H) - b.y;
                const overlapBottom = (b.y + PLAYER_H) - a.y;

                const minOverlapX = Math.min(overlapLeft, overlapRight);
                const minOverlapY = Math.min(overlapTop, overlapBottom);

                if (minOverlapY < minOverlapX) {
                    // Vertical collision (stacking)
                    if (overlapTop < overlapBottom) {
                        // A is on top of B
                        a.y = b.y - PLAYER_H;
                        a.vy = 0;
                        a.onGround = true;
                    } else {
                        // B is on top of A
                        b.y = a.y - PLAYER_H;
                        b.vy = 0;
                        b.onGround = true;
                    }
                } else {
                    // Horizontal collision (side push)
                    const pushDist = minOverlapX / 2;
                    if (overlapLeft < overlapRight) {
                        // A is to the left of B
                        a.x -= pushDist;
                        b.x += pushDist;
                    } else {
                        // A is to the right of B
                        a.x += pushDist;
                        b.x -= pushDist;
                    }
                }
            }
        }

        // --- Jump ---
        for (const id of alivePlayers) {
            const p = players[id];
            if (p.input.jump && p.onGround) {
                p.vy = JUMP_VEL;
                p.onGround = false;
            }
        }

        // --- Heavy block pushing ---
        for (const block of lobby.heavyBlocks) {
            if (block.fallen) continue;

            // Push right (players pushing from left side)
            if (block.pushersLeft.length >= block.weight) {
                let newX = block.x + BLOCK_SPEED;
                // Check tile collision for block
                const bRight = Math.floor((newX + block.w - 0.001) / TILE);
                const bTop = Math.floor(block.y / TILE);
                const bBottom = Math.floor((block.y + block.h - 0.001) / TILE);
                let canMove = true;
                for (let ty = bTop; ty <= bBottom; ty++) {
                    if (getTile(level, bRight, ty) === 1) canMove = false;
                }
                if (canMove) block.x = newX;
            }

            // Push left (players pushing from right side)
            if (block.pushersRight.length >= block.weight) {
                let newX = block.x - BLOCK_SPEED;
                const bLeft = Math.floor(newX / TILE);
                const bTop = Math.floor(block.y / TILE);
                const bBottom = Math.floor((block.y + block.h - 0.001) / TILE);
                let canMove = true;
                for (let ty = bTop; ty <= bBottom; ty++) {
                    if (getTile(level, bLeft, ty) === 1) canMove = false;
                }
                if (canMove) block.x = newX;
            }

            // Check if block should fall (no floor beneath)
            const blockBottom = Math.floor((block.y + block.h) / TILE);
            const blockLeft = Math.floor(block.x / TILE);
            const blockRight = Math.floor((block.x + block.w - 0.001) / TILE);
            let hasFloor = false;
            for (let tx = blockLeft; tx <= blockRight; tx++) {
                if (getTile(level, tx, blockBottom) === 1) hasFloor = true;
            }
            if (!hasFloor) {
                block.y += GRAVITY * 4;
                // Check if it fell into a pit (below level)
                if (block.y > level.height * TILE) {
                    block.fallen = true;
                }
            }
        }

        // --- Kill block detection (tile type 3) ---
        for (const id of alivePlayers) {
            const p = players[id];
            const left = Math.floor(p.x / TILE);
            const right = Math.floor((p.x + PLAYER_W - 0.001) / TILE);
            const top = Math.floor(p.y / TILE);
            const bottom = Math.floor((p.y + PLAYER_H - 0.001) / TILE);

            let killed = false;
            for (let ty = top; ty <= bottom && !killed; ty++) {
                for (let tx = left; tx <= right && !killed; tx++) {
                    if (getTile(level, tx, ty) === 3) {
                        killed = true;
                    }
                }
            }

            if (killed) {
                p.alive = false;
                p.vx = 0;
                p.vy = 0;
                nsp.to(lobbyId).emit('playerKilled', {
                    playerId: id,
                    x: p.x,
                    y: p.y,
                    color: p.color,
                    index: p.index
                });
            }
        }

        // --- Check if only one player remains alive ---
        const stillAlive = playerKeys.filter(id => players[id].alive);
        if (stillAlive.length <= 1 && playerKeys.length >= 2) {
            lobby.levelComplete = true;
            const winnerId = stillAlive.length === 1 ? stillAlive[0] : null;
            const winnerIndex = winnerId ? players[winnerId].index : -1;
            nsp.to(lobbyId).emit('gameOver', {
                reason: stillAlive.length === 0 ? 'allDead' : 'lastStanding',
                winnerId: winnerId,
                winnerIndex: winnerIndex,
                winnerColor: winnerId ? players[winnerId].color : null
            });
            stopGameLoop(lobbyId);

            // Return to lobby after 5s
            setTimeout(() => {
                if (!lobbies[lobbyId]) return;
                lobby.gameState = 'lobby';
                Object.values(lobby.players).forEach(p => {
                    p.isReady = false;
                    p.alive = true;
                });
                broadcastLobbyState(lobbyId);
                broadcastActiveLobbies();
                nsp.to(lobbyId).emit('resetToLobby');
            }, 5000);
            return;
        }

        // --- Key pickup ---
        if (!lobby.keyCollected) {
            const kx = level.key.x * TILE;
            const ky = level.key.y * TILE;
            for (const id of stillAlive) {
                const p = players[id];
                if (rectOverlap(p.x, p.y, PLAYER_W, PLAYER_H, kx, ky, KEY_SIZE, KEY_SIZE)) {
                    lobby.keyCollected = true;
                    nsp.to(lobbyId).emit('keyCollected');
                    break;
                }
            }
        }

        // --- Door check (only alive players need to be at door) ---
        if (lobby.keyCollected) {
            const dx = level.door.x * TILE;
            const dy = level.door.y * TILE;
            let allAtDoor = true;
            for (const id of stillAlive) {
                const p = players[id];
                p.atDoor = rectOverlap(p.x, p.y, PLAYER_W, PLAYER_H, dx, dy, DOOR_W, DOOR_H);
                if (!p.atDoor) allAtDoor = false;
            }

            if (allAtDoor && stillAlive.length >= 1) {
                lobby.levelComplete = true;
                nsp.to(lobbyId).emit('levelComplete', {
                    levelIndex: lobby.selectedLevel,
                    levelName: level.name
                });
                stopGameLoop(lobbyId);

                // Return to lobby after 5s
                setTimeout(() => {
                    if (!lobbies[lobbyId]) return;
                    lobby.gameState = 'lobby';
                    Object.values(lobby.players).forEach(p => {
                        p.isReady = false;
                        p.alive = true;
                    });
                    broadcastLobbyState(lobbyId);
                    broadcastActiveLobbies();
                    nsp.to(lobbyId).emit('resetToLobby');
                }, 5000);
                return;
            }
        }

        // --- Broadcast game state (every frame at 30fps is fine for co-op) ---
        lobby.frameCount = (lobby.frameCount || 0) + 1;

        const playersState = {};
        for (const id of playerKeys) {
            const p = players[id];
            playersState[id] = {
                x: Math.round(p.x * 10) / 10,
                y: Math.round(p.y * 10) / 10,
                vx: p.vx,
                vy: Math.round(p.vy * 10) / 10,
                onGround: p.onGround,
                facingRight: p.facingRight,
                atDoor: p.atDoor,
                color: p.color,
                index: p.index,
                alive: p.alive
            };
        }

        const blocksState = lobby.heavyBlocks.filter(b => !b.fallen).map(b => ({
            x: Math.round(b.x),
            y: Math.round(b.y),
            w: b.w,
            h: b.h,
            weight: b.weight,
            pushingLeft: b.pushersLeft.length,
            pushingRight: b.pushersRight.length
        }));

        const aliveCount = playerKeys.filter(id => players[id].alive).length;
        nsp.to(lobbyId).emit('gameStateUpdate', {
            players: playersState,
            blocks: blocksState,
            keyCollected: lobby.keyCollected,
            playersAtDoor: playerKeys.filter(id => players[id].atDoor && players[id].alive).length,
            totalPlayers: playerKeys.length,
            alivePlayers: aliveCount
        });
    }

    // ---- Socket handlers ----
    nsp.on('connection', (socket) => {
        console.log('[Co-op Puzzle] User connected:', socket.id);
        broadcastActiveLobbies();

        socket.on('createLobby', () => {
            const lobbyId = uuidv4().substring(0, 8);
            lobbies[lobbyId] = {
                id: lobbyId,
                name: `${socket.id.substring(0, 4)}'s Puzzle`,
                creatorId: socket.id,
                players: {},
                gameState: 'lobby',
                gameLoopInterval: null,
                selectedLevel: 0,
                keyCollected: false,
                levelComplete: false,
                heavyBlocks: [],
                frameCount: 0
            };
            joinLobby(socket, lobbyId);
            broadcastActiveLobbies();
        });

        socket.on('joinLobby', (lobbyId) => {
            if (lobbies[lobbyId] && lobbies[lobbyId].gameState === 'lobby') {
                if (Object.keys(lobbies[lobbyId].players).length < 8) {
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

        socket.on('selectLevel', (levelIndex) => {
            const lobbyId = playerLobbies[socket.id];
            if (!lobbyId || !lobbies[lobbyId]) return;
            const lobby = lobbies[lobbyId];
            if (lobby.creatorId === socket.id && lobby.gameState === 'lobby') {
                const idx = parseInt(levelIndex);
                const allLevels = getAllLevels();
                if (idx >= 0 && idx < allLevels.length) {
                    lobby.selectedLevel = idx;
                    broadcastLobbyState(lobbyId);
                }
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
                if (playerKeys.length >= 2 && playerKeys.every(id => lobby.players[id].isReady)) {
                    startGame(lobbyId);
                }
            }
        });

        socket.on('input', (inputData) => {
            const lobbyId = playerLobbies[socket.id];
            if (!lobbyId || !lobbies[lobbyId]) return;
            const lobby = lobbies[lobbyId];

            if (lobby.players[socket.id] && lobby.gameState === 'playing') {
                lobby.players[socket.id].input = {
                    left: !!inputData.left,
                    right: !!inputData.right,
                    jump: !!inputData.jump
                };
            }
        });

        socket.on('disconnect', () => {
            console.log('[Co-op Puzzle] User disconnected:', socket.id);
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
                index: playerIndex,
                isReady: false,
                x: 0, y: 0, vx: 0, vy: 0,
                onGround: false,
                facingRight: true,
                atDoor: false,
                input: { left: false, right: false, jump: false }
            };

            sock.emit('lobbyJoined', lobbyId);
            broadcastLobbyState(lobbyId);
            broadcastActiveLobbies();
        }

        function leaveLobby(sock) {
            const lobbyId = playerLobbies[sock.id];
            if (!lobbyId || !lobbies[lobbyId]) return;

            const lobby = lobbies[lobbyId];
            delete lobby.players[sock.id];
            delete playerLobbies[sock.id];

            sock.leave(lobbyId);
            sock.emit('lobbyLeft');

            if (Object.keys(lobby.players).length === 0) {
                stopGameLoop(lobbyId);
                delete lobbies[lobbyId];
                broadcastActiveLobbies();
                return;
            }

            if (lobby.creatorId === sock.id) {
                lobby.creatorId = Object.keys(lobby.players)[0];
            }

            // Reassign indices
            const playerKeys = Object.keys(lobby.players);
            playerKeys.forEach((id, index) => {
                lobby.players[id].index = index;
                lobby.players[id].color = PLAYER_COLORS[index % PLAYER_COLORS.length];
            });

            nsp.to(lobbyId).emit('playerDisconnected', sock.id);
            broadcastLobbyState(lobbyId);
            broadcastActiveLobbies();
        }

        function startGame(lobbyId) {
            const lobby = lobbies[lobbyId];
            if (!lobby) return;

            const level = getLevel(lobby.selectedLevel);
            lobby.gameState = 'playing';
            lobby.frameCount = 0;

            initGameState(lobby);

            nsp.to(lobbyId).emit('gameStart', {
                level: {
                    name: level.name,
                    width: level.width,
                    height: level.height,
                    tiles: level.tiles,
                    theme: level.theme,
                    key: level.key,
                    door: level.door,
                    heavyBlocks: level.heavyBlocks,
                    hasKillBlocks: level.tiles.some(row => row.some(t => t === 3))
                },
                players: Object.fromEntries(
                    Object.keys(lobby.players).map(id => [id, {
                        color: lobby.players[id].color,
                        index: lobby.players[id].index
                    }])
                )
            });

            broadcastActiveLobbies();
            startGameLoop(lobbyId);
        }
        // ---- Custom Level Events ----
        socket.on('publishLevel', (data) => {
            const errors = validateCustomLevel(data);
            if (errors.length > 0) {
                socket.emit('publishLevelResult', { success: false, errors });
                return;
            }

            const customLevel = {
                id: 'custom_' + (++customLevelIdCounter),
                name: data.name.trim().substring(0, 30),
                description: data.description ? data.description.trim().substring(0, 80) : 'Custom level',
                width: data.width,
                height: data.height,
                theme: data.theme,
                tiles: data.tiles,
                key: { x: data.key.x, y: data.key.y },
                door: { x: data.door.x, y: data.door.y },
                spawns: data.spawns.slice(0, 8).map(s => ({ x: s.x, y: s.y })),
                heavyBlocks: (data.heavyBlocks || []).map(b => ({
                    x: b.x, y: b.y, w: b.w || 2, h: b.h || 2, weight: Math.max(1, Math.min(b.weight || 2, 8))
                })),
                creatorId: socket.id,
                isCustom: true
            };

            customLevels.push(customLevel);
            console.log(`[Co-op Puzzle] Custom level published: "${customLevel.name}" by ${socket.id}`);

            socket.emit('publishLevelResult', { success: true, levelId: customLevel.id, index: LEVELS.length + customLevels.length - 1 });

            // Broadcast updated level lists to all lobbies
            Object.keys(lobbies).forEach(lid => broadcastLobbyState(lid));
            nsp.emit('customLevelsUpdated', customLevels.map((l, i) => ({
                index: LEVELS.length + i,
                name: l.name,
                description: l.description,
                isCustom: true
            })));
        });

        socket.on('getCustomLevels', () => {
            socket.emit('customLevelsList', customLevels.map((l, i) => ({
                index: LEVELS.length + i,
                name: l.name,
                description: l.description,
                isCustom: true
            })));
        });
    });
};
