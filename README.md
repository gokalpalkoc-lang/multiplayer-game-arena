# Multiplayer Game Arena

The game server behind **[Game Arena](http://gokalp.alkoc.net)**, a hub of real-time multiplayer browser games. It runs on Node.js, Express and Socket.IO, with a SQLite database for player profiles, coins and leaderboards.

The server is authoritative: each game runs its own simulation loop and broadcasts state to the clients over Socket.IO, so clients only send input.

## Games

Each game is a separate module in `games/` with its own Socket.IO namespace.

| Game | Namespace | What it is |
|---|---|---|
| Counter-Stride | `/counter-stride` | Fast 2D top-down shooter |
| Battle Royale | `/battle-royale` | Up to 20 players on a generated 3200×3200 map with a shrinking zone |
| Territory Wars | `/territory-wars` | Real-time strategy: build bases, gather resources and fight with units |
| Brawler | `/brawler` | Platform fighter with gravity, double jumps and knockback |
| Social Deduction | `/social-deduction` | Crew vs. impostor game with vision radius, sabotage, meetings and voting |
| Co-op Puzzle | `/coop-puzzle` | Cooperative color-matching levels, with a map editor |
| Pixel Kart | `/pixel-kart` | Top-down racing |
| Battle Pong | `/battle-pong` | Competitive, high-speed Pong |
| Donkey Competition | `/donkey-competition` | Race betting with a 30-second betting window and preset tracks |

`games/globalHub.js` (`/hub`) handles everything shared between games: global chat, who is online, and parties.

## API

| Endpoint | Returns |
|---|---|
| `GET /health` | `OK` |
| `GET /api/leaderboard?sort=coins&limit=15` | Global leaderboard |
| `GET /api/leaderboard/:game` | Leaderboard for one game |
| `GET /api/user/:username` | A player's stats |

## Running locally

```bash
npm install
npm run dev      # restarts on file changes; or: npm start
```

The server listens on port 3000. On first start it creates `data/arena.db` and its schema; the database is not tracked in git.

The browser client is deployed separately at [gokalp.alkoc.net](http://gokalp.alkoc.net) and is not part of this repository.

## Project structure

```
server.js      Express + Socket.IO setup, leaderboard API, loads every game module
db.js          SQLite schema and queries (users, per-game stats, coin transactions)
games/         one module per game; each registers its own namespace and game loop
```

## Tech stack

- Node.js, Express
- Socket.IO for real-time, bidirectional networking
- better-sqlite3 (WAL mode) for persistence
