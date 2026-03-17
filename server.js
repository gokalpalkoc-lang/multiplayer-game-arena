const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const io = new Server(server, {
  cors: {
    origin: "*", // Allow all origins to connect (or specify "http://gokalp.alkoc.net")
    methods: ["GET", "POST"]
  }
});

// Use path.join to ensure the public directory is resolved correctly regardless of where the node process was started
app.use(express.static(path.join(__dirname, 'public')));

// Simple healthcheck endpoint for Render / cloud providers to verify the server is active
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

const lobbies = {}; // Map of lobbyId -> lobbyData
const playerLobbies = {}; // Map of socket.id -> lobbyId

// Global maps removed, map logic moved to be per-lobby

let totalGamesPlayed = 0;

const GAME_WIDTH = 800;
const GAME_HEIGHT = 600;

function broadcastLobbyState(lobbyId) {
    const lobby = lobbies[lobbyId];
    if (!lobby) return;

    // Tally votes to send to clients
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

    io.to(lobbyId).emit('lobbyState', {
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
    io.emit('activeLobbies', publicLobbies);
}


io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);
    
    // Send active lobbies to the new connection
    broadcastActiveLobbies();
    
    socket.on('createLobby', () => {
        const lobbyId = uuidv4().substring(0, 8); // Short ID for UI
        lobbies[lobbyId] = {
            id: lobbyId,
            name: `${socket.id.substring(0,4)}'s Lobby`,
            creatorId: socket.id,
            players: {},
            gameState: 'lobby',
            gameMode: 'ffa',
            teamCount: 2,
            bullets: {},
            items: {}, // generic power-ups
            gameLoopInterval: null,
            currentMapData: null,
            uploadedMaps: [
                { name: "Default Arena", data: null }
            ]
        };
        joinLobby(socket, lobbyId);
        broadcastActiveLobbies();
    });

    // Handle user trying to join an existing lobby
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
            lobby.name = newName.substring(0, 30); // Max 30 chars
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
            // When switching to TDM, assign everyone a team
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
                
                // Reassign teams if someone is on an invalid team
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

        // Leave current lobby if any
        leaveLobby(socket);

        socket.join(lobbyId);
        playerLobbies[socket.id] = lobbyId;

        // Assign a random position and color to the new player
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
            team: null, // Assigned when joining a TDM lobby
            speedBootsUntil: 0,
            rapidFireUntil: 0,
            armorCount: 0,
            isHidden: false
        };
        
        if (lobby.gameMode === 'tdm') {
            // Find team with fewest members
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

        // Notify them they joined
        socket.emit('lobbyJoined', lobbyId);

        // Send the current players object to the new player
        socket.emit('currentPlayers', lobby.players);
        
        // Reset map votes for all players in this lobby since player count changed
        Object.values(lobby.players).forEach(p => {
            p.votedMapIndex = undefined;
        });
        
        // Broadcast lobby state
        broadcastLobbyState(lobbyId);
        broadcastActiveLobbies();
        
        // Broadcast the new player to all other players in lobby
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
            // Destroy empty lobby
            if (lobby.gameLoopInterval) clearInterval(lobby.gameLoopInterval);
            delete lobbies[lobbyId];
            broadcastActiveLobbies();
            return;
        }

        // Reassign creator if creator leaves
        if (lobby.creatorId === socket.id) {
            lobby.creatorId = Object.keys(lobby.players)[0]; // pass to next player
        }

        // If a player leaves during lobby, update everyone
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
        
        io.to(lobbyId).emit('playerDisconnected', socket.id);
        broadcastActiveLobbies();
    }

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        leaveLobby(socket);
    });

    // --- NEW LOBBY EVENTS ---
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
                // Ignore vote: map doesn't support this many players
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
                // Broadcast only to this lobby
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
        
        // Only creator can delete, and cannot delete default map (index 0)
        if (lobby.creatorId !== socket.id || index <= 0 || index >= lobby.uploadedMaps.length) return;

        lobby.uploadedMaps.splice(index, 1);
        
        // Reset votes for anyone who voted for the deleted map or shift indices
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
        // Require at least 2 players to start
        if (playerKeys.length >= 2) {
            const allReady = playerKeys.every(id => lobby.players[id].isReady);
            if (allReady) {
                // All are ready! Start the game.
                lobby.gameState = 'playing';
                lobby.items = {}; // Replaced healingItems with items
                totalGamesPlayed++;
                broadcastActiveLobbies();
                
                // Reset player stats for the new game
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
                        // Keep their selected team, but assign their color
                        if (lobby.players[id].team === 'red') lobby.players[id].color = '#ff4444';
                        else if (lobby.players[id].team === 'blue') lobby.players[id].color = '#4466ff';
                        else if (lobby.players[id].team === 'green') lobby.players[id].color = '#44ff44';
                        else if (lobby.players[id].team === 'yellow') lobby.players[id].color = '#ffff44';
                    } else {
                        lobby.players[id].team = null;
                        lobby.players[id].color = `hsl(${Math.random() * 360}, 100%, 50%)`;
                    }
                });
                
                // Tally votes
                let mapVotes = new Array(lobby.uploadedMaps.length).fill(0);
                Object.values(lobby.players).forEach(p => {
                    if (p.votedMapIndex !== undefined && p.votedMapIndex >= 0 && p.votedMapIndex < lobby.uploadedMaps.length) {
                        mapVotes[p.votedMapIndex]++;
                    }
                });

                // Find the maximum votes
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

                // Choose a random map from the tied top maps
                const randomTiedIndex = Math.floor(Math.random() * topMaps.length);
                const chosenMap = topMaps[randomTiedIndex];

                // Parse map for start positions
                if (chosenMap && chosenMap.data) {
                    // DEEP COPY the map so destructible walls destroyed don't persist
                    lobby.currentMapData = JSON.parse(JSON.stringify(chosenMap.data));
                    const tileSize = lobby.currentMapData.tileSize || 50;
                    const mapGrid = lobby.currentMapData.data;
                    const pKeys = Object.keys(lobby.players);
                    
                    // Initialize block array for destructible walls
                    lobby.blockHealth = [];
                    for (let r = 0; r < lobby.currentMapData.rows; r++) {
                        lobby.blockHealth[r] = new Array(lobby.currentMapData.cols).fill(0);
                        for (let c = 0; c < lobby.currentMapData.cols; c++) {
                            if (mapGrid[r][c] === 3) {
                                lobby.blockHealth[r][c] = 100; // 100 health per block
                            }
                        }
                    }
                    
                    if (lobby.currentMapData.playerStarts && lobby.currentMapData.playerStarts.length > 0) {
                        // New format: sequential array
                        const starts = lobby.currentMapData.playerStarts;
                        pKeys.forEach((pid, index) => {
                            if (index < starts.length) {
                                lobby.players[pid].x = starts[index].c * tileSize + tileSize / 2;
                                lobby.players[pid].y = starts[index].r * tileSize + tileSize / 2;
                            }
                        });
                    } else if (mapGrid) {
                        // Old format: scrape map grid for 2 and 3 blocks
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

                io.to(lobbyId).emit('gameStart', {
                    map: chosenMap,
                    players: lobby.players, // Ensure all clients have latest init position
                    playCount: totalGamesPlayed
                });
                
                startGameLoop(lobbyId);
            }
        }
    }
    // --- END NEW LOBBY EVENTS ---

    socket.on('playerMovement', (movementData) => {
        const lobbyId = playerLobbies[socket.id];
        if (!lobbyId || !lobbies[lobbyId]) return;
        const lobby = lobbies[lobbyId];

        if (lobby.players[socket.id] && !lobby.players[socket.id].isEliminated) {
            lobby.players[socket.id].x = movementData.x;
            lobby.players[socket.id].y = movementData.y;
            lobby.players[socket.id].facingRight = movementData.facingRight;
            // Broadcast the movement to all OTHER players
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
        let fireRate = 400; // pistol base fire rate
        if (isRevolver) {
            fireRate = 800;
        }
        if (now < player.rapidFireUntil) {
            fireRate = 100; // very fast fire rate
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
        io.to(socket.id).emit('reloadStart');

        setTimeout(() => {
            if (lobby.players[socket.id] && lobby.players[socket.id].isReloading) {
                if (lobby.players[socket.id].weapon === 'revolver') {
                    lobby.players[socket.id].revolverAmmo = 6;
                    io.to(socket.id).emit('ammoUpdate', 6);
                } else {
                    lobby.players[socket.id].ammo = 16;
                    io.to(socket.id).emit('ammoUpdate', 16);
                }
                lobby.players[socket.id].isReloading = false;
            }
        }, reloadTime);
    });
});

function triggerGameOver(lobbyId, result) {
    const lobby = lobbies[lobbyId];
    if (!lobby || lobby.gameState !== 'playing') return;

    io.to(lobbyId).emit('gameOver', result);
    stopGameLoop(lobbyId);
    lobby.gameState = 'gameover'; // Prevent multiple triggers
    broadcastActiveLobbies();
    
    // Return to lobby after 5 seconds
    setTimeout(() => {
        if (!lobbies[lobbyId]) return;
        lobby.gameState = 'lobby';
        lobby.items = {}; // Reset items
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
        io.to(lobbyId).emit('resetToLobby');
    }, 5000);
}

function startGameLoop(lobbyId) {
    const lobby = lobbies[lobbyId];
    if (!lobby) return;

    lobby.bullets = {};
    if (lobby.gameLoopInterval) clearInterval(lobby.gameLoopInterval);
    
    // 60 FPS
    lobby.gameLoopInterval = setInterval(() => {
        updatePhysics(lobbyId);
    }, 1000 / 60);

    // Initial spawner setup
    lobby.lastItemSpawnTime = Date.now();
    // Spawner handles random item drops periodically
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

    // Move and check bullet collisions
    const bulletKeys = Object.keys(lobby.bullets);
    for (let i = 0; i < bulletKeys.length; i++) {
        const bId = bulletKeys[i];
        const b = lobby.bullets[bId];
        
        b.x += b.vx;
        b.y += b.vy;
        
        let destroyed = false;
        
        // 1. Map boundaries collision
        if (b.x < 0 || b.x > GAME_WIDTH || b.y < 0 || b.y > GAME_HEIGHT) {
            destroyed = true;
        }
        
        // 2. Map tiles collision
        if (!destroyed && lobby.currentMapData) {
            const tileSize = lobby.currentMapData.tileSize || 50;
            const col = Math.floor(b.x / tileSize);
            const row = Math.floor(b.y / tileSize);
            
            if (row >= 0 && row < lobby.currentMapData.rows && col >= 0 && col < lobby.currentMapData.cols) {
                const tileType = lobby.currentMapData.data[row][col];
                if (tileType === 1) { // 1 is a wall block
                    destroyed = true;
                } else if (tileType === 3) { // 3 is destructible wall
                    destroyed = true;
                    if (lobby.blockHealth[row] && lobby.blockHealth[row][col] !== undefined) {
                        lobby.blockHealth[row][col] -= 25;
                        if (lobby.blockHealth[row][col] <= 0) {
                            lobby.currentMapData.data[row][col] = 0; // turn into empty tile
                            io.to(lobbyId).emit('mapUpdate', { row: row, col: col, type: 0 }); // Tell clients block is broken
                        }
                    }
                }
            }
        }
        
        // 3. Player collision
        if (!destroyed) {
            const playerKeys = Object.keys(lobby.players);
            for (let j = 0; j < playerKeys.length; j++) {
                const pId = playerKeys[j];
                const p = lobby.players[pId];
                
                // Don't hit owner or eliminated players
                if (pId === b.ownerId || p.isEliminated) continue;
                
                // Do not allow friendly fire in TDM
                if (lobby.gameMode === 'tdm' && p.team === b.team && b.team != null) continue;
                
                // Simple circle collision (player approx 30x30, radius 15)
                const dx = p.x - b.x;
                const dy = p.y - b.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                
                if (dist < 15 + b.radius) {
                    // Hit!
                    destroyed = true;
                    if (p.armorCount > 0) {
                        p.armorCount--;
                    } else {
                        p.health -= 25;
                    }
                    
                    if (p.health <= 0) {
                        p.health = 0;
                        p.isEliminated = true;
                        io.to(lobbyId).emit('playerEliminated', pId);
                        
                        // spawn a random item
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
                        
                        // Check if game over? 
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

            for (let j = 0; j < playerKeys.length; j++) {
                const pId = playerKeys[j];
                const p = lobby.players[pId];

                // Only active players can consume
                if (p.isEliminated || !p.isPlaying) continue;

                const dx = p.x - item.x;
                const dy = p.y - item.y;
                const dist = Math.sqrt(dx * dx + dy * dy);

                // Player radius is 15, item radius is 10
                if (dist < 15 + item.radius) {
                    if (item.type === 'health') {
                        p.health = 100;
                    } else if (item.type === 'speed') {
                        p.speedBootsUntil = Date.now() + 10000; // 10 seconds
                    } else if (item.type === 'armor') {
                        p.armorCount = 2; // Absorbs 2 bullets
                    } else if (item.type === 'rapidfire') {
                        p.rapidFireUntil = Date.now() + 5000; // 5 seconds
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
    // Periodic Item Spawner
    if (now - lobby.lastItemSpawnTime > 15000) {
        lobby.lastItemSpawnTime = now;
        if (lobby.currentMapData && Object.keys(lobby.items).length < 10) { // cap items
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

    // Process Stealth Logic
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
            // hide after standing still for 500ms
            if (now - p.stillTimer > 500) {
                p.isHidden = true;
            }
        } else {
            p.stillTimer = 0;
            p.isHidden = false;
        }
    }

    // Broadcast state to all clients in loop
    io.to(lobbyId).emit('gameStateUpdate', {
        bullets: Object.values(lobby.bullets),
        players: lobby.players, // sending players syncs health, ammo, and isEliminated status
        items: lobby.items ? Object.values(lobby.items) : []
    });
}

const PORT = process.env.PORT || 3000;
// Explicitly bind to '0.0.0.0' so that it is properly accessible on cloud host networking
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on port ${PORT} at 0.0.0.0`);
});
