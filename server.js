const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const { v4: uuidv4 } = require('uuid');
const io = new Server(server, {
  cors: {
    origin: "*", // Allow all origins to connect (or specify "http://gokalp.alkoc.net")
    methods: ["GET", "POST"]
  }
});

app.use(express.static('public'));

const players = {};
const uploadedMaps = [
    { name: "Default Arena", data: null } // null means no special map, use default canvas boundaries
];
let gameState = 'lobby'; // 'lobby' or 'playing'
let totalGamesPlayed = 0;

let bullets = {};
let gameLoopInterval = null;
let currentMapData = null;

const GAME_WIDTH = 800;
const GAME_HEIGHT = 600;

function broadcastLobbyState() {
    // Tally votes to send to clients
    const mapVotes = new Array(uploadedMaps.length).fill(0);
    Object.values(players).forEach(p => {
        if (p.votedMapIndex !== undefined && p.votedMapIndex >= 0 && p.votedMapIndex < uploadedMaps.length) {
            mapVotes[p.votedMapIndex]++;
        }
    });

    const mapsWithVotes = uploadedMaps.map((m, index) => ({
        name: m.name,
        votes: mapVotes[index],
        maxPlayers: m.data ? m.data.maxPlayers : undefined
    }));

    io.emit('lobbyState', {
        players: players,
        maps: mapsWithVotes,
        gameState: gameState
    });
}


io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);
    
    // Assign a random position and color to the new player
    players[socket.id] = {
        x: Math.floor(Math.random() * (GAME_WIDTH - 50)) + 25,
        y: Math.floor(Math.random() * (GAME_HEIGHT - 50)) + 25,
        color: `hsl(${Math.random() * 360}, 100%, 50%)`,
        id: socket.id,
        isReady: false,
        health: 100,
        ammo: 16,
        isEliminated: false,
        isPlaying: false,
        lastShotTime: 0
    };

    // If game already started, tell them (they might just watch, but we only have 2 players usually in 1 room)
    if (gameState === 'playing') {
        socket.emit('gameAlreadyStarted'); // Edge case handling
    }

    // Send the current players object to the new player
    socket.emit('currentPlayers', players);
    
    // Reset map votes for all players since player count changed
    if (gameState === 'lobby') {
        Object.values(players).forEach(p => {
            p.votedMapIndex = undefined;
        });
    }
    
    // Broadcast lobby state to everyone so UI updates
    broadcastLobbyState();
    
    // Broadcast the new player to all other players
    socket.broadcast.emit('newPlayer', players[socket.id]);

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        delete players[socket.id];
        
        // If a player leaves during lobby, update everyone
        if (gameState === 'lobby') {
            broadcastLobbyState();
        } else if (gameState === 'playing') {
            const alivePlayers = Object.values(players).filter(pl => !pl.isEliminated && pl.isPlaying);
            if (alivePlayers.length <= 1) {
                let winnerId = null;
                if (alivePlayers.length === 1) {
                    winnerId = alivePlayers[0].id;
                }
                triggerGameOver(winnerId);
            }
        }

        io.emit('playerDisconnected', socket.id);
    });

    // --- NEW LOBBY EVENTS ---
    socket.on('toggleReady', () => {
        if (players[socket.id] && gameState === 'lobby') {
            players[socket.id].isReady = !players[socket.id].isReady;
            broadcastLobbyState();
            checkGameStart();
        }
    });

    socket.on('voteMap', (index) => {
        if (gameState !== 'lobby') return;
        
        const lobbySize = Object.keys(players).length;
        const targetMap = uploadedMaps[index];
        
        if (targetMap && targetMap.data && targetMap.data.maxPlayers) {
            if (lobbySize > targetMap.data.maxPlayers) {
                // Ignore vote: map doesn't support this many players
                return;
            }
        }
        
        if (players[socket.id] && index >= 0 && index < uploadedMaps.length) {
            players[socket.id].votedMapIndex = index;
            broadcastLobbyState();
        }
    });

    socket.on('uploadMap', (mapJsonStr) => {
        if (gameState !== 'lobby') return;
        try {
            const mapObj = JSON.parse(mapJsonStr);
            if (mapObj.data && mapObj.cols && mapObj.rows) {
                uploadedMaps.push({
                    name: `Custom Map ${uploadedMaps.length}`,
                    data: mapObj
                });
                broadcastLobbyState();
            }
        } catch (e) {
            console.error("Invalid map upload JSON from", socket.id);
        }
    });
    
    function checkGameStart() {
        const playerKeys = Object.keys(players);
        // Require at least 2 players to start
        if (playerKeys.length >= 2) {
            const allReady = playerKeys.every(id => players[id].isReady);
            if (allReady) {
                // All are ready! Start the game.
                gameState = 'playing';
                totalGamesPlayed++;
                
                // Reset player stats for the new game
                playerKeys.forEach(id => {
                    players[id].health = 100;
                    players[id].ammo = 16;
                    players[id].isReloading = false;
                    players[id].isEliminated = false;
                    players[id].isPlaying = true;
                    players[id].lastShotTime = 0;
                });
                
                // Tally votes
                let mapVotes = new Array(uploadedMaps.length).fill(0);
                Object.values(players).forEach(p => {
                    if (p.votedMapIndex !== undefined && p.votedMapIndex >= 0 && p.votedMapIndex < uploadedMaps.length) {
                        mapVotes[p.votedMapIndex]++;
                    }
                });

                // Find the maximum votes
                let maxVotes = -1;
                let topMaps = [];
                for (let i = 0; i < uploadedMaps.length; i++) {
                    if (mapVotes[i] > maxVotes) {
                        maxVotes = mapVotes[i];
                        topMaps = [uploadedMaps[i]];
                    } else if (mapVotes[i] === maxVotes) {
                        topMaps.push(uploadedMaps[i]);
                    }
                }

                // Choose a random map from the tied top maps
                const randomTiedIndex = Math.floor(Math.random() * topMaps.length);
                const chosenMap = topMaps[randomTiedIndex];

                // Parse map for start positions
                if (chosenMap && chosenMap.data) {
                    currentMapData = chosenMap.data;
                    const tileSize = chosenMap.data.tileSize || 50;
                    const mapGrid = chosenMap.data.data;
                    const pKeys = Object.keys(players);
                    
                    if (chosenMap.data.playerStarts && chosenMap.data.playerStarts.length > 0) {
                        // New format: sequential array
                        const starts = chosenMap.data.playerStarts;
                        pKeys.forEach((pid, index) => {
                            if (index < starts.length) {
                                players[pid].x = starts[index].c * tileSize + tileSize / 2;
                                players[pid].y = starts[index].r * tileSize + tileSize / 2;
                            }
                        });
                    } else if (mapGrid) {
                        // Old format: scrape map grid for 2 and 3 blocks
                        let p1Spawned = false;
                        let p2Spawned = false;

                        for (let r = 0; r < chosenMap.data.rows; r++) {
                            for (let c = 0; c < chosenMap.data.cols; c++) {
                                if (mapGrid[r][c] === 2 && !p1Spawned && pKeys[0]) {
                                    players[pKeys[0]].x = c * tileSize + tileSize / 2;
                                    players[pKeys[0]].y = r * tileSize + tileSize / 2;
                                    p1Spawned = true;
                                } else if (mapGrid[r][c] === 3 && !p2Spawned && pKeys[1]) {
                                    players[pKeys[1]].x = c * tileSize + tileSize / 2;
                                    players[pKeys[1]].y = r * tileSize + tileSize / 2;
                                    p2Spawned = true;
                                }
                            }
                        }
                    }
                } else {
                    currentMapData = null;
                }

                io.emit('gameStart', {
                    map: chosenMap,
                    players: players, // Ensure all clients have latest init position
                    playCount: totalGamesPlayed
                });
                
                startGameLoop();
            }
        }
    }
    // --- END NEW LOBBY EVENTS ---

    socket.on('playerMovement', (movementData) => {
        if (players[socket.id] && !players[socket.id].isEliminated) {
            players[socket.id].x = movementData.x;
            players[socket.id].y = movementData.y;
            players[socket.id].facingRight = movementData.facingRight;
            // Broadcast the movement to all OTHER players
            socket.broadcast.emit('playerMoved', { id: socket.id, ...movementData });
        }
    });

    socket.on('shoot', (data) => {
        const player = players[socket.id];
        if (!player || player.isEliminated || gameState !== 'playing') return;

        const now = Date.now();
        if (player.ammo > 0 && !player.isReloading && (now - player.lastShotTime >= 40)) {
            player.ammo--;
            player.lastShotTime = now;

            // Optional: send ammo update specifically to the shooter, 
            // but the game loop broadcasts all player stats anyway.
            socket.emit('ammoUpdate', player.ammo);

            const bulletId = uuidv4();
            const BULLET_SPEED = 15;
            
            // Normalize direction vector
            const magnitude = Math.sqrt(data.dirX * data.dirX + data.dirY * data.dirY);
            let nX = 0, nY = 0;
            if (magnitude > 0) {
                nX = data.dirX / magnitude;
                nY = data.dirY / magnitude;
            } else {
                nX = player.facingRight ? 1 : -1;
            } // Fallback if no direction
            
            bullets[bulletId] = {
                id: bulletId,
                x: player.x, // spawn at center of player
                y: player.y,
                vx: nX * BULLET_SPEED,
                vy: nY * BULLET_SPEED,
                ownerId: socket.id,
                radius: 4
            };
        }
    });

    socket.on('reload', () => {
        const player = players[socket.id];
        if (!player || player.isEliminated || player.isReloading || player.ammo === 16 || gameState !== 'playing') return;

        player.isReloading = true;
        io.to(socket.id).emit('reloadStart');

        setTimeout(() => {
            if (players[socket.id] && players[socket.id].isReloading) {
                players[socket.id].ammo = 16;
                players[socket.id].isReloading = false;
                io.to(socket.id).emit('ammoUpdate', 16);
            }
        }, 2000);
    });
});

function triggerGameOver(winnerId) {
    if (gameState !== 'playing') return;
    io.emit('gameOver', { winnerId: winnerId });
    stopGameLoop();
    gameState = 'gameover'; // Prevent multiple triggers
    
    // Return to lobby after 5 seconds
    setTimeout(() => {
        gameState = 'lobby';
        Object.values(players).forEach(p => {
            p.isReady = false;
            p.health = 100;
            p.ammo = 16;
            p.isReloading = false;
            p.isEliminated = false;
            p.isPlaying = false;
        });
        broadcastLobbyState();
        io.emit('resetToLobby');
    }, 5000);
}

function startGameLoop() {
    bullets = {};
    if (gameLoopInterval) clearInterval(gameLoopInterval);
    
    // 60 FPS
    gameLoopInterval = setInterval(() => {
        updatePhysics();
    }, 1000 / 60);
}

function stopGameLoop() {
    if (gameLoopInterval) {
        clearInterval(gameLoopInterval);
        gameLoopInterval = null;
    }
}

function updatePhysics() {
    // Move and check bullet collisions
    const bulletKeys = Object.keys(bullets);
    for (let i = 0; i < bulletKeys.length; i++) {
        const bId = bulletKeys[i];
        const b = bullets[bId];
        
        b.x += b.vx;
        b.y += b.vy;
        
        let destroyed = false;
        
        // 1. Map boundaries collision
        if (b.x < 0 || b.x > GAME_WIDTH || b.y < 0 || b.y > GAME_HEIGHT) {
            destroyed = true;
        }
        
        // 2. Map tiles collision
        if (!destroyed && currentMapData) {
            const tileSize = currentMapData.tileSize || 50;
            const col = Math.floor(b.x / tileSize);
            const row = Math.floor(b.y / tileSize);
            
            if (row >= 0 && row < currentMapData.rows && col >= 0 && col < currentMapData.cols) {
                if (currentMapData.data[row][col] === 1) { // 1 is a wall block
                    destroyed = true;
                }
            }
        }
        
        // 3. Player collision
        if (!destroyed) {
            const playerKeys = Object.keys(players);
            for (let j = 0; j < playerKeys.length; j++) {
                const pId = playerKeys[j];
                const p = players[pId];
                
                // Don't hit owner or eliminated players
                if (pId === b.ownerId || p.isEliminated) continue;
                
                // Simple circle collision (player approx 30x30, radius 15)
                const dx = p.x - b.x;
                const dy = p.y - b.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                
                if (dist < 15 + b.radius) {
                    // Hit!
                    p.health -= 25;
                    destroyed = true;
                    
                    if (p.health <= 0) {
                        p.health = 0;
                        p.isEliminated = true;
                        io.emit('playerEliminated', pId);
                        
                        // Check if game over? 
                        const alivePlayers = Object.values(players).filter(pl => !pl.isEliminated && pl.isPlaying);
                        if (alivePlayers.length <= 1) {
                            let winnerId = null;
                            if (alivePlayers.length === 1) {
                                winnerId = alivePlayers[0].id;
                            }
                            triggerGameOver(winnerId);
                        }
                    }
                    break;
                }
            }
        }
        
        if (destroyed) {
            delete bullets[bId];
        }
    }
    
    // Broadcast state to all clients
    io.emit('gameStateUpdate', {
        bullets: Object.values(bullets),
        players: players // sending players syncs health, ammo, and isEliminated status
    });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
