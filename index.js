const { startWhatsAppBot } = require('./src/whatsapp');
const { startWebSocketServer } = require('./src/websocket');

// Handle uncaught errors gracefully
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection:', err);
});

console.log('🚀 Memulai WhatsApp AI Agent & Antigravity Bridge...');

// Start lightweight WebSocket Server (port 8765)
startWebSocketServer(process.env.WS_PORT ? parseInt(process.env.WS_PORT) : 8765);

// Start WhatsApp Bot
startWhatsAppBot().catch((err) => {
  console.error('Fatal Error starting WhatsApp Bot:', err);
});
