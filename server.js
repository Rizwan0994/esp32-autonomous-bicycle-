const express = require('express');
const expressWs = require('express-ws');
const ejs = require('ejs');
const path = require('path');
const bodyParser = require('body-parser');
const fs = require('fs');

const app = express();
expressWs(app); // Apply WebSocket middleware
const port = 80; // Standard HTTP port

// Configuration file for WiFi credentials
const WIFI_CONFIG_PATH = path.join(__dirname, 'wifi_config.json');

// --- Middleware ---
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public'))); // Serve static files from 'public' directory
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views')); // EJS templates are in the 'views' directory

// In-memory storage for connected WebSocket clients
const clients = new Set();

// Default WiFi credentials (can be overridden by wifi_config.json)
let wifiConfig = {
    ssid: "abdullah",
    password: "12345678"
};

// Load WiFi configuration from file if it exists
if (fs.existsSync(WIFI_CONFIG_PATH)) {
    try {
        const rawConfig = fs.readFileSync(WIFI_CONFIG_PATH, 'utf8');
        wifiConfig = JSON.parse(rawConfig);
        console.log('Loaded WiFi config from file:', wifiConfig);
    } catch (err) {
        console.error('Error loading WiFi config file:', err);
    }
} else {
    // Save default config if file doesn't exist
    fs.writeFileSync(WIFI_CONFIG_PATH, JSON.stringify(wifiConfig, null, 2), 'utf8');
    console.log('Created default WiFi config file.');
}

// --- WebSocket Handling ---
app.ws('/ws', (ws, req) => {
    console.log('WebSocket client connected');
    clients.add(ws);

    // Send initial WiFi config to newly connected ESP32 client
    if (req.query.device === 'esp32') {
        console.log('ESP32 connected. Sending WiFi config.');
        ws.send(JSON.stringify({
            command: 'wifi_config',
            ssid: wifiConfig.ssid,
            password: wifiConfig.password
        }));
    }

    ws.on('message', (msg) => {
        try {
            const data = JSON.parse(msg);
           // console.log('Received from WebSocket:', data);

            // Forward data to all other connected web clients (dashboard)
            clients.forEach(client => {
                if (client !== ws) { // Don't send back to the sender
                    client.send(JSON.stringify(data));
                }
            });

            // Handle commands from the web UI to be sent to ESP32
            if (data.command) {
                // Assuming ESP32 client identifies itself or we use separate WebSocket endpoints
                // For simplicity, let's assume we send all commands to the single ESP32 client
                // In a multi-device setup, you'd need a way to identify the ESP32's WebSocket
                clients.forEach(client => {
                    if (client === ws || req.query.device === 'esp32') { // This condition is a bit loose, better to identify ESP32
                        // If the message came from ESP32, no need to send it back to itself as a command
                        // If it came from web UI, then send it to ESP32
                        // This logic needs refinement for proper routing
                        // For now, let's just forward to ESP32 specifically.
                        // A dedicated ESP32 client variable would be better.
                    }
                });
            }

        } catch (error) {
            console.error('Failed to parse WebSocket message:', msg, error);
        }
    });

    ws.on('close', () => {
        console.log('WebSocket client disconnected');
        clients.delete(ws);
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});

// Function to send data to all connected web clients
function sendDataToWebClients(data) {
    clients.forEach(client => {
        // Only send to web clients (not the ESP32)
        // This requires differentiating clients, e.g., by adding a query param or origin check
        // For this example, we'll assume all non-ESP32 connections are web clients
        if (client.readyState === client.OPEN) {
            client.send(JSON.stringify(data));
        }
    });
}

// --- HTTP Routes ---

// Dashboard page
app.get('/', (req, res) => {
    res.render('index', { wifiConfig }); // Pass wifiConfig to the EJS template
});

// Route to handle Wi-Fi credential updates
app.post('/update-wifi', (req, res) => {
    const { ssid, password } = req.body;
    if (ssid && password) {
        wifiConfig.ssid = ssid;
        wifiConfig.password = password;

        fs.writeFile(WIFI_CONFIG_PATH, JSON.stringify(wifiConfig, null, 2), 'utf8', (err) => {
            if (err) {
                console.error('Error saving WiFi config:', err);
                return res.status(500).send('Error saving WiFi configuration.');
            }
            console.log('WiFi credentials updated and saved:', wifiConfig);
            // Optionally, send update to ESP32 here if it's connected
            clients.forEach(client => {
                // If it's an ESP32 client (you'd need a way to identify it)
                // For now, it sends to all, and ESP32 will handle 'wifi_config' command
                if (client.readyState === client.OPEN) {
                    client.send(JSON.stringify({
                        command: 'wifi_config',
                        ssid: wifiConfig.ssid,
                        password: wifiConfig.password
                    }));
                }
            });
            res.redirect('/'); // Redirect back to the dashboard
        });
    } else {
        res.status(400).send('SSID and Password are required.');
    }
});

// Start the server
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});