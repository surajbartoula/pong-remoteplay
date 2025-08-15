import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Initialize Fastify
const fastify = Fastify({ 
  logger: true 
});

let players = {};
let playerSides = {}; // Track which side each player controls
let gameState = {
  ball: { x: 300, y: 200, vx: 3, vy: 2 },
  paddles: { left: { y: 160 }, right: { y: 160 } },
  score: { left: 0, right: 0 }
};

const PADDLE_HEIGHT = 80;
const PADDLE_WIDTH = 10;
const BALL_RADIUS = 8;
const CANVAS_WIDTH = 600;
const CANVAS_HEIGHT = 400;

// Start server function
async function startServer() {
  try {
    // Register static files
    await fastify.register(fastifyStatic, {
      root: join(__dirname, 'public'),
      prefix: '/',
    });

    // Register WebSocket
    await fastify.register(fastifyWebsocket);

    // WebSocket route
    fastify.register(async function (fastify) {
      fastify.get('/ws', { websocket: true }, (connection, req) => {
        const playerId = Date.now().toString();
        players[playerId] = connection.socket;
        
        // Assign player to available side
        let assignedSide = null;
        const activeSides = Object.values(playerSides);
        
        if (!activeSides.includes('left')) {
          assignedSide = 'left';
        } else if (!activeSides.includes('right')) {
          assignedSide = 'right';
        } else {
          // If both sides taken, assign to left (spectator mode or override)
          assignedSide = 'left';
        }
        
        playerSides[playerId] = assignedSide;
        
        console.log(`Player ${playerId} connected and assigned to ${assignedSide} side`);
        
        // Send initial assignment to client
        connection.socket.send(JSON.stringify({
          type: 'assignment',
          side: assignedSide
        }));
        
        connection.socket.on('message', message => {
          try {
            const data = JSON.parse(message.toString());
            if (data.type === 'move') {
              // Only allow movement if this player controls this side
              const playerSide = playerSides[playerId];
              if (data.side === playerSide && gameState.paddles[data.side]) {
                // Clamp paddle position
                gameState.paddles[data.side].y = Math.max(0, 
                  Math.min(CANVAS_HEIGHT - PADDLE_HEIGHT, data.y)
                );
              }
            }
          } catch (err) {
            console.error('Bad WS message:', err);
          }
        });
        
        connection.socket.on('close', () => {
          console.log(`Player ${playerId} (${playerSides[playerId]}) disconnected`);
          delete players[playerId];
          delete playerSides[playerId];
        });
      });
    });

    // Start the server
    await fastify.listen({ 
      port: 3000, 
      host: '127.0.0.1' 
    });
    
    console.log('🚀 Pong server running on http://localhost:3000');
    console.log('📡 WebSocket endpoint: ws://localhost:3000/ws');

  } catch (err) {
    console.error('Error starting server:', err);
    process.exit(1);
  }
}

function resetBall() {
  gameState.ball.x = CANVAS_WIDTH / 2;
  gameState.ball.y = CANVAS_HEIGHT / 2;
  gameState.ball.vx = (Math.random() > 0.5 ? 1 : -1) * 3;
  gameState.ball.vy = (Math.random() - 0.5) * 4;
}

// Physics + broadcast loop
setInterval(() => {
  // Update ball position
  gameState.ball.x += gameState.ball.vx;
  gameState.ball.y += gameState.ball.vy;
  
  // Top/bottom wall bouncing
  if (gameState.ball.y - BALL_RADIUS < 0 || gameState.ball.y + BALL_RADIUS > CANVAS_HEIGHT) {
    gameState.ball.vy *= -1;
  }
  
  // Left paddle collision
  if (gameState.ball.x - BALL_RADIUS <= 20 + PADDLE_WIDTH &&
      gameState.ball.y >= gameState.paddles.left.y &&
      gameState.ball.y <= gameState.paddles.left.y + PADDLE_HEIGHT &&
      gameState.ball.vx < 0) {
    gameState.ball.vx *= -1;
    // Add some spin based on where it hits the paddle
    const hitPos = (gameState.ball.y - gameState.paddles.left.y - PADDLE_HEIGHT/2) / (PADDLE_HEIGHT/2);
    gameState.ball.vy += hitPos * 2;
  }
  
  // Right paddle collision
  if (gameState.ball.x + BALL_RADIUS >= CANVAS_WIDTH - 20 - PADDLE_WIDTH &&
      gameState.ball.y >= gameState.paddles.right.y &&
      gameState.ball.y <= gameState.paddles.right.y + PADDLE_HEIGHT &&
      gameState.ball.vx > 0) {
    gameState.ball.vx *= -1;
    // Add some spin
    const hitPos = (gameState.ball.y - gameState.paddles.right.y - PADDLE_HEIGHT/2) / (PADDLE_HEIGHT/2);
    gameState.ball.vy += hitPos * 2;
  }
  
  // Scoring
  if (gameState.ball.x < 0) {
    gameState.score.right++;
    resetBall();
  } else if (gameState.ball.x > CANVAS_WIDTH) {
    gameState.score.left++;
    resetBall();
  }
  
  // Broadcast to all connected players
  if (Object.keys(players).length > 0) {
    const packet = JSON.stringify({ 
      type: 'state', 
      state: gameState,
      playerCount: Object.keys(players).length,
      activeSides: Object.values(playerSides)
    });
    for (const id in players) {
      const ws = players[id];
      if (ws.readyState === 1) {
        try {
          ws.send(packet);
        } catch (err) {
          console.error('Error sending to player:', err);
          delete players[id];
          delete playerSides[id];
        }
      }
    }
  }
}, 16); // ~60 FPS

// Start the server
startServer();