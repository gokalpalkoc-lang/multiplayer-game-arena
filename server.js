const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const path = require('path');

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    // Performance: compress WebSocket messages to reduce bandwidth
    perMessageDeflate: {
        threshold: 256, // only compress messages > 256 bytes
        zlibDeflateOptions: { level: 1 }, // fast compression (level 1)
    },
    // Faster disconnect detection
    pingInterval: 10000,
    pingTimeout: 5000,
});

// Serve the homepage / shared assets from public root
app.use(express.static(path.join(__dirname, 'public')));

// Simple healthcheck endpoint
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// Ignore favicon to prevent 404 errors
app.get('/favicon.ico', (req, res) => res.status(204).end());

// --- Database Layer ---
const arenaDB = require('./db');

// Attach DB to io so game modules can access it
io.arenaDB = arenaDB;

// --- Leaderboard API Endpoints ---
app.get('/api/leaderboard', (req, res) => {
    const sortBy = req.query.sort || 'coins';
    const limit = Math.min(parseInt(req.query.limit) || 15, 50);
    const data = arenaDB.getLeaderboard(sortBy, limit);
    res.json({ leaderboard: data, sortBy });
});

app.get('/api/leaderboard/:game', (req, res) => {
    const game = req.params.game;
    const limit = Math.min(parseInt(req.query.limit) || 15, 50);
    const data = arenaDB.getGameLeaderboard(game, limit);
    res.json({ leaderboard: data, game });
});

app.get('/api/user/:username', (req, res) => {
    const stats = arenaDB.getUserStats(req.params.username);
    if (!stats) return res.status(404).json({ error: 'User not found' });
    res.json(stats);
});

// --- Register Global Hub ---
// The hub provides global chat, online presence, and party system
require('./games/globalHub')(io);

// --- Register Game Modules ---
// Each game module receives the io instance and sets up its own namespace
require('./games/counterStride')(io);
require('./games/pixelKart')(io);
require('./games/battlePong')(io);
require('./games/territoryWars')(io);
require('./games/coopPuzzle')(io);
require('./games/brawler')(io);
require('./games/battleRoyale')(io);
require('./games/socialDeduction')(io);
require('./games/donkeyCompetition')(io);

console.log('Game modules loaded: Hub, Counter-Stride, Pixel Kart, Battle Pong, Territory Wars, Co-op Puzzle, Brawler, Battle Royale, Social Deduction, Donkey Competition');

const PORT = process.env.PORT || 3000;
const listener = server.listen(PORT, '0.0.0.0', () => {
    console.log(`Game Arena server listening on port ${PORT} at 0.0.0.0`);
});

// Graceful shutdown
function shutdown() {
    console.log('Shutting down gracefully...');
    listener.close(() => {
        console.log('HTTP server closed.');
        if (arenaDB && typeof arenaDB.close === 'function') {
            arenaDB.close();
            console.log('Database closed.');
        }
        process.exit(0);
    });
    
    // Force close if server takes too long
    setTimeout(() => {
        console.error('Could not close connections in time, forcefully shutting down');
        process.exit(1);
    }, 5000);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.once('SIGUSR2', function () {
    shutdown();
});
