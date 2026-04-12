const { v4: uuidv4 } = require('uuid');

module.exports = function(io) {
    const nsp = io.of('/pixel-kart');
    const arenaDB = io.arenaDB;

    const lobbies = {};
    const playerLobbies = {};

    const GAME_WIDTH = 800;
    const GAME_HEIGHT = 600;

    // Track definition — a simple oval track with checkpoints
    const TRACK = {
        // Outer boundary
        outerRect: { x: 50, y: 50, w: 700, h: 500 },
        // Inner boundary (the island in the middle)
        innerRect: { x: 180, y: 160, w: 440, h: 280 },
        // Checkpoints (lines the kart must cross in order)
        checkpoints: [
            { x1: 400, y1: 50, x2: 400, y2: 160 },   // top 
            { x1: 620, y1: 300, x2: 700, y2: 300 },   // right
            { x1: 400, y1: 440, x2: 400, y2: 550 },   // bottom
            { x1: 50, y1: 300, x2: 180, y2: 300 }      // left
        ],
        // Start line (same as checkpoint 0)
        startLine: { x1: 400, y1: 50, x2: 400, y2: 160 },
        // Start positions for players
        startPositions: [
            { x: 350, y: 100, angle: Math.PI / 2 },
            { x: 350, y: 130, angle: Math.PI / 2 },
            { x: 300, y: 100, angle: Math.PI / 2 },
            { x: 300, y: 130, angle: Math.PI / 2 },
            { x: 250, y: 100, angle: Math.PI / 2 },
            { x: 250, y: 130, angle: Math.PI / 2 }
        ],
        totalLaps: 3
    };

    const KART_COLORS = ['#ff4444', '#4488ff', '#44ff44', '#ffcc00', '#ff44ff', '#44ffff'];

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
                name: p.name
            })),
            gameState: lobby.gameState
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

    // Check if a point is on the track (between outer and inner rectangles)
    function isOnTrack(x, y) {
        const outer = TRACK.outerRect;
        const inner = TRACK.innerRect;
        
        const inOuter = x >= outer.x && x <= outer.x + outer.w && y >= outer.y && y <= outer.y + outer.h;
        const inInner = x >= inner.x && x <= inner.x + inner.w && y >= inner.y && y <= inner.y + inner.h;
        
        return inOuter && !inInner;
    }

    // Check if a kart crossed a checkpoint line (simplified line-segment crossing)
    function crossedCheckpoint(prevX, prevY, newX, newY, cp) {
        // Simple vertical/horizontal line crossing check
        if (cp.x1 === cp.x2) {
            // Vertical checkpoint line
            if ((prevX < cp.x1 && newX >= cp.x1) || (prevX > cp.x1 && newX <= cp.x1)) {
                const minY = Math.min(cp.y1, cp.y2);
                const maxY = Math.max(cp.y1, cp.y2);
                const crossY = prevY + (newY - prevY) * (cp.x1 - prevX) / (newX - prevX);
                return crossY >= minY && crossY <= maxY;
            }
        } else {
            // Horizontal checkpoint line
            if ((prevY < cp.y1 && newY >= cp.y1) || (prevY > cp.y1 && newY <= cp.y1)) {
                const minX = Math.min(cp.x1, cp.x2);
                const maxX = Math.max(cp.x1, cp.x2);
                const crossX = prevX + (newX - prevX) * (cp.y1 - prevY) / (newY - prevY);
                return crossX >= minX && crossX <= maxX;
            }
        }
        return false;
    }

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

    function updatePhysics(lobbyId) {
        const lobby = lobbies[lobbyId];
        if (!lobby || lobby.gameState !== 'playing') return;

        const playerKeys = Object.keys(lobby.players);

        for (const pId of playerKeys) {
            const p = lobby.players[pId];
            if (p.finished) continue;

            // Apply inputs
            if (p.input.up) {
                p.speed = Math.min(p.speed + 0.15, p.maxSpeed);
            } else if (p.input.down) {
                p.speed = Math.max(p.speed - 0.2, -2);
            } else {
                // Natural deceleration
                p.speed *= 0.98;
                if (Math.abs(p.speed) < 0.05) p.speed = 0;
            }

            if (p.input.left) {
                p.angle -= 0.04 * (p.speed > 0 ? 1 : p.speed < 0 ? -1 : 0);
            }
            if (p.input.right) {
                p.angle += 0.04 * (p.speed > 0 ? 1 : p.speed < 0 ? -1 : 0);
            }

            const prevX = p.x;
            const prevY = p.y;

            p.x += Math.sin(p.angle) * p.speed;
            p.y += -Math.cos(p.angle) * p.speed;

            // Off-track penalty — slow down
            if (!isOnTrack(p.x, p.y)) {
                p.speed *= 0.9;
                // Push back towards track
                const dx = p.x - prevX;
                const dy = p.y - prevY;
                p.x = prevX + dx * 0.3;
                p.y = prevY + dy * 0.3;
            }

            // Clamp to game area
            p.x = Math.max(10, Math.min(GAME_WIDTH - 10, p.x));
            p.y = Math.max(10, Math.min(GAME_HEIGHT - 10, p.y));

            // Check checkpoint crossing
            const nextCP = p.nextCheckpoint;
            if (nextCP < TRACK.checkpoints.length) {
                if (crossedCheckpoint(prevX, prevY, p.x, p.y, TRACK.checkpoints[nextCP])) {
                    p.nextCheckpoint = (nextCP + 1) % TRACK.checkpoints.length;
                    if (p.nextCheckpoint === 0) {
                        p.lap++;
                        if (p.lap > TRACK.totalLaps) {
                            p.finished = true;
                            p.finishTime = Date.now() - lobby.raceStartTime;
                            
                            // Check if all finished
                            const allDone = Object.values(lobby.players).every(pl => pl.finished);
                            const finishedCount = Object.values(lobby.players).filter(pl => pl.finished).length;
                            
                            nsp.to(lobbyId).emit('playerFinished', {
                                id: pId,
                                position: finishedCount,
                                time: p.finishTime
                            });

                            if (allDone) {
                                triggerGameOver(lobbyId);
                            }
                        }
                    }
                }
            }
        }

        // Kart-to-kart collision (simple circle collision)
        for (let i = 0; i < playerKeys.length; i++) {
            for (let j = i + 1; j < playerKeys.length; j++) {
                const a = lobby.players[playerKeys[i]];
                const b = lobby.players[playerKeys[j]];
                const dx = a.x - b.x;
                const dy = a.y - b.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const minDist = 20; // kart radius * 2

                if (dist < minDist && dist > 0) {
                    const overlap = minDist - dist;
                    const nx = dx / dist;
                    const ny = dy / dist;
                    a.x += nx * overlap / 2;
                    a.y += ny * overlap / 2;
                    b.x -= nx * overlap / 2;
                    b.y -= ny * overlap / 2;

                    // Bounce speeds
                    const relSpeed = a.speed - b.speed;
                    a.speed -= relSpeed * 0.3;
                    b.speed += relSpeed * 0.3;
                }
            }
        }

        // Throttle broadcast to every 3rd frame (~20 FPS)
        // Physics still runs at 60 FPS for accuracy
        lobby.frameCount = (lobby.frameCount || 0) + 1;
        if (lobby.frameCount % 3 === 0) {
            const gameState = {};
            for (const pId of playerKeys) {
                const p = lobby.players[pId];
                gameState[pId] = {
                    x: Math.round(p.x * 10) / 10,
                    y: Math.round(p.y * 10) / 10,
                    angle: Math.round(p.angle * 100) / 100,
                    speed: Math.round(p.speed * 100) / 100,
                    lap: p.lap,
                    nextCheckpoint: p.nextCheckpoint,
                    finished: p.finished,
                    color: p.color
                };
            }

            nsp.to(lobbyId).emit('gameStateUpdate', gameState);
        }
    }

    function triggerGameOver(lobbyId) {
        const lobby = lobbies[lobbyId];
        if (!lobby) return;

        const results = Object.values(lobby.players)
            .sort((a, b) => {
                if (a.finished && !b.finished) return -1;
                if (!a.finished && b.finished) return 1;
                if (a.finished && b.finished) return a.finishTime - b.finishTime;
                return b.lap - a.lap;
            })
            .map((p, i) => ({
                id: p.id,
                position: i + 1,
                lap: p.lap,
                time: p.finishTime || null,
                color: p.color
            }));

        nsp.to(lobbyId).emit('gameOver', { results });
        stopGameLoop(lobbyId);
        lobby.gameState = 'gameover';
        broadcastActiveLobbies();

        // Award coins based on finishing position
        if (arenaDB) {
            const coinRewards = [30, 20, 15, 10, 10, 10];
            results.forEach((r, i) => {
                const username = io.getUsernameBySocketId ? io.getUsernameBySocketId(r.id) : null;
                if (!username) return;
                const coins = coinRewards[i] || 10;
                const isWinner = i === 0;
                arenaDB.awardCoins(username, coins, isWinner ? '1st Place' : `Finished #${i + 1}`, 'pixel-kart');
                arenaDB.recordGameResult(username, 'pixel-kart', isWinner);
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

    nsp.on('connection', (socket) => {
        console.log('[Pixel Kart] User connected:', socket.id);
        broadcastActiveLobbies();

        socket.on('createLobby', () => {
            const lobbyId = uuidv4().substring(0, 8);
            lobbies[lobbyId] = {
                id: lobbyId,
                name: `${socket.id.substring(0,4)}'s Race`,
                creatorId: socket.id,
                players: {},
                gameState: 'lobby',
                gameLoopInterval: null,
                raceStartTime: null
            };
            joinLobby(socket, lobbyId);
            broadcastActiveLobbies();
        });

        socket.on('joinLobby', (lobbyId) => {
            if (lobbies[lobbyId] && lobbies[lobbyId].gameState === 'lobby') {
                if (Object.keys(lobbies[lobbyId].players).length < 6) {
                    joinLobby(socket, lobbyId);
                } else {
                    socket.emit('lobbyError', 'Lobby is full (max 6 players).');
                }
            } else {
                socket.emit('lobbyError', 'Lobby not found or race already in progress.');
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

        socket.on('toggleReady', () => {
            const lobbyId = playerLobbies[socket.id];
            if (!lobbyId || !lobbies[lobbyId]) return;
            const lobby = lobbies[lobbyId];

            if (lobby.players[socket.id] && lobby.gameState === 'lobby') {
                lobby.players[socket.id].isReady = !lobby.players[socket.id].isReady;
                broadcastLobbyState(lobbyId);

                // Check if all ready (need at least 2)
                const playerKeys = Object.keys(lobby.players);
                if (playerKeys.length >= 2 && playerKeys.every(id => lobby.players[id].isReady)) {
                    startRace(lobbyId);
                }
            }
        });

        socket.on('input', (inputData) => {
            const lobbyId = playerLobbies[socket.id];
            if (!lobbyId || !lobbies[lobbyId]) return;
            const lobby = lobbies[lobbyId];

            if (lobby.players[socket.id] && lobby.gameState === 'playing') {
                lobby.players[socket.id].input = {
                    up: !!inputData.up,
                    down: !!inputData.down,
                    left: !!inputData.left,
                    right: !!inputData.right
                };
            }
        });

        socket.on('disconnect', () => {
            console.log('[Pixel Kart] User disconnected:', socket.id);
            leaveLobby(socket);
        });

        function joinLobby(socket, lobbyId) {
            const lobby = lobbies[lobbyId];
            if (!lobby) return;
            leaveLobby(socket);

            socket.join(lobbyId);
            playerLobbies[socket.id] = lobbyId;

            const playerIndex = Object.keys(lobby.players).length;
            const startPos = TRACK.startPositions[playerIndex] || TRACK.startPositions[0];

            lobby.players[socket.id] = {
                id: socket.id,
                x: startPos.x,
                y: startPos.y,
                angle: startPos.angle,
                speed: 0,
                maxSpeed: 5,
                color: KART_COLORS[playerIndex % KART_COLORS.length],
                isReady: false,
                lap: 0,
                nextCheckpoint: 0,
                finished: false,
                finishTime: null,
                input: { up: false, down: false, left: false, right: false },
                name: `Racer ${playerIndex + 1}`
            };

            socket.emit('lobbyJoined', { lobbyId, track: TRACK });
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

            nsp.to(lobbyId).emit('playerDisconnected', socket.id);
            broadcastLobbyState(lobbyId);
            broadcastActiveLobbies();
        }

        function startRace(lobbyId) {
            const lobby = lobbies[lobbyId];
            if (!lobby) return;

            lobby.gameState = 'playing';
            lobby.raceStartTime = Date.now();

            // Reset all players to start positions
            const playerKeys = Object.keys(lobby.players);
            playerKeys.forEach((id, index) => {
                const startPos = TRACK.startPositions[index] || TRACK.startPositions[0];
                lobby.players[id].x = startPos.x;
                lobby.players[id].y = startPos.y;
                lobby.players[id].angle = startPos.angle;
                lobby.players[id].speed = 0;
                lobby.players[id].lap = 0;
                lobby.players[id].nextCheckpoint = 0;
                lobby.players[id].finished = false;
                lobby.players[id].finishTime = null;
            });

            nsp.to(lobbyId).emit('raceStart', {
                track: TRACK,
                players: Object.fromEntries(
                    playerKeys.map(id => [id, {
                        x: lobby.players[id].x,
                        y: lobby.players[id].y,
                        angle: lobby.players[id].angle,
                        color: lobby.players[id].color
                    }])
                )
            });

            broadcastActiveLobbies();
            startGameLoop(lobbyId);
        }
    });
};
