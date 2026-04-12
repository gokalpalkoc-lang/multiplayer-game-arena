const Database = require('better-sqlite3');
const path = require('path');

// --- Initialize Database ---
const dbPath = path.join(__dirname, 'data', 'arena.db');

// Ensure data directory exists
const fs = require('fs');
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(dbPath);
db.pragma('journal_mode = WAL'); // Better concurrent read performance
db.pragma('foreign_keys = ON');

// --- Schema ---
db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE COLLATE NOCASE NOT NULL,
        coins INTEGER DEFAULT 0,
        total_games INTEGER DEFAULT 0,
        total_wins INTEGER DEFAULT 0,
        total_kills INTEGER DEFAULT 0,
        total_levels_completed INTEGER DEFAULT 0,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        last_seen INTEGER DEFAULT (strftime('%s', 'now'))
    );

    CREATE TABLE IF NOT EXISTS game_stats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        game TEXT NOT NULL,
        wins INTEGER DEFAULT 0,
        losses INTEGER DEFAULT 0,
        kills INTEGER DEFAULT 0,
        deaths INTEGER DEFAULT 0,
        games_played INTEGER DEFAULT 0,
        coins_earned INTEGER DEFAULT 0,
        best_score INTEGER DEFAULT 0,
        FOREIGN KEY (user_id) REFERENCES users(id),
        UNIQUE(user_id, game)
    );

    CREATE TABLE IF NOT EXISTS coin_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        amount INTEGER NOT NULL,
        reason TEXT NOT NULL,
        game TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
    CREATE INDEX IF NOT EXISTS idx_users_coins ON users(coins DESC);
    CREATE INDEX IF NOT EXISTS idx_game_stats_user ON game_stats(user_id);
    CREATE INDEX IF NOT EXISTS idx_game_stats_game ON game_stats(game);
    CREATE INDEX IF NOT EXISTS idx_coin_tx_user ON coin_transactions(user_id);
`);

// --- Prepared Statements (much faster than ad-hoc queries) ---
const stmts = {
    // Users
    getUser: db.prepare('SELECT * FROM users WHERE username = ?'),
    getUserById: db.prepare('SELECT * FROM users WHERE id = ?'),
    createUser: db.prepare('INSERT OR IGNORE INTO users (username) VALUES (?)'),
    updateLastSeen: db.prepare('UPDATE users SET last_seen = strftime(\'%s\', \'now\') WHERE id = ?'),
    addCoins: db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?'),
    incrementWins: db.prepare('UPDATE users SET total_wins = total_wins + 1, total_games = total_games + 1 WHERE id = ?'),
    incrementGames: db.prepare('UPDATE users SET total_games = total_games + 1 WHERE id = ?'),
    incrementKills: db.prepare('UPDATE users SET total_kills = total_kills + ? WHERE id = ?'),
    incrementLevels: db.prepare('UPDATE users SET total_levels_completed = total_levels_completed + 1 WHERE id = ?'),

    // Game Stats
    getGameStats: db.prepare('SELECT * FROM game_stats WHERE user_id = ? AND game = ?'),
    upsertGameStats: db.prepare(`
        INSERT INTO game_stats (user_id, game, wins, losses, kills, deaths, games_played, coins_earned, best_score)
        VALUES (?, ?, 0, 0, 0, 0, 0, 0, 0)
        ON CONFLICT(user_id, game) DO NOTHING
    `),
    addGameWin: db.prepare('UPDATE game_stats SET wins = wins + 1, games_played = games_played + 1 WHERE user_id = ? AND game = ?'),
    addGameLoss: db.prepare('UPDATE game_stats SET losses = losses + 1, games_played = games_played + 1 WHERE user_id = ? AND game = ?'),
    addGameKills: db.prepare('UPDATE game_stats SET kills = kills + ? WHERE user_id = ? AND game = ?'),
    addGameDeaths: db.prepare('UPDATE game_stats SET deaths = deaths + ? WHERE user_id = ? AND game = ?'),
    addGameCoins: db.prepare('UPDATE game_stats SET coins_earned = coins_earned + ? WHERE user_id = ? AND game = ?'),
    updateBestScore: db.prepare('UPDATE game_stats SET best_score = MAX(best_score, ?) WHERE user_id = ? AND game = ?'),

    // Coin Transactions
    logTransaction: db.prepare('INSERT INTO coin_transactions (user_id, amount, reason, game) VALUES (?, ?, ?, ?)'),

    // Leaderboards
    topByCoins: db.prepare('SELECT username, coins, total_wins, total_games, total_kills FROM users ORDER BY coins DESC LIMIT ?'),
    topByWins: db.prepare('SELECT username, coins, total_wins, total_games, total_kills FROM users ORDER BY total_wins DESC LIMIT ?'),
    topByKills: db.prepare('SELECT username, coins, total_wins, total_games, total_kills FROM users ORDER BY total_kills DESC LIMIT ?'),
    topByGame: db.prepare(`
        SELECT u.username, gs.wins, gs.games_played, gs.kills, gs.coins_earned, gs.best_score
        FROM game_stats gs
        JOIN users u ON u.id = gs.user_id
        WHERE gs.game = ?
        ORDER BY gs.wins DESC, gs.coins_earned DESC
        LIMIT ?
    `),
};

// --- Public API ---
const arenaDB = {
    /**
     * Get or create a user by username. Returns { id, username, coins, ... }
     */
    getOrCreateUser(username) {
        stmts.createUser.run(username);
        const user = stmts.getUser.get(username);
        if (user) stmts.updateLastSeen.run(user.id);
        return user;
    },

    /**
     * Get user profile by username
     */
    getUser(username) {
        return stmts.getUser.get(username);
    },

    /**
     * Award coins to a user with a reason string.
     * Also logs the transaction and updates game-specific stats.
     */
    awardCoins(username, amount, reason, game) {
        const user = this.getOrCreateUser(username);
        if (!user) return null;

        stmts.addCoins.run(amount, user.id);
        stmts.logTransaction.run(user.id, amount, reason, game || null);

        if (game) {
            stmts.upsertGameStats.run(user.id, game);
            stmts.addGameCoins.run(amount, user.id, game);
        }

        return stmts.getUserById.get(user.id);
    },

    /**
     * Record a game result for a player
     */
    recordGameResult(username, game, won, extraData = {}) {
        const user = this.getOrCreateUser(username);
        if (!user) return;

        stmts.upsertGameStats.run(user.id, game);

        if (won) {
            stmts.incrementWins.run(user.id);
            stmts.addGameWin.run(user.id, game);
        } else {
            stmts.incrementGames.run(user.id);
            stmts.addGameLoss.run(user.id, game);
        }

        if (extraData.kills) {
            stmts.incrementKills.run(extraData.kills, user.id);
            stmts.addGameKills.run(extraData.kills, user.id, game);
        }

        if (extraData.deaths) {
            stmts.addGameDeaths.run(extraData.deaths, user.id, game);
        }

        if (extraData.bestScore !== undefined) {
            stmts.updateBestScore.run(extraData.bestScore, user.id, game);
        }

        if (extraData.levelCompleted) {
            stmts.incrementLevels.run(user.id);
        }
    },

    /**
     * Get leaderboard data
     * @param {'coins'|'wins'|'kills'} sortBy
     * @param {number} limit
     */
    getLeaderboard(sortBy = 'coins', limit = 15) {
        switch (sortBy) {
            case 'wins': return stmts.topByWins.all(limit);
            case 'kills': return stmts.topByKills.all(limit);
            case 'coins':
            default: return stmts.topByCoins.all(limit);
        }
    },

    /**
     * Get per-game leaderboard
     */
    getGameLeaderboard(game, limit = 15) {
        return stmts.topByGame.all(game, limit);
    },

    /**
     * Get all game stats for a user
     */
    getUserStats(username) {
        const user = this.getUser(username);
        if (!user) return null;

        const stats = db.prepare('SELECT * FROM game_stats WHERE user_id = ?').all(user.id);
        return {
            user: {
                username: user.username,
                coins: user.coins,
                total_games: user.total_games,
                total_wins: user.total_wins,
                total_kills: user.total_kills,
                total_levels_completed: user.total_levels_completed,
            },
            games: stats
        };
    }
};

module.exports = arenaDB;
