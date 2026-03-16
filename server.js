const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
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
        isReady: false
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
        } else if (Object.keys(players).length < 2) {
            // If someone leaves during the game and < 2 players remain, maybe reset to lobby?
            // For now, let's reset to lobby
            gameState = 'lobby';
            Object.values(players).forEach(p => p.isReady = false);
            broadcastLobbyState();
            io.emit('resetToLobby');
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
                }

                io.emit('gameStart', {
                    map: chosenMap,
                    players: players, // Ensure all clients have latest init position
                    playCount: totalGamesPlayed
                });
            }
        }
    }
    // --- END NEW LOBBY EVENTS ---

    socket.on('playerMovement', (movementData) => {
        if (players[socket.id]) {
            players[socket.id].x = movementData.x;
            players[socket.id].y = movementData.y;
            players[socket.id].facingRight = movementData.facingRight;
            // Broadcast the movement to all OTHER players
            socket.broadcast.emit('playerMoved', players[socket.id]);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
