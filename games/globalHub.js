const { v4: uuidv4 } = require('uuid');

module.exports = function (io) {
    const nsp = io.of('/hub');
    const arenaDB = io.arenaDB; // Database layer (attached in server.js)

    // --- State ---
    const onlineUsers = {};      // socketId -> { username, currentGame, joinedAt }
    const RATE_LIMIT_MS = 800;   // min ms between messages per user
    const bannedWords = [
        // English
        'fuck', 'shit', 'bitch', 'ass', 'asshole', 'cunt', 'dick', 'pussy', 'slut', 'whore', 'bastard', 'fag', 'nigger', 'nigga', 'cock', 'motherfucker',
        // Turkish
        'amk', 'amq', 'aq', 'amına', 'siktir', 'yarrak', 'piç', 'orospu', 'göt', 'pezevenk', 'yavşak', 'sik', 'sikerim', 'oç', 'kahpe'
    ]; // Bilingual profanity filter list

    // Helper regex to match words anywhere (including within other words)
    function createProfanityRegex(word) {
        return new RegExp(word, 'gi');
    }

    // --- Party State ---
    const parties = {};          // partyCode -> { code, leaderId, members: [socketId, ...] }
    const playerParties = {};    // socketId -> partyCode

    // Expose username lookup on io so game modules can resolve socketId -> username
    io.getUsernameBySocketId = function (socketId) {
        const user = onlineUsers[socketId];
        return user ? user.username : null;
    };

    // --- Helpers ---
    function broadcastOnlineUsers() {
        const userList = Object.values(onlineUsers).map(u => ({
            username: u.username,
            currentGame: u.currentGame || 'lobby',
            joinedAt: u.joinedAt
        }));
        nsp.emit('onlineUsers', {
            count: userList.length,
            users: userList
        });
    }

    function sanitize(str, maxLen = 200) {
        if (typeof str !== 'string') return '';
        return str.trim().replace(/[<>&"']/g, '').substring(0, maxLen);
    }

    // Generate a unique 4-character party code
    function generatePartyCode() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No I/O/0/1 to avoid confusion
        let code;
        do {
            code = '';
            for (let i = 0; i < 4; i++) {
                code += chars.charAt(Math.floor(Math.random() * chars.length));
            }
        } while (parties[code]); // Ensure unique
        return code;
    }

    // Broadcast party state to all members
    function broadcastPartyUpdate(partyCode) {
        const party = parties[partyCode];
        if (!party) return;

        const memberData = party.members.map(sid => ({
            socketId: sid,
            username: onlineUsers[sid] ? onlineUsers[sid].username : 'Unknown',
            isLeader: sid === party.leaderId
        }));

        party.members.forEach(sid => {
            const sock = nsp.sockets.get(sid);
            if (sock) {
                sock.emit('partyUpdate', {
                    code: party.code,
                    leaderId: party.leaderId,
                    members: memberData,
                    isLeader: sid === party.leaderId
                });
            }
        });
    }

    // Remove a player from their current party
    function removeFromParty(socketId) {
        const code = playerParties[socketId];
        if (!code || !parties[code]) return;

        const party = parties[code];
        party.members = party.members.filter(id => id !== socketId);
        delete playerParties[socketId];

        // Notify the removed player
        const sock = nsp.sockets.get(socketId);
        if (sock) {
            sock.emit('partyLeft');
        }

        if (party.members.length === 0) {
            // Party is empty — delete it
            delete parties[code];
            return;
        }

        // Transfer leadership if the leader left
        if (party.leaderId === socketId) {
            party.leaderId = party.members[0];
        }

        broadcastPartyUpdate(code);
    }

    // --- Connection ---
    nsp.on('connection', (socket) => {
        console.log('[Hub] User connected:', socket.id);

        // Player sets their username on connect
        socket.on('setUsername', (username) => {
            const clean = sanitize(username, 20);
            if (clean.length < 1) {
                socket.emit('usernameError', 'Username must be at least 1 character.');
                return;
            }

            // Profanity check for username
            const isProfane = bannedWords.some(word => {
                const regex = createProfanityRegex(word);
                return regex.test(clean);
            });

            if (isProfane) {
                socket.emit('usernameError', 'Username contains restricted words.');
                return;
            }

            // Check for duplicate usernames (case-insensitive)
            const lowerName = clean.toLowerCase();
            const duplicate = Object.values(onlineUsers).find(
                u => u.username.toLowerCase() === lowerName && u.socketId !== socket.id
            );

            if (duplicate) {
                // Append random digits to make unique
                const uniqueName = clean + '#' + Math.floor(Math.random() * 9000 + 1000);
                onlineUsers[socket.id] = {
                    socketId: socket.id,
                    username: uniqueName,
                    currentGame: null,
                    joinedAt: Date.now(),
                    lastMessageTime: 0
                };
                socket.emit('usernameSet', uniqueName);
            } else {
                onlineUsers[socket.id] = {
                    socketId: socket.id,
                    username: clean,
                    currentGame: null,
                    joinedAt: Date.now(),
                    lastMessageTime: 0
                };
                socket.emit('usernameSet', clean);
            }

            // Chat history is disabled (non-stored), so we don't send history here.
            // Register in database and send profile
            if (arenaDB) {
                const dbUser = arenaDB.getOrCreateUser(onlineUsers[socket.id].username);
                if (dbUser) {
                    socket.emit('userProfile', {
                        username: dbUser.username,
                        coins: dbUser.coins,
                        total_wins: dbUser.total_wins,
                        total_games: dbUser.total_games,
                        total_kills: dbUser.total_kills
                    });
                }
            }

            // Broadcast that a new user joined
            nsp.emit('userJoined', {
                username: onlineUsers[socket.id].username,
                count: Object.keys(onlineUsers).length
            });

            broadcastOnlineUsers();
        });

        // Player updates what game they're viewing/playing
        socket.on('updateGame', (gameName) => {
            if (onlineUsers[socket.id]) {
                onlineUsers[socket.id].currentGame = sanitize(gameName, 30) || null;
                broadcastOnlineUsers();
            }
        });

        // Chat message
        socket.on('chatMessage', (message) => {
            const user = onlineUsers[socket.id];
            if (!user) return;

            const now = Date.now();
            if (now - user.lastMessageTime < RATE_LIMIT_MS) {
                socket.emit('chatError', 'Slow down! Wait a moment between messages.');
                return;
            }

            let cleanMsg = sanitize(message, 150);
            if (cleanMsg.length < 1) return;

            // Basic profanity filter
            bannedWords.forEach(word => {
                const regex = createProfanityRegex(word);
                cleanMsg = cleanMsg.replace(regex, (match) => {
                    if (match.length <= 1) return '*';
                    return match[0] + '*'.repeat(match.length - 1);
                });
            });

            user.lastMessageTime = now;

            const chatMsg = {
                id: uuidv4().substring(0, 8),
                username: user.username,
                message: cleanMsg,
                timestamp: now
            };

            // History pushing removed to make chats ephemeral (non-stored)

            nsp.emit('chatMessage', chatMsg);
        });

        // ─── Reporting ───────────────────────────────────────────
        socket.on('reportUser', (reportedUsername) => {
            const user = onlineUsers[socket.id];
            if (!user) return;
            // Simply log the report to server console for now (moderation system pending)
            console.log(`[ALERT] User ${user.username} reported user: ${reportedUsername}`);
        });

        // ─── Party System ────────────────────────────────────────

        // Create a new party
        socket.on('createParty', () => {
            // Leave any existing party first
            if (playerParties[socket.id]) {
                removeFromParty(socket.id);
            }

            const code = generatePartyCode();
            parties[code] = {
                code: code,
                leaderId: socket.id,
                members: [socket.id]
            };
            playerParties[socket.id] = code;

            console.log(`[Hub] Party ${code} created by ${onlineUsers[socket.id]?.username || socket.id}`);
            broadcastPartyUpdate(code);
        });

        // Join an existing party by code
        socket.on('joinParty', (rawCode) => {
            const code = sanitize(rawCode, 4).toUpperCase();

            if (!parties[code]) {
                socket.emit('partyError', 'Party not found. Check the code and try again.');
                return;
            }

            if (parties[code].members.length >= 8) {
                socket.emit('partyError', 'Party is full (max 8 members).');
                return;
            }

            if (playerParties[socket.id] === code) {
                socket.emit('partyError', 'You are already in this party.');
                return;
            }

            // Leave current party if in one
            if (playerParties[socket.id]) {
                removeFromParty(socket.id);
            }

            parties[code].members.push(socket.id);
            playerParties[socket.id] = code;

            console.log(`[Hub] ${onlineUsers[socket.id]?.username || socket.id} joined party ${code}`);
            broadcastPartyUpdate(code);
        });

        // Leave current party
        socket.on('leaveParty', () => {
            removeFromParty(socket.id);
        });

        // Leader navigates the entire party to a game
        socket.on('partyNavigate', (url) => {
            const code = playerParties[socket.id];
            if (!code || !parties[code]) return;
            if (parties[code].leaderId !== socket.id) return; // Only leader can navigate

            const cleanUrl = sanitize(url, 100);
            if (!cleanUrl.startsWith('/games/')) return; // Only allow game URLs

            console.log(`[Hub] Party ${code} navigating to ${cleanUrl}`);

            // Notify all members (including leader) to navigate
            parties[code].members.forEach(sid => {
                const sock = nsp.sockets.get(sid);
                if (sock) {
                    sock.emit('partyNavigate', cleanUrl);
                }
            });
        });

        // Leader kicks a member
        socket.on('partyKick', (targetSocketId) => {
            const code = playerParties[socket.id];
            if (!code || !parties[code]) return;
            if (parties[code].leaderId !== socket.id) return; // Only leader can kick
            if (targetSocketId === socket.id) return; // Can't kick yourself

            if (parties[code].members.includes(targetSocketId)) {
                const kickedSock = nsp.sockets.get(targetSocketId);
                if (kickedSock) {
                    kickedSock.emit('partyKicked');
                }
                removeFromParty(targetSocketId);
            }
        });

        // Disconnect
        socket.on('disconnect', () => {
            const user = onlineUsers[socket.id];

            // Clean up party membership
            if (playerParties[socket.id]) {
                removeFromParty(socket.id);
            }

            if (user) {
                console.log('[Hub] User disconnected:', user.username);
                nsp.emit('userLeft', {
                    username: user.username,
                    count: Object.keys(onlineUsers).length - 1
                });
                delete onlineUsers[socket.id];
                broadcastOnlineUsers();
            }
        });
    });
};
