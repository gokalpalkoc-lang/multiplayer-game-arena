# Multiplayer 2D Game Template

A simple boilerplate for building 2D multiplayer games in the browser using HTML5 Canvas, modern aesthetics, Node.js, Express, and Socket.IO. 

## Getting Started

1. Open your terminal in this directory.
2. Run `npm install` to install dependencies.
3. Run `npm start` to start the local game server.
4. Open your browser and navigate to `http://localhost:3000`. 
5. Open a second browser tab to the same address to see the multiplayer in action!
6. in your public directory. You can access it by running your server (node server.js) and navigating to http://localhost:3000/mapEditor.html in your browser. From there, you can draw maps and click "Export Map Data" to generate the code for your game.

## Code Structure

- `server.js`: The backend Node server handling player connections, disconnections, and broadcasting positions.
- `public/index.html`: The markup containing the HTML5 Canvas element.
- `public/style.css`: The CSS adding an aesthetic and responsive dark-mode look.
- `public/game.js`: The frontend client managing input, connecting to Socket.IO, and rendering to the screen.

Have fun building your game!
