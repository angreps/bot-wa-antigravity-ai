const { WebSocketServer } = require('ws');
const terminal = require('./terminal');
const antigravity = require('./antigravity');

let wss = null;
const clients = new Set();

function startWebSocketServer(port = 8765) {
  try {
    wss = new WebSocketServer({ port });
    console.log(`⚡ WebSocket Server berjalan di ws://localhost:${port}`);

    wss.on('connection', (ws) => {
      clients.add(ws);
      console.log(`[WS] Client baru terhubung (Total: ${clients.size})`);

      // Send welcome handshake
      ws.send(JSON.stringify({
        type: 'connected',
        message: 'Terhubung ke Antigravity Laptop WebSocket Bridge',
        model: antigravity.getModel(),
        cwd: terminal.getCwd(),
      }));

      ws.on('message', async (data) => {
        try {
          const payload = JSON.parse(data.toString('utf8'));
          if (payload.type === 'prompt') {
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

module.exports = {
  startWebSocketServer,
  broadcast,
};
