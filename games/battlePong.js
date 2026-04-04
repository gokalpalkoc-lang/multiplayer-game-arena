const { v4: uuidv4 } = require('uuid');

module.exports = function(io) {
    const nsp = io.of('/battle-pong');

    const lobbies = {};
    const playerLobbies = {};

    const GAME_WIDTH = 800;
    const GAME_HEIGHT = 600;

    const PADDLE_WIDTH = 15;
    const PADDLE_LENGTH = 100;
    const BALL_RADIUS = 8;
    const BALL_SPEED = 5;
    const PADDLE_SPEED = 6;

    const PLAYER_SIDES = ['left', 'right', 'top', 'bottom'];
    const SIDE_COLORS = ['#ff4444', '#4488ff', '#44ff44', '#ffcc00'];

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
                side: p.side,
                color: p.color,
                score: p.score
            })),
            gameState: lobby.gameState,
            maxScore: lobby.maxScore
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

    function resetBall(lobby) {
        const angle = (Math.random() * Math.PI / 2) - Math.PI / 4 + (Math.random() > 0.5 ? 0 : Math.PI);
        lobby.ball = {
            x: GAME_WIDTH / 2,
            y: GAME_HEIGHT / 2,
            vx: Math.cos(angle) * BALL_SPEED,
            vy: Math.sin(angle) * BALL_SPEED,
            radius: BALL_RADIUS,
            speed: BALL_SPEED
        };
        lobby.powerUps = lobby.powerUps || [];
    }

    function spawnPowerUp(lobby) {
        if (lobby.powerUps.length >= 3) return;
        
        const types = ['speed', 'big', 'multi'];
        const type = types[Math.floor(Math.random() * types.length)];

        lobby.powerUps.push({
            id: uuidv4(),
            x: 150 + Math.random() * (GAME_WIDTH - 300),
            y: 150 + Math.random() * (GAME_HEIGHT - 300),
            type: type,
            radius: 12
        });
    }

    function getPaddleBounds(player) {
        const side = player.side;
        const pos = player.paddlePos;

        if (side === 'left') {
            return { x: 10, y: pos - PADDLE_LENGTH / 2, w: PADDLE_WIDTH, h: player.paddleLength || PADDLE_LENGTH };
        } else if (side === 'right') {
            return { x: GAME_WIDTH - 10 - PADDLE_WIDTH, y: pos - PADDLE_LENGTH / 2, w: PADDLE_WIDTH, h: player.paddleLength || PADDLE_LENGTH };
        } else if (side === 'top') {
            return { x: pos - PADDLE_LENGTH / 2, y: 10, w: player.paddleLength || PADDLE_LENGTH, h: PADDLE_WIDTH };
        } else if (side === 'bottom') {
            return { x: pos - PADDLE_LENGTH / 2, y: GAME_HEIGHT - 10 - PADDLE_WIDTH, w: player.paddleLength || PADDLE_LENGTH, h: PADDLE_WIDTH };
        }
    }

    function startGameLoop(lobbyId) {
        const lobby = lobbies[lobbyId];
        if (!lobby) return;
        if (lobby.gameLoopInterval) clearInterval(lobby.gameLoopInterval);

        lobby.gameLoopInterval = setInterval(() => {
            updatePhysics(lobbyId);
        }, 1000 / 45);

        lobby.lastPowerUpTime = Date.now();
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

        const players = lobby.players;
        const playerKeys = Object.keys(players);

        // Update paddle positions based on input
        for (const pId of playerKeys) {
            const p = players[pId];
            const isVertical = (p.side === 'left' || p.side === 'right');
            const maxPos = isVertical ? GAME_HEIGHT : GAME_WIDTH;
            const halfPaddle = (p.paddleLength || PADDLE_LENGTH) / 2;

            if (isVertical) {
                // Left/right paddles move up/down with W/S
                if (p.input.up) {
                    p.paddlePos -= PADDLE_SPEED;
                }
                if (p.input.down) {
                    p.paddlePos += PADDLE_SPEED;
                }
            } else {
                // Top/bottom paddles move left/right with A/D
                if (p.input.left) {
                    p.paddlePos -= PADDLE_SPEED;
                }
                if (p.input.right) {
                    p.paddlePos += PADDLE_SPEED;
                }
            }

            p.paddlePos = Math.max(halfPaddle + 10, Math.min(maxPos - halfPaddle - 10, p.paddlePos));
        }

        // Process each ball
        const balls = lobby.balls || [lobby.ball];

        for (let bi = balls.length - 1; bi >= 0; bi--) {
            const ball = balls[bi];

            ball.x += ball.vx;
            ball.y += ball.vy;

            let scored = false;

            // Check paddle collisions
            for (const pId of playerKeys) {
                const p = players[pId];
                const bounds = getPaddleBounds(p);

                if (ball.x + ball.radius > bounds.x && ball.x - ball.radius < bounds.x + bounds.w &&
                    ball.y + ball.radius > bounds.y && ball.y - ball.radius < bounds.y + bounds.h) {
                    
                    if (p.side === 'left' || p.side === 'right') {
                        ball.vx = -ball.vx;
                        // Add spin based on paddle position
                        const hitPos = (ball.y - bounds.y) / bounds.h - 0.5;
                        ball.vy += hitPos * 3;
                        ball.x = p.side === 'left' ? bounds.x + bounds.w + ball.radius : bounds.x - ball.radius;
                    } else {
                        ball.vy = -ball.vy;
                        const hitPos = (ball.x - bounds.x) / bounds.w - 0.5;
                        ball.vx += hitPos * 3;
                        ball.y = p.side === 'top' ? bounds.y + bounds.h + ball.radius : bounds.y - ball.radius;
                    }

                    // Slight speed increase per hit
                    const currentSpeed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
                    const newSpeed = Math.min(currentSpeed * 1.02, 12);
                    const ratio = newSpeed / currentSpeed;
                    ball.vx *= ratio;
                    ball.vy *= ratio;
                }
            }

            // Check wall/score boundaries
            const activeSides = new Set(Object.values(players).map(p => p.side));

            // Left wall
            if (ball.x - ball.radius < 0) {
                if (activeSides.has('left')) {
                    // Score against the left player
                    const leftPlayer = Object.values(players).find(p => p.side === 'left');
                    if (leftPlayer) leftPlayer.score++;
                    scored = true;
                } else {
                    ball.vx = Math.abs(ball.vx);
                }
            }
            // Right wall
            if (ball.x + ball.radius > GAME_WIDTH) {
                if (activeSides.has('right')) {
                    const rightPlayer = Object.values(players).find(p => p.side === 'right');
                    if (rightPlayer) rightPlayer.score++;
                    scored = true;
                } else {
                    ball.vx = -Math.abs(ball.vx);
                }
            }
            // Top wall
            if (ball.y - ball.radius < 0) {
                if (activeSides.has('top')) {
                    const topPlayer = Object.values(players).find(p => p.side === 'top');
                    if (topPlayer) topPlayer.score++;
                    scored = true;
                } else {
                    ball.vy = Math.abs(ball.vy);
                }
            }
            // Bottom wall
            if (ball.y + ball.radius > GAME_HEIGHT) {
                if (activeSides.has('bottom')) {
                    const bottomPlayer = Object.values(players).find(p => p.side === 'bottom');
                    if (bottomPlayer) bottomPlayer.score++;
                    scored = true;
                } else {
                    ball.vy = -Math.abs(ball.vy);
                }
            }

            if (scored) {
                if (balls.length > 1) {
                    balls.splice(bi, 1);
                } else {
                    resetBall(lobby);
                    balls[0] = lobby.ball;
                }
                
                // Check for game over (a player reaches maxScore — they LOSE)
                const loser = Object.values(players).find(p => p.score >= lobby.maxScore);
                if (loser) {
                    const results = Object.values(players)
                        .sort((a, b) => a.score - b.score)
                        .map((p, i) => ({
                            id: p.id,
                            score: p.score,
                            side: p.side,
                            color: p.color,
                            position: i + 1
                        }));

                    nsp.to(lobbyId).emit('gameOver', { results });
                    stopGameLoop(lobbyId);
                    lobby.gameState = 'gameover';
                    broadcastActiveLobbies();

                    setTimeout(() => {
                        if (!lobbies[lobbyId]) return;
                        lobby.gameState = 'lobby';
                        Object.values(lobby.players).forEach(p => {
                            p.isReady = false;
                            p.score = 0;
                        });
                        broadcastLobbyState(lobbyId);
                        broadcastActiveLobbies();
                        nsp.to(lobbyId).emit('resetToLobby');
                    }, 6000);
                    return;
                }
                continue;
            }
        }

        // Power-up collision
        if (lobby.powerUps) {
            for (let pi = lobby.powerUps.length - 1; pi >= 0; pi--) {
                const pu = lobby.powerUps[pi];
                
                for (const b of balls) {
                    const dx = b.x - pu.x;
                    const dy = b.y - pu.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    
                    if (dist < b.radius + pu.radius) {
                        if (pu.type === 'speed') {
                            const currentSpeed = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
                            const newSpeed = currentSpeed * 1.5;
                            b.vx = (b.vx / currentSpeed) * newSpeed;
                            b.vy = (b.vy / currentSpeed) * newSpeed;
                        } else if (pu.type === 'multi' && balls.length < 4) {
                            balls.push({
                                x: b.x,
                                y: b.y,
                                vx: -b.vy,
                                vy: b.vx,
                                radius: BALL_RADIUS,
                                speed: Math.sqrt(b.vx * b.vx + b.vy * b.vy)
                            });
                        } else if (pu.type === 'big') {
                            // Find whoever's paddle last touched the ball and make it bigger (simplified: random player)
                            const rndPlayer = players[playerKeys[Math.floor(Math.random() * playerKeys.length)]];
                            if (rndPlayer) {
                                rndPlayer.paddleLength = Math.min((rndPlayer.paddleLength || PADDLE_LENGTH) + 30, 200);
                                setTimeout(() => {
                                    if (rndPlayer) rndPlayer.paddleLength = PADDLE_LENGTH;
                                }, 8000);
                            }
                        }
                        lobby.powerUps.splice(pi, 1);
                        break;
                    }
                }
            }
        }

        // Spawn power-ups periodically
        const now = Date.now();
        if (now - lobby.lastPowerUpTime > 10000) {
            lobby.lastPowerUpTime = now;
            spawnPowerUp(lobby);
        }

        lobby.balls = balls;

        // Broadcast state (throttled — only send every 2nd frame)
        lobby.frameCount = (lobby.frameCount || 0) + 1;
        if (lobby.frameCount % 2 === 0) {
            const paddleStates = {};
            for (const pId of playerKeys) {
                const p = players[pId];
                paddleStates[pId] = {
                    paddlePos: Math.round(p.paddlePos),
                    paddleLength: p.paddleLength || PADDLE_LENGTH,
                    side: p.side,
                    color: p.color,
                    score: p.score
                };
            }

            nsp.to(lobbyId).emit('gameStateUpdate', {
                paddles: paddleStates,
                balls: balls.map(b => ({ x: Math.round(b.x * 10) / 10, y: Math.round(b.y * 10) / 10, vx: Math.round(b.vx * 100) / 100, vy: Math.round(b.vy * 100) / 100, radius: b.radius })),
                powerUps: lobby.powerUps || []
            });
        }
    }

    nsp.on('connection', (socket) => {
        console.log('[Battle Pong] User connected:', socket.id);
        broadcastActiveLobbies();

        socket.on('createLobby', () => {
            const lobbyId = uuidv4().substring(0, 8);
            lobbies[lobbyId] = {
                id: lobbyId,
                name: `${socket.id.substring(0,4)}'s Pong`,
                creatorId: socket.id,
                players: {},
                gameState: 'lobby',
                gameLoopInterval: null,
                maxScore: 10,
                ball: null,
                balls: [],
                powerUps: []
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
                    up: !!inputData.up,
                    down: !!inputData.down,
                    left: !!inputData.left,
                    right: !!inputData.right
                };
            }
        });

        socket.on('disconnect', () => {
            console.log('[Battle Pong] User disconnected:', socket.id);
            leaveLobby(socket);
        });

        function joinLobby(socket, lobbyId) {
            const lobby = lobbies[lobbyId];
            if (!lobby) return;
            leaveLobby(socket);

            socket.join(lobbyId);
            playerLobbies[socket.id] = lobbyId;

            const playerIndex = Object.keys(lobby.players).length;
            const side = PLAYER_SIDES[playerIndex % 4];
            const isVertical = (side === 'left' || side === 'right');

            lobby.players[socket.id] = {
                id: socket.id,
                side: side,
                color: SIDE_COLORS[playerIndex % 4],
                paddlePos: isVertical ? GAME_HEIGHT / 2 : GAME_WIDTH / 2,
                paddleLength: PADDLE_LENGTH,
                isReady: false,
                score: 0,
                input: { up: false, down: false, left: false, right: false }
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

            // Reassign sides
            const playerKeys = Object.keys(lobby.players);
            playerKeys.forEach((id, index) => {
                lobby.players[id].side = PLAYER_SIDES[index % 4];
                lobby.players[id].color = SIDE_COLORS[index % 4];
            });

            nsp.to(lobbyId).emit('playerDisconnected', socket.id);
            broadcastLobbyState(lobbyId);
            broadcastActiveLobbies();
        }

        function startGame(lobbyId) {
            const lobby = lobbies[lobbyId];
            if (!lobby) return;

            lobby.gameState = 'playing';
            lobby.powerUps = [];
            resetBall(lobby);
            lobby.balls = [lobby.ball];

            Object.values(lobby.players).forEach(p => {
                p.score = 0;
                p.paddleLength = PADDLE_LENGTH;
                const isVertical = (p.side === 'left' || p.side === 'right');
                p.paddlePos = isVertical ? GAME_HEIGHT / 2 : GAME_WIDTH / 2;
            });

            nsp.to(lobbyId).emit('gameStart', {
                players: Object.fromEntries(
                    Object.keys(lobby.players).map(id => [id, {
                        side: lobby.players[id].side,
                        color: lobby.players[id].color
                    }])
                )
            });

            broadcastActiveLobbies();
            startGameLoop(lobbyId);
        }
    });
};
