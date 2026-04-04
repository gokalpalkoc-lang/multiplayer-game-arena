const { v4: uuidv4 } = require('uuid');

module.exports = function(io) {
    const nsp = io.of('/counter-stride');

    const lobbies = {};
    const playerLobbies = {};
    let totalGamesPlayed = 0;

    const GAME_WIDTH = 800;
    const GAME_HEIGHT = 600;

    function broadcastLobbyState(lobbyId) {
        const lobby = lobbies[lobbyId];
        if (!lobby) return;

        const mapVotes = new Array((lobby.uploadedMaps || []).length).fill(0);
        Object.values(lobby.players).forEach(p => {
            if (p.votedMapIndex !== undefined && p.votedMapIndex >= 0 && p.votedMapIndex < lobby.uploadedMaps.length) {
                mapVotes[p.votedMapIndex]++;
            }
        });

        const mapsWithVotes = (lobby.uploadedMaps || []).map((m, index) => ({
            name: m.name,
            votes: mapVotes[index],
            maxPlayers: m.data ? m.data.maxPlayers : undefined
        }));

        nsp.to(lobbyId).emit('lobbyState', {
            id: lobby.id,
            name: lobby.name,
            creatorId: lobby.creatorId,
            players: lobby.players,
            maps: mapsWithVotes,
            gameState: lobby.gameState,
            gameMode: lobby.gameMode,
            teamCount: lobby.teamCount
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

    function triggerGameOver(lobbyId, result) {
        const lobby = lobbies[lobbyId];
        if (!lobby || lobby.gameState !== 'playing') return;

        nsp.to(lobbyId).emit('gameOver', result);
        stopGameLoop(lobbyId);
        lobby.gameState = 'gameover';
        broadcastActiveLobbies();

        setTimeout(() => {
            if (!lobbies[lobbyId]) return;
            lobby.gameState = 'lobby';
            lobby.items = {};
            Object.values(lobby.players).forEach(p => {
                p.isReady = false;
                p.health = 100;
                p.ammo = 16;
                p.revolverAmmo = 6;
                p.weapon = 'pistol';
                p.isReloading = false;
                p.isEliminated = false;
                p.isPlaying = false;
                p.speedBootsUntil = 0;
                p.rapidFireUntil = 0;
                p.armorCount = 0;
                p.isHidden = false;
            });
            broadcastLobbyState(lobbyId);
            broadcastActiveLobbies();
            nsp.to(lobbyId).emit('resetToLobby');
        }, 5000);
    }

    function startGameLoop(lobbyId) {
        const lobby = lobbies[lobbyId];
        if (!lobby) return;

        lobby.bullets = {};
        lobby.frameCount = 0;
        if (lobby.gameLoopInterval) clearInterval(lobby.gameLoopInterval);

        lobby.gameLoopInterval = setInterval(() => {
            updatePhysics(lobbyId);
        }, 1000 / 60);

        lobby.lastItemSpawnTime = Date.now();
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
        if (!lobby) return;

        const bulletKeys = Object.keys(lobby.bullets);
        for (let i = 0; i < bulletKeys.length; i++) {
            const bId = bulletKeys[i];
            const b = lobby.bullets[bId];

            b.x += b.vx;
            b.y += b.vy;

            let destroyed = false;

            if (b.x < 0 || b.x > GAME_WIDTH || b.y < 0 || b.y > GAME_HEIGHT) {
                destroyed = true;
            }

            if (!destroyed && lobby.currentMapData) {
                const tileSize = lobby.currentMapData.tileSize || 50;
                const col = Math.floor(b.x / tileSize);
                const row = Math.floor(b.y / tileSize);

                if (row >= 0 && row < lobby.currentMapData.rows && col >= 0 && col < lobby.currentMapData.cols) {
                    const tileType = lobby.currentMapData.data[row][col];
                    if (tileType === 1) {
                        destroyed = true;
                    } else if (tileType === 3) {
                        destroyed = true;
                        if (lobby.blockHealth[row] && lobby.blockHealth[row][col] !== undefined) {
                            lobby.blockHealth[row][col] -= 25;
                            if (lobby.blockHealth[row][col] <= 0) {
                                lobby.currentMapData.data[row][col] = 0;
                                nsp.to(lobbyId).emit('mapUpdate', { row: row, col: col, type: 0, health: 0 });
                            } else {
                                nsp.to(lobbyId).emit('mapUpdate', { row: row, col: col, type: 3, health: lobby.blockHealth[row][col] });
                            }
                        }
                    }
                }
            }

            if (!destroyed) {
                const playerKeys = Object.keys(lobby.players);
                for (let j = 0; j < playerKeys.length; j++) {
                    const pId = playerKeys[j];
                    const p = lobby.players[pId];

                    if (pId === b.ownerId || p.isEliminated) continue;
                    if (lobby.gameMode === 'tdm' && p.team === b.team && b.team != null) continue;

                    const dx = p.x - b.x;
                    const dy = p.y - b.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);

                    if (dist < 15 + b.radius) {
                        destroyed = true;
                        if (p.armorCount > 0) {
                            p.armorCount--;
                        } else {
                            p.health -= 25;
                        }

                        if (p.health <= 0) {
                            p.health = 0;
                            p.isEliminated = true;
                            nsp.to(lobbyId).emit('playerEliminated', pId);

                            const itemId = uuidv4();
                            lobby.items = lobby.items || {};
                            const itemTypes = ['health', 'speed', 'armor', 'rapidfire'];
                            const randomType = itemTypes[Math.floor(Math.random() * itemTypes.length)];

                            lobby.items[itemId] = {
                                id: itemId,
                                x: p.x,
                                y: p.y,
                                type: randomType,
                                radius: 10
                            };

                            const alivePlayers = Object.values(lobby.players).filter(pl => !pl.isEliminated && pl.isPlaying);
                            if (lobby.gameMode === 'tdm') {
                                const aliveTeams = new Set(alivePlayers.map(p => p.team));
                                if (aliveTeams.size <= 1) {
                                    let winnerTeam = aliveTeams.size === 1 ? aliveTeams.values().next().value : null;
                                    triggerGameOver(lobbyId, { winnerTeam: winnerTeam });
                                }
                            } else {
                                if (alivePlayers.length <= 1) {
                                    let winnerId = null;
                                    if (alivePlayers.length === 1) {
                                        winnerId = alivePlayers[0].id;
                                    }
                                    triggerGameOver(lobbyId, { winnerId: winnerId });
                                }
                            }
                        }
                        break;
                    }
                }
            }

            if (destroyed) {
                delete lobby.bullets[bId];
            }
        }

        if (lobby.items) {
            const itemKeys = Object.keys(lobby.items);
            const playerKeys = Object.keys(lobby.players);

            for (let i = 0; i < itemKeys.length; i++) {
                const itemId = itemKeys[i];
                const item = lobby.items[itemId];
                let itemConsumed = false;

                if (lobby.currentMapData) {
                    item.vy = (item.vy || 0) + 0.5;
                    item.y += item.vy;

                    const tileSize = lobby.currentMapData.tileSize || 50;
                    const radius = item.radius;
                    const leftCol = Math.floor((item.x - radius) / tileSize);
                    const rightCol = Math.floor((item.x + radius) / tileSize);
                    const bottomRow = Math.floor((item.y + radius) / tileSize);

                    if (item.vy > 0 && bottomRow >= 0 && bottomRow < lobby.currentMapData.rows) {
                        for (let c = leftCol; c <= rightCol; c++) {
                            if (c >= 0 && c < lobby.currentMapData.cols) {
                                const tileType = lobby.currentMapData.data[bottomRow][c];
                                if (tileType === 1 || tileType === 3) {
                                    item.y = bottomRow * tileSize - radius - 0.01;
                                    item.vy = 0;
                                    break;
                                }
                            }
                        }
                    }
                    if (item.y > GAME_HEIGHT) {
                        item.y = GAME_HEIGHT - radius;
                        item.vy = 0;
                    }
                } else {
                    item.vy = (item.vy || 0) + 0.5;
                    item.y += item.vy;
                    if (item.y > GAME_HEIGHT - item.radius) {
                        item.y = GAME_HEIGHT - item.radius;
                        item.vy = 0;
                    }
                }

                for (let j = 0; j < playerKeys.length; j++) {
                    const pId = playerKeys[j];
                    const p = lobby.players[pId];

                    if (p.isEliminated || !p.isPlaying) continue;

                    const dx = p.x - item.x;
                    const dy = p.y - item.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);

                    if (dist < 15 + item.radius) {
                        if (item.type === 'health') {
                            p.health = 100;
                        } else if (item.type === 'speed') {
                            p.speedBootsUntil = Date.now() + 10000;
                        } else if (item.type === 'armor') {
                            p.armorCount = 2;
                        } else if (item.type === 'rapidfire') {
                            p.rapidFireUntil = Date.now() + 5000;
                        }
                        itemConsumed = true;
                        break;
                    }
                }

                if (itemConsumed) {
                    delete lobby.items[itemId];
                }
            }
        }

        const now = Date.now();
        if (now - lobby.lastItemSpawnTime > 15000) {
            lobby.lastItemSpawnTime = now;
            if (lobby.currentMapData && Object.keys(lobby.items).length < 10) {
                const emptyTiles = [];
                for (let r = 0; r < lobby.currentMapData.rows; r++) {
                    for (let c = 0; c < lobby.currentMapData.cols; c++) {
                        if (lobby.currentMapData.data[r][c] === 0) {
                            emptyTiles.push({r, c});
                        }
                    }
                }
                if (emptyTiles.length > 0) {
                    const randTile = emptyTiles[Math.floor(Math.random() * emptyTiles.length)];
                    const tileSize = lobby.currentMapData.tileSize || 50;

                    const itemId = uuidv4();
                    const itemTypes = ['health', 'speed', 'armor', 'rapidfire'];
                    const randomType = itemTypes[Math.floor(Math.random() * itemTypes.length)];

                    lobby.items[itemId] = {
                        id: itemId,
                        x: randTile.c * tileSize + tileSize / 2,
                        y: randTile.r * tileSize + tileSize / 2,
                        type: randomType,
                        radius: 10
                    };
                }
            }
        }

        const playerKeys = Object.keys(lobby.players);
        for (let j = 0; j < playerKeys.length; j++) {
            const pId = playerKeys[j];
            const p = lobby.players[pId];

            if (p.isEliminated || !p.isPlaying) continue;

            if (!p.lastX) p.lastX = p.x;
            if (!p.lastY) p.lastY = p.y;

            const isMoving = Math.abs(p.x - p.lastX) > 1.0 || Math.abs(p.y - p.lastY) > 1.0;
            p.lastX = p.x;
            p.lastY = p.y;

            let inBush = false;
            if (lobby.currentMapData) {
                const tileSize = lobby.currentMapData.tileSize || 50;
                const col = Math.floor(p.x / tileSize);
                const row = Math.floor(p.y / tileSize);
                if (row >= 0 && row < lobby.currentMapData.rows && col >= 0 && col < lobby.currentMapData.cols) {
                   if (lobby.currentMapData.data[row][col] === 4) {
                       inBush = true;
                   }
                }
            }

            if (inBush && !isMoving) {
                if (!p.stillTimer) p.stillTimer = now;
                if (now - p.stillTimer > 500) {
                    p.isHidden = true;
                }
            } else {
                p.stillTimer = 0;
                p.isHidden = false;
            }
        }

        // Throttle network broadcast to every 3rd frame (~20 FPS)
        // Physics still runs at 60 FPS for accuracy
        lobby.frameCount = (lobby.frameCount || 0) + 1;
        if (lobby.frameCount % 3 === 0) {
            // Slim down bullet data — only send position and radius
            const slimBullets = Object.values(lobby.bullets).map(b => ({
                x: Math.round(b.x),
                y: Math.round(b.y),
                radius: b.radius
            }));

            // Slim down player data — only send fields that change during gameplay
            const slimPlayers = {};
            for (const id in lobby.players) {
                const p = lobby.players[id];
                slimPlayers[id] = {
                    x: Math.round(p.x),
                    y: Math.round(p.y),
                    health: p.health,
                    ammo: p.ammo,
                    revolverAmmo: p.revolverAmmo,
                    weapon: p.weapon,
                    isEliminated: p.isEliminated,
                    isReloading: p.isReloading,
                    team: p.team,
                    facingRight: p.facingRight,
                    speedBootsUntil: p.speedBootsUntil,
                    rapidFireUntil: p.rapidFireUntil,
                    armorCount: p.armorCount,
                    isHidden: p.isHidden
                };
            }

            nsp.to(lobbyId).emit('gameStateUpdate', {
                bullets: slimBullets,
                players: slimPlayers,
                items: lobby.items ? Object.values(lobby.items) : []
            });
        }
    }

    nsp.on('connection', (socket) => {
        console.log('[Counter-Stride] User connected:', socket.id);

        broadcastActiveLobbies();

        socket.on('createLobby', () => {
            const lobbyId = uuidv4().substring(0, 8);
            lobbies[lobbyId] = {
                id: lobbyId,
                name: `${socket.id.substring(0,4)}'s Lobby`,
                creatorId: socket.id,
                players: {},
                gameState: 'lobby',
                gameMode: 'ffa',
                teamCount: 2,
                bullets: {},
                items: {},
                gameLoopInterval: null,
                currentMapData: null,
                uploadedMaps: [
                    { name: "Default Arena", data: null }
                ]
            };
            joinLobby(socket, lobbyId);
            broadcastActiveLobbies();
        });

        socket.on('joinLobby', (lobbyId) => {
            if (lobbies[lobbyId] && lobbies[lobbyId].gameState === 'lobby') {
                joinLobby(socket, lobbyId);
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

        socket.on('toggleGameMode', (newMode) => {
            const lobbyId = playerLobbies[socket.id];
            if (!lobbyId || !lobbies[lobbyId]) return;
            const lobby = lobbies[lobbyId];

            if (lobby.creatorId === socket.id && (newMode === 'ffa' || newMode === 'tdm')) {
                lobby.gameMode = newMode;
                if (newMode === 'tdm') {
                     let tIdx = 0;
                     const validTeams = ['red', 'blue', 'green', 'yellow'].slice(0, lobby.teamCount);
                     Object.values(lobby.players).forEach(p => {
                         p.team = validTeams[tIdx % lobby.teamCount];
                         tIdx++;
                     });
                } else {
                     Object.values(lobby.players).forEach(p => p.team = null);
                }
                broadcastLobbyState(lobbyId);
            }
        });

        socket.on('changeTeamCount', (count) => {
            const lobbyId = playerLobbies[socket.id];
            if (!lobbyId || !lobbies[lobbyId]) return;
            const lobby = lobbies[lobbyId];

            if (lobby.creatorId === socket.id && lobby.gameMode === 'tdm') {
                const numCount = parseInt(count);
                if (numCount >= 2 && numCount <= 4) {
                    lobby.teamCount = numCount;

                    const validTeams = ['red', 'blue', 'green', 'yellow'].slice(0, lobby.teamCount);
                    let needsRebalance = false;

                    Object.values(lobby.players).forEach(p => {
                        if (!validTeams.includes(p.team)) {
                            needsRebalance = true;
                        }
                    });

                    if (needsRebalance) {
                        let tIdx = 0;
                        Object.values(lobby.players).forEach(p => {
                            p.team = validTeams[tIdx % lobby.teamCount];
                            tIdx++;
                        });
                    }

                    broadcastLobbyState(lobbyId);
                }
            }
        });

        socket.on('changeTeam', (newTeam) => {
            const lobbyId = playerLobbies[socket.id];
            if (!lobbyId || !lobbies[lobbyId]) return;
            const lobby = lobbies[lobbyId];

            if (lobby.gameState === 'lobby' && lobby.gameMode === 'tdm') {
                const validTeams = ['red', 'blue', 'green', 'yellow'].slice(0, lobby.teamCount);
                if (validTeams.includes(newTeam)) {
                    lobby.players[socket.id].team = newTeam;
                    broadcastLobbyState(lobbyId);
                }
            }
        });

        function joinLobby(socket, lobbyId) {
            const lobby = lobbies[lobbyId];
            if (!lobby) return;

            leaveLobby(socket);

            socket.join(lobbyId);
            playerLobbies[socket.id] = lobbyId;

            lobby.players[socket.id] = {
                x: Math.floor(Math.random() * (GAME_WIDTH - 50)) + 25,
                y: Math.floor(Math.random() * (GAME_HEIGHT - 50)) + 25,
                color: `hsl(${Math.random() * 360}, 100%, 50%)`,
                id: socket.id,
                isReady: false,
                health: 100,
                ammo: 16,
                revolverAmmo: 6,
                weapon: 'pistol',
                isEliminated: false,
                isPlaying: false,
                lastShotTime: 0,
                team: null,
                speedBootsUntil: 0,
                rapidFireUntil: 0,
                armorCount: 0,
                isHidden: false
            };

            if (lobby.gameMode === 'tdm') {
                const validTeams = ['red', 'blue', 'green', 'yellow'].slice(0, lobby.teamCount);
                const teamCounts = {};
                validTeams.forEach(t => teamCounts[t] = 0);

                Object.values(lobby.players).forEach(p => {
                    if (teamCounts[p.team] !== undefined) {
                        teamCounts[p.team]++;
                    }
                });

                let bestTeam = validTeams[0];
                let minScore = 999;
                validTeams.forEach(t => {
                    if (teamCounts[t] < minScore) {
                        minScore = teamCounts[t];
                        bestTeam = t;
                    }
                });

                lobby.players[socket.id].team = bestTeam;
            }

            socket.emit('lobbyJoined', lobbyId);
            socket.emit('currentPlayers', lobby.players);

            Object.values(lobby.players).forEach(p => {
                p.votedMapIndex = undefined;
            });

            broadcastLobbyState(lobbyId);
            broadcastActiveLobbies();

            socket.to(lobbyId).emit('newPlayer', lobby.players[socket.id]);
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
                if (lobby.gameLoopInterval) clearInterval(lobby.gameLoopInterval);
                delete lobbies[lobbyId];
                broadcastActiveLobbies();
                return;
            }

            if (lobby.creatorId === socket.id) {
                lobby.creatorId = Object.keys(lobby.players)[0];
            }

            if (lobby.gameState === 'lobby') {
                broadcastLobbyState(lobbyId);
            } else if (lobby.gameState === 'playing') {
                const alivePlayers = Object.values(lobby.players).filter(pl => !pl.isEliminated && pl.isPlaying);
                if (lobby.gameMode === 'tdm') {
                    const aliveTeams = new Set(alivePlayers.map(p => p.team));
                    if (aliveTeams.size <= 1) {
                        let winnerTeam = aliveTeams.size === 1 ? aliveTeams.values().next().value : null;
                        triggerGameOver(lobbyId, { winnerTeam: winnerTeam });
                    }
                } else {
                    if (alivePlayers.length <= 1) {
                        let winnerId = null;
                        if (alivePlayers.length === 1) {
                            winnerId = alivePlayers[0].id;
                        }
                        triggerGameOver(lobbyId, { winnerId: winnerId });
                    }
                }
            }

            nsp.to(lobbyId).emit('playerDisconnected', socket.id);
            broadcastActiveLobbies();
        }

        socket.on('disconnect', () => {
            console.log('[Counter-Stride] User disconnected:', socket.id);
            leaveLobby(socket);
        });

        socket.on('toggleReady', () => {
            const lobbyId = playerLobbies[socket.id];
            if (!lobbyId || !lobbies[lobbyId]) return;
            const lobby = lobbies[lobbyId];

            if (lobby.players[socket.id] && lobby.gameState === 'lobby') {
                lobby.players[socket.id].isReady = !lobby.players[socket.id].isReady;
                broadcastLobbyState(lobbyId);
                checkGameStart(lobbyId);
            }
        });

        socket.on('voteMap', (index) => {
            const lobbyId = playerLobbies[socket.id];
            if (!lobbyId || !lobbies[lobbyId]) return;
            const lobby = lobbies[lobbyId];

            if (lobby.gameState !== 'lobby') return;

            const lobbySize = Object.keys(lobby.players).length;
            const targetMap = lobby.uploadedMaps[index];

            if (targetMap && targetMap.data && targetMap.data.maxPlayers) {
                if (lobbySize > targetMap.data.maxPlayers) {
                    return;
                }
            }

            if (lobby.players[socket.id] && index >= 0 && index < lobby.uploadedMaps.length) {
                lobby.players[socket.id].votedMapIndex = index;
                broadcastLobbyState(lobbyId);
            }
        });

        socket.on('uploadMap', (payload) => {
            const lobbyId = playerLobbies[socket.id];
            if (!lobbyId || !lobbies[lobbyId]) return;
            const lobby = lobbies[lobbyId];

            if (lobby.gameState !== 'lobby') return;
            try {
                const mapObj = JSON.parse(payload.data);
                if (mapObj.data && mapObj.cols && mapObj.rows) {
                    lobby.uploadedMaps.push({
                        name: payload.name || `Custom Map ${lobby.uploadedMaps.length}`,
                        data: mapObj
                    });
                    broadcastLobbyState(lobbyId);
                }
            } catch (e) {
                console.error("Invalid map upload JSON from", socket.id);
            }
        });

        socket.on('deleteMap', (index) => {
            const lobbyId = playerLobbies[socket.id];
            if (!lobbyId || !lobbies[lobbyId]) return;
            const lobby = lobbies[lobbyId];

            if (lobby.gameState !== 'lobby') return;

            if (lobby.creatorId !== socket.id || index <= 0 || index >= lobby.uploadedMaps.length) return;

            lobby.uploadedMaps.splice(index, 1);

            Object.values(lobby.players).forEach(p => {
                if (p.votedMapIndex === index) {
                    p.votedMapIndex = undefined;
                } else if (p.votedMapIndex > index) {
                    p.votedMapIndex--;
                }
            });

            broadcastLobbyState(lobbyId);
        });

        function checkGameStart(lobbyId) {
            const lobby = lobbies[lobbyId];
            const playerKeys = Object.keys(lobby.players);
            if (playerKeys.length >= 2) {
                const allReady = playerKeys.every(id => lobby.players[id].isReady);
                if (allReady) {
                    lobby.gameState = 'playing';
                    lobby.items = {};
                    totalGamesPlayed++;
                    broadcastActiveLobbies();

                    let tdmPlayers = [...playerKeys];
                    tdmPlayers.sort(() => Math.random() - 0.5);

                    playerKeys.forEach(id => {
                        lobby.players[id].health = 100;
                        lobby.players[id].ammo = 16;
                        lobby.players[id].revolverAmmo = 6;
                        lobby.players[id].weapon = 'pistol';
                        lobby.players[id].isReloading = false;
                        lobby.players[id].isEliminated = false;
                        lobby.players[id].isPlaying = true;
                        lobby.players[id].lastShotTime = 0;
                        lobby.players[id].speedBootsUntil = 0;
                        lobby.players[id].rapidFireUntil = 0;
                        lobby.players[id].armorCount = 0;
                        lobby.players[id].isHidden = false;

                        if (lobby.gameMode === 'tdm') {
                            if (lobby.players[id].team === 'red') lobby.players[id].color = '#ff4444';
                            else if (lobby.players[id].team === 'blue') lobby.players[id].color = '#4466ff';
                            else if (lobby.players[id].team === 'green') lobby.players[id].color = '#44ff44';
                            else if (lobby.players[id].team === 'yellow') lobby.players[id].color = '#ffff44';
                        } else {
                            lobby.players[id].team = null;
                            lobby.players[id].color = `hsl(${Math.random() * 360}, 100%, 50%)`;
                        }
                    });

                    let mapVotes = new Array(lobby.uploadedMaps.length).fill(0);
                    Object.values(lobby.players).forEach(p => {
                        if (p.votedMapIndex !== undefined && p.votedMapIndex >= 0 && p.votedMapIndex < lobby.uploadedMaps.length) {
                            mapVotes[p.votedMapIndex]++;
                        }
                    });

                    let maxVotes = -1;
                    let topMaps = [];
                    for (let i = 0; i < lobby.uploadedMaps.length; i++) {
                        if (mapVotes[i] > maxVotes) {
                            maxVotes = mapVotes[i];
                            topMaps = [lobby.uploadedMaps[i]];
                        } else if (mapVotes[i] === maxVotes) {
                            topMaps.push(lobby.uploadedMaps[i]);
                        }
                    }

                    const randomTiedIndex = Math.floor(Math.random() * topMaps.length);
                    const chosenMap = topMaps[randomTiedIndex];

                    if (chosenMap && chosenMap.data) {
                        lobby.currentMapData = JSON.parse(JSON.stringify(chosenMap.data));
                        const tileSize = lobby.currentMapData.tileSize || 50;
                        const mapGrid = lobby.currentMapData.data;
                        const pKeys = Object.keys(lobby.players);

                        lobby.blockHealth = [];
                        for (let r = 0; r < lobby.currentMapData.rows; r++) {
                            lobby.blockHealth[r] = new Array(lobby.currentMapData.cols).fill(0);
                            for (let c = 0; c < lobby.currentMapData.cols; c++) {
                                if (mapGrid[r][c] === 3) {
                                    lobby.blockHealth[r][c] = 100;
                                }
                            }
                        }

                        if (lobby.currentMapData.playerStarts && lobby.currentMapData.playerStarts.length > 0) {
                            const starts = lobby.currentMapData.playerStarts;
                            pKeys.forEach((pid, index) => {
                                if (index < starts.length) {
                                    lobby.players[pid].x = starts[index].c * tileSize + tileSize / 2;
                                    lobby.players[pid].y = starts[index].r * tileSize + tileSize / 2;
                                }
                            });
                        } else if (mapGrid) {
                            let p1Spawned = false;
                            let p2Spawned = false;

                            for (let r = 0; r < lobby.currentMapData.rows; r++) {
                                for (let c = 0; c < lobby.currentMapData.cols; c++) {
                                    if (mapGrid[r][c] === 2 && !p1Spawned && pKeys[0]) {
                                        lobby.players[pKeys[0]].x = c * tileSize + tileSize / 2;
                                        lobby.players[pKeys[0]].y = r * tileSize + tileSize / 2;
                                        p1Spawned = true;
                                    } else if (mapGrid[r][c] === 3 && !p2Spawned && pKeys[1]) {
                                        lobby.players[pKeys[1]].x = c * tileSize + tileSize / 2;
                                        lobby.players[pKeys[1]].y = r * tileSize + tileSize / 2;
                                        p2Spawned = true;
                                    }
                                }
                            }
                        }
                    } else {
                        lobby.currentMapData = null;
                    }

                    nsp.to(lobbyId).emit('gameStart', {
                        map: chosenMap,
                        players: lobby.players,
                        playCount: totalGamesPlayed
                    });

                    startGameLoop(lobbyId);
                }
            }
        }

        socket.on('playerMovement', (movementData) => {
            const lobbyId = playerLobbies[socket.id];
            if (!lobbyId || !lobbies[lobbyId]) return;
            const lobby = lobbies[lobbyId];

            if (lobby.players[socket.id] && !lobby.players[socket.id].isEliminated) {
                lobby.players[socket.id].x = movementData.x;
                lobby.players[socket.id].y = movementData.y;
                lobby.players[socket.id].facingRight = movementData.facingRight;
                socket.to(lobbyId).emit('playerMoved', { id: socket.id, ...movementData });
            }
        });

        socket.on('shoot', (data) => {
            const lobbyId = playerLobbies[socket.id];
            if (!lobbyId || !lobbies[lobbyId]) return;
            const lobby = lobbies[lobbyId];

            const player = lobby.players[socket.id];
            if (!player || player.isEliminated || lobby.gameState !== 'playing') return;

            const now = Date.now();
            const isRevolver = player.weapon === 'revolver';
            const currentAmmo = isRevolver ? player.revolverAmmo : player.ammo;
            let fireRate = 400;
            if (isRevolver) {
                fireRate = 800;
            }
            if (now < player.rapidFireUntil) {
                fireRate = 100;
            }

            if (currentAmmo > 0 && !player.isReloading && (now - player.lastShotTime >= fireRate)) {
                if (isRevolver) {
                    player.revolverAmmo--;
                } else {
                    player.ammo--;
                }
                player.lastShotTime = now;

                if (isRevolver) {
                     const magnitude = Math.sqrt(data.dirX * data.dirX + data.dirY * data.dirY);
                     if (magnitude > 0) {
                         player.x -= (data.dirX / magnitude) * 15;
                         player.y -= (data.dirY / magnitude) * 15;
                     }
                }

                socket.emit('ammoUpdate', isRevolver ? player.revolverAmmo : player.ammo);

                const bulletId = uuidv4();
                const BULLET_SPEED = 15;

                const magnitude = Math.sqrt(data.dirX * data.dirX + data.dirY * data.dirY);
                let nX = 0, nY = 0;
                if (magnitude > 0) {
                    nX = data.dirX / magnitude;
                    nY = data.dirY / magnitude;
                } else {
                    nX = player.facingRight ? 1 : -1;
                }

                lobby.bullets[bulletId] = {
                    id: bulletId,
                    x: player.x,
                    y: player.y,
                    vx: nX * BULLET_SPEED,
                    vy: nY * BULLET_SPEED,
                    ownerId: socket.id,
                    team: player.team,
                    radius: isRevolver ? 2 : 4
                };
            }
        });

        socket.on('switchWeapon', (weaponName) => {
            const lobbyId = playerLobbies[socket.id];
            if (!lobbyId || !lobbies[lobbyId]) return;
            const lobby = lobbies[lobbyId];
            const player = lobby.players[socket.id];

            if (player && !player.isEliminated && (weaponName === 'pistol' || weaponName === 'revolver')) {
                player.weapon = weaponName;
                player.isReloading = false;
                socket.emit('ammoUpdate', weaponName === 'revolver' ? player.revolverAmmo : player.ammo);
            }
        });

        socket.on('reload', () => {
            const lobbyId = playerLobbies[socket.id];
            if (!lobbyId || !lobbies[lobbyId]) return;
            const lobby = lobbies[lobbyId];

            const player = lobby.players[socket.id];
            if (!player || player.isEliminated || player.isReloading || lobby.gameState !== 'playing') return;

            const isRevolver = player.weapon === 'revolver';
            const maxAmmo = isRevolver ? 6 : 16;
            const currentAmmo = isRevolver ? player.revolverAmmo : player.ammo;
            const reloadTime = isRevolver ? 1000 : 2000;

            if (currentAmmo === maxAmmo) return;

            player.isReloading = true;
            nsp.to(socket.id).emit('reloadStart');

            setTimeout(() => {
                if (lobby.players[socket.id] && lobby.players[socket.id].isReloading) {
                    if (lobby.players[socket.id].weapon === 'revolver') {
                        lobby.players[socket.id].revolverAmmo = 6;
                        nsp.to(socket.id).emit('ammoUpdate', 6);
                    } else {
                        lobby.players[socket.id].ammo = 16;
                        nsp.to(socket.id).emit('ammoUpdate', 16);
                    }
                    lobby.players[socket.id].isReloading = false;
                }
            }, reloadTime);
        });
    });
};
