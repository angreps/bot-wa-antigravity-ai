const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { WebSocketServer } = require('ws');
const terminal = require('./terminal');
const antigravity = require('./antigravity');

let httpServer = null;
let wss = null;
const clients = new Set();
let gameStats = {
  totalPlays: 0,
  highScores: {
    cyber_runner: { score: 0, player: 'Anon' },
  },
  lastGames: [],
};

// Helper: Get best external or LAN IP address
function getLocalIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
}

function getGameUrl(port = 8765) {
  const ip = getLocalIp();
  return {
    local: `http://localhost:${port}/game`,
    lan: `http://${ip}:${port}/game`,
    wsUrl: `ws://${ip}:${port}`,
  };
}

function startWebSocketServer(port = 8765) {
  try {
    // 1. Create HTTP Server for HTML Mini App
    httpServer = http.createServer((req, res) => {
      // CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

      const urlPath = req.url.split('?')[0];

      // Route / or /game to public/game.html
      if (urlPath === '/' || urlPath === '/game' || urlPath === '/miniapp') {
        const gameHtmlPath = path.join(__dirname, '../public/game.html');
        if (fs.existsSync(gameHtmlPath)) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          return res.end(fs.readFileSync(gameHtmlPath));
        }
      }

      // API route for status or highscores
      if (urlPath === '/api/stats') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          status: 'online',
          gameStats,
          model: antigravity.getModel(),
        }));
      }

      // Default fallback
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found - Antigravity Mini App Server');
    });

    // 2. Attach WebSocket to HTTP Server
    wss = new WebSocketServer({ server: httpServer });

    wss.on('connection', (ws) => {
      clients.add(ws);
      console.log(`[WS] Client baru terhubung ke Mini App / Bridge (Total: ${clients.size})`);

      // Send welcome handshake
      ws.send(JSON.stringify({
        type: 'connected',
        message: 'Terhubung ke Antigravity Mini App & AI Bridge',
        model: antigravity.getModel(),
        gameStats,
      }));

      ws.on('message', async (data) => {
        try {
          const payload = JSON.parse(data.toString('utf8'));

          // MINI APP GAME EVENTS
          if (payload.type === 'game_start') {
            gameStats.totalPlays++;
            broadcast('game_activity', {
              event: 'started',
              game: payload.game,
              totalPlays: gameStats.totalPlays,
            });
          } else if (payload.type === 'game_score') {
            // Realtime score stream
            if (payload.game === 'cyber_runner' && payload.score > gameStats.highScores.cyber_runner.score) {
              gameStats.highScores.cyber_runner = {
                score: payload.score,
                player: payload.player || 'Player WA',
                timestamp: Date.now(),
              };
            }
          } else if (payload.type === 'game_over') {
            gameStats.lastGames.unshift({
              game: payload.game,
              score: payload.finalScore || payload.winner,
              timestamp: Date.now(),
            });
            if (gameStats.lastGames.length > 10) gameStats.lastGames.pop();

            broadcast('game_over_broadcast', {
              game: payload.game,
              stats: payload,
              highScores: gameStats.highScores,
            });
          }

          // TERMINAL / AI PROMPT EVENTS
          else if (payload.type === 'prompt') {
            const promptText = payload.prompt || payload.text;
            if (!promptText) return ws.send(JSON.stringify({ type: 'error', error: 'Prompt kosong' }));

            ws.send(JSON.stringify({ type: 'status', status: 'processing', prompt: promptText }));
            const result = await antigravity.askAntigravity(promptText);
            ws.send(JSON.stringify({
              type: 'response',
              text: result.text,
              duration: result.duration,
              success: result.success,
            }));
          } else if (payload.type === 'status') {
            ws.send(JSON.stringify({
              type: 'status_response',
              system: terminal.getSystemStatus(),
              model: antigravity.getModel(),
              gameStats,
            }));
          } else if (payload.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong' }));
          }
        } catch (err) {
          ws.send(JSON.stringify({ type: 'error', error: err.message }));
        }
      });

      ws.on('close', () => {
        clients.delete(ws);
        console.log(`[WS] Client terputus (Sisa: ${clients.size})`);
      });

      ws.on('error', (err) => {
        console.error('[WS Error]:', err.message);
      });
    });

    httpServer.listen(port, () => {
      const urls = getGameUrl(port);
      console.log(`⚡ Mini App Server & WebSocket berjalan di:`);
      console.log(`   🔗 Web Mini App : ${urls.lan}`);
      console.log(`   🔗 Localhost    : ${urls.local}`);
      console.log(`   ⚡ WebSocket    : ${urls.wsUrl}`);
    });

    return wss;
  } catch (err) {
    console.warn(`[WS] Gagal memulai WebSocket di port ${port}:`, err.message);
    return null;
  }
}

// Broadcast event to all connected WebSocket clients
function broadcast(event, data) {
  if (!wss || clients.size === 0) return;
  const msg = JSON.stringify({ event, data, timestamp: Date.now() });
  for (const client of clients) {
    if (client.readyState === 1) { // OPEN
      client.send(msg);
    }
  }
}

function getStats() {
  return gameStats;
}

module.exports = {
  startWebSocketServer,
  broadcast,
  getGameUrl,
  getStats,
};
