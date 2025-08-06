// server.js (Updated for HTTPS and Per-Client Colors)

const express = require('express');
const https = require('https');
const socketIo = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// 1. Generate a self-signed certificate
// In a real-world scenario, you would use a trusted certificate authority (CA)
// The following is for development purposes only.
// To use this, you'll need to create 'cert.pem' and 'key.pem' files in a 'ssl' directory.
// You can use OpenSSL to generate these files with a command like:
// openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 365
const options = {
  key: fs.readFileSync(path.join(__dirname, 'ssl', 'key.pem')),
  cert: fs.readFileSync(path.join(__dirname, 'ssl', 'cert.pem'))
};

// 2. Create the HTTPS server
const server = https.createServer(options, app);
const io = socketIo(server);

// Store client information { socket.id: { ip, color } }
let connectedClients = {};

app.use(express.static(__dirname));

// Function to broadcast the client list
const updateUserList = () => {
  // Convert to broadcast-friendly format: [{ id, ip, color }, ...]
  const clientListForBroadcast = Object.entries(connectedClients).map(([id, data]) => ({
    id,
    ...data
  }));
  io.emit('update-user-list', clientListForBroadcast);
};

io.on('connection', (socket) => {
  // 1. Get IP
  const ip = socket.handshake.address.replace('::ffff:', ''); // Handle IPv6 formatted IPv4 addresses

  // 2. Generate a random color (HSV, S > 0.8, V > 0.8)
  const color = {
    h: Math.random() * 360, // Hue (0-360)
    s: 0.8 + Math.random() * 0.2, // Saturation (0.8 - 1.0)
    v: 0.8 + Math.random() * 0.2 // Value/Brightness (0.8 - 1.0)
  };

  console.log(`User ${socket.id} from ${ip} connected, assigned color H:${color.h.toFixed(0)}`);
  
  // 3. Store user information
  connectedClients[socket.id] = { ip, color };
  
  socket.emit('your-id', socket.id);
  updateUserList();

  // 4. Modify MIDI message broadcast to include the sender's ID
  socket.on('midi', (data) => {
    socket.broadcast.emit('midi', { 
      senderId: socket.id, 
      midiData: data 
    });
  });

  socket.on('disconnect', () => {
    console.log(`User ${socket.id} disconnected.`);
    delete connectedClients[socket.id];
    updateUserList();
  });
});

server.listen(PORT, () => {
  console.log(`Server is running on https://localhost:${PORT}`);
});