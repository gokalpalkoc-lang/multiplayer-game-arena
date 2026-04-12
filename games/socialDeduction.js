const { v4: uuidv4 } = require('uuid');

module.exports = function(io) {
    const nsp = io.of('/social-deduction');
    const arenaDB = io.arenaDB;

    const lobbies = {};
    const playerLobbies = {};

    // --- Constants ---
    const MAP_W = 1200, MAP_H = 900;
    const PLAYER_SPEED = 2.8;
    const PLAYER_RADIUS = 14;
    const KILL_RANGE = 60;
    const KILL_COOLDOWN = 30000;      // 30s between kills
    const REPORT_RANGE = 80;
    const VISION_RADIUS = 180;
    const IMPOSTOR_VISION = 240;
    const SABOTAGED_VISION = 60;      // Crew vision during lights-out
    const MEETING_DISCUSSION = 45000; // 45s discussion
    const MEETING_VOTING = 20000;     // 20s voting
    const SABOTAGE_COOLDOWN = 25000;
    const SABOTAGE_DURATION = 30000;
    const MAX_PLAYERS = 10;
    const MIN_PLAYERS = 2;            // Lowered for testing (set to 4 for production)
    const VENT_RANGE = 40;

    // --- Map: rooms and corridors ---
    const ROOMS = [
        { id: 'cafeteria',  name: 'Cafeteria',  x: 500, y: 100, w: 200, h: 150, color: '#2a3a2a' },
        { id: 'medbay',     name: 'MedBay',     x: 100, y: 100, w: 160, h: 130, color: '#2a2a3a' },
        { id: 'electrical', name: 'Electrical',  x: 100, y: 400, w: 150, h: 140, color: '#3a2a2a' },
        { id: 'engine',     name: 'Engine Room', x: 100, y: 680, w: 170, h: 140, color: '#2a2a2a' },
        { id: 'weapons',    name: 'Weapons',     x: 800, y: 100, w: 160, h: 130, color: '#3a3a2a' },
        { id: 'navigation', name: 'Navigation',  x: 900, y: 400, w: 170, h: 150, color: '#2a303a' },
        { id: 'shields',    name: 'Shields',     x: 850, y: 680, w: 150, h: 130, color: '#302a3a' },
        { id: 'storage',    name: 'Storage',     x: 500, y: 680, w: 180, h: 140, color: '#2a2a30' },
        { id: 'admin',      name: 'Admin',       x: 500, y: 400, w: 180, h: 150, color: '#303030' },
    ];

    // Walls (rectangular obstacles)
    const WALLS = [
        // Corridors between rooms (walls that form hallways)
        { x: 270, y: 80,  w: 220, h: 20 },
        { x: 270, y: 250, w: 220, h: 20 },
        { x: 710, y: 80,  w: 80,  h: 20 },
        { x: 710, y: 250, w: 80,  h: 20 },
        { x: 80,  y: 250, w: 20,  h: 140 },
        { x: 260, y: 250, w: 20,  h: 140 },
        { x: 80,  y: 550, w: 20,  h: 120 },
        { x: 260, y: 550, w: 20,  h: 120 },
        { x: 690, y: 250, w: 20,  h: 140 },
        { x: 970, y: 250, w: 20,  h: 140 },
        { x: 690, y: 560, w: 20,  h: 110 },
        { x: 280, y: 560, w: 210, h: 20 },
        { x: 280, y: 830, w: 210, h: 20 },
        { x: 690, y: 830, w: 250, h: 20 },
    ];

    // Vent locations — paired for impostor teleportation
    const VENTS = [
        { id: 'vent_cafe',   x: 560, y: 200, room: 'cafeteria',  pairedTo: 'vent_admin' },
        { id: 'vent_admin',  x: 560, y: 460, room: 'admin',      pairedTo: 'vent_cafe' },
        { id: 'vent_elec',   x: 180, y: 480, room: 'electrical',  pairedTo: 'vent_engine' },
        { id: 'vent_engine', x: 180, y: 740, room: 'engine',     pairedTo: 'vent_elec' },
        { id: 'vent_weapons',x: 860, y: 180, room: 'weapons',    pairedTo: 'vent_nav' },
        { id: 'vent_nav',    x: 960, y: 460, room: 'navigation', pairedTo: 'vent_weapons' },
        { id: 'vent_shields',x: 910, y: 730, room: 'shields',    pairedTo: 'vent_storage' },
        { id: 'vent_storage',x: 560, y: 730, room: 'storage',    pairedTo: 'vent_shields' },
    ];

    // Sabotage fix locations
    const SABOTAGE_FIX_LOCATIONS = {
        lights:  { x: 175, y: 470, room: 'electrical', range: 60 },
        reactor: { x: 160, y: 730, room: 'engine',     range: 60 },
        comms:   { x: 560, y: 450, room: 'admin',      range: 60 },
    };

    // Task locations
    const TASK_LOCATIONS = [
        { id: 'wires_elec',   room: 'electrical', x: 150, y: 450, name: 'Fix Wiring',       type: 'wires' },
        { id: 'scan_medbay',  room: 'medbay',     x: 160, y: 150, name: 'Submit Scan',       type: 'scan' },
        { id: 'swipe_admin',  room: 'admin',      x: 560, y: 450, name: 'Swipe Card',        type: 'swipe' },
        { id: 'upload_cafe',  room: 'cafeteria',  x: 580, y: 150, name: 'Upload Data',       type: 'upload' },
        { id: 'chart_nav',    room: 'navigation', x: 960, y: 450, name: 'Chart Course',      type: 'chart' },
        { id: 'calibrate_wep',room: 'weapons',    x: 860, y: 150, name: 'Calibrate Weapons', type: 'calibrate' },
        { id: 'fuel_engine',  room: 'engine',     x: 160, y: 730, name: 'Fuel Engines',      type: 'fuel' },
        { id: 'shields_fix',  room: 'shields',    x: 900, y: 720, name: 'Prime Shields',     type: 'shields' },
        { id: 'trash_storage',room: 'storage',    x: 560, y: 730, name: 'Empty Garbage',     type: 'trash' },
        { id: 'wires_nav',    room: 'navigation', x: 980, y: 510, name: 'Fix Wiring',        type: 'wires' },
        { id: 'divert_elec',  room: 'electrical', x: 200, y: 500, name: 'Divert Power',      type: 'divert' },
    ];

    const PLAYER_COLORS = [
        '#ff4466', '#4488ff', '#44ff88', '#ffcc00', '#ff44ff',
        '#44ffff', '#ff8844', '#88ff44', '#ff8888', '#8888ff'
    ];

    // --- Helpers ---
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
            gameState: lobby.gameState,
            settings: lobby.settings
        });
    }

    function broadcastActiveLobbies() {
        const list = Object.values(lobbies).map(l => ({
            id: l.id, name: l.name,
            playerCount: Object.keys(l.players).length,
            gameState: l.gameState
        }));
        nsp.emit('activeLobbies', list);
    }

    function assignRoles(lobby) {
        const pIds = Object.keys(lobby.players);
        const numImpostors = pIds.length >= 7 ? 2 : 1;

        // Shuffle and pick impostors
        const shuffled = [...pIds].sort(() => Math.random() - 0.5);
        shuffled.forEach((id, i) => {
            lobby.players[id].role = i < numImpostors ? 'impostor' : 'crew';
        });
    }

    function assignTasks(lobby) {
        const pIds = Object.keys(lobby.players);
        const tasksPerPlayer = lobby.settings.tasksPerPlayer || 4;

        pIds.forEach(id => {
            const p = lobby.players[id];
            if (p.role === 'impostor') {
                // Impostors get fake tasks for appearance
                p.tasks = [];
                return;
            }
            // Shuffle tasks and assign a subset
            const shuffled = [...TASK_LOCATIONS].sort(() => Math.random() - 0.5);
            p.tasks = shuffled.slice(0, tasksPerPlayer).map(t => ({
                ...t,
                completed: false
            }));
        });

        // Calculate total tasks
        lobby.totalTasks = 0;
        lobby.completedTasks = 0;
        pIds.forEach(id => {
            if (lobby.players[id].role === 'crew') {
                lobby.totalTasks += lobby.players[id].tasks.length;
            }
        });
    }

    function spawnPlayers(lobby) {
        const cafe = ROOMS.find(r => r.id === 'cafeteria');
        const pIds = Object.keys(lobby.players);
        pIds.forEach((id, i) => {
            const angle = (i / pIds.length) * Math.PI * 2;
            lobby.players[id].x = cafe.x + cafe.w / 2 + Math.cos(angle) * 50;
            lobby.players[id].y = cafe.y + cafe.h / 2 + Math.sin(angle) * 50;
            lobby.players[id].dead = false;
            lobby.players[id].lastKillTime = 0;
            lobby.players[id].inVent = false;
            lobby.players[id].facingRight = true;
            lobby.players[id].input = { up: false, down: false, left: false, right: false };
        });
    }

    function getAlivePlayers(lobby) {
        return Object.values(lobby.players).filter(p => !p.dead);
    }

    function getAliveByRole(lobby, role) {
        return Object.values(lobby.players).filter(p => !p.dead && p.role === role);
    }

    function checkWinCondition(lobbyId) {
        const lobby = lobbies[lobbyId];
        if (!lobby || lobby.gameState !== 'playing') return;

        const aliveCrew = getAliveByRole(lobby, 'crew');
        const aliveImpostors = getAliveByRole(lobby, 'impostor');

        // Impostors win if they equal or outnumber crew
        if (aliveImpostors.length >= aliveCrew.length) {
            endGame(lobbyId, 'impostor', 'Impostors outnumber the crew!');
            return;
        }

        // Crew wins if all impostors are ejected
        if (aliveImpostors.length === 0) {
            endGame(lobbyId, 'crew', 'All impostors have been ejected!');
            return;
        }

        // Crew wins if all tasks are completed
        if (lobby.completedTasks >= lobby.totalTasks && lobby.totalTasks > 0) {
            endGame(lobbyId, 'crew', 'All tasks completed!');
            return;
        }
    }

    function endGame(lobbyId, winnerRole, reason) {
        const lobby = lobbies[lobbyId];
        if (!lobby) return;

        stopGameLoop(lobbyId);
        lobby.gameState = 'gameover';

        const results = Object.values(lobby.players).map(p => ({
            id: p.id,
            color: p.color,
            role: p.role,
            dead: p.dead,
            tasksCompleted: p.tasks ? p.tasks.filter(t => t.completed).length : 0
        }));

        nsp.to(lobbyId).emit('gameOver', {
            winnerRole,
            reason,
            results
        });

        // Award coins
        if (arenaDB) {
            Object.values(lobby.players).forEach(p => {
                const username = io.getUsernameBySocketId ? io.getUsernameBySocketId(p.id) : null;
                if (!username) return;
                const won = p.role === winnerRole;
                const coins = won ? 25 : 8;
                arenaDB.awardCoins(username, coins, won ? `${winnerRole} victory` : 'Defeated', 'social-deduction');
                arenaDB.recordGameResult(username, 'social-deduction', won);
            });
        }

        setTimeout(() => {
            if (!lobbies[lobbyId]) return;
            lobby.gameState = 'lobby';
            Object.values(lobby.players).forEach(p => { p.isReady = false; });
            broadcastLobbyState(lobbyId);
            broadcastActiveLobbies();
            nsp.to(lobbyId).emit('resetToLobby');
        }, 10000);
    }

    // --- Meeting System ---
    function startMeeting(lobbyId, callerId, bodyId) {
        const lobby = lobbies[lobbyId];
        if (!lobby || lobby.gameState !== 'playing' || lobby.inMeeting) return;

        lobby.inMeeting = true;
        lobby.votes = {};
        lobby.meetingPhase = 'discussion';
        lobby.meetingCallerId = callerId;
        lobby.meetingBodyId = bodyId;

        // Clear sabotage
        if (lobby.sabotageActive) {
            lobby.sabotageActive = false;
            lobby.sabotageType = null;
            if (lobby.sabotageTimer) clearTimeout(lobby.sabotageTimer);
        }

        // Exit all players from vents
        Object.values(lobby.players).forEach(p => {
            p.inVent = false;
        });

        // Teleport all alive players to cafeteria
        const cafe = ROOMS.find(r => r.id === 'cafeteria');
        const alive = getAlivePlayers(lobby);
        alive.forEach((p, i) => {
            const angle = (i / alive.length) * Math.PI * 2;
            p.x = cafe.x + cafe.w / 2 + Math.cos(angle) * 50;
            p.y = cafe.y + cafe.h / 2 + Math.sin(angle) * 50;
        });

        // Remove bodies
        lobby.bodies = {};

        nsp.to(lobbyId).emit('meetingStart', {
            callerId,
            bodyId,
            callerColor: lobby.players[callerId]?.color,
            type: bodyId ? 'report' : 'emergency',
            alivePlayers: alive.map(p => ({ id: p.id, color: p.color })),
            discussionTime: MEETING_DISCUSSION,
            votingTime: MEETING_VOTING
        });

        // After discussion, switch to voting
        lobby.meetingTimer = setTimeout(() => {
            if (!lobby.inMeeting) return;
            lobby.meetingPhase = 'voting';
            nsp.to(lobbyId).emit('meetingVotingStart');

            // After voting, tally
            lobby.meetingTimer = setTimeout(() => {
                tallyVotes(lobbyId);
            }, MEETING_VOTING);
        }, MEETING_DISCUSSION);
    }

    function tallyVotes(lobbyId) {
        const lobby = lobbies[lobbyId];
        if (!lobby || !lobby.inMeeting) return;

        const alive = getAlivePlayers(lobby);
        const voteCounts = {};
        let skipCount = 0;

        for (const voterId in lobby.votes) {
            const voteTarget = lobby.votes[voterId];
            if (voteTarget === 'skip') {
                skipCount++;
            } else {
                voteCounts[voteTarget] = (voteCounts[voteTarget] || 0) + 1;
            }
        }

        // Find highest vote count
        let maxVotes = skipCount;
        let ejectedId = null;

        for (const pid in voteCounts) {
            if (voteCounts[pid] > maxVotes) {
                maxVotes = voteCounts[pid];
                ejectedId = pid;
            } else if (voteCounts[pid] === maxVotes) {
                ejectedId = null; // Tie = no eject
            }
        }

        let ejectedRole = null;
        if (ejectedId && lobby.players[ejectedId]) {
            lobby.players[ejectedId].dead = true;
            ejectedRole = lobby.players[ejectedId].role;
        }

        nsp.to(lobbyId).emit('meetingResult', {
            ejectedId,
            ejectedColor: ejectedId ? lobby.players[ejectedId]?.color : null,
            ejectedRole: lobby.settings.confirmEjects ? ejectedRole : null,
            votes: lobby.votes,
            wasSkip: !ejectedId
        });

        lobby.inMeeting = false;
        lobby.votes = {};

        // Check win after ejection
        setTimeout(() => {
            if (lobbies[lobbyId] && lobby.gameState === 'playing') {
                checkWinCondition(lobbyId);
            }
        }, 3000);
    }

    // --- Game Loop ---
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
        if (lobby && lobby.meetingTimer) {
            clearTimeout(lobby.meetingTimer);
            lobby.meetingTimer = null;
        }
    }

    function updatePhysics(lobbyId) {
        const lobby = lobbies[lobbyId];
        if (!lobby || lobby.gameState !== 'playing' || lobby.inMeeting) return;

        const now = Date.now();

        // Player movement
        for (const pid in lobby.players) {
            const p = lobby.players[pid];
            if (p.dead || p.inVent) continue;

            let dx = 0, dy = 0;
            if (p.input.up) dy -= 1;
            if (p.input.down) dy += 1;
            if (p.input.left) dx -= 1;
            if (p.input.right) dx += 1;

            if (dx !== 0 || dy !== 0) {
                // Track facing direction
                if (dx !== 0) p.facingRight = dx > 0;

                const mag = Math.sqrt(dx * dx + dy * dy);
                dx = (dx / mag) * PLAYER_SPEED;
                dy = (dy / mag) * PLAYER_SPEED;

                const nx = p.x + dx;
                const ny = p.y + dy;

                // Basic wall collision
                let blocked = false;
                for (const wall of WALLS) {
                    if (nx + PLAYER_RADIUS > wall.x && nx - PLAYER_RADIUS < wall.x + wall.w &&
                        ny + PLAYER_RADIUS > wall.y && ny - PLAYER_RADIUS < wall.y + wall.h) {
                        blocked = true;
                        break;
                    }
                }

                if (!blocked) {
                    p.x = Math.max(PLAYER_RADIUS, Math.min(MAP_W - PLAYER_RADIUS, nx));
                    p.y = Math.max(PLAYER_RADIUS, Math.min(MAP_H - PLAYER_RADIUS, ny));
                }
            }
        }

        // Broadcast at 20fps
        lobby.frameCount++;
        if (lobby.frameCount % 3 === 0) {
            // Send each player a customized view (role-specific info)
            for (const pid in lobby.players) {
                const sock = nsp.sockets.get(pid);
                if (!sock) continue;

                const me = lobby.players[pid];

                // Calculate effective vision based on sabotage
                let effectiveVision;
                if (me.role === 'impostor') {
                    effectiveVision = IMPOSTOR_VISION; // Impostors unaffected by lights
                } else if (lobby.sabotageActive && lobby.sabotageType === 'lights') {
                    effectiveVision = SABOTAGED_VISION; // Crew has reduced vision during lights-out
                } else {
                    effectiveVision = VISION_RADIUS;
                }

                const playersView = {};

                for (const oid in lobby.players) {
                    const o = lobby.players[oid];
                    if (oid === pid) {
                        playersView[oid] = {
                            x: Math.round(o.x), y: Math.round(o.y),
                            color: o.color, dead: o.dead,
                            facingRight: o.facingRight !== false
                        };
                        continue;
                    }

                    // Skip players in vents (unless viewer is dead — ghosts see all)
                    if (o.inVent && !me.dead) continue;

                    // Visibility check — only show if within vision radius
                    const dist = Math.sqrt((me.x - o.x) ** 2 + (me.y - o.y) ** 2);

                    if (dist <= effectiveVision || me.dead) {
                        playersView[oid] = {
                            x: Math.round(o.x), y: Math.round(o.y),
                            color: o.color, dead: o.dead,
                            facingRight: o.facingRight !== false
                        };
                    }
                }

                // Bodies (always visible if in range or dead/spectating)
                const bodiesView = {};
                for (const bid in lobby.bodies) {
                    const b = lobby.bodies[bid];
                    const dist = Math.sqrt((me.x - b.x) ** 2 + (me.y - b.y) ** 2);
                    if (dist <= effectiveVision || me.dead) {
                        bodiesView[bid] = b;
                    }
                }

                // Kill cooldown for impostor
                let killCooldown = 0;
                if (me.role === 'impostor' && !me.dead) {
                    const elapsed = now - me.lastKillTime;
                    if (elapsed < lobby.settings.killCooldown) {
                        killCooldown = Math.ceil((lobby.settings.killCooldown - elapsed) / 1000);
                    }
                }

                // Check if near a vent (for impostor)
                let nearVent = null;
                if (me.role === 'impostor' && !me.dead) {
                    for (const vent of VENTS) {
                        const dist = Math.sqrt((me.x - vent.x) ** 2 + (me.y - vent.y) ** 2);
                        if (dist < VENT_RANGE) {
                            nearVent = vent.id;
                            break;
                        }
                    }
                }

                // Check if in cafeteria for emergency meeting
                const cafe = ROOMS.find(r => r.id === 'cafeteria');
                const inCafeteria = !me.dead && me.x >= cafe.x && me.x <= cafe.x + cafe.w && me.y >= cafe.y && me.y <= cafe.y + cafe.h;

                sock.emit('gameStateUpdate', {
                    players: playersView,
                    bodies: bodiesView,
                    taskProgress: lobby.totalTasks > 0 ? lobby.completedTasks / lobby.totalTasks : 0,
                    sabotageActive: lobby.sabotageActive || false,
                    sabotageType: lobby.sabotageType || null,
                    killCooldown,
                    nearVent,
                    inVent: me.inVent || false,
                    canMeeting: inCafeteria && (me.emergencyMeetingsLeft || 0) > 0,
                    effectiveVision
                });
            }
        }
    }

    // --- Socket Connection ---
    nsp.on('connection', (socket) => {
        console.log('[Social Deduction] User connected:', socket.id);
        broadcastActiveLobbies();

        socket.on('createLobby', () => {
            const lobbyId = uuidv4().substring(0, 8);
            lobbies[lobbyId] = {
                id: lobbyId,
                name: `${socket.id.substring(0, 4)}'s Game`,
                creatorId: socket.id,
                players: {},
                gameState: 'lobby',
                gameLoopInterval: null,
                bodies: {},
                votes: {},
                inMeeting: false,
                totalTasks: 0,
                completedTasks: 0,
                sabotageActive: false,
                sabotageType: null,
                lastSabotageTime: 0,
                settings: {
                    tasksPerPlayer: 4,
                    confirmEjects: true,
                    emergencyMeetings: 1,
                    killCooldown: KILL_COOLDOWN
                }
            };
            joinLobby(socket, lobbyId);
            broadcastActiveLobbies();
        });

        socket.on('joinLobby', (lobbyId) => {
            if (lobbies[lobbyId] && lobbies[lobbyId].gameState === 'lobby') {
                if (Object.keys(lobbies[lobbyId].players).length < MAX_PLAYERS) {
                    joinLobby(socket, lobbyId);
                } else {
                    socket.emit('lobbyError', 'Lobby is full.');
                }
            }
        });

        socket.on('leaveLobby', () => leaveLobby(socket));

        socket.on('toggleReady', () => {
            const lobbyId = playerLobbies[socket.id];
            if (!lobbyId || !lobbies[lobbyId]) return;
            const lobby = lobbies[lobbyId];
            if (lobby.players[socket.id] && lobby.gameState === 'lobby') {
                lobby.players[socket.id].isReady = !lobby.players[socket.id].isReady;
                broadcastLobbyState(lobbyId);

                const pKeys = Object.keys(lobby.players);
                if (pKeys.length >= MIN_PLAYERS && pKeys.every(id => lobby.players[id].isReady)) {
                    startGame(lobbyId);
                }
            }
        });

        // --- In-Game ---
        socket.on('input', (data) => {
            const lobbyId = playerLobbies[socket.id];
            if (!lobbyId || !lobbies[lobbyId]) return;
            const lobby = lobbies[lobbyId];
            const p = lobby.players[socket.id];
            if (!p || p.dead || lobby.gameState !== 'playing' || lobby.inMeeting || p.inVent) return;

            p.input = {
                up: !!data.up, down: !!data.down,
                left: !!data.left, right: !!data.right
            };
        });

        // Kill (impostors only)
        socket.on('kill', () => {
            const lobbyId = playerLobbies[socket.id];
            if (!lobbyId || !lobbies[lobbyId]) return;
            const lobby = lobbies[lobbyId];
            const p = lobby.players[socket.id];
            if (!p || p.dead || p.role !== 'impostor' || lobby.inMeeting || p.inVent) return;

            const now = Date.now();
            if (now - p.lastKillTime < lobby.settings.killCooldown) return;

            // Find closest alive crew member in range
            let closest = null, closestDist = KILL_RANGE;
            for (const oid in lobby.players) {
                const o = lobby.players[oid];
                if (oid === socket.id || o.dead || o.role === 'impostor') continue;
                const dist = Math.sqrt((p.x - o.x) ** 2 + (p.y - o.y) ** 2);
                if (dist < closestDist) {
                    closestDist = dist;
                    closest = oid;
                }
            }

            if (closest) {
                p.lastKillTime = now;
                const victim = lobby.players[closest];
                victim.dead = true;

                // Teleport killer to victim's position (Among Us-style snap)
                p.x = victim.x;
                p.y = victim.y;

                // Leave a body
                lobby.bodies[closest] = {
                    id: closest,
                    x: victim.x,
                    y: victim.y,
                    color: victim.color
                };

                // Broadcast kill animation to nearby players
                nsp.to(lobbyId).emit('killAnimation', {
                    killerId: socket.id,
                    victimId: closest,
                    x: victim.x,
                    y: victim.y,
                    victimColor: victim.color
                });

                // Notify killer and victim
                socket.emit('killSuccess', { victimId: closest, cooldown: lobby.settings.killCooldown });
                const victimSock = nsp.sockets.get(closest);
                if (victimSock) {
                    victimSock.emit('youDied', { killerId: socket.id, killerColor: p.color });
                }

                // Award coins for kill
                if (arenaDB) {
                    const killerName = io.getUsernameBySocketId ? io.getUsernameBySocketId(socket.id) : null;
                    if (killerName) arenaDB.awardCoins(killerName, 3, 'Kill', 'social-deduction');
                }

                checkWinCondition(lobbyId);
            }
        });

        // Report body
        socket.on('report', () => {
            const lobbyId = playerLobbies[socket.id];
            if (!lobbyId || !lobbies[lobbyId]) return;
            const lobby = lobbies[lobbyId];
            const p = lobby.players[socket.id];
            if (!p || p.dead || lobby.inMeeting || p.inVent) return;

            // Find closest body in range
            for (const bid in lobby.bodies) {
                const b = lobby.bodies[bid];
                const dist = Math.sqrt((p.x - b.x) ** 2 + (p.y - b.y) ** 2);
                if (dist < REPORT_RANGE) {
                    startMeeting(lobbyId, socket.id, bid);
                    return;
                }
            }
        });

        // Emergency meeting
        socket.on('emergencyMeeting', () => {
            const lobbyId = playerLobbies[socket.id];
            if (!lobbyId || !lobbies[lobbyId]) return;
            const lobby = lobbies[lobbyId];
            const p = lobby.players[socket.id];
            if (!p || p.dead || lobby.inMeeting || p.inVent) return;

            if (!p.emergencyMeetingsLeft || p.emergencyMeetingsLeft <= 0) {
                socket.emit('meetingError', 'No emergency meetings left.');
                return;
            }

            // Must be in cafeteria
            const cafe = ROOMS.find(r => r.id === 'cafeteria');
            if (p.x < cafe.x || p.x > cafe.x + cafe.w || p.y < cafe.y || p.y > cafe.y + cafe.h) {
                socket.emit('meetingError', 'You must be in the Cafeteria to call a meeting.');
                return;
            }

            p.emergencyMeetingsLeft--;
            startMeeting(lobbyId, socket.id, null);
        });

        // --- Vent System ---
        socket.on('enterVent', () => {
            const lobbyId = playerLobbies[socket.id];
            if (!lobbyId || !lobbies[lobbyId]) return;
            const lobby = lobbies[lobbyId];
            const p = lobby.players[socket.id];
            if (!p || p.dead || p.role !== 'impostor' || lobby.inMeeting || p.inVent) return;

            // Find nearest vent
            for (const vent of VENTS) {
                const dist = Math.sqrt((p.x - vent.x) ** 2 + (p.y - vent.y) ** 2);
                if (dist < VENT_RANGE) {
                    p.inVent = true;
                    p.currentVent = vent.id;
                    p.x = vent.x;
                    p.y = vent.y;
                    p.input = { up: false, down: false, left: false, right: false };
                    socket.emit('ventEntered', { ventId: vent.id, pairedTo: vent.pairedTo });
                    return;
                }
            }
        });

        socket.on('ventMove', () => {
            const lobbyId = playerLobbies[socket.id];
            if (!lobbyId || !lobbies[lobbyId]) return;
            const lobby = lobbies[lobbyId];
            const p = lobby.players[socket.id];
            if (!p || !p.inVent || p.role !== 'impostor') return;

            // Find current vent and teleport to paired vent
            const currentVent = VENTS.find(v => v.id === p.currentVent);
            if (!currentVent) return;
            const pairedVent = VENTS.find(v => v.id === currentVent.pairedTo);
            if (!pairedVent) return;

            p.x = pairedVent.x;
            p.y = pairedVent.y;
            p.currentVent = pairedVent.id;
            socket.emit('ventMoved', { ventId: pairedVent.id, pairedTo: pairedVent.pairedTo, x: pairedVent.x, y: pairedVent.y });
        });

        socket.on('exitVent', () => {
            const lobbyId = playerLobbies[socket.id];
            if (!lobbyId || !lobbies[lobbyId]) return;
            const lobby = lobbies[lobbyId];
            const p = lobby.players[socket.id];
            if (!p || !p.inVent) return;

            p.inVent = false;
            p.currentVent = null;
            socket.emit('ventExited');
        });

        // Vote
        socket.on('vote', (targetId) => {
            const lobbyId = playerLobbies[socket.id];
            if (!lobbyId || !lobbies[lobbyId]) return;
            const lobby = lobbies[lobbyId];
            if (!lobby.inMeeting || lobby.meetingPhase !== 'voting') return;
            const p = lobby.players[socket.id];
            if (!p || p.dead) return;

            if (targetId === 'skip' || (lobby.players[targetId] && !lobby.players[targetId].dead)) {
                lobby.votes[socket.id] = targetId;
                nsp.to(lobbyId).emit('voteUpdate', {
                    voterId: socket.id,
                    hasVoted: true
                });

                // Check if all alive have voted
                const alive = getAlivePlayers(lobby);
                if (alive.every(p => lobby.votes[p.id] !== undefined)) {
                    if (lobby.meetingTimer) clearTimeout(lobby.meetingTimer);
                    tallyVotes(lobbyId);
                }
            }
        });

        // Chat during meeting
        socket.on('meetingChat', (message) => {
            const lobbyId = playerLobbies[socket.id];
            if (!lobbyId || !lobbies[lobbyId]) return;
            const lobby = lobbies[lobbyId];
            if (!lobby.inMeeting) return;
            const p = lobby.players[socket.id];
            if (!p || p.dead) return;

            const clean = typeof message === 'string' ? message.trim().substring(0, 150) : '';
            if (clean.length < 1) return;

            nsp.to(lobbyId).emit('meetingChat', {
                senderId: socket.id,
                senderColor: p.color,
                message: clean,
                timestamp: Date.now()
            });
        });

        // Complete task
        socket.on('completeTask', (taskId) => {
            const lobbyId = playerLobbies[socket.id];
            if (!lobbyId || !lobbies[lobbyId]) return;
            const lobby = lobbies[lobbyId];
            const p = lobby.players[socket.id];
            if (!p || p.dead || p.role !== 'crew' || lobby.inMeeting) return;

            const task = p.tasks.find(t => t.id === taskId && !t.completed);
            if (!task) return;

            // Must be near the task
            const dist = Math.sqrt((p.x - task.x) ** 2 + (p.y - task.y) ** 2);
            if (dist > 50) return;

            task.completed = true;
            lobby.completedTasks++;
            socket.emit('taskCompleted', taskId);

            checkWinCondition(lobbyId);
        });

        // Sabotage (impostors only)
        socket.on('sabotage', (type) => {
            const lobbyId = playerLobbies[socket.id];
            if (!lobbyId || !lobbies[lobbyId]) return;
            const lobby = lobbies[lobbyId];
            const p = lobby.players[socket.id];
            if (!p || p.dead || p.role !== 'impostor' || lobby.inMeeting) return;

            const now = Date.now();
            if (now - lobby.lastSabotageTime < SABOTAGE_COOLDOWN) return;
            if (lobby.sabotageActive) return;

            const validTypes = ['lights', 'reactor', 'comms'];
            if (!validTypes.includes(type)) return;

            lobby.sabotageActive = true;
            lobby.sabotageType = type;
            lobby.lastSabotageTime = now;

            nsp.to(lobbyId).emit('sabotageStart', { type });

            // Auto-resolve after duration (if crew doesn't fix it)
            lobby.sabotageTimer = setTimeout(() => {
                if (lobby.sabotageActive && lobby.sabotageType === 'reactor') {
                    // Reactor meltdown = impostors win
                    endGame(lobbyId, 'impostor', 'Reactor meltdown!');
                } else {
                    lobby.sabotageActive = false;
                    lobby.sabotageType = null;
                    nsp.to(lobbyId).emit('sabotageEnd');
                }
            }, SABOTAGE_DURATION);
        });

        // Fix sabotage — requires proximity to fix location
        socket.on('fixSabotage', () => {
            const lobbyId = playerLobbies[socket.id];
            if (!lobbyId || !lobbies[lobbyId]) return;
            const lobby = lobbies[lobbyId];
            if (!lobby.sabotageActive) return;
            const p = lobby.players[socket.id];
            if (!p || p.dead) return;

            // Check proximity to the sabotage fix location
            const fixLoc = SABOTAGE_FIX_LOCATIONS[lobby.sabotageType];
            if (fixLoc) {
                const dist = Math.sqrt((p.x - fixLoc.x) ** 2 + (p.y - fixLoc.y) ** 2);
                if (dist > fixLoc.range) {
                    socket.emit('fixError', `Go to ${fixLoc.room} to fix the sabotage!`);
                    return;
                }
            }

            lobby.sabotageActive = false;
            lobby.sabotageType = null;
            if (lobby.sabotageTimer) clearTimeout(lobby.sabotageTimer);
            nsp.to(lobbyId).emit('sabotageEnd');
        });

        socket.on('disconnect', () => {
            console.log('[Social Deduction] User disconnected:', socket.id);
            leaveLobby(socket);
        });

        // --- Lobby Helpers ---
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
                x: 600, y: 175,
                dead: false,
                role: null,
                tasks: [],
                kills: 0,
                input: { up: false, down: false, left: false, right: false },
                emergencyMeetingsLeft: 1,
                lastKillTime: 0,
                inVent: false,
                currentVent: null,
                facingRight: true
            };

            socket.emit('lobbyJoined', lobbyId);
            socket.emit('mapData', {
                rooms: ROOMS, walls: WALLS, taskLocations: TASK_LOCATIONS,
                vents: VENTS, sabotageFixLocations: SABOTAGE_FIX_LOCATIONS,
                mapW: MAP_W, mapH: MAP_H
            });
            broadcastLobbyState(lobbyId);
            broadcastActiveLobbies();
        }

        function leaveLobby(socket) {
            const lobbyId = playerLobbies[socket.id];
            if (!lobbyId || !lobbies[lobbyId]) return;

            const lobby = lobbies[lobbyId];
            const p = lobby.players[socket.id];
            const wasPlaying = lobby.gameState === 'playing';
            const wasAlive = wasPlaying && p && !p.dead;
            const wasCrew = wasPlaying && p && p.role === 'crew';

            if (wasCrew) {
                const pCompletedTasks = p.tasks ? p.tasks.filter(t => t.completed).length : 0;
                const pTotalTasks = p.tasks ? p.tasks.length : 0;
                lobby.totalTasks = Math.max(0, lobby.totalTasks - pTotalTasks);
                lobby.completedTasks = Math.max(0, lobby.completedTasks - pCompletedTasks);
            }

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

            if (wasAlive || wasCrew) {
                if (!lobby.inMeeting) {
                    checkWinCondition(lobbyId);
                }
            }

            broadcastLobbyState(lobbyId);
            broadcastActiveLobbies();
        }

        function startGame(lobbyId) {
            const lobby = lobbies[lobbyId];
            if (!lobby) return;

            lobby.gameState = 'playing';
            lobby.bodies = {};
            lobby.votes = {};
            lobby.inMeeting = false;
            lobby.completedTasks = 0;
            lobby.sabotageActive = false;
            lobby.sabotageType = null;

            assignRoles(lobby);
            assignTasks(lobby);
            spawnPlayers(lobby);

            // Notify each player of their role privately
            for (const pid in lobby.players) {
                const p = lobby.players[pid];
                const sock = nsp.sockets.get(pid);
                if (!sock) continue;

                const fellowImpostors = p.role === 'impostor'
                    ? Object.values(lobby.players).filter(o => o.role === 'impostor' && o.id !== pid).map(o => ({ id: o.id, color: o.color }))
                    : [];

                sock.emit('gameStart', {
                    role: p.role,
                    tasks: p.tasks,
                    fellowImpostors,
                    totalTasks: lobby.totalTasks,
                    startPos: { x: p.x, y: p.y },
                    settings: lobby.settings,
                    vents: VENTS
                });
            }

            broadcastActiveLobbies();
            startGameLoop(lobbyId);
        }
    });
};
