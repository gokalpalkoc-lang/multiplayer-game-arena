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
    }
});

// Serve the homepage / shared assets from public root
app.use(express.static(path.join(__dirname, 'public')));

// Simple healthcheck endpoint
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// Ignore favicon to prevent 404 errors
app.get('/favicon.ico', (req, res) => res.status(204).end());

// --- Register Game Modules ---
// Each game module receives the io instance and sets up its own namespace
require('./games/counterStride')(io);
require('./games/pixelKart')(io);
require('./games/battlePong')(io);
require('./games/territoryWars')(io);

console.log('Game modules loaded: Counter-Stride, Pixel Kart, Battle Pong, Territory Wars');

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Game Arena server listening on port ${PORT} at 0.0.0.0`);
});
