const { v4: uuidv4 } = require('uuid');

module.exports = function(io) {
    const nsp = io.of('/donkey-competition');
    const arenaDB = io.arenaDB;

    const lobbies = {};
    const playerLobbies = {};

    // ─── Constants ────────────────────────────────────────────
    const RACE_WIDTH = 900;
    const RACE_HEIGHT = 500;
    const HORSE_RADIUS = 12;
    const NUM_HORSES = 6;
    const STARTING_MONEY = 500;
    const MIN_BET = 1;
    const BETTING_TIME = 30; // seconds
    const TICK_RATE = 30;    // fps

    const HORSE_NAMES = [
        'Dusty Dash', 'Golden Hoof', 'Shadow Bray',
        'Lucky Ears', 'Wild Kick', 'Iron Tail'
    ];
    const HORSE_COLORS = [
        '#ff4444', '#ffcc00', '#4488ff',
        '#44ff44', '#ff66ff', '#ff8800'
    ];

    // ─── Pre-defined Tracks ──────────────────────────────────
    const TRACKS = [
        {
            name: 'Thunder Valley',
            walls: [
                // Outer bounds are implicit (0,0 to RACE_WIDTH, RACE_HEIGHT)
            ],
            obstacles: [
                { x: 250, y: 100, w: 40, h: 120 },
                { x: 450, y: 280, w: 40, h: 120 },
                { x: 600, y: 80, w: 120, h: 30 },
                { x: 350, y: 380, w: 120, h: 30 },
            ],
            finishZone: { x: 830, y: 0, w: 70, h: RACE_HEIGHT }
        },
        {
            name: 'Emerald Circuit',
            walls: [],
            obstacles: [
                { x: 200, y: 180, w: 100, h: 30 },
                { x: 400, y: 120, w: 30, h: 160 },
                { x: 550, y: 300, w: 100, h: 30 },
                { x: 700, y: 100, w: 30, h: 140 },
                { x: 300, y: 350, w: 30, h: 100 },
            ],
            finishZone: { x: 830, y: 0, w: 70, h: RACE_HEIGHT }
        },
        {
            name: 'Canyon Run',
            walls: [],
            obstacles: [
                { x: 180, y: 60, w: 30, h: 180 },
                { x: 350, y: 260, w: 30, h: 180 },
                { x: 520, y: 40, w: 30, h: 200 },
                { x: 680, y: 250, w: 30, h: 200 },
                { x: 400, y: 200, w: 80, h: 25 },
            ],
            finishZone: { x: 830, y: 0, w: 70, h: RACE_HEIGHT }
        }
    ];

    // ─── Helpers ──────────────────────────────────────────────

    function broadcastLobbyState(lobbyId) {
        const lobby = lobbies[lobbyId];
        if (!lobby) return;

        nsp.to(lobbyId).emit('lobbyState', {
            id: lobby.id,
            name: lobby.name,
            creatorId: lobby.creatorId,
            players: Object.values(lobby.players).map(p => ({
                id: p.id,
                username: p.username,
                money: p.money,
                isReady: p.isReady,
                eliminated: p.eliminated,
                bet: p.bet,
                horseChoice: p.horseChoice
            })),
            gameState: lobby.gameState,
            raceNumber: lobby.raceNumber,
            track: lobby.track ? { name: lobby.track.name, obstacles: lobby.track.obstacles, finishZone: lobby.track.finishZone } : null
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

    function createHorses() {
        const horses = [];
        for (let i = 0; i < NUM_HORSES; i++) {
            const startY = 40 + (i * (RACE_HEIGHT - 80) / (NUM_HORSES - 1));
            // Random velocity direction and magnitude
            const speed = 2.5 + Math.random() * 2.5;
            const angle = (Math.random() * Math.PI / 3) - Math.PI / 6; // Mostly rightward
            horses.push({
                id: i + 1,
                name: HORSE_NAMES[i],
                color: HORSE_COLORS[i],
                x: 40 + Math.random() * 20,
                y: startY,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                finished: false
            });
        }
        return horses;
    }

    function pickTrack() {
        return TRACKS[Math.floor(Math.random() * TRACKS.length)];
    }

    function bounceOffBounds(horse) {
        const r = HORSE_RADIUS;
        if (horse.x - r < 0) {
            horse.x = r;
            horse.vx = Math.abs(horse.vx);
            addSpeedVariation(horse);
        }
        if (horse.x + r > RACE_WIDTH) {
            horse.x = RACE_WIDTH - r;
            horse.vx = -Math.abs(horse.vx);
            addSpeedVariation(horse);
        }
        if (horse.y - r < 0) {
            horse.y = r;
            horse.vy = Math.abs(horse.vy);
            addSpeedVariation(horse);
        }
        if (horse.y + r > RACE_HEIGHT) {
            horse.y = RACE_HEIGHT - r;
            horse.vy = -Math.abs(horse.vy);
            addSpeedVariation(horse);
        }
    }

    function bounceOffObstacles(horse, obstacles) {
        const r = HORSE_RADIUS;
        for (const obs of obstacles) {
            // Check circle-rect collision
            const closestX = Math.max(obs.x, Math.min(horse.x, obs.x + obs.w));
            const closestY = Math.max(obs.y, Math.min(horse.y, obs.y + obs.h));
            const dx = horse.x - closestX;
            const dy = horse.y - closestY;
            const distSq = dx * dx + dy * dy;

            if (distSq < r * r) {
                // Determine which face was hit
                const overlapLeft = (horse.x + r) - obs.x;
                const overlapRight = (obs.x + obs.w) - (horse.x - r);
                const overlapTop = (horse.y + r) - obs.y;
                const overlapBottom = (obs.y + obs.h) - (horse.y - r);

                const minOverlap = Math.min(overlapLeft, overlapRight, overlapTop, overlapBottom);

                if (minOverlap === overlapLeft || minOverlap === overlapRight) {
                    horse.vx = -horse.vx;
                    horse.x += horse.vx > 0 ? 2 : -2;
                } else {
                    horse.vy = -horse.vy;
                    horse.y += horse.vy > 0 ? 2 : -2;
                }
                addSpeedVariation(horse);
                break; // One collision per tick
            }
        }
    }

    function addSpeedVariation(horse) {
        // ±15% speed variation on bounce for unpredictability
        const factor = 0.85 + Math.random() * 0.30;
        horse.vx *= factor;
        horse.vy *= factor;

        // Ensure minimum speed
        const speed = Math.sqrt(horse.vx * horse.vx + horse.vy * horse.vy);
        if (speed < 1.5) {
            const scale = 2.0 / Math.max(speed, 0.1);
            horse.vx *= scale;
            horse.vy *= scale;
        }
        // Cap maximum speed
        if (speed > 7) {
            const scale = 6 / speed;
            horse.vx *= scale;
            horse.vy *= scale;
        }
    }

    function checkFinish(horse, finishZone) {
        return (
            horse.x >= finishZone.x &&
            horse.x <= finishZone.x + finishZone.w &&
            horse.y >= finishZone.y &&
            horse.y <= finishZone.y + finishZone.h
        );
    }

    // ─── Betting Phase ───────────────────────────────────────

    function startBettingPhase(lobbyId) {
        const lobby = lobbies[lobbyId];
        if (!lobby) return;

        lobby.gameState = 'betting';
        lobby.track = pickTrack();
        lobby.horses = createHorses();
        lobby.raceNumber++;

        // Reset bets
        Object.values(lobby.players).forEach(p => {
            if (!p.eliminated) {
                p.bet = null;
                p.horseChoice = null;
            }
        });

        nsp.to(lobbyId).emit('bettingPhase', {
            track: {
                name: lobby.track.name,
                obstacles: lobby.track.obstacles,
                finishZone: lobby.track.finishZone
            },
            horses: lobby.horses.map(h => ({
                id: h.id,
                name: h.name,
                color: h.color
            })),
            raceNumber: lobby.raceNumber,
            bettingTime: BETTING_TIME,
            players: Object.values(lobby.players).map(p => ({
                id: p.id,
                username: p.username,
                money: p.money,
                eliminated: p.eliminated
            }))
        });

        broadcastLobbyState(lobbyId);
        broadcastActiveLobbies();

        // Countdown
        lobby.bettingTimeLeft = BETTING_TIME;
        lobby.bettingInterval = setInterval(() => {
            lobby.bettingTimeLeft--;
            nsp.to(lobbyId).emit('bettingCountdown', lobby.bettingTimeLeft);

            if (lobby.bettingTimeLeft <= 0) {
                clearInterval(lobby.bettingInterval);
                lobby.bettingInterval = null;

                // Auto-bet $1 on random horse for non-betting active players
                Object.values(lobby.players).forEach(p => {
                    if (!p.eliminated && p.bet === null && p.money >= MIN_BET) {
                        p.horseChoice = Math.floor(Math.random() * NUM_HORSES) + 1;
                        p.bet = MIN_BET;
                    }
                });

                startRace(lobbyId);
            }
        }, 1000);
    }

    // ─── Race Phase ──────────────────────────────────────────

    function startRace(lobbyId) {
        const lobby = lobbies[lobbyId];
        if (!lobby) return;

        lobby.gameState = 'racing';

        nsp.to(lobbyId).emit('raceStart', {
            horses: lobby.horses.map(h => ({
                id: h.id, name: h.name, color: h.color,
                x: h.x, y: h.y
            })),
            track: {
                name: lobby.track.name,
                obstacles: lobby.track.obstacles,
                finishZone: lobby.track.finishZone
            }
        });

        broadcastLobbyState(lobbyId);
        broadcastActiveLobbies();

        let frameCount = 0;

        lobby.raceInterval = setInterval(() => {
            if (!lobbies[lobbyId] || lobby.gameState !== 'racing') {
                clearInterval(lobby.raceInterval);
                lobby.raceInterval = null;
                return;
            }

            let winnerHorse = null;

            // Update horse physics
            for (const horse of lobby.horses) {
                if (horse.finished) continue;

                horse.x += horse.vx;
                horse.y += horse.vy;

                bounceOffBounds(horse);
                bounceOffObstacles(horse, lobby.track.obstacles);

                // Check finish
                if (checkFinish(horse, lobby.track.finishZone)) {
                    horse.finished = true;
                    if (!winnerHorse) winnerHorse = horse;
                }
            }

            // Send positions every 2nd frame
            frameCount++;
            if (frameCount % 2 === 0) {
                nsp.to(lobbyId).emit('raceUpdate', {
                    horses: lobby.horses.map(h => ({
                        id: h.id,
                        x: Math.round(h.x * 10) / 10,
                        y: Math.round(h.y * 10) / 10,
                        vx: Math.round(h.vx * 100) / 100,
                        vy: Math.round(h.vy * 100) / 100,
                        finished: h.finished
                    }))
                });
            }

            // Handle winner
            if (winnerHorse) {
                clearInterval(lobby.raceInterval);
                lobby.raceInterval = null;

                nsp.to(lobbyId).emit('horseFinished', {
                    horseId: winnerHorse.id,
                    horseName: winnerHorse.name,
                    horseColor: winnerHorse.color
                });

                // Calculate payouts after a short delay for drama
                setTimeout(() => {
                    calculatePayouts(lobbyId, winnerHorse.id);
                }, 2000);
            }
        }, 1000 / TICK_RATE);
    }

    // ─── Payouts ─────────────────────────────────────────────

    function calculatePayouts(lobbyId, winningHorseId) {
        const lobby = lobbies[lobbyId];
        if (!lobby) return;

        lobby.gameState = 'results';

        const activePlayers = Object.values(lobby.players).filter(p => !p.eliminated && p.bet !== null);
        const winners = activePlayers.filter(p => p.horseChoice === winningHorseId);
        const losers = activePlayers.filter(p => p.horseChoice !== winningHorseId);

        // Total losing pool
        const totalLosingPool = losers.reduce((sum, p) => sum + p.bet, 0);
        const payoutPool = Math.floor(totalLosingPool / 2); // Half the losing pool goes to winners

        // Deduct bets from losers
        losers.forEach(p => {
            p.money -= p.bet;
        });

        // Calculate winner payouts (proportional to bet size)
        const totalWinnerBets = winners.reduce((sum, p) => sum + p.bet, 0);
        const payouts = {};

        winners.forEach(p => {
            const share = totalWinnerBets > 0 ? (p.bet / totalWinnerBets) : 0;
            const payout = Math.floor(payoutPool * share);
            p.money += payout; // Winners keep their bet + get payout
            payouts[p.id] = payout;
        });

        // Check for eliminations
        const eliminations = [];
        Object.values(lobby.players).forEach(p => {
            if (!p.eliminated && p.money <= 0) {
                p.eliminated = true;
                p.money = 0;
                eliminations.push({ id: p.id, username: p.username });
            }
        });

        // Award DB coins to winners
        if (arenaDB) {
            winners.forEach(p => {
                const username = p.username;
                if (!username) return;
                const coinReward = Math.max(5, Math.floor((payouts[p.id] || 0) / 10));
                arenaDB.awardCoins(username, coinReward, 'Donkey Competition Win', 'donkey-competition');
            });

            // Record results
            activePlayers.forEach(p => {
                const username = p.username;
                if (!username) return;
                const won = p.horseChoice === winningHorseId;
                arenaDB.recordGameResult(username, 'donkey-competition', won);
            });
        }

        // Count remaining active players
        const remainingPlayers = Object.values(lobby.players).filter(p => !p.eliminated);

        nsp.to(lobbyId).emit('raceResults', {
            winningHorseId,
            winningHorseName: HORSE_NAMES[winningHorseId - 1],
            winningHorseColor: HORSE_COLORS[winningHorseId - 1],
            payoutPool,
            payouts, // { playerId: amount }
            players: Object.values(lobby.players).map(p => ({
                id: p.id,
                username: p.username,
                money: p.money,
                bet: p.bet,
                horseChoice: p.horseChoice,
                eliminated: p.eliminated,
                won: p.horseChoice === winningHorseId,
                payout: payouts[p.id] || 0
            })),
            eliminations,
            remainingCount: remainingPlayers.length,
            gameOver: remainingPlayers.length <= 1
        });

        broadcastLobbyState(lobbyId);

        // If game over (0-1 player left), reset after delay
        if (remainingPlayers.length <= 1) {
            const finalWinner = remainingPlayers[0] || null;
            if (finalWinner && arenaDB) {
                arenaDB.awardCoins(finalWinner.username, 50, 'Donkey Competition Champion', 'donkey-competition');
            }

            setTimeout(() => {
                if (!lobbies[lobbyId]) return;
                resetLobby(lobbyId);
            }, 8000);
        }
        // Otherwise host can start next race
    }

    function resetLobby(lobbyId) {
        const lobby = lobbies[lobbyId];
        if (!lobby) return;

        lobby.gameState = 'lobby';
        lobby.raceNumber = 0;
        lobby.horses = [];
        lobby.track = null;

        Object.values(lobby.players).forEach(p => {
            p.isReady = false;
            p.money = STARTING_MONEY;
            p.bet = null;
            p.horseChoice = null;
            p.eliminated = false;
        });

        nsp.to(lobbyId).emit('resetToLobby');
        broadcastLobbyState(lobbyId);
        broadcastActiveLobbies();
    }

    // ─── Connection Handler ──────────────────────────────────

    nsp.on('connection', (socket) => {
        console.log('[Donkey Competition] User connected:', socket.id);
        broadcastActiveLobbies();

        // ── Lobby Management ─────────────────────────────────

        socket.on('createLobby', (data) => {
            const lobbyId = uuidv4().substring(0, 8);
            const username = (data && data.username) || socket.id.substring(0, 6);

            lobbies[lobbyId] = {
                id: lobbyId,
                name: `${username}'s Competition`,
                creatorId: socket.id,
                players: {},
                gameState: 'lobby',
                horses: [],
                track: null,
                raceNumber: 0,
                bettingInterval: null,
                raceInterval: null,
            };
            joinLobby(socket, lobbyId, username);
            broadcastActiveLobbies();
        });

        socket.on('joinLobby', (data) => {
            const lobbyId = typeof data === 'string' ? data : data.lobbyId;
            const username = (typeof data === 'object' && data.username) || socket.id.substring(0, 6);

            if (lobbies[lobbyId]) {
                if (lobbies[lobbyId].gameState !== 'lobby') {
                    socket.emit('lobbyError', 'Game already in progress.');
                    return;
                }
                if (Object.keys(lobbies[lobbyId].players).length >= 10) {
                    socket.emit('lobbyError', 'Lobby is full (max 10 players).');
                    return;
                }
                joinLobby(socket, lobbyId, username);
            } else {
                socket.emit('lobbyError', 'Lobby not found.');
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
                    startBettingPhase(lobbyId);
                }
            }
        });

        // ── Betting ──────────────────────────────────────────

        socket.on('placeBet', (data) => {
            const lobbyId = playerLobbies[socket.id];
            if (!lobbyId || !lobbies[lobbyId]) return;
            const lobby = lobbies[lobbyId];
            const player = lobby.players[socket.id];

            if (!player || player.eliminated || lobby.gameState !== 'betting') return;

            const horseNumber = parseInt(data.horseNumber);
            const amount = parseInt(data.amount);

            if (isNaN(horseNumber) || horseNumber < 1 || horseNumber > NUM_HORSES) {
                socket.emit('betError', 'Invalid horse number.');
                return;
            }
            if (isNaN(amount) || amount < MIN_BET) {
                socket.emit('betError', `Minimum entry is ${MIN_BET} credits.`);
                return;
            }
            if (amount > player.money) {
                socket.emit('betError', 'Not enough credits.');
                return;
            }

            player.horseChoice = horseNumber;
            player.bet = amount;

            socket.emit('betConfirmed', {
                horseNumber: player.horseChoice,
                amount: player.bet,
                horseName: HORSE_NAMES[horseNumber - 1],
                horseColor: HORSE_COLORS[horseNumber - 1]
            });

            // Broadcast updated bets (without revealing choices to others)
            nsp.to(lobbyId).emit('bettingUpdate', {
                players: Object.values(lobby.players).map(p => ({
                    id: p.id,
                    username: p.username,
                    hasBet: p.bet !== null,
                    eliminated: p.eliminated
                }))
            });
        });

        // ── Host Controls ────────────────────────────────────

        socket.on('startNextRace', () => {
            const lobbyId = playerLobbies[socket.id];
            if (!lobbyId || !lobbies[lobbyId]) return;
            const lobby = lobbies[lobbyId];

            if (lobby.creatorId === socket.id && lobby.gameState === 'results') {
                const remaining = Object.values(lobby.players).filter(p => !p.eliminated);
                if (remaining.length >= 2) {
                    startBettingPhase(lobbyId);
                }
            }
        });

        // ── Disconnect ───────────────────────────────────────

        socket.on('disconnect', () => {
            console.log('[Donkey Competition] User disconnected:', socket.id);
            leaveLobby(socket);
        });

        // ─── Internal Functions ──────────────────────────────

        function joinLobby(socket, lobbyId, username) {
            const lobby = lobbies[lobbyId];
            if (!lobby) return;
            leaveLobby(socket);

            socket.join(lobbyId);
            playerLobbies[socket.id] = lobbyId;

            lobby.players[socket.id] = {
                id: socket.id,
                username: username || socket.id.substring(0, 6),
                money: STARTING_MONEY,
                isReady: false,
                bet: null,
                horseChoice: null,
                eliminated: false
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
                // Clean up intervals
                if (lobby.bettingInterval) clearInterval(lobby.bettingInterval);
                if (lobby.raceInterval) clearInterval(lobby.raceInterval);
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
    });
};
