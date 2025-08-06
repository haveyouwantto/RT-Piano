// server.js (Updated for HTTPS and Per-Client Colors)

const express = require('express');
const https = require('https');
const socketIo = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// 1. Use self-signed certificates for HTTPS

// This is for development purposes only. You should use a trusted certificate authority (CA) in production.
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



let autoIncrementId = 0;

function intToBase64(num) {
    if (num < 0 || !Number.isInteger(num)) {
        throw new Error('Invalid input');
    }
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    if (num === 0) return chars[0];

    let result = '';
    while (num > 0) {
        const remainder = num % 64;
        result = chars[remainder] + result;
        num = Math.floor(num / 64);
    }
    return result;
}


// Function to broadcast the client list
const updateUserList = () => {
    // Convert to broadcast-friendly format: [{ shortId, ip, color }, ...]
    const clientListForBroadcast = Object.entries(connectedClients).map(([id, data]) => ({
        id,
        ...data
    }));
    io.emit('update-user-list', clientListForBroadcast);
};

io.on('connection', (socket) => {
    // 1. Get IP
    const ip = socket.handshake.address.replace('::ffff:', ''); // Handle IPv6 formatted IPv4 addresses
    socket.shortId = intToBase64(autoIncrementId++);

    // 2. Generate a random color (HSV, S > 0.8, V > 0.8)
    const color = {
        h: Math.random() * 360, // Hue (0-360)
        s: 0.8 + Math.random() * 0.2, // Saturation (0.8 - 1.0)
        v: 0.8 + Math.random() * 0.2 // Value/Brightness (0.8 - 1.0)
    };

    console.log(`User ${socket.shortId} from ${ip} connected, assigned color H:${color.h.toFixed(0)}`);

    // 3. Store user information
    connectedClients[socket.shortId] = { ip, color };

    socket.emit('your-id', socket.shortId);
    updateUserList();

    // 4. Modify MIDI message broadcast to include the sender's ID
    socket.on('midi', (data) => {
        socket.broadcast.emit('midi', {
            s: socket.shortId,
            m: data
        });
    });

    socket.on('disconnect', () => {
        console.log(`User ${socket.shortId} disconnected.`);
        delete connectedClients[socket.shortId];
        updateUserList();
    });

    socket.on("ping", (callback) => {
        callback();
    });
});

server.listen(PORT, () => {
    console.log(`Server is running on https://localhost:${PORT}`);
});