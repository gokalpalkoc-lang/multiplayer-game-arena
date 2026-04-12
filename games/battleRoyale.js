const { v4: uuidv4 } = require('uuid');

module.exports = function(io) {
    const nsp = io.of('/battle-royale');
    const arenaDB = io.arenaDB;

    const lobbies = {};
    const playerLobbies = {};

    // --- Map Generation Constants ---
    const MAP_SIZE = 3200;        // 3200x3200 world pixels
    const TILE_SIZE = 40;
    const GRID_SIZE = MAP_SIZE / TILE_SIZE; // 80x80 grid
    const PLAYER_RADIUS = 12;
    const PLAYER_SPEED = 3.5;
    const BULLET_SPEED = 14;
    const MAX_PLAYERS = 20;

    // Zone constants
    const ZONE_SHRINK_INTERVAL = 25000;  // 25s between shrinks
    const ZONE_SHRINK_DURATION = 8000;   // 8s to shrink
    const ZONE_DAMAGE = 5;               // HP/s outside zone
    const ZONE_DAMAGE_TICK = 500;        // ms between damage ticks

    // Weapons
    const WEAPONS = {
        pistol: { name: 'Pistol', damage: 15, fireRate: 350, ammo: Infinity, spread: 0.05, bulletRadius: 3, color: '#aaa' },
        smg: { name: 'SMG', damage: 10, fireRate: 100, ammo: 40, spread: 0.12, bulletRadius: 2, color: '#00d4ff' },
        shotgun: { name: 'Shotgun', damage: 8, fireRate: 800, ammo: 8, spread: 0.3, bulletRadius: 3, pellets: 5, color: '#ff8800' },
        sniper: { name: 'Sniper', damage: 55, fireRate: 1200, ammo: 5, spread: 0.01, bulletRadius: 2, color: '#ff4466' },
        ar: { name: 'AR', damage: 18, fireRate: 150, ammo: 30, spread: 0.07, bulletRadius: 3, color: '#44ff88' }
    };

    const ITEM_TYPES = ['smg', 'shotgun', 'sniper', 'ar', 'medkit', 'shield'];

    function generateMap() {
        const grid = [];
        for (let y = 0; y < GRID_SIZE; y++) {
            grid[y] = [];
            for (let x = 0; x < GRID_SIZE; x++) {
                // Border walls
                if (x === 0 || y === 0 || x === GRID_SIZE - 1 || y === GRID_SIZE - 1) {
                    grid[y][x] = 1; // wall
                } else {
                    grid[y][x] = 0; // empty
                }
            }
        }

        // Generate building clusters
        const numBuildings = 18 + Math.floor(Math.random() * 8);
        for (let i = 0; i < numBuildings; i++) {
            const bx = 3 + Math.floor(Math.random() * (GRID_SIZE - 10));
            const by = 3 + Math.floor(Math.random() * (GRID_SIZE - 10));
            const bw = 3 + Math.floor(Math.random() * 4);
            const bh = 3 + Math.floor(Math.random() * 4);

            for (let y = by; y < by + bh && y < GRID_SIZE - 1; y++) {
                for (let x = bx; x < bx + bw && x < GRID_SIZE - 1; x++) {
                    grid[y][x] = 1;
                }
            }
            // Cut doorways
            const doorSide = Math.floor(Math.random() * 4);
            const doorPos = Math.floor(Math.random() * Math.min(bw, bh));
            if (doorSide === 0 && by > 1) grid[by][bx + Math.min(doorPos, bw - 1)] = 0;
            else if (doorSide === 1 && by + bh < GRID_SIZE - 1) grid[by + bh - 1][bx + Math.min(doorPos, bw - 1)] = 0;
            else if (doorSide === 2 && bx > 1) grid[by + Math.min(doorPos, bh - 1)][bx] = 0;
            else if (doorSide === 3 && bx + bw < GRID_SIZE - 1) grid[by + Math.min(doorPos, bh - 1)][bx + bw - 1] = 0;
        }

        // Scatter cover (single walls / small obstacles)
        const numCover = 60 + Math.floor(Math.random() * 30);
        for (let i = 0; i < numCover; i++) {
            const cx = 2 + Math.floor(Math.random() * (GRID_SIZE - 4));
            const cy = 2 + Math.floor(Math.random() * (GRID_SIZE - 4));
            if (grid[cy][cx] === 0) {
                grid[cy][cx] = 2; // destructible cover
            }
        }

        return grid;
    }

    function generateLootChests(grid) {
        const chests = {};
        const numChests = 40 + Math.floor(Math.random() * 20);
        let placed = 0;
        let attempts = 0;

        while (placed < numChests && attempts < 500) {
            attempts++;
            const gx = 2 + Math.floor(Math.random() * (GRID_SIZE - 4));
            const gy = 2 + Math.floor(Math.random() * (GRID_SIZE - 4));
            if (grid[gy][gx] === 0) {
                const id = uuidv4().substring(0, 8);
                const itemType = ITEM_TYPES[Math.floor(Math.random() * ITEM_TYPES.length)];
                chests[id] = {
                    id,
                    x: gx * TILE_SIZE + TILE_SIZE / 2,
                    y: gy * TILE_SIZE + TILE_SIZE / 2,
                    type: itemType,
                    opened: false
                };
                placed++;
            }
        }
        return chests;
    }

    function findSpawnPoint(grid, existingPlayers) {
        for (let attempt = 0; attempt < 200; attempt++) {
            const gx = 3 + Math.floor(Math.random() * (GRID_SIZE - 6));
            const gy = 3 + Math.floor(Math.random() * (GRID_SIZE - 6));
            if (grid[gy][gx] !== 0) continue;

            const wx = gx * TILE_SIZE + TILE_SIZE / 2;
            const wy = gy * TILE_SIZE + TILE_SIZE / 2;

            // Check distance from other players
            let tooClose = false;
            for (const pid in existingPlayers) {
                const p = existingPlayers[pid];
                const dx = p.x - wx;
                const dy = p.y - wy;
                if (Math.sqrt(dx * dx + dy * dy) < 200) {
                    tooClose = true;
                    break;
                }
            }
            if (!tooClose) return { x: wx, y: wy };
        }
        // Fallback
        return { x: MAP_SIZE / 2, y: MAP_SIZE / 2 };
    }

    // --- Lobby Helpers ---
    function broadcastLobbyState(lobbyId) {
        const lobby = lobbies[lobbyId];
        if (!lobby) return;
        nsp.to(lobbyId).emit('lobbyState', {
            id: lobby.id,
            name: lobby.name,
            creatorId: lobby.creatorId,
            players: Object.values(lobby.players).map(p => ({
                id: p.id, isReady: p.isReady, color: p.color
            })),
            gameState: lobby.gameState
        });
    }

    function broadcastActiveLobbies() {
        const list = Object.values(lobbies).map(l => ({
            id: l.id,
            name: l.name,
            playerCount: Object.keys(l.players).length,
            gameState: l.gameState
        }));
        nsp.emit('activeLobbies', list);
    }

    // --- Physics / Game Loop ---
    function startGameLoop(lobbyId) {
        const lobby = lobbies[lobbyId];
        if (!lobby) return;
        if (lobby.gameLoopInterval) clearInterval(lobby.gameLoopInterval);
        lobby.frameCount = 0;

        lobby.gameLoopInterval = setInterval(() => {
            updatePhysics(lobbyId);
        }, 1000 / 60);
    }

    function stopGameLoop(lobbyId) {
        const lobby = lobbies[lobbyId];
        if (lobby && lobby.gameLoopInterval) {
            clearInterval(lobby.gameLoopInterval);
            lobby.gameLoopInterval = null;
        }
        if (lobby && lobby.zoneShrinkTimer) {
            clearTimeout(lobby.zoneShrinkTimer);
            lobby.zoneShrinkTimer = null;
        }
    }

    function updatePhysics(lobbyId) {
        const lobby = lobbies[lobbyId];
        if (!lobby || lobby.gameState !== 'playing') return;

        const now = Date.now();

        // --- Zone Shrink ---
        if (lobby.zoneShrinking) {
            const elapsed = now - lobby.zoneShrinkStart;
            const t = Math.min(1, elapsed / ZONE_SHRINK_DURATION);
            lobby.zone.radius = lobby.zoneFrom + (lobby.zoneTo - lobby.zoneFrom) * t;
            if (t >= 1) {
                lobby.zoneShrinking = false;
            }
        }

        // --- Zone Damage ---
        if (now - lobby.lastZoneDamageTick >= ZONE_DAMAGE_TICK) {
            lobby.lastZoneDamageTick = now;
            for (const pid in lobby.players) {
                const p = lobby.players[pid];
                if (p.dead) continue;
                const dx = p.x - lobby.zone.x;
                const dy = p.y - lobby.zone.y;
                if (Math.sqrt(dx * dx + dy * dy) > lobby.zone.radius) {
                    p.health -= ZONE_DAMAGE;
                    if (p.health <= 0) {
                        p.health = 0;
                        eliminatePlayer(lobbyId, pid, null, 'zone');
                    }
                }
            }
        }

        // --- Player Movement ---
        for (const pid in lobby.players) {
            const p = lobby.players[pid];
            if (p.dead) continue;

            let dx = 0, dy = 0;
            if (p.input.up) dy -= 1;
            if (p.input.down) dy += 1;
            if (p.input.left) dx -= 1;
            if (p.input.right) dx += 1;

            if (dx !== 0 || dy !== 0) {
                const mag = Math.sqrt(dx * dx + dy * dy);
                dx = (dx / mag) * PLAYER_SPEED;
                dy = (dy / mag) * PLAYER_SPEED;

                const nx = p.x + dx;
                const ny = p.y + dy;

                // Tile collision
                if (!isTileBlocked(lobby.grid, nx, p.y)) p.x = nx;
                if (!isTileBlocked(lobby.grid, p.x, ny)) p.y = ny;

                // Clamp to map
                p.x = Math.max(PLAYER_RADIUS, Math.min(MAP_SIZE - PLAYER_RADIUS, p.x));
                p.y = Math.max(PLAYER_RADIUS, Math.min(MAP_SIZE - PLAYER_RADIUS, p.y));
            }
        }

        // --- Bullets ---
        const bulletKeys = Object.keys(lobby.bullets);
        for (const bId of bulletKeys) {
            const b = lobby.bullets[bId];
            b.x += b.vx;
            b.y += b.vy;
            b.life--;

            let destroyed = false;

            // Out of bounds
            if (b.x < 0 || b.x > MAP_SIZE || b.y < 0 || b.y > MAP_SIZE || b.life <= 0) {
                destroyed = true;
            }

            // Wall collision
            if (!destroyed && isTileBlocked(lobby.grid, b.x, b.y)) {
                // Destructible?
                const gx = Math.floor(b.x / TILE_SIZE);
                const gy = Math.floor(b.y / TILE_SIZE);
                if (gx >= 0 && gx < GRID_SIZE && gy >= 0 && gy < GRID_SIZE && lobby.grid[gy][gx] === 2) {
                    lobby.grid[gy][gx] = 0;
                    nsp.to(lobbyId).emit('tileDestroyed', { x: gx, y: gy });
                }
                destroyed = true;
            }

            // Player collision
            if (!destroyed) {
                for (const pid in lobby.players) {
                    const p = lobby.players[pid];
                    if (pid === b.ownerId || p.dead) continue;
                    const pdx = p.x - b.x;
                    const pdy = p.y - b.y;
                    if (Math.sqrt(pdx * pdx + pdy * pdy) < PLAYER_RADIUS + b.radius) {
                        destroyed = true;
                        // Damage
                        if (p.shield > 0) {
                            const shieldDmg = Math.min(p.shield, b.damage);
                            p.shield -= shieldDmg;
                            p.health -= (b.damage - shieldDmg);
                        } else {
                            p.health -= b.damage;
                        }
                        if (p.health <= 0) {
                            p.health = 0;
                            eliminatePlayer(lobbyId, pid, b.ownerId, 'weapon');
                        }
                        break;
                    }
                }
            }

            if (destroyed) {
                delete lobby.bullets[bId];
            }
        }

        // --- Broadcast State (throttled to 20fps) ---
        lobby.frameCount++;
        if (lobby.frameCount % 3 === 0) {
            const playersSlim = {};
            for (const pid in lobby.players) {
                const p = lobby.players[pid];
                playersSlim[pid] = {
                    x: Math.round(p.x),
                    y: Math.round(p.y),
                    health: p.health,
                    shield: p.shield,
                    dead: p.dead,
                    weapon: p.weapon,
                    aimAngle: Math.round(p.aimAngle * 100) / 100,
                    color: p.color,
                    kills: p.kills
                };
            }

            const bulletsSlim = Object.values(lobby.bullets).map(b => ({
                x: Math.round(b.x),
                y: Math.round(b.y),
                radius: b.radius,
                color: b.color
            }));

            nsp.to(lobbyId).emit('gameStateUpdate', {
                players: playersSlim,
                bullets: bulletsSlim,
                zone: {
                    x: Math.round(lobby.zone.x),
                    y: Math.round(lobby.zone.y),
                    radius: Math.round(lobby.zone.radius)
                },
                alive: Object.values(lobby.players).filter(p => !p.dead).length,
                total: Object.keys(lobby.players).length
            });
        }
    }

    function isTileBlocked(grid, x, y) {
        const gx = Math.floor(x / TILE_SIZE);
        const gy = Math.floor(y / TILE_SIZE);
        if (gx < 0 || gx >= GRID_SIZE || gy < 0 || gy >= GRID_SIZE) return true;
        return grid[gy][gx] === 1 || grid[gy][gx] === 2;
    }

    function eliminatePlayer(lobbyId, victimId, killerId, cause) {
        const lobby = lobbies[lobbyId];
        if (!lobby) return;

        const victim = lobby.players[victimId];
        if (!victim || victim.dead) return;

        victim.dead = true;
        victim.placement = lobby.aliveCount;
        lobby.aliveCount--;

        // Award kill
        if (killerId && lobby.players[killerId]) {
            lobby.players[killerId].kills++;
            if (arenaDB) {
                const killerName = io.getUsernameBySocketId ? io.getUsernameBySocketId(killerId) : null;
                if (killerName) arenaDB.awardCoins(killerName, 5, 'Elimination', 'battle-royale');
            }
        }

        nsp.to(lobbyId).emit('playerEliminated', {
            victimId,
            killerId,
            cause,
            placement: victim.placement,
            alive: lobby.aliveCount
        });

        // Enable spectator for victim
        const victimSock = nsp.sockets.get(victimId);
        if (victimSock) {
            victimSock.emit('spectatorMode', { placement: victim.placement });
        }

        // Check for win
        if (lobby.aliveCount <= 1) {
            const winner = Object.values(lobby.players).find(p => !p.dead);
            triggerGameOver(lobbyId, winner ? winner.id : null);
        }
    }

    function triggerGameOver(lobbyId, winnerId) {
        const lobby = lobbies[lobbyId];
        if (!lobby || lobby.gameState !== 'playing') return;

        stopGameLoop(lobbyId);
        lobby.gameState = 'gameover';

        const results = Object.values(lobby.players)
            .sort((a, b) => {
                if (a.id === winnerId) return -1;
                if (b.id === winnerId) return 1;
                return (a.placement || 999) - (b.placement || 999);
            })
            .map((p, i) => ({
                id: p.id,
                placement: p.id === winnerId ? 1 : (p.placement || i + 1),
                kills: p.kills,
                color: p.color
            }));

        nsp.to(lobbyId).emit('gameOver', { results, winnerId });
        broadcastActiveLobbies();

        // Award coins
        if (arenaDB) {
            const coinRewards = [40, 25, 20, 15, 12, 10, 10, 10];
            results.forEach((r, i) => {
                const username = io.getUsernameBySocketId ? io.getUsernameBySocketId(r.id) : null;
                if (!username) return;
                const coins = coinRewards[i] || 8;
                arenaDB.awardCoins(username, coins, i === 0 ? 'Victory Royale' : `#${r.placement}`, 'battle-royale');
                arenaDB.recordGameResult(username, 'battle-royale', i === 0);
            });
        }

        setTimeout(() => {
            if (!lobbies[lobbyId]) return;
            lobby.gameState = 'lobby';
            Object.values(lobby.players).forEach(p => {
                p.isReady = false;
            });
            broadcastLobbyState(lobbyId);
            broadcastActiveLobbies();
            nsp.to(lobbyId).emit('resetToLobby');
        }, 8000);
    }

    function scheduleZoneShrink(lobbyId) {
        const lobby = lobbies[lobbyId];
        if (!lobby || lobby.gameState !== 'playing') return;

        lobby.zoneShrinkTimer = setTimeout(() => {
            if (!lobby || lobby.gameState !== 'playing') return;

            lobby.zonePhase = (lobby.zonePhase || 0) + 1;
            const newRadius = Math.max(200, lobby.zone.radius * 0.65);

            // Move zone center slightly toward map center each shrink
            const cx = lobby.zone.x + (MAP_SIZE / 2 - lobby.zone.x) * 0.15;
            const cy = lobby.zone.y + (MAP_SIZE / 2 - lobby.zone.y) * 0.15;

            lobby.zoneFrom = lobby.zone.radius;
            lobby.zoneTo = newRadius;
            lobby.zone.x = cx;
            lobby.zone.y = cy;
            lobby.zoneShrinking = true;
            lobby.zoneShrinkStart = Date.now();

            nsp.to(lobbyId).emit('zoneShrink', {
                x: Math.round(cx),
                y: Math.round(cy),
                fromRadius: Math.round(lobby.zoneFrom),
                toRadius: Math.round(newRadius),
                duration: ZONE_SHRINK_DURATION
            });

            // Schedule next shrink
            scheduleZoneShrink(lobbyId);
        }, ZONE_SHRINK_INTERVAL);
    }

    // --- Player Colors ---
    const PLAYER_COLORS = [
        '#ff4466', '#4488ff', '#44ff88', '#ffcc00', '#ff44ff', '#44ffff',
        '#ff8844', '#88ff44', '#4444ff', '#ff4488', '#44ff44', '#ff8800',
        '#00d4ff', '#d4ff00', '#ff00d4', '#00ffd4', '#8844ff', '#ff4400',
        '#00ff88', '#8800ff'
    ];

    // --- Socket Connection ---
    nsp.on('connection', (socket) => {
        console.log('[Battle Royale] User connected:', socket.id);
        broadcastActiveLobbies();

        socket.on('createLobby', () => {
            const lobbyId = uuidv4().substring(0, 8);
            lobbies[lobbyId] = {
                id: lobbyId,
                name: `${socket.id.substring(0, 4)}'s BR`,
                creatorId: socket.id,
                players: {},
                gameState: 'lobby',
                gameLoopInterval: null,
                grid: null,
                chests: {},
                bullets: {},
                zone: null
            };
            joinLobby(socket, lobbyId);
            broadcastActiveLobbies();
        });

        socket.on('joinLobby', (lobbyId) => {
            if (lobbies[lobbyId] && lobbies[lobbyId].gameState === 'lobby') {
                if (Object.keys(lobbies[lobbyId].players).length < MAX_PLAYERS) {
                    joinLobby(socket, lobbyId);
                } else {
                    socket.emit('lobbyError', 'Lobby is full (max 20 players).');
                }
            } else {
                socket.emit('lobbyError', 'Lobby not found or game in progress.');
            }
        });

        socket.on('leaveLobby', () => leaveLobby(socket));

        socket.on('renameLobby', (newName) => {
            const lobbyId = playerLobbies[socket.id];
            if (!lobbyId || !lobbies[lobbyId]) return;
            if (lobbies[lobbyId].creatorId === socket.id && newName && typeof newName === 'string') {
                lobbies[lobbyId].name = newName.substring(0, 30);
                broadcastLobbyState(lobbyId);
                broadcastActiveLobbies();
            }
        });

        socket.on('toggleReady', () => {
            const lobbyId = playerLobbies[socket.id];
            if (!lobbyId || !lobbies[lobbyId]) return;
            const lobby = lobbies[lobbyId];
            if (lobby.players[socket.id] && lobby.gameState === 'lobby') {
                lobby.players[socket.id].isReady = !lobby.players[socket.id].isReady;
                broadcastLobbyState(lobbyId);

                // Check start (need 2+)
                const pKeys = Object.keys(lobby.players);
                if (pKeys.length >= 2 && pKeys.every(id => lobby.players[id].isReady)) {
                    startGame(lobbyId);
                }
            }
        });

        // --- In-Game Input ---
        socket.on('input', (data) => {
            const lobbyId = playerLobbies[socket.id];
            if (!lobbyId || !lobbies[lobbyId]) return;
            const lobby = lobbies[lobbyId];
            const p = lobby.players[socket.id];
            if (!p || p.dead || lobby.gameState !== 'playing') return;

            p.input = {
                up: !!data.up,
                down: !!data.down,
                left: !!data.left,
                right: !!data.right
            };
            if (typeof data.aimAngle === 'number') {
                p.aimAngle = data.aimAngle;
            }
        });

        socket.on('shoot', (data) => {
            const lobbyId = playerLobbies[socket.id];
            if (!lobbyId || !lobbies[lobbyId]) return;
            const lobby = lobbies[lobbyId];
            const p = lobby.players[socket.id];
            if (!p || p.dead || lobby.gameState !== 'playing') return;

            const now = Date.now();
            const weaponDef = WEAPONS[p.weapon] || WEAPONS.pistol;

            if (now - p.lastShotTime < weaponDef.fireRate) return;
            if (p.ammo !== Infinity && p.ammo <= 0) return;

            p.lastShotTime = now;
            if (p.ammo !== Infinity) p.ammo--;

            const pellets = weaponDef.pellets || 1;
            for (let i = 0; i < pellets; i++) {
                const spread = (Math.random() - 0.5) * weaponDef.spread * 2;
                const angle = (data.angle || p.aimAngle || 0) + spread;
                const bId = uuidv4().substring(0, 8);
                lobby.bullets[bId] = {
                    id: bId,
                    x: p.x,
                    y: p.y,
                    vx: Math.cos(angle) * BULLET_SPEED,
                    vy: Math.sin(angle) * BULLET_SPEED,
                    ownerId: socket.id,
                    damage: weaponDef.damage,
                    radius: weaponDef.bulletRadius,
                    color: weaponDef.color,
                    life: 120
                };
            }

            socket.emit('ammoUpdate', p.ammo);
        });

        socket.on('openChest', (chestId) => {
            const lobbyId = playerLobbies[socket.id];
            if (!lobbyId || !lobbies[lobbyId]) return;
            const lobby = lobbies[lobbyId];
            const p = lobby.players[socket.id];
            if (!p || p.dead) return;

            const chest = lobby.chests[chestId];
            if (!chest || chest.opened) return;

            // Distance check
            const dx = p.x - chest.x;
            const dy = p.y - chest.y;
            if (Math.sqrt(dx * dx + dy * dy) > 60) return;

            chest.opened = true;

            if (chest.type === 'medkit') {
                p.health = Math.min(100, p.health + 50);
                socket.emit('itemPickup', { type: 'medkit', health: p.health });
            } else if (chest.type === 'shield') {
                p.shield = Math.min(50, p.shield + 25);
                socket.emit('itemPickup', { type: 'shield', shield: p.shield });
            } else {
                // Weapon pickup
                const wDef = WEAPONS[chest.type];
                if (wDef) {
                    p.weapon = chest.type;
                    p.ammo = wDef.ammo;
                    socket.emit('weaponPickup', { weapon: chest.type, ammo: p.ammo });
                }
            }

            nsp.to(lobbyId).emit('chestOpened', chestId);
        });

        // Spectator camera target
        socket.on('spectateNext', () => {
            const lobbyId = playerLobbies[socket.id];
            if (!lobbyId || !lobbies[lobbyId]) return;
            const lobby = lobbies[lobbyId];
            const alive = Object.values(lobby.players).filter(p => !p.dead);
            if (alive.length > 0) {
                const targetIdx = Math.floor(Math.random() * alive.length);
                socket.emit('spectateTarget', alive[targetIdx].id);
            }
        });

        socket.on('disconnect', () => {
            console.log('[Battle Royale] User disconnected:', socket.id);
            leaveLobby(socket);
        });

        // --- Helper Functions ---
        function joinLobby(socket, lobbyId) {
            const lobby = lobbies[lobbyId];
            if (!lobby) return;
            leaveLobby(socket);

            socket.join(lobbyId);
            playerLobbies[socket.id] = lobbyId;

            const pIndex = Object.keys(lobby.players).length;
            lobby.players[socket.id] = {
                id: socket.id,
                isReady: false,
                color: PLAYER_COLORS[pIndex % PLAYER_COLORS.length],
                x: 0, y: 0,
                health: 100,
                shield: 0,
                weapon: 'pistol',
                ammo: Infinity,
                dead: false,
                kills: 0,
                input: { up: false, down: false, left: false, right: false },
                aimAngle: 0,
                lastShotTime: 0,
                placement: 0
            };

            socket.emit('lobbyJoined', lobbyId);
            broadcastLobbyState(lobbyId);
            broadcastActiveLobbies();
        }

        function leaveLobby(socket) {
            const lobbyId = playerLobbies[socket.id];
            if (!lobbyId || !lobbies[lobbyId]) return;

            const lobby = lobbies[lobbyId];
            const wasPlaying = lobby.gameState === 'playing' && lobby.players[socket.id] && !lobby.players[socket.id].dead;

            delete lobby.players[socket.id];
            delete playerLobbies[socket.id];
            socket.leave(lobbyId);
            socket.emit('lobbyLeft');

            if (Object.keys(lobby.players).length === 0) {
                stopGameLoop(lobbyId);
                delete lobbies[lobbyId];
                broadcastActiveLobbies();
                return;
            }

            if (lobby.creatorId === socket.id) {
                lobby.creatorId = Object.keys(lobby.players)[0];
            }

            if (wasPlaying) {
                lobby.aliveCount--;
                nsp.to(lobbyId).emit('playerDisconnected', socket.id);
                if (lobby.aliveCount <= 1) {
                    const winner = Object.values(lobby.players).find(p => !p.dead);
                    triggerGameOver(lobbyId, winner ? winner.id : null);
                }
            } else {
                nsp.to(lobbyId).emit('playerDisconnected', socket.id);
                broadcastLobbyState(lobbyId);
            }
            broadcastActiveLobbies();
        }

        function startGame(lobbyId) {
            const lobby = lobbies[lobbyId];
            if (!lobby) return;

            lobby.gameState = 'playing';
            lobby.grid = generateMap();
            lobby.chests = generateLootChests(lobby.grid);
            lobby.bullets = {};
            lobby.aliveCount = Object.keys(lobby.players).length;
            lobby.lastZoneDamageTick = Date.now();

            // Zone starts covering the whole map
            lobby.zone = {
                x: MAP_SIZE / 2,
                y: MAP_SIZE / 2,
                radius: MAP_SIZE * 0.6
            };
            lobby.zoneShrinking = false;
            lobby.zonePhase = 0;

            // Spawn players
            const pKeys = Object.keys(lobby.players);
            pKeys.forEach((id, i) => {
                const spawn = findSpawnPoint(lobby.grid, lobby.players);
                lobby.players[id].x = spawn.x;
                lobby.players[id].y = spawn.y;
                lobby.players[id].health = 100;
                lobby.players[id].shield = 0;
                lobby.players[id].weapon = 'pistol';
                lobby.players[id].ammo = Infinity;
                lobby.players[id].dead = false;
                lobby.players[id].kills = 0;
                lobby.players[id].lastShotTime = 0;
                lobby.players[id].placement = 0;
                lobby.players[id].color = PLAYER_COLORS[i % PLAYER_COLORS.length];
            });

            nsp.to(lobbyId).emit('gameStart', {
                grid: lobby.grid,
                chests: Object.values(lobby.chests),
                players: Object.fromEntries(
                    pKeys.map(id => [id, {
                        x: lobby.players[id].x,
                        y: lobby.players[id].y,
                        color: lobby.players[id].color
                    }])
                ),
                mapSize: MAP_SIZE,
                tileSize: TILE_SIZE,
                zone: lobby.zone
            });

            broadcastActiveLobbies();
            startGameLoop(lobbyId);
            scheduleZoneShrink(lobbyId);
        }
    });
};
