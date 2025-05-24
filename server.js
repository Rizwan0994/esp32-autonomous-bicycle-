const express = require('express');
const expressWs = require('express-ws');
const ejs = require('ejs');
const path = require('path');
const bodyParser = require('body-parser');
const fs = require('fs');
const axios = require('axios');

// Server config
const app = express();
expressWs(app);
const port = 80;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json({ limit: '10mb' })); // to handle large base64 images
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

const WIFI_CONFIG_PATH = path.join(__dirname, 'wifi_config.json');
const clients = new Set();

let wifiConfig = {
  ssid: 'abdullah',
  password: '12345678'
};

// Load or create WiFi config
if (fs.existsSync(WIFI_CONFIG_PATH)) {
  try {
    wifiConfig = JSON.parse(fs.readFileSync(WIFI_CONFIG_PATH, 'utf8'));
    console.log('Loaded WiFi config:', wifiConfig);
  } catch (e) {
    console.error('Failed to read WiFi config:', e);
  }
} else {
  fs.writeFileSync(WIFI_CONFIG_PATH, JSON.stringify(wifiConfig, null, 2));
  console.log('Created default WiFi config.');
}

// WebSocket route
app.ws('/ws', (ws, req) => {
  console.log('Client connected');
  clients.add(ws);

  // if (req.query.device === 'esp32') {
  //   console.log('ESP32 connected, sending WiFi config');
  //   ws.send(JSON.stringify({
  //     command: 'wifi_config',
  //     ssid: wifiConfig.ssid,
  //     password: wifiConfig.password
  //   }));
  // }

  ws.on('message', async (msg) => {
    let data;
    try {
      data = JSON.parse(msg);
    } catch (err) {
      return console.warn('Invalid JSON from client:', msg);
    }
 console.log('Received image data from client:',data.type);
    // Handle image processing
    if (data.type === 'image' && data.data) {
          for (const client of clients) {
      if (client !== ws && client.readyState === client.OPEN) {
        client.send(JSON.stringify(data));
      }
    }
      try {
        // Send image to Python detection service
        const response = await axios.post('https://c739-2407-d000-a-96a8-60f7-2f04-b183-25c3.ngrok-free.app/detect', {
          image: data.data
        }, {
          timeout: 5000
        });

        const predictions = response.data; // Array of detected objects

        const obstacleDetected = predictions.length > 0;
        const command = obstacleDetected
          ? { action: 'STOP', reason: 'obstacle_detected', details: predictions,image: data.data,type:'image' }
          : { action: 'GO', reason: 'clear_path' ,image: data.data ,type:'image'};

        const commandStr = JSON.stringify(command);

        for (const client of clients) {
          if (client.readyState === client.OPEN) {
            client.send(commandStr);
          }
        }
      } catch (err) {
        console.error('Detection service error:', err.message);
      }
    } else {
      // Forward normal messages to others
      for (const client of clients) {
        if (client !== ws && client.readyState === client.OPEN) {
          client.send(JSON.stringify(data));
        }
      }
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
    clients.delete(ws);
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
  });
});

// UI route
app.get('/', (req, res) => {
  res.render('index', { wifiConfig });
});

// WiFi update route
app.post('/update-wifi', (req, res) => {
  const { ssid, password } = req.body;
  if (!ssid || !password) return res.status(400).send('SSID and Password are required.');

  wifiConfig = { ssid, password };
  fs.writeFile(WIFI_CONFIG_PATH, JSON.stringify(wifiConfig, null, 2), (err) => {
    if (err) {
      console.error('Failed to save WiFi config:', err);
      return res.status(500).send('Failed to save WiFi config.');
    }

    // Notify ESP32 clients
    for (const client of clients) {
      if (client.readyState === client.OPEN) {
        client.send(JSON.stringify({
          command: 'wifi_config',
          ssid: wifiConfig.ssid,
          password: wifiConfig.password
        }));
      }
    }

    res.redirect('/');
  });
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
