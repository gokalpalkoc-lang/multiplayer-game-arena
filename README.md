# Multiplayer Game Arena

A comprehensive platform for 2D multiplayer browser games built with HTML5 Canvas, Node.js, Express, and Socket.IO. The platform features a responsive, aesthetic design and hosts multiple distinct game modes.

## Live Deployment

- **Frontend URL**: [http://gokalp.alkoc.net](http://gokalp.alkoc.net)
- **Backend API / WebSocket Server**: [https://multiplayer-game-backend-y5na.onrender.com](https://multiplayer-game-backend-y5na.onrender.com)

## Games Included

1. **Counter-Stride**: A fast-paced 2D multiplayer shooter.
2. **Co-op Puzzle**: A cooperative puzzle game where players must color-match and work together to complete levels and avoid kill-blocks. Includes a dedicated level editor!
3. **Territory Wars**: A real-time strategy (RTS) pixel-based conquest game featuring base-building, resource management, and unit combat.
4. **Battle Pong**: A competitive, high-speed twist on the classic arcade game.
5. **Pixel Kart**: A fast-paced, top-down multiplayer racing game.

## Getting Started

1. Open your terminal in this directory.
2. Run `npm install` to install the required dependencies.
3. Run `npm start` (or `npm run dev` for auto-restarting watch mode) to launch the local game server.
4. Open your browser and navigate to `http://localhost:3000`.
5. Open additional browser tabs (or use different browsers) navigating to the same address to simulate multiple players joining the lobby and games.

## Map Editor
Some games, such as Co-op Puzzle, support custom maps. Navigate to `http://localhost:3000/mapEditor.html` while the server is running to launch the visual map editor. You can design maps, add interactable elements, and export the map data for use in the games.

## Project Structure

- `server.js`: The central Node.js backend entry point. Initializes the server and loads all game modules.
- `games/`: Contains the backend logic and independent Socket.IO namespaces for each game (e.g., `coopPuzzle.js`, `territoryWars.js`).
- `public/`: Contains the frontend static assets.
  - `public/index.html`: The main lobby interface where players can select a game.
  - `public/games/`: Holds the client-side scripts, stylesheets, and assets specifically scoped to each individual game.
  - `public/mapEditor.html`: The frontend UI for the map editor.

## Tech Stack

- **Frontend:** HTML5 Canvas, Vanilla Javascript, Custom CSS
- **Backend:** Node.js, Express
- **Networking:** Socket.IO for real-time, bidirectional event-based communication.
