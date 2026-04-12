const { v4: uuidv4 } = require('uuid');

module.exports = function (io) {
    const nsp = io.of('/brawler');
    const arenaDB = io.arenaDB;

    const lobbies = {};
    const playerLobbies = {};

    // ─── Constants ─────────────────────────────────────────────
    const GAME_WIDTH = 800;
    const GAME_HEIGHT = 600;
    const GRAVITY = 0.55;
    const TERMINAL_VEL = 14;
    const JUMP_VEL = -12;
    const DOUBLE_JUMP_VEL = -10;
    const MOVE_SPEED = 4.5;
    const AIR_SPEED = 3.5;
    const FRICTION = 0.85;
    const AIR_FRICTION = 0.95;

    const PLAYER_W = 28;
    const PLAYER_H = 36;
    const MAX_STOCKS = 3;

    // Blast zones (KO boundaries)
    const BLAST_LEFT = -120;
    const BLAST_RIGHT = GAME_WIDTH + 120;
    const BLAST_TOP = -150;
    const BLAST_BOTTOM = GAME_HEIGHT + 100;

    // Attack data
    const ATTACKS = {
        light: {
            damage: 8,
            baseKnockback: 3,
            knockbackGrowth: 0.12,
            range: 40,
            startup: 3,    // frames
            active: 4,
            endlag: 6,
            hitstun: 12
        },
        heavy: {
            damage: 18,
            baseKnockback: 8,
            knockbackGrowth: 0.25,
            range: 50,
            startup: 8,
            active: 5,
            endlag: 14,
            hitstun: 20
        },
        aerial: {
            damage: 12,
            baseKnockback: 5,
            knockbackGrowth: 0.18,
            range: 45,
            startup: 4,
            active: 4,
            endlag: 10,
            hitstun: 15
        },
        upSpecial: {
            damage: 14,
            baseKnockback: 9,
            knockbackGrowth: 0.2,
            range: 35,
            startup: 5,
            active: 6,
            endlag: 20,
            hitstun: 18,
            launchAngle: -Math.PI / 2  // straight up
        }
    };

    // Platforms (stage layout)
    const STAGES = [
        {
            name: 'Battlefield',
            platforms: [
                // Main stage
                { x: 150, y: 420, w: 500, h: 30, type: 'solid' },
                // Floating platforms
                { x: 200, y: 300, w: 120, h: 12, type: 'passthrough' },
                { x: 480, y: 300, w: 120, h: 12, type: 'passthrough' },
                { x: 340, y: 200, w: 120, h: 12, type: 'passthrough' }
            ],
            spawns: [
                { x: 250, y: 380 },
                { x: 550, y: 380 },
                { x: 350, y: 160 },
                { x: 450, y: 160 }
            ]
        },
        {
            name: 'Final Destination',
            platforms: [
                { x: 120, y: 400, w: 560, h: 35, type: 'solid' }
            ],
            spawns: [
                { x: 250, y: 360 },
                { x: 550, y: 360 },
                { x: 350, y: 360 },
                { x: 450, y: 360 }
            ]
        },
        {
            name: 'Sky Towers',
            platforms: [
                { x: 80, y: 460, w: 200, h: 25, type: 'solid' },
                { x: 520, y: 460, w: 200, h: 25, type: 'solid' },
                { x: 300, y: 350, w: 200, h: 25, type: 'solid' },
                { x: 150, y: 240, w: 130, h: 12, type: 'passthrough' },
                { x: 520, y: 240, w: 130, h: 12, type: 'passthrough' },
                { x: 335, y: 140, w: 130, h: 12, type: 'passthrough' }
            ],
            spawns: [
                { x: 180, y: 420 },
                { x: 620, y: 420 },
                { x: 400, y: 310 },
                { x: 400, y: 100 }
            ]
        }
    ];

    const PLAYER_COLORS = [
        { body: '#ff4466', outline: '#cc2244' },
        { body: '#44aaff', outline: '#2288dd' },
        { body: '#66ff66', outline: '#44cc44' },
        { body: '#ffcc44', outline: '#ddaa22' }
    ];

    // ─── Helpers ───────────────────────────────────────────────
    function broadcastLobbyState(lobbyId) {
        const lobby = lobbies[lobbyId];
        if (!lobby) return;

        nsp.to(lobbyId).emit('lobbyState', {
            id: lobby.id,
            name: lobby.name,
            creatorId: lobby.creatorId,
            players: Object.values(lobby.players).map(p => ({
                id: p.id,
                isReady: p.isReady,
                color: p.color,
                stocks: p.stocks,
                damage: p.damage
            })),
            gameState: lobby.gameState,
            selectedStage: lobby.selectedStage,
            stages: STAGES.map((s, i) => ({ index: i, name: s.name }))
        });
    }

    function broadcastActiveLobbies() {
        const publicLobbies = Object.values(lobbies).map(l => ({
            id: l.id,
            name: l.name,
            playerCount: Object.keys(l.players).length,
            gameState: l.gameState
        }));
        nsp.emit('activeLobbies', publicLobbies);
    }

    function rectOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
        return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
    }

    // ─── Physics ──────────────────────────────────────────────
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
    }

    function respawnPlayer(lobby, player) {
        const stage = STAGES[lobby.selectedStage];
        const spawn = stage.spawns[Math.floor(Math.random() * stage.spawns.length)];
        player.x = spawn.x;
        player.y = spawn.y;
        player.vx = 0;
        player.vy = 0;
        player.damage = 0;
        player.hitstun = 0;
        player.attackFrame = 0;
        player.currentAttack = null;
        player.invincible = 90; // 1.5 seconds of invincibility after respawn
        player.jumpsLeft = 2;
        player.onGround = false;
        player.facingRight = true;
    }

    function applyKnockback(attacker, target, attack, direction) {
        const dmgPercent = target.damage;
        const knockbackMag = attack.baseKnockback + dmgPercent * attack.knockbackGrowth;

        let kbAngle;
        if (attack.launchAngle !== undefined) {
            kbAngle = attack.launchAngle;
        } else {
            // Launch diagonally upward in the direction of the hit
            kbAngle = direction > 0 ? -Math.PI / 4 : -3 * Math.PI / 4;
        }

        target.vx = Math.cos(kbAngle) * knockbackMag;
        target.vy = Math.sin(kbAngle) * knockbackMag;
        target.hitstun = attack.hitstun;
        target.damage += attack.damage;

        // Emit hit effect
        nsp.to(attacker.lobbyId).emit('hitEffect', {
            x: target.x + PLAYER_W / 2,
            y: target.y + PLAYER_H / 2,
            magnitude: knockbackMag,
            attackType: attacker.currentAttack
        });
    }

    function updatePhysics(lobbyId) {
        const lobby = lobbies[lobbyId];
        if (!lobby || lobby.gameState !== 'playing') return;

        const stage = STAGES[lobby.selectedStage];
        const platforms = stage.platforms;
        const playerKeys = Object.keys(lobby.players);

        for (const pid of playerKeys) {
            const p = lobby.players[pid];
            if (p.stocks <= 0) continue;

            // Invincibility countdown
            if (p.invincible > 0) p.invincible--;

            // Hitstun countdown
            if (p.hitstun > 0) {
                p.hitstun--;
                // During hitstun, can't control character
            } else {
                // Process input
                const isGrounded = p.onGround;
                const moveSpeed = isGrounded ? MOVE_SPEED : AIR_SPEED;

                if (p.input.left) {
                    p.vx -= moveSpeed * 0.3;
                    p.facingRight = false;
                }
                if (p.input.right) {
                    p.vx += moveSpeed * 0.3;
                    p.facingRight = true;
                }

                // Jump
                if (p.input.jump && !p.jumpHeld) {
                    if (p.onGround) {
                        p.vy = JUMP_VEL;
                        p.onGround = false;
                        p.jumpsLeft = 1; // one double jump left
                    } else if (p.jumpsLeft > 0) {
                        p.vy = DOUBLE_JUMP_VEL;
                        p.jumpsLeft--;
                    }
                }
                p.jumpHeld = p.input.jump;

                // Attacks
                if (p.attackFrame <= 0 && !p.currentAttack) {
                    if (p.input.lightAttack && !p.lightHeld) {
                        p.currentAttack = p.onGround ? 'light' : 'aerial';
                        p.attackFrame = ATTACKS[p.currentAttack].startup + ATTACKS[p.currentAttack].active + ATTACKS[p.currentAttack].endlag;
                        p.attackPhase = 'startup';
                        p.attackTimer = ATTACKS[p.currentAttack].startup;
                    } else if (p.input.heavyAttack && !p.heavyHeld) {
                        p.currentAttack = 'heavy';
                        p.attackFrame = ATTACKS.heavy.startup + ATTACKS.heavy.active + ATTACKS.heavy.endlag;
                        p.attackPhase = 'startup';
                        p.attackTimer = ATTACKS.heavy.startup;
                    } else if (p.input.special && !p.specialHeld) {
                        p.currentAttack = 'upSpecial';
                        p.attackFrame = ATTACKS.upSpecial.startup + ATTACKS.upSpecial.active + ATTACKS.upSpecial.endlag;
                        p.attackPhase = 'startup';
                        p.attackTimer = ATTACKS.upSpecial.startup;
                        // Up special gives vertical boost
                        p.vy = -8;
                    }
                    p.lightHeld = p.input.lightAttack;
                    p.heavyHeld = p.input.heavyAttack;
                    p.specialHeld = p.input.special;
                } else {
                    p.lightHeld = p.input.lightAttack;
                    p.heavyHeld = p.input.heavyAttack;
                    p.specialHeld = p.input.special;
                }
            }

            // Attack frame processing
            if (p.currentAttack && p.attackFrame > 0) {
                p.attackTimer--;
                p.attackFrame--;

                const atk = ATTACKS[p.currentAttack];
                if (p.attackPhase === 'startup' && p.attackTimer <= 0) {
                    p.attackPhase = 'active';
                    p.attackTimer = atk.active;
                } else if (p.attackPhase === 'active' && p.attackTimer <= 0) {
                    p.attackPhase = 'endlag';
                    p.attackTimer = atk.endlag;
                } else if (p.attackPhase === 'endlag' && p.attackTimer <= 0) {
                    p.currentAttack = null;
                    p.attackPhase = null;
                }

                // Hit detection during active frames
                if (p.attackPhase === 'active' && p.attackTimer === atk.active) {
                    const hitbox = {
                        x: p.facingRight ? p.x + PLAYER_W : p.x - atk.range,
                        y: p.y - 5,
                        w: atk.range,
                        h: PLAYER_H + 10
                    };

                    // Up special has vertical hitbox
                    if (p.currentAttack === 'upSpecial') {
                        hitbox.x = p.x - 10;
                        hitbox.y = p.y - atk.range;
                        hitbox.w = PLAYER_W + 20;
                        hitbox.h = atk.range;
                    }

                    for (const tid of playerKeys) {
                        if (tid === pid) continue;
                        const t = lobby.players[tid];
                        if (t.stocks <= 0 || t.invincible > 0) continue;

                        if (rectOverlap(hitbox.x, hitbox.y, hitbox.w, hitbox.h,
                            t.x, t.y, PLAYER_W, PLAYER_H)) {
                            const dir = p.facingRight ? 1 : -1;
                            p.lobbyId = lobbyId;
                            applyKnockback(p, t, atk, dir);
                        }
                    }
                }
            }

            // Gravity
            p.vy += GRAVITY;
            if (p.vy > TERMINAL_VEL) p.vy = TERMINAL_VEL;

            // Friction
            if (p.onGround) {
                p.vx *= FRICTION;
            } else {
                p.vx *= AIR_FRICTION;
            }

            // Clamp horizontal speed
            if (Math.abs(p.vx) > MOVE_SPEED * 1.5 && p.hitstun <= 0) {
                p.vx = Math.sign(p.vx) * MOVE_SPEED * 1.5;
            }

            if (Math.abs(p.vx) < 0.1) p.vx = 0;

            // Move X
            p.x += p.vx;
            p.onGround = false;

            // Platform collision X (solid only)
            for (const plat of platforms) {
                if (plat.type !== 'solid') continue;
                if (rectOverlap(p.x, p.y, PLAYER_W, PLAYER_H, plat.x, plat.y, plat.w, plat.h)) {
                    if (p.vx > 0) {
                        p.x = plat.x - PLAYER_W;
                    } else if (p.vx < 0) {
                        p.x = plat.x + plat.w;
                    }
                    if (p.hitstun <= 0) p.vx = 0;
                }
            }

            // Move Y
            p.y += p.vy;

            // Platform collision Y
            for (const plat of platforms) {
                if (rectOverlap(p.x, p.y, PLAYER_W, PLAYER_H, plat.x, plat.y, plat.w, plat.h)) {
                    if (plat.type === 'passthrough') {
                        // Only collide from above
                        if (p.vy > 0) {
                            const prevBottom = p.y + PLAYER_H - p.vy;
                            if (prevBottom <= plat.y + 4) {
                                p.y = plat.y - PLAYER_H;
                                p.vy = 0;
                                p.onGround = true;
                                p.jumpsLeft = 2;
                            }
                        }
                    } else {
                        // Solid platform
                        if (p.vy > 0) {
                            p.y = plat.y - PLAYER_H;
                            p.vy = 0;
                            p.onGround = true;
                            p.jumpsLeft = 2;
                        } else if (p.vy < 0) {
                            p.y = plat.y + plat.h;
                            p.vy = 0;
                        }
                    }
                }
            }

            // Blast zone check
            if (p.x + PLAYER_W < BLAST_LEFT || p.x > BLAST_RIGHT ||
                p.y + PLAYER_H < BLAST_TOP || p.y > BLAST_BOTTOM) {
                // KO!
                p.stocks--;
                nsp.to(lobbyId).emit('playerKO', {
                    id: pid,
                    stocksLeft: p.stocks,
                    x: p.x,
                    y: p.y
                });

                if (p.stocks > 0) {
                    respawnPlayer(lobby, p);
                }
            }
        }

        // Check game over
        const alive = playerKeys.filter(id => lobby.players[id].stocks > 0);
        if (alive.length <= 1 && playerKeys.length >= 2) {
            const winnerId = alive.length === 1 ? alive[0] : null;
            const results = playerKeys.map(id => ({
                id,
                stocks: lobby.players[id].stocks,
                damage: lobby.players[id].damage,
                color: lobby.players[id].color
            })).sort((a, b) => b.stocks - a.stocks);

            nsp.to(lobbyId).emit('gameOver', { winnerId, results });
            stopGameLoop(lobbyId);
            lobby.gameState = 'gameover';
            broadcastActiveLobbies();

            // Award coins
            if (arenaDB) {
                results.forEach(r => {
                    const username = io.getUsernameBySocketId ? io.getUsernameBySocketId(r.id) : null;
                    if (!username) return;
                    const isWinner = r.id === winnerId;
                    arenaDB.awardCoins(username, isWinner ? 25 : 10, isWinner ? 'Brawl Victory' : 'Brawl Played', 'brawler');
                    arenaDB.recordGameResult(username, 'brawler', isWinner);
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
            }, 6000);
            return;
        }

        // Broadcast game state (throttled to every 2nd frame ~ 30fps)
        lobby.frameCount = (lobby.frameCount || 0) + 1;
        if (lobby.frameCount % 2 === 0) {
            const gameState = {};
            for (const pid of playerKeys) {
                const p = lobby.players[pid];
                gameState[pid] = {
                    x: Math.round(p.x * 10) / 10,
                    y: Math.round(p.y * 10) / 10,
                    vx: Math.round(p.vx * 10) / 10,
                    vy: Math.round(p.vy * 10) / 10,
                    damage: p.damage,
                    stocks: p.stocks,
                    facingRight: p.facingRight,
                    onGround: p.onGround,
                    currentAttack: p.currentAttack,
                    attackPhase: p.attackPhase,
                    invincible: p.invincible > 0,
                    color: p.color
                };
            }
            nsp.to(lobbyId).emit('gameStateUpdate', gameState);
        }
    }

    // ─── Socket Handlers ──────────────────────────────────────
    nsp.on('connection', (socket) => {
        console.log('[Brawler] User connected:', socket.id);
        broadcastActiveLobbies();

        socket.on('createLobby', () => {
            const lobbyId = uuidv4().substring(0, 8);
            lobbies[lobbyId] = {
                id: lobbyId,
                name: `${socket.id.substring(0, 4)}'s Brawl`,
                creatorId: socket.id,
                players: {},
                gameState: 'lobby',
                gameLoopInterval: null,
                selectedStage: 0,
                frameCount: 0
            };
            joinLobby(socket, lobbyId);
            broadcastActiveLobbies();
        });

        socket.on('joinLobby', (lobbyId) => {
            if (lobbies[lobbyId] && lobbies[lobbyId].gameState === 'lobby') {
                if (Object.keys(lobbies[lobbyId].players).length < 4) {
                    joinLobby(socket, lobbyId);
                } else {
                    socket.emit('lobbyError', 'Lobby is full (max 4 players).');
                }
            } else {
                socket.emit('lobbyError', 'Lobby not found or game already in progress.');
            }
        });

        socket.on('leaveLobby', () => leaveLobby(socket));

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

        socket.on('selectStage', (stageIndex) => {
            const lobbyId = playerLobbies[socket.id];
            if (!lobbyId || !lobbies[lobbyId]) return;
            const lobby = lobbies[lobbyId];
            if (lobby.creatorId === socket.id && lobby.gameState === 'lobby') {
                const idx = parseInt(stageIndex);
                if (idx >= 0 && idx < STAGES.length) {
                    lobby.selectedStage = idx;
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
                    jump: !!inputData.jump,
                    lightAttack: !!inputData.lightAttack,
                    heavyAttack: !!inputData.heavyAttack,
                    special: !!inputData.special
                };
            }
        });

        socket.on('disconnect', () => {
            console.log('[Brawler] User disconnected:', socket.id);
            leaveLobby(socket);
        });

        function joinLobby(socket, lobbyId) {
            const lobby = lobbies[lobbyId];
            if (!lobby) return;
            leaveLobby(socket);

            socket.join(lobbyId);
            playerLobbies[socket.id] = lobbyId;

            const playerIndex = Object.keys(lobby.players).length;

            lobby.players[socket.id] = {
                id: socket.id,
                color: PLAYER_COLORS[playerIndex % PLAYER_COLORS.length],
                isReady: false,
                stocks: MAX_STOCKS,
                damage: 0,
                x: 400,
                y: 300,
                vx: 0,
                vy: 0,
                facingRight: true,
                onGround: false,
                jumpsLeft: 2,
                hitstun: 0,
                invincible: 0,
                currentAttack: null,
                attackPhase: null,
                attackFrame: 0,
                attackTimer: 0,
                jumpHeld: false,
                lightHeld: false,
                heavyHeld: false,
                specialHeld: false,
                input: { left: false, right: false, jump: false, lightAttack: false, heavyAttack: false, special: false }
            };

            socket.emit('lobbyJoined', lobbyId);
            broadcastLobbyState(lobbyId);
            broadcastActiveLobbies();
        }

        function leaveLobby(socket) {
            const lobbyId = playerLobbies[socket.id];
            if (!lobbyId || !lobbies[lobbyId]) return;

            const lobby = lobbies[lobbyId];
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

            // Check if game should end
            if (lobby.gameState === 'playing') {
                const alive = Object.keys(lobby.players).filter(id => lobby.players[id].stocks > 0);
                if (alive.length <= 1) {
                    const winnerId = alive.length === 1 ? alive[0] : null;
                    nsp.to(lobbyId).emit('gameOver', { winnerId, results: [] });
                    stopGameLoop(lobbyId);
                    lobby.gameState = 'gameover';
                }
            }

            nsp.to(lobbyId).emit('playerDisconnected', socket.id);
            broadcastLobbyState(lobbyId);
            broadcastActiveLobbies();
        }

        function startGame(lobbyId) {
            const lobby = lobbies[lobbyId];
            if (!lobby) return;

            lobby.gameState = 'playing';
            const stage = STAGES[lobby.selectedStage];
            const playerKeys = Object.keys(lobby.players);

            playerKeys.forEach((id, i) => {
                const spawn = stage.spawns[i % stage.spawns.length];
                const p = lobby.players[id];
                p.stocks = MAX_STOCKS;
                p.damage = 0;
                p.x = spawn.x;
                p.y = spawn.y;
                p.vx = 0;
                p.vy = 0;
                p.facingRight = i % 2 === 0;
                p.onGround = false;
                p.jumpsLeft = 2;
                p.hitstun = 0;
                p.invincible = 60;
                p.currentAttack = null;
                p.attackPhase = null;
                p.attackFrame = 0;
                p.attackTimer = 0;
                p.jumpHeld = false;
                p.lightHeld = false;
                p.heavyHeld = false;
                p.specialHeld = false;
            });

            nsp.to(lobbyId).emit('gameStart', {
                stage: stage,
                stageIndex: lobby.selectedStage,
                players: Object.fromEntries(
                    playerKeys.map(id => [id, {
                        x: lobby.players[id].x,
                        y: lobby.players[id].y,
                        color: lobby.players[id].color,
                        stocks: lobby.players[id].stocks
                    }])
                )
            });

            broadcastActiveLobbies();
            startGameLoop(lobbyId);
        }
    });
};
