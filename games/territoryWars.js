const { v4: uuidv4 } = require('uuid');

module.exports = function (io) {
    const nsp = io.of('/territory-wars');

    const lobbies = {};
    const playerLobbies = {};

    // ─── Constants ───────────────────────────────────────────────
    const TICK_RATE = 20; // ticks per second
    const TICK_MS = 1000 / TICK_RATE;
    const MATCH_DURATION = 10 * 60; // seconds
    const MAX_PLAYERS = 8;
    const MIN_PLAYERS = 2;

    const PLAYER_COLORS = [
        '#ef4444', '#3b82f6', '#22c55e', '#eab308',
        '#a855f7', '#06b6d4', '#f97316', '#ec4899'
    ];

    // Node terrain types
    const TERRAIN = {
        STANDARD:   { name: 'standard',   prodRate: 1.0, defBonus: 1.0, supplyCap: 30, icon: '⬡' },
        GENERATOR:  { name: 'generator',  prodRate: 2.0, defBonus: 0.8, supplyCap: 25, icon: '⚡' },
        FORTRESS:   { name: 'fortress',   prodRate: 0.6, defBonus: 1.5, supplyCap: 40, icon: '🛡' },
        CHOKEPOINT: { name: 'chokepoint', prodRate: 0.5, defBonus: 1.2, supplyCap: 15, icon: '⚔' },
    };
    const TERRAIN_KEYS = Object.keys(TERRAIN);

    // Unit types with rock-paper-scissors advantages
    // Scout > Brute > Tank > Scout
    const UNIT_TYPES = {
        scout:  { name: 'Scout',  shape: 'circle',   speed: 1.4, attack: 1.0, defense: 0.8, strongVs: 'brute', weakVs: 'tank' },
        tank:   { name: 'Tank',   shape: 'square',    speed: 0.7, attack: 0.8, defense: 1.4, strongVs: 'scout', weakVs: 'brute' },
        brute:  { name: 'Brute',  shape: 'triangle',  speed: 1.0, attack: 1.4, defense: 1.0, strongVs: 'tank',  weakVs: 'scout' },
    };

    const TYPE_ADVANTAGE_MULT = 1.5;
    const TYPE_DISADVANTAGE_MULT = 0.65;

    // ─── Map Generation ─────────────────────────────────────────
    function generateMap(playerCount) {
        const nodeCount = 18 + playerCount * 3; // Scale with players
        const nodes = [];
        const edges = [];

        // Generate nodes in a spread-out pattern using a grid + jitter approach
        const cols = Math.ceil(Math.sqrt(nodeCount * 1.5));
        const rows = Math.ceil(nodeCount / cols);
        const cellW = 900 / cols;
        const cellH = 600 / rows;
        const positions = [];

        // Create candidate positions
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                positions.push({
                    x: cellW * (c + 0.3 + Math.random() * 0.4),
                    y: cellH * (r + 0.3 + Math.random() * 0.4),
                });
            }
        }

        // Shuffle and pick nodeCount
        for (let i = positions.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [positions[i], positions[j]] = [positions[j], positions[i]];
        }
        const chosenPositions = positions.slice(0, nodeCount);

        // Determine terrain distribution
        for (let i = 0; i < nodeCount; i++) {
            let terrainKey;
            const roll = Math.random();
            if (roll < 0.45) terrainKey = 'STANDARD';
            else if (roll < 0.70) terrainKey = 'GENERATOR';
            else if (roll < 0.85) terrainKey = 'FORTRESS';
            else terrainKey = 'CHOKEPOINT';

            const terrain = TERRAIN[terrainKey];
            nodes.push({
                id: i,
                x: chosenPositions[i].x,
                y: chosenPositions[i].y,
                terrain: terrain.name,
                prodRate: terrain.prodRate,
                defBonus: terrain.defBonus,
                supplyCap: terrain.supplyCap,
                owner: null, // null = neutral
                units: { scout: 4, tank: 0, brute: 0 }, // neutral starts with some scouts
                totalUnits: 4,
            });
        }

        // Generate edges using Delaunay-like nearest neighbor approach
        // Connect each node to its 2–4 nearest neighbors
        for (let i = 0; i < nodes.length; i++) {
            const distances = [];
            for (let j = 0; j < nodes.length; j++) {
                if (i === j) continue;
                const dx = nodes[i].x - nodes[j].x;
                const dy = nodes[i].y - nodes[j].y;
                distances.push({ j, dist: Math.sqrt(dx * dx + dy * dy) });
            }
            distances.sort((a, b) => a.dist - b.dist);

            // Connect to 2–3 nearest (but max distance threshold)
            const connectCount = 2 + Math.floor(Math.random() * 2);
            let connected = 0;
            for (const { j, dist } of distances) {
                if (connected >= connectCount) break;
                if (dist > 280) break; // max edge length

                // Check if edge already exists
                const exists = edges.some(e =>
                    (e[0] === i && e[1] === j) || (e[0] === j && e[1] === i)
                );
                if (!exists) {
                    edges.push([i, j]);
                }
                connected++;
            }
        }

        // Ensure connectivity with BFS — connect isolated components
        const visited = new Set();
        const queue = [0];
        visited.add(0);
        while (queue.length > 0) {
            const curr = queue.shift();
            for (const e of edges) {
                let neighbor = -1;
                if (e[0] === curr) neighbor = e[1];
                else if (e[1] === curr) neighbor = e[0];
                if (neighbor >= 0 && !visited.has(neighbor)) {
                    visited.add(neighbor);
                    queue.push(neighbor);
                }
            }
        }
        // Connect any unvisited nodes to the nearest visited node
        for (let i = 0; i < nodes.length; i++) {
            if (!visited.has(i)) {
                let bestJ = 0, bestDist = Infinity;
                for (const v of visited) {
                    const dx = nodes[i].x - nodes[v].x;
                    const dy = nodes[i].y - nodes[v].y;
                    const d = Math.sqrt(dx * dx + dy * dy);
                    if (d < bestDist) { bestDist = d; bestJ = v; }
                }
                edges.push([i, bestJ]);
                visited.add(i);
                // BFS from this node too
                const q2 = [i];
                while (q2.length > 0) {
                    const c2 = q2.shift();
                    for (const e of edges) {
                        let nb = -1;
                        if (e[0] === c2) nb = e[1];
                        else if (e[1] === c2) nb = e[0];
                        if (nb >= 0 && !visited.has(nb)) {
                            visited.add(nb);
                            q2.push(nb);
                        }
                    }
                }
            }
        }

        // Assign starting nodes to players — spread them apart
        const startingNodes = selectStartingNodes(nodes, edges, playerCount);

        return { nodes, edges, startingNodes };
    }

    function selectStartingNodes(nodes, edges, playerCount) {
        // Pick nodes that are maximally spread apart
        // Start with the node closest to each corner/edge of the map
        const targets = [];
        const w = 900, h = 600;
        const cornerPositions = [
            { x: 50, y: 50 }, { x: w - 50, y: 50 },
            { x: 50, y: h - 50 }, { x: w - 50, y: h - 50 },
            { x: w / 2, y: 30 }, { x: w / 2, y: h - 30 },
            { x: 30, y: h / 2 }, { x: w - 30, y: h / 2 },
        ];

        const used = new Set();
        for (let p = 0; p < playerCount && p < cornerPositions.length; p++) {
            const target = cornerPositions[p];
            let bestIdx = -1, bestDist = Infinity;
            for (let i = 0; i < nodes.length; i++) {
                if (used.has(i)) continue;
                const dx = nodes[i].x - target.x;
                const dy = nodes[i].y - target.y;
                const d = Math.sqrt(dx * dx + dy * dy);
                if (d < bestDist) { bestDist = d; bestIdx = i; }
            }
            if (bestIdx >= 0) {
                targets.push(bestIdx);
                used.add(bestIdx);
            }
        }

        return targets;
    }

    // ─── Combat Resolution ──────────────────────────────────────
    function resolveAttack(attackers, defenders, defBonus) {
        // attackers/defenders = { scout: N, tank: N, brute: N }
        // Returns { remainingAttackers, remainingDefenders, attackerWins }

        let atkPower = 0;
        let defPower = 0;

        const atkTypes = Object.keys(attackers).filter(t => attackers[t] > 0);
        const defTypes = Object.keys(defenders).filter(t => defenders[t] > 0);

        // Calculate total effective power
        for (const aType of atkTypes) {
            const info = UNIT_TYPES[aType];
            let mult = 1.0;
            // Check advantage against majority defender type
            for (const dType of defTypes) {
                if (info.strongVs === dType) mult = Math.max(mult, TYPE_ADVANTAGE_MULT);
                if (info.weakVs === dType) mult = Math.min(mult, TYPE_DISADVANTAGE_MULT);
            }
            atkPower += attackers[aType] * info.attack * mult;
        }

        for (const dType of defTypes) {
            const info = UNIT_TYPES[dType];
            let mult = 1.0;
            for (const aType of atkTypes) {
                if (info.strongVs === aType) mult = Math.max(mult, TYPE_ADVANTAGE_MULT);
                if (info.weakVs === aType) mult = Math.min(mult, TYPE_DISADVANTAGE_MULT);
            }
            defPower += defenders[dType] * info.defense * mult * defBonus;
        }

        if (atkPower <= 0 && defPower <= 0) {
            return { remainingAttackers: { scout: 0, tank: 0, brute: 0 }, remainingDefenders: { scout: 0, tank: 0, brute: 0 }, attackerWins: false };
        }

        const totalAtk = attackers.scout + attackers.tank + attackers.brute;
        const totalDef = defenders.scout + defenders.tank + defenders.brute;

        if (atkPower > defPower) {
            // Attacker wins — surviving ratio
            const survivalRatio = Math.max(0.1, (atkPower - defPower) / atkPower);
            const remaining = { scout: 0, tank: 0, brute: 0 };
            for (const t of Object.keys(attackers)) {
                remaining[t] = Math.ceil(attackers[t] * survivalRatio);
            }
            return { remainingAttackers: remaining, remainingDefenders: { scout: 0, tank: 0, brute: 0 }, attackerWins: true };
        } else {
            // Defender wins
            const survivalRatio = Math.max(0.1, (defPower - atkPower) / defPower);
            const remaining = { scout: 0, tank: 0, brute: 0 };
            for (const t of Object.keys(defenders)) {
                remaining[t] = Math.ceil(defenders[t] * survivalRatio);
            }
            return { remainingAttackers: { scout: 0, tank: 0, brute: 0 }, remainingDefenders: remaining, attackerWins: false };
        }
    }

    // ─── Game Tick ───────────────────────────────────────────────
    function gameTick(lobbyId) {
        const lobby = lobbies[lobbyId];
        if (!lobby || lobby.gameState !== 'playing') return;

        lobby.tickCount++;

        // ── Production (every 20 ticks = 1 second) ──
        if (lobby.tickCount % TICK_RATE === 0) {
            lobby.timeRemaining--;

            for (const node of lobby.map.nodes) {
                if (node.owner === null) continue;

                const total = node.units.scout + node.units.tank + node.units.brute;
                if (total < node.supplyCap) {
                    // Produce the player's selected unit type (default scout)
                    const player = lobby.players[node.owner];
                    const prodType = player ? (player.prodUnitType || 'scout') : 'scout';
                    const produced = Math.min(node.prodRate, node.supplyCap - total);
                    node.units[prodType] = (node.units[prodType] || 0) + produced;
                    node.totalUnits = node.units.scout + node.units.tank + node.units.brute;
                }
            }

            // Check win conditions
            if (lobby.timeRemaining <= 0) {
                endGame(lobbyId, 'time');
                return;
            }

            // Elimination check
            const activePlayers = new Set();
            for (const node of lobby.map.nodes) {
                if (node.owner) activePlayers.add(node.owner);
            }
            // Also count players who have units in transit
            for (const convoy of lobby.convoys) {
                if (convoy.owner) activePlayers.add(convoy.owner);
            }

            const playerIds = Object.keys(lobby.players);
            const eliminated = playerIds.filter(id => !activePlayers.has(id));
            for (const id of eliminated) {
                if (!lobby.players[id].eliminated) {
                    lobby.players[id].eliminated = true;
                    nsp.to(lobbyId).emit('playerEliminated', { playerId: id });
                }
            }

            const remaining = playerIds.filter(id => !lobby.players[id].eliminated);
            if (lobby.teamMode) {
                // Check if one team has eliminated all others
                const teamsAlive = new Set(remaining.map(id => lobby.players[id].team));
                if (teamsAlive.size <= 1) {
                    endGame(lobbyId, 'elimination');
                    return;
                }
            } else {
                if (remaining.length <= 1) {
                    endGame(lobbyId, 'elimination');
                    return;
                }
            }
        }

        // ── Move convoys ──
        for (let ci = lobby.convoys.length - 1; ci >= 0; ci--) {
            const convoy = lobby.convoys[ci];
            convoy.progress += convoy.speed;

            if (convoy.progress >= 1.0) {
                // Arrived at target node
                const targetNode = lobby.map.nodes[convoy.targetNodeId];

                if (targetNode.owner === convoy.owner) {
                    // Reinforcement — add units
                    for (const t of ['scout', 'tank', 'brute']) {
                        targetNode.units[t] += convoy.units[t];
                    }
                    // Clamp to supply cap
                    const total = targetNode.units.scout + targetNode.units.tank + targetNode.units.brute;
                    if (total > targetNode.supplyCap) {
                        const ratio = targetNode.supplyCap / total;
                        for (const t of ['scout', 'tank', 'brute']) {
                            targetNode.units[t] = Math.floor(targetNode.units[t] * ratio);
                        }
                    }
                    targetNode.totalUnits = targetNode.units.scout + targetNode.units.tank + targetNode.units.brute;
                } else {
                    // Combat!
                    const result = resolveAttack(
                        { ...convoy.units },
                        { ...targetNode.units },
                        targetNode.defBonus
                    );

                    if (result.attackerWins) {
                        targetNode.owner = convoy.owner;
                        targetNode.units = { ...result.remainingAttackers };

                        nsp.to(lobbyId).emit('nodeCaptured', {
                            nodeId: targetNode.id,
                            newOwner: convoy.owner,
                            fromConvoy: true,
                        });
                    } else {
                        targetNode.units = { ...result.remainingDefenders };
                    }
                    targetNode.totalUnits = targetNode.units.scout + targetNode.units.tank + targetNode.units.brute;

                    nsp.to(lobbyId).emit('combatResult', {
                        nodeId: targetNode.id,
                        attackerWon: result.attackerWins,
                        attackerId: convoy.owner,
                        defenderId: targetNode.owner,
                    });
                }

                lobby.convoys.splice(ci, 1);
            }
        }

        // ── Broadcast state ──
        if (lobby.tickCount % 2 === 0) { // Broadcast every 2 ticks for perf
            broadcastGameState(lobbyId);
        }
    }

    function broadcastGameState(lobbyId) {
        const lobby = lobbies[lobbyId];
        if (!lobby) return;

        const nodeStates = lobby.map.nodes.map(n => ({
            id: n.id,
            owner: n.owner,
            units: { ...n.units },
            totalUnits: n.units.scout + n.units.tank + n.units.brute,
        }));

        const convoyStates = lobby.convoys.map(c => ({
            id: c.id,
            owner: c.owner,
            sourceNodeId: c.sourceNodeId,
            targetNodeId: c.targetNodeId,
            units: { ...c.units },
            progress: c.progress,
            totalUnits: c.units.scout + c.units.tank + c.units.brute,
        }));

        const playerStates = {};
        for (const [id, p] of Object.entries(lobby.players)) {
            let nodeCount = 0;
            let totalUnits = 0;
            for (const n of lobby.map.nodes) {
                if (n.owner === id) {
                    nodeCount++;
                    totalUnits += n.units.scout + n.units.tank + n.units.brute;
                }
            }
            for (const c of lobby.convoys) {
                if (c.owner === id) {
                    totalUnits += c.units.scout + c.units.tank + c.units.brute;
                }
            }
            playerStates[id] = {
                color: p.color,
                nodeCount,
                totalUnits,
                eliminated: !!p.eliminated,
                team: p.team || null,
                prodUnitType: p.prodUnitType || 'scout',
            };
        }

        nsp.to(lobbyId).emit('gameStateUpdate', {
            nodes: nodeStates,
            convoys: convoyStates,
            players: playerStates,
            timeRemaining: lobby.timeRemaining,
        });
    }

    function endGame(lobbyId, reason) {
        const lobby = lobbies[lobbyId];
        if (!lobby) return;

        stopGameLoop(lobbyId);
        lobby.gameState = 'gameover';

        // Calculate results
        const results = [];
        for (const [id, p] of Object.entries(lobby.players)) {
            let nodeCount = 0;
            let totalUnits = 0;
            for (const n of lobby.map.nodes) {
                if (n.owner === id) {
                    nodeCount++;
                    totalUnits += n.units.scout + n.units.tank + n.units.brute;
                }
            }
            results.push({
                id,
                color: p.color,
                nodeCount,
                totalUnits,
                eliminated: !!p.eliminated,
                team: p.team || null,
            });
        }

        results.sort((a, b) => b.nodeCount - a.nodeCount || b.totalUnits - a.totalUnits);

        nsp.to(lobbyId).emit('gameOver', { results, reason });
        broadcastActiveLobbies();

        // Return to lobby after delay
        setTimeout(() => {
            if (!lobbies[lobbyId]) return;
            lobby.gameState = 'lobby';
            lobby.convoys = [];
            Object.values(lobby.players).forEach(p => {
                p.isReady = false;
                p.eliminated = false;
            });
            broadcastLobbyState(lobbyId);
            broadcastActiveLobbies();
            nsp.to(lobbyId).emit('resetToLobby');
        }, 8000);
    }

    // ─── Lobby Helpers ──────────────────────────────────────────
    function broadcastLobbyState(lobbyId) {
        const lobby = lobbies[lobbyId];
        if (!lobby) return;

        nsp.to(lobbyId).emit('lobbyState', {
            id: lobby.id,
            name: lobby.name,
            creatorId: lobby.creatorId,
            teamMode: lobby.teamMode,
            players: Object.values(lobby.players).map(p => ({
                id: p.id,
                isReady: p.isReady,
                color: p.color,
                team: p.team || null,
            })),
            gameState: lobby.gameState,
        });
    }

    function broadcastActiveLobbies() {
        const publicLobbies = Object.values(lobbies).map(l => ({
            id: l.id,
            name: l.name,
            playerCount: Object.keys(l.players).length,
            gameState: l.gameState,
            teamMode: l.teamMode,
        }));
        nsp.emit('activeLobbies', publicLobbies);
    }

    function startGameLoop(lobbyId) {
        const lobby = lobbies[lobbyId];
        if (!lobby) return;
        if (lobby.gameLoopInterval) clearInterval(lobby.gameLoopInterval);
        lobby.gameLoopInterval = setInterval(() => gameTick(lobbyId), TICK_MS);
    }

    function stopGameLoop(lobbyId) {
        const lobby = lobbies[lobbyId];
        if (lobby && lobby.gameLoopInterval) {
            clearInterval(lobby.gameLoopInterval);
            lobby.gameLoopInterval = null;
        }
    }

    function startGame(lobbyId) {
        const lobby = lobbies[lobbyId];
        if (!lobby) return;

        const playerIds = Object.keys(lobby.players);
        const map = generateMap(playerIds.length);

        // Assign starting nodes to players
        for (let i = 0; i < playerIds.length; i++) {
            const nodeIdx = map.startingNodes[i];
            if (nodeIdx !== undefined) {
                const node = map.nodes[nodeIdx];
                node.owner = playerIds[i];
                node.units = { scout: 10, tank: 0, brute: 0 };
                node.totalUnits = 10;
                // Make starting nodes standard with decent stats
                node.terrain = 'standard';
                node.prodRate = 1.2;
                node.defBonus = 1.0;
                node.supplyCap = 35;
            }
        }

        lobby.map = map;
        lobby.convoys = [];
        lobby.tickCount = 0;
        lobby.timeRemaining = MATCH_DURATION;
        lobby.gameState = 'playing';

        // Assign teams if team mode
        if (lobby.teamMode) {
            playerIds.forEach((id, i) => {
                lobby.players[id].team = i % 2; // alternate teams
            });
        }

        nsp.to(lobbyId).emit('gameStart', {
            map: {
                nodes: map.nodes.map(n => ({
                    id: n.id,
                    x: n.x,
                    y: n.y,
                    terrain: n.terrain,
                    prodRate: n.prodRate,
                    defBonus: n.defBonus,
                    supplyCap: n.supplyCap,
                    owner: n.owner,
                    units: { ...n.units },
                    totalUnits: n.totalUnits,
                })),
                edges: map.edges,
            },
            players: Object.fromEntries(
                playerIds.map(id => [id, {
                    color: lobby.players[id].color,
                    team: lobby.players[id].team || null,
                }])
            ),
            timeRemaining: MATCH_DURATION,
        });

        broadcastActiveLobbies();
        startGameLoop(lobbyId);
    }

    // ─── Socket Handlers ────────────────────────────────────────
    nsp.on('connection', (socket) => {
        console.log('[Territory Wars] User connected:', socket.id);
        broadcastActiveLobbies();

        socket.on('createLobby', (opts) => {
            const lobbyId = uuidv4().substring(0, 8);
            lobbies[lobbyId] = {
                id: lobbyId,
                name: `${socket.id.substring(0, 4)}'s War`,
                creatorId: socket.id,
                teamMode: !!(opts && opts.teamMode),
                players: {},
                gameState: 'lobby',
                gameLoopInterval: null,
                map: null,
                convoys: [],
                tickCount: 0,
                timeRemaining: MATCH_DURATION,
            };
            joinLobby(socket, lobbyId);
            broadcastActiveLobbies();
        });

        socket.on('joinLobby', (lobbyId) => {
            if (lobbies[lobbyId] && lobbies[lobbyId].gameState === 'lobby') {
                if (Object.keys(lobbies[lobbyId].players).length < MAX_PLAYERS) {
                    joinLobby(socket, lobbyId);
                } else {
                    socket.emit('lobbyError', 'Lobby is full (max 8 players).');
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

        socket.on('toggleTeamMode', () => {
            const lobbyId = playerLobbies[socket.id];
            if (!lobbyId || !lobbies[lobbyId]) return;
            const lobby = lobbies[lobbyId];
            if (lobby.creatorId === socket.id && lobby.gameState === 'lobby') {
                lobby.teamMode = !lobby.teamMode;
                broadcastLobbyState(lobbyId);
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
                if (playerKeys.length >= MIN_PLAYERS && playerKeys.every(id => lobby.players[id].isReady)) {
                    startGame(lobbyId);
                }
            }
        });

        // ── In-Game Actions ──
        socket.on('sendUnits', (data) => {
            // data = { sourceNodeId, targetNodeId, percentage, unitType (optional, default 'all') }
            const lobbyId = playerLobbies[socket.id];
            if (!lobbyId || !lobbies[lobbyId]) return;
            const lobby = lobbies[lobbyId];
            if (lobby.gameState !== 'playing') return;

            const { sourceNodeId, targetNodeId, percentage } = data;
            const sourceNode = lobby.map.nodes[sourceNodeId];
            const targetNode = lobby.map.nodes[targetNodeId];

            if (!sourceNode || !targetNode) return;
            if (sourceNode.owner !== socket.id) return;

            // Verify nodes are connected
            const connected = lobby.map.edges.some(e =>
                (e[0] === sourceNodeId && e[1] === targetNodeId) ||
                (e[0] === targetNodeId && e[1] === sourceNodeId)
            );
            if (!connected) return;

            const pct = Math.max(0.25, Math.min(1.0, percentage || 0.5));

            // Calculate units to send
            const unitsToSend = { scout: 0, tank: 0, brute: 0 };
            for (const t of ['scout', 'tank', 'brute']) {
                unitsToSend[t] = Math.floor(sourceNode.units[t] * pct);
                sourceNode.units[t] -= unitsToSend[t];
            }

            const totalSending = unitsToSend.scout + unitsToSend.tank + unitsToSend.brute;
            if (totalSending <= 0) return;

            sourceNode.totalUnits = sourceNode.units.scout + sourceNode.units.tank + sourceNode.units.brute;

            // Calculate travel speed based on edge distance and slowest unit type
            const dx = targetNode.x - sourceNode.x;
            const dy = targetNode.y - sourceNode.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            // Find the slowest unit type being sent
            let slowestSpeed = Infinity;
            for (const t of ['scout', 'tank', 'brute']) {
                if (unitsToSend[t] > 0) {
                    slowestSpeed = Math.min(slowestSpeed, UNIT_TYPES[t].speed);
                }
            }
            if (slowestSpeed === Infinity) slowestSpeed = 1.0;

            // Speed = pixels per tick, progress = fraction of distance
            const travelSpeed = (slowestSpeed * 80) / dist / TICK_RATE; // Normalize

            lobby.convoys.push({
                id: uuidv4().substring(0, 8),
                owner: socket.id,
                sourceNodeId,
                targetNodeId,
                units: unitsToSend,
                progress: 0,
                speed: Math.max(0.005, Math.min(0.05, travelSpeed)),
            });
        });

        socket.on('setProdUnitType', (unitType) => {
            const lobbyId = playerLobbies[socket.id];
            if (!lobbyId || !lobbies[lobbyId]) return;
            const lobby = lobbies[lobbyId];
            if (lobby.gameState !== 'playing') return;
            if (!UNIT_TYPES[unitType]) return;
            lobby.players[socket.id].prodUnitType = unitType;
        });

        socket.on('disconnect', () => {
            console.log('[Territory Wars] User disconnected:', socket.id);
            leaveLobby(socket);
        });

        function joinLobby(sock, lobbyId) {
            const lobby = lobbies[lobbyId];
            if (!lobby) return;
            leaveLobby(sock);

            sock.join(lobbyId);
            playerLobbies[sock.id] = lobbyId;

            const playerIndex = Object.keys(lobby.players).length;
            lobby.players[sock.id] = {
                id: sock.id,
                color: PLAYER_COLORS[playerIndex % PLAYER_COLORS.length],
                isReady: false,
                eliminated: false,
                team: lobby.teamMode ? playerIndex % 2 : null,
                prodUnitType: 'scout',
            };

            sock.emit('lobbyJoined', lobbyId);
            broadcastLobbyState(lobbyId);
            broadcastActiveLobbies();
        }

        function leaveLobby(sock) {
            const lobbyId = playerLobbies[sock.id];
            if (!lobbyId || !lobbies[lobbyId]) return;

            const lobby = lobbies[lobbyId];
            delete lobby.players[sock.id];
            delete playerLobbies[sock.id];

            sock.leave(lobbyId);
            sock.emit('lobbyLeft');

            // If in game, convert player's nodes to neutral
            if (lobby.gameState === 'playing' && lobby.map) {
                for (const node of lobby.map.nodes) {
                    if (node.owner === sock.id) {
                        node.owner = null;
                        // Keep units as neutral defenders
                    }
                }
                // Remove their convoys
                lobby.convoys = lobby.convoys.filter(c => c.owner !== sock.id);
            }

            if (Object.keys(lobby.players).length === 0) {
                stopGameLoop(lobbyId);
                delete lobbies[lobbyId];
                broadcastActiveLobbies();
                return;
            }

            if (lobby.creatorId === sock.id) {
                lobby.creatorId = Object.keys(lobby.players)[0];
            }

            // Reassign colors
            const playerKeys = Object.keys(lobby.players);
            playerKeys.forEach((id, index) => {
                lobby.players[id].color = PLAYER_COLORS[index % PLAYER_COLORS.length];
            });

            nsp.to(lobbyId).emit('playerDisconnected', sock.id);
            broadcastLobbyState(lobbyId);
            broadcastActiveLobbies();
        }
    });
};
