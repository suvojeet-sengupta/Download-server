const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3009;
const PASSWORD = process.env.PASSWORD;
const PUBLIC_URL = process.env.PUBLIC_URL || '';


if (!PASSWORD) {
  console.error('FATAL ERROR: PASSWORD environment variable is not defined.');
  process.exit(1);
}

const UPLOADS_DIR = path.join(__dirname, 'uploads');
const TEMP_DIR = path.join(UPLOADS_DIR, 'temp');
const MULTER_TEMP_DIR = path.join(UPLOADS_DIR, 'multer_temp');
const DB_FILE = path.join(__dirname, 'db.json');

// Ensure directories exist
[UPLOADS_DIR, TEMP_DIR, MULTER_TEMP_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Helper functions for database operations
function readDatabase() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ files: [] }, null, 2));
    return { files: [] };
  }
  try {
    const data = fs.readFileSync(DB_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading database file:', error);
    return { files: [] };
  }
}

function writeDatabase(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Error writing database file:', error);
  }
}

// Telegram alert integration
function sendTelegramMessage(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId || token === 'YOUR_TELEGRAM_BOT_TOKEN' || chatId === 'YOUR_TELEGRAM_CHAT_ID') {
    return;
  }

  const payload = JSON.stringify({
    chat_id: chatId,
    text: text,
    parse_mode: 'HTML'
  });

  const options = {
    hostname: 'api.telegram.org',
    port: 443,
    path: `/bot${token}/sendMessage`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    }
  };

  const req = https.request(options, (res) => {
    // Response stream ignored, errors caught in hook
  });
  
  req.on('error', (e) => {
    console.error('Failed to send Telegram alert:', e);
  });
  
  req.write(payload);
  req.end();
}

function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// Helper to find active session by fingerprint
function findSessionByFingerprint(fingerprint) {
  if (!fs.existsSync(TEMP_DIR)) return null;
  const folders = fs.readdirSync(TEMP_DIR);
  for (const folder of folders) {
    const metaPath = path.join(TEMP_DIR, folder, 'meta.json');
    if (fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        if (meta.fingerprint === fingerprint) {
          return { uploadId: folder, meta };
        }
      } catch (err) {
        // ignore malformed meta
      }
    }
  }
  return null;
}

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Configure Multer Disk Storage for temporary files
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    if (!fs.existsSync(MULTER_TEMP_DIR)) {
      fs.mkdirSync(MULTER_TEMP_DIR, { recursive: true });
    }
    cb(null, MULTER_TEMP_DIR);
  },
  filename: function (req, file, cb) {
    // Save under a unique random name
    cb(null, crypto.randomBytes(16).toString('hex'));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 20 * 1024 * 1024 * 1024 // 20 GB file limit
  }
});

// Authentication middleware
function authenticate(req, res, next) {
  const userPassword = req.headers['x-password'] || req.query.password;
  if (!userPassword || userPassword !== PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized: Invalid password.' });
  }
  next();
}

// Storage capacity configurations
const maxStorageGB = parseInt(process.env.MAX_STORAGE_LIMIT_GB) || 20;
const MAX_STORAGE_LIMIT = maxStorageGB * 1024 * 1024 * 1024; // Storage capacity in bytes

function getTotalStorageUsed() {
  const db = readDatabase();
  return db.files.reduce((acc, f) => acc + f.size, 0);
}

// API Routes

// Verify password
app.post('/api/verify', (req, res) => {
  const { password } = req.body;
  if (password === PASSWORD) {
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Invalid password' });
  }
});

// Upload file (Standard upload)
app.post('/api/upload', authenticate, upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  // Check storage capacity limit
  const currentUsed = getTotalStorageUsed();
  if (currentUsed + req.file.size > MAX_STORAGE_LIMIT) {
    if (fs.existsSync(req.file.path)) {
      try { fs.unlinkSync(req.file.path); } catch (e) {}
    }
    return res.status(400).json({ error: 'Storage capacity full: 20 GB limit reached.' });
  }

  const id = crypto.randomBytes(4).toString('hex');
  const targetDir = path.join(UPLOADS_DIR, id);
  fs.mkdirSync(targetDir, { recursive: true });
  
  const targetPath = path.join(targetDir, req.file.originalname);
  
  try {
    fs.renameSync(req.file.path, targetPath);
  } catch (err) {
    console.error('Failed to move uploaded file:', err);
    return res.status(500).json({ error: 'Failed to process file on server' });
  }

  const db = readDatabase();
  const fileData = {
    id: id,
    name: req.file.originalname,
    size: req.file.size,
    mimeType: req.file.mimetype,
    uploadedAt: new Date().toISOString(),
    downloads: 0
  };

  db.files.push(fileData);
  writeDatabase(db);

  // Construct links
  const baseUrl = PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
  const downloadUrl = `${baseUrl}/d/${fileData.id}/${encodeURIComponent(fileData.name)}`;
  const directUrl = `${baseUrl}/d/${fileData.id}`;

  // Send Telegram Alert
  const tgText = `📤 <b>New File Uploaded on SuvShare!</b>\n\n📁 <b>Name:</b> <code>${fileData.name}</code>\n⚖️ <b>Size:</b> <code>${formatBytes(fileData.size)}</code>\n🏷️ <b>Type:</b> <code>${fileData.mimeType}</code>\n\n🔗 <b>Link:</b> <a href="${downloadUrl}">${downloadUrl}</a>`;
  sendTelegramMessage(tgText);

  res.json({
    success: true,
    file: {
      ...fileData,
      downloadUrl,
      directUrl
    }
  });
});

// Initialize or resume chunked upload
app.post('/api/upload/init', authenticate, (req, res) => {
  const { name, size, mimeType, chunkSize, fingerprint } = req.body;
  if (!name || !size || !fingerprint) {
    return res.status(400).json({ error: 'Missing upload metadata' });
  }

  // Check storage capacity limit
  const currentUsed = getTotalStorageUsed();
  if (currentUsed + parseInt(size) > MAX_STORAGE_LIMIT) {
    return res.status(400).json({ error: 'Storage capacity full: 20 GB limit reached.' });
  }

  // Check if a session already exists for this file fingerprint
  const existingSession = findSessionByFingerprint(fingerprint);
  
  if (existingSession) {
    const { uploadId, meta } = existingSession;
    const tempDir = path.join(TEMP_DIR, uploadId);
    
    // Find next chunk index by counting consecutive chunks on disk
    let nextChunkIndex = 0;
    while (fs.existsSync(path.join(tempDir, `chunk_${nextChunkIndex}`))) {
      nextChunkIndex++;
    }
    
    return res.json({
      success: true,
      uploadId,
      nextChunkIndex,
      resumed: true
    });
  }

  // Create a new session
  const uploadId = crypto.randomBytes(8).toString('hex');
  const tempDir = path.join(TEMP_DIR, uploadId);
  fs.mkdirSync(tempDir, { recursive: true });

  const totalChunks = Math.ceil(size / chunkSize);
  const meta = {
    uploadId,
    name,
    size,
    mimeType,
    chunkSize,
    totalChunks,
    fingerprint,
    createdAt: new Date().toISOString()
  };

  fs.writeFileSync(path.join(tempDir, 'meta.json'), JSON.stringify(meta, null, 2));

  res.json({
    success: true,
    uploadId,
    nextChunkIndex: 0,
    resumed: false
  });
});

// Upload file chunk
app.post('/api/upload/chunk', authenticate, upload.single('chunk'), (req, res) => {
  const { uploadId, chunkIndex } = req.body;
  
  if (!req.file || !uploadId || chunkIndex === undefined) {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    return res.status(400).json({ error: 'Missing chunk upload data' });
  }

  const index = parseInt(chunkIndex);
  const tempDir = path.join(TEMP_DIR, uploadId);
  
  if (!fs.existsSync(tempDir)) {
    if (fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    return res.status(404).json({ error: 'Upload session not found or expired' });
  }

  const destPath = path.join(tempDir, `chunk_${index}`);
  
  try {
    fs.renameSync(req.file.path, destPath);
  } catch (err) {
    console.error('Failed to save chunk:', err);
    if (fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    return res.status(500).json({ error: 'Failed to save chunk on server' });
  }

  // Read meta.json
  const metaPath = path.join(tempDir, 'meta.json');
  if (!fs.existsSync(metaPath)) {
    return res.status(500).json({ error: 'Upload metadata is missing' });
  }

  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  } catch (err) {
    return res.status(500).json({ error: 'Failed to read upload metadata' });
  }

  // Check if we have received all chunks
  let complete = true;
  for (let i = 0; i < meta.totalChunks; i++) {
    if (!fs.existsSync(path.join(tempDir, `chunk_${i}`))) {
      complete = false;
      break;
    }
  }

  if (complete) {
    // Merge all chunks
    const finalDir = path.join(UPLOADS_DIR, uploadId);
    fs.mkdirSync(finalDir, { recursive: true });
    const finalPath = path.join(finalDir, meta.name);

    const writeStream = fs.createWriteStream(finalPath);

    const mergeChunks = (i) => {
      if (i === meta.totalChunks) {
        writeStream.end();
        return;
      }
      
      const chunkPath = path.join(tempDir, `chunk_${i}`);
      const readStream = fs.createReadStream(chunkPath);
      
      readStream.pipe(writeStream, { end: false });
      
      readStream.on('end', () => {
        try {
          fs.unlinkSync(chunkPath);
        } catch (e) {}
        mergeChunks(i + 1);
      });

      readStream.on('error', (err) => {
        console.error(`Error reading chunk ${i}:`, err);
        writeStream.destroy(err);
      });
    };

    writeStream.on('finish', () => {
      try {
        // Clean up directory
        fs.unlinkSync(metaPath);
        fs.rmdirSync(tempDir);
      } catch (err) {
        console.error('Error cleaning up temp directory:', err);
      }

      // Add file to DB
      const db = readDatabase();
      const fileData = {
        id: uploadId,
        name: meta.name,
        size: meta.size,
        mimeType: meta.mimeType,
        uploadedAt: new Date().toISOString(),
        downloads: 0
      };

      db.files.push(fileData);
      writeDatabase(db);

      const baseUrl = PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
      const downloadUrl = `${baseUrl}/d/${fileData.id}/${encodeURIComponent(fileData.name)}`;
      const directUrl = `${baseUrl}/d/${fileData.id}`;

      // Send Telegram Alert
      const tgText = `📤 <b>New File Uploaded on SuvShare!</b>\n\n📁 <b>Name:</b> <code>${fileData.name}</code>\n⚖️ <b>Size:</b> <code>${formatBytes(fileData.size)}</code>\n🏷️ <b>Type:</b> <code>${fileData.mimeType}</code>\n\n🔗 <b>Link:</b> <a href="${downloadUrl}">${downloadUrl}</a>`;
      sendTelegramMessage(tgText);

      res.json({
        success: true,
        completed: true,
        file: {
          ...fileData,
          downloadUrl,
          directUrl
        }
      });
    });

    writeStream.on('error', (err) => {
      console.error('Merge write stream error:', err);
      res.status(500).json({ error: 'Failed to merge chunks on server' });
    });

    mergeChunks(0);
  } else {
    res.json({
      success: true,
      completed: false,
      nextChunkIndex: index + 1
    });
  }
});

// List files
app.get('/api/files', authenticate, (req, res) => {
  const db = readDatabase();
  // Sort files by upload date (newest first)
  const sortedFiles = [...db.files].sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
  
  const baseUrl = PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
  
  const filesWithUrls = sortedFiles.map(file => ({
    ...file,
    downloadUrl: `${baseUrl}/d/${file.id}/${encodeURIComponent(file.name)}`,
    directUrl: `${baseUrl}/d/${file.id}`
  }));

  res.json({ files: filesWithUrls, maxStorage: MAX_STORAGE_LIMIT });
});

// Delete file
app.delete('/api/files/:id', authenticate, (req, res) => {
  const { id } = req.params;
  const db = readDatabase();
  const fileIndex = db.files.findIndex(f => f.id === id);

  if (fileIndex === -1) {
    return res.status(404).json({ error: 'File not found' });
  }

  const file = db.files[fileIndex];
  const fileDir = path.join(UPLOADS_DIR, id);

  // Delete folder from disk
  if (fs.existsSync(fileDir)) {
    try {
      fs.rmSync(fileDir, { recursive: true, force: true });
    } catch (err) {
      console.error(`Failed to delete directory: ${fileDir}`, err);
    }
  }

  // Remove from database
  db.files.splice(fileIndex, 1);
  writeDatabase(db);

  res.json({ success: true });
});

// ==========================================
// URL Shortener API Routes
// ==========================================

// Shorten a long URL
app.post('/api/shorten', authenticate, (req, res) => {
  const { url, customAlias } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'URL parameter is required' });
  }

  // Ensure URL starts with http:// or https://
  let longUrl = url.trim();
  if (!/^https?:\/\//i.test(longUrl)) {
    longUrl = 'https://' + longUrl;
  }

  const db = readDatabase();
  if (!db.links) {
    db.links = [];
  }

  let code = customAlias ? customAlias.trim() : '';
  if (code) {
    // If custom alias is provided, verify it is unique and starts with "suvo"
    if (!code.startsWith('suvo')) {
      return res.status(400).json({ error: 'Custom alias must start with "suvo"' });
    }
    const exists = db.links.some(l => l.id === code);
    if (exists) {
      return res.status(400).json({ error: 'This custom short link alias already exists.' });
    }
  } else {
    // Generate a unique code starting with "suvo" followed by random hex characters
    let attempts = 0;
    do {
      const randomPart = crypto.randomBytes(3).toString('hex');
      code = `suvo${randomPart}`;
      attempts++;
    } while (db.links.some(l => l.id === code) && attempts < 100);

    if (attempts >= 100) {
      return res.status(500).json({ error: 'Failed to generate a unique short link alias.' });
    }
  }

  const linkData = {
    id: code,
    longUrl: longUrl,
    clicks: 0,
    createdAt: new Date().toISOString()
  };

  db.links.push(linkData);
  writeDatabase(db);

  const baseUrl = PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
  const shortUrl = `${baseUrl}/s/${code}`;

  res.json({
    success: true,
    link: {
      ...linkData,
      shortUrl
    }
  });
});

// List shortened URLs
app.get('/api/shorten', authenticate, (req, res) => {
  const db = readDatabase();
  const links = db.links || [];
  
  const baseUrl = PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
  const linksWithUrls = links.map(link => ({
    ...link,
    shortUrl: `${baseUrl}/s/${link.id}`
  }));

  res.json({ links: linksWithUrls });
});

// Delete shortened URL
app.delete('/api/shorten/:code', authenticate, (req, res) => {
  const { code } = req.params;
  const db = readDatabase();
  if (!db.links) {
    db.links = [];
  }

  const linkIndex = db.links.findIndex(l => l.id === code);
  if (linkIndex === -1) {
    return res.status(404).json({ error: 'Shortened link not found' });
  }

  db.links.splice(linkIndex, 1);
  writeDatabase(db);

  res.json({ success: true });
});

// Download files (Direct Download)
// Supports both /d/:id and /d/:id/:filename
const downloadHandler = (req, res) => {
  const { id } = req.params;
  const db = readDatabase();
  const fileIndex = db.files.findIndex(f => f.id === id);

  if (fileIndex === -1) {
    return res.status(404).send('<h1>404 - File Not Found</h1><p>The file you are trying to download does not exist or has been deleted.</p>');
  }

  const file = db.files[fileIndex];
  const filePath = path.join(UPLOADS_DIR, id, file.name);

  if (!fs.existsSync(filePath)) {
    return res.status(404).send('<h1>404 - File Not Found</h1><p>The file is missing from the server filesystem.</p>');
  }

  // Increment download count
  db.files[fileIndex].downloads += 1;
  writeDatabase(db);

  // Serve file for download
  res.download(filePath, file.name, (err) => {
    if (err) {
      console.error(`Error sending file ${file.name}:`, err);
      if (!res.headersSent) {
        res.status(500).send('Error sending file');
      }
    }
  });
};

app.get('/d/:id', downloadHandler);
app.get('/d/:id/:filename', downloadHandler);

// Short URL Redirect Endpoint
app.get('/s/:code', (req, res) => {
  const { code } = req.params;
  const db = readDatabase();
  const links = db.links || [];
  const linkIndex = links.findIndex(l => l.id === code);

  if (linkIndex === -1) {
    return res.status(404).send('<h1>404 - Link Not Found</h1><p>The shortened link you are trying to access does not exist or has been deleted.</p>');
  }

  const link = links[linkIndex];
  
  // Increment clicks count
  if (!link.clicks) link.clicks = 0;
  link.clicks += 1;
  writeDatabase(db);

  // Redirect to original long URL
  res.redirect(link.longUrl);
});

// Start Telegram Bot update polling to dynamically register Chat ID
function startTelegramBotPolling() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || token === 'YOUR_TELEGRAM_BOT_TOKEN') {
    return;
  }

  let offset = 0;

  function poll() {
    const options = {
      hostname: 'api.telegram.org',
      port: 443,
      path: `/bot${token}/getUpdates?offset=${offset}&timeout=30`,
      method: 'GET'
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (result.ok && result.result && result.result.length > 0) {
            for (const update of result.result) {
              offset = update.update_id + 1;
              if (update.message && update.message.text) {
                const text = update.message.text.trim();
                const chatId = update.message.chat.id;

                if (text === '/start') {
                  // Register chat ID in environment
                  process.env.TELEGRAM_CHAT_ID = chatId;

                  // Dynamically update the .env file (volume mounted to host)
                  const envPath = path.join(__dirname, '.env');
                  if (fs.existsSync(envPath)) {
                    try {
                      let envContent = fs.readFileSync(envPath, 'utf8');
                      if (envContent.includes('TELEGRAM_CHAT_ID=')) {
                        envContent = envContent.replace(/TELEGRAM_CHAT_ID=.*/, `TELEGRAM_CHAT_ID=${chatId}`);
                      } else {
                        envContent += `\nTELEGRAM_CHAT_ID=${chatId}`;
                      }
                      fs.writeFileSync(envPath, envContent);
                    } catch (err) {
                      console.error('Failed to write Chat ID to .env file:', err);
                    }
                  }

                  // Send welcome alert
                  sendTelegramMessage(`👋 <b>Welcome to SuvShare Alerts!</b>\n\nYour Chat ID <code>${chatId}</code> has been registered successfully.\n\nYou will now receive live alerts here whenever a file is uploaded to your VPS cloud!`);
                }
              }
            }
          }
        } catch (e) {
          // ignore parsing error
        }
        // Poll again after short delay
        setTimeout(poll, 1000);
      });
    });

    req.on('error', (e) => {
      // Retry after connection drops
      setTimeout(poll, 5000);
    });

    req.end();
  }

  // Start polling loop
  poll();
}

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`SuvShare server listening at http://0.0.0.0:${PORT}`);
  // Start bot update polling
  // startTelegramBotPolling();
});

