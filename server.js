const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const https = require('https');
const { ZipArchive } = require('archiver');

const app = express();
const PORT = process.env.PORT || 3009;
const PASSWORD = process.env.PASSWORD;
const PUBLIC_URL = process.env.PUBLIC_URL || '';


if (!PASSWORD) {
  console.error('FATAL ERROR: PASSWORD environment variable is not defined.');
  process.exit(1);
}

// Persistent locations. Both are plain DIRECTORIES so a bind mount on a fresh
// host always works: Docker auto-creates a missing mount source as a directory.
// The database therefore lives *inside* DATA_DIR and is never bind mounted as a
// single file - that is exactly what produced the historical EISDIR bug.
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const TEMP_DIR = path.join(UPLOADS_DIR, 'temp');
const MULTER_TEMP_DIR = path.join(UPLOADS_DIR, 'multer_temp');
const DB_FILE = path.join(DATA_DIR, 'db.json');

// Ensure directories exist
[UPLOADS_DIR, DATA_DIR, TEMP_DIR, MULTER_TEMP_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Helper functions for database operations
function readDatabase() {
  if (!fs.existsSync(DB_FILE)) {
    writeDatabase({ files: [] });
    return { files: [] };
  }
  try {
    const data = fs.readFileSync(DB_FILE, 'utf8');
    const parsed = JSON.parse(data);
    if (!parsed || !Array.isArray(parsed.files)) return { files: [] };
    return parsed;
  } catch (error) {
    console.error('Error reading database file:', error);
    return { files: [] };
  }
}

// Atomic write: a crash mid-write must not truncate the index.
function writeDatabase(data) {
  const tmp = `${DB_FILE}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, DB_FILE);
  } catch (error) {
    console.error('Error writing database file:', error);
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_) {}
  }
}

// One-time migration: older deployments kept db.json at the project root. Move
// a real legacy file into DATA_DIR. A legacy *directory* at that path is the
// symptom of the old broken bind mount, so it is ignored on purpose.
function migrateLegacyDatabase() {
  const legacy = path.join(__dirname, 'db.json');
  if (fs.existsSync(DB_FILE) || !fs.existsSync(legacy)) return;
  try {
    if (!fs.statSync(legacy).isFile()) {
      console.warn('[startup] Ignoring legacy db.json: it is a directory, not a file.');
      return;
    }
    const parsed = JSON.parse(fs.readFileSync(legacy, 'utf8'));
    writeDatabase(parsed);
    console.log('[startup] Migrated legacy db.json into', DB_FILE);
  } catch (error) {
    console.warn('[startup] Could not migrate legacy db.json:', error.message);
  }
}

// Self-heal: rebuild index entries for uploads present on disk but missing from
// an empty database. Runs only when the database has no records, so it can
// never duplicate or overwrite live data.
function reindexOrphanUploads() {
  const db = readDatabase();
  if (db.files.length > 0) return;

  const reserved = new Set(['temp', 'multer_temp']);
  const recovered = [];

  for (const entry of fs.readdirSync(UPLOADS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory() || reserved.has(entry.name)) continue;
    const dir = path.join(UPLOADS_DIR, entry.name);
    const contents = fs.readdirSync(dir, { withFileTypes: true }).filter(f => f.isFile());
    if (contents.length !== 1) continue; // ambiguous (folder upload) - leave alone

    const name = contents[0].name;
    const stat = fs.statSync(path.join(dir, name));
    recovered.push({
      id: entry.name,
      name,
      type: 'file',
      size: stat.size,
      mimeType: 'application/octet-stream',
      uploadedAt: stat.mtime.toISOString(),
      downloads: 0
    });
  }

  if (recovered.length === 0) return;
  db.files.push(...recovered);
  writeDatabase(db);
  console.log(`[startup] Re-indexed ${recovered.length} orphaned upload(s) from disk.`);
}

migrateLegacyDatabase();
reindexOrphanUploads();

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

function generateRandomBase62(length) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
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

// Explicit route for /
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Container healthcheck target. Unauthenticated on purpose, and it verifies the
// index is actually readable/writable rather than only that the port is open -
// a broken database mount must surface as "unhealthy", not as a silent failure.
app.get('/healthz', (req, res) => {
  try {
    const db = readDatabase();
    fs.accessSync(DATA_DIR, fs.constants.W_OK);
    fs.accessSync(UPLOADS_DIR, fs.constants.W_OK);
    res.json({ status: 'ok', items: db.files.length, uptime: Math.round(process.uptime()) });
  } catch (error) {
    res.status(503).json({ status: 'error', error: error.message });
  }
});

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
    type: 'file',
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

// Create folder entry
app.post('/api/folder/create', authenticate, (req, res) => {
  const { name, size } = req.body;
  
  const currentUsed = getTotalStorageUsed();
  if (currentUsed + parseInt(size) > MAX_STORAGE_LIMIT) {
    return res.status(400).json({ error: 'Storage capacity full: 20 GB limit reached.' });
  }

  const id = crypto.randomBytes(4).toString('hex');
  const db = readDatabase();
  const folderData = {
    id: id,
    name: name,
    type: 'folder',
    size: parseInt(size) || 0,
    uploadedAt: new Date().toISOString(),
    downloads: 0,
    files: []
  };

  db.files.push(folderData);
  writeDatabase(db);
  
  fs.mkdirSync(path.join(UPLOADS_DIR, id), { recursive: true });

  const baseUrl = PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
  const downloadUrl = `${baseUrl}/d/${id}`;
  const tgText = `📤 <b>New Folder Uploaded on SuvShare!</b>\n\n📁 <b>Name:</b> <code>${name}</code>\n⚖️ <b>Size:</b> <code>${formatBytes(size)}</code>\n\n🔗 <b>Link:</b> <a href="${downloadUrl}">${downloadUrl}</a>`;
  sendTelegramMessage(tgText);

  res.json({ success: true, folderId: id });
});

// Initialize or resume chunked upload
app.post('/api/upload/init', authenticate, (req, res) => {
  const { name, size, mimeType, chunkSize, fingerprint, folderId, relativePath } = req.body;
  if (!name || size === undefined || !fingerprint) {
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

  const totalChunks = Math.ceil(size / chunkSize) || 1;
  const meta = {
    uploadId,
    name,
    size,
    mimeType,
    chunkSize,
    totalChunks,
    fingerprint,
    folderId,
    relativePath,
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
      let finalDir = path.join(UPLOADS_DIR, uploadId);
      let finalPath = path.join(finalDir, meta.name);

      if (meta.folderId) {
        finalDir = path.join(UPLOADS_DIR, meta.folderId, path.dirname(meta.relativePath));
        finalPath = path.join(UPLOADS_DIR, meta.folderId, meta.relativePath);
      }
      fs.mkdirSync(finalDir, { recursive: true });

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
      let fileData;
      
      const baseUrl = PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
      let downloadUrl, directUrl;

      if (meta.folderId) {
        const folder = db.files.find(f => f.id === meta.folderId);
        if (folder) {
          fileData = {
            name: meta.name,
            relativePath: meta.relativePath,
            size: meta.size,
            mimeType: meta.mimeType
          };
          folder.files.push(fileData);
          writeDatabase(db);
        }
        
        downloadUrl = `${baseUrl}/d/${meta.folderId}`;
        directUrl = downloadUrl;
      } else {
        fileData = {
          id: uploadId,
          name: meta.name,
          type: 'file',
          size: meta.size,
          mimeType: meta.mimeType,
          uploadedAt: new Date().toISOString(),
          downloads: 0
        };

        db.files.push(fileData);
        writeDatabase(db);

        downloadUrl = `${baseUrl}/d/${fileData.id}/${encodeURIComponent(fileData.name)}`;
        directUrl = `${baseUrl}/d/${fileData.id}`;

        // Send Telegram Alert for single files only (folders have their own alert)
        const tgText = `📤 <b>New File Uploaded on SuvShare!</b>\n\n📁 <b>Name:</b> <code>${fileData.name}</code>\n⚖️ <b>Size:</b> <code>${formatBytes(fileData.size)}</code>\n🏷️ <b>Type:</b> <code>${fileData.mimeType}</code>\n\n🔗 <b>Link:</b> <a href="${downloadUrl}">${downloadUrl}</a>`;
        sendTelegramMessage(tgText);
      }

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
    downloadUrl: file.type === 'folder' ? `${baseUrl}/d/${file.id}` : `${baseUrl}/d/${file.id}/${encodeURIComponent(file.name)}`,
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
    // Generate a unique code starting with "suvo" followed by random base62 characters (3 characters)
    let attempts = 0;
    do {
      const randomPart = generateRandomBase62(3);
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
  const shortUrl = `${baseUrl}/${code}`;

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
    shortUrl: `${baseUrl}/${link.id}`
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

// --- ZIP Background Task Logic ---
const zipTasks = {};

app.post('/api/zip/start/:id', (req, res) => {
  const { id } = req.params;
  const db = readDatabase();
  const fileIndex = db.files.findIndex(f => f.id === id);
  
  if (fileIndex === -1) return res.status(404).send('Not found');
  const item = db.files[fileIndex];
  
  if (zipTasks[id] && zipTasks[id].status === 'zipping') {
    return res.json({ success: true, status: 'zipping' });
  }

  const zipPath = path.join(UPLOADS_DIR, `${id}.zip`);
  if (fs.existsSync(zipPath)) {
    return res.json({ success: true, status: 'done', url: `/api/zip/download/${id}` });
  }

  zipTasks[id] = { status: 'zipping', progress: 0, total: item.size };

  const output = fs.createWriteStream(zipPath);
  const archive = new ZipArchive({ zlib: { level: 9 } });

  output.on('close', () => {
    zipTasks[id] = { status: 'done', progress: 100, total: item.size, url: `/api/zip/download/${id}` };
    
    // Update download count
    const currentDb = readDatabase();
    const idx = currentDb.files.findIndex(f => f.id === id);
    if (idx !== -1) {
      currentDb.files[idx].downloads += 1;
      writeDatabase(currentDb);
    }
  });

  archive.on('error', (err) => {
    zipTasks[id] = { status: 'error', error: err.message };
  });

  archive.on('progress', (data) => {
    zipTasks[id].progress = data.fs.processedBytes;
  });

  archive.pipe(output);
  archive.directory(path.join(UPLOADS_DIR, id), false);
  archive.finalize();

  res.json({ success: true, status: 'zipping' });
});

app.get('/api/zip/status/:id', (req, res) => {
  const { id } = req.params;
  if (!zipTasks[id]) {
    const zipPath = path.join(UPLOADS_DIR, `${id}.zip`);
    if (fs.existsSync(zipPath)) {
      return res.json({ status: 'done', progress: 100, total: 100, url: `/api/zip/download/${id}` });
    }
    return res.json({ status: 'not_started' });
  }
  res.json(zipTasks[id]);
});

app.get('/api/zip/download/:id', (req, res) => {
  const { id } = req.params;
  const zipPath = path.join(UPLOADS_DIR, `${id}.zip`);
  if (!fs.existsSync(zipPath)) return res.status(404).send('Zip not found');
  
  const db = readDatabase();
  const fileIndex = db.files.findIndex(f => f.id === id);
  const item = fileIndex > -1 ? db.files[fileIndex] : { name: id };

  res.download(zipPath, `${item.name}.zip`);
});

// Download files (Direct Download)
// Supports both /d/:id and /d/:id/*
const downloadHandler = (req, res) => {
  const { id } = req.params;
  const filename = req.params[0]; // For catch-all /d/:id/*
  const db = readDatabase();
  const fileIndex = db.files.findIndex(f => f.id === id);

  if (fileIndex === -1) {
    return res.status(404).send('<h1>404 - Not Found</h1><p>The file or folder does not exist.</p>');
  }

  const item = db.files[fileIndex];

  if (item.type === 'folder') {


    if (filename && filename !== item.name) {
      const file = item.files.find(f => f.name === filename || f.relativePath === filename);
      if (!file) return res.status(404).send('File not found in folder.');
      
      const filePath = path.join(UPLOADS_DIR, id, file.relativePath);
      if (!fs.existsSync(filePath)) return res.status(404).send('File missing.');
      
      return res.download(filePath, file.name);
    }

    const baseUrl = PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
    let html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Folder: ${item.name}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&display=swap" rel="stylesheet">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
        <style>
          body { font-family: 'Outfit', sans-serif; padding: 2rem; background: #0f111a; color: #fff; margin: 0; }
          .container { max-width: 900px; margin: 0 auto; background: rgba(255, 255, 255, 0.03); padding: 2.5rem; border-radius: 20px; border: 1px solid rgba(255, 255, 255, 0.05); box-shadow: 0 10px 30px rgba(0,0,0,0.5); backdrop-filter: blur(10px); }
          h1 { margin-top: 0; color: #fff; font-size: 2rem; display: flex; align-items: center; gap: 12px; }
          .folder-meta { margin-bottom: 2rem; color: #94a3b8; font-size: 0.95rem; }
          .files { list-style: none; padding: 0; margin: 0; border-radius: 12px; overflow: hidden; border: 1px solid rgba(255, 255, 255, 0.08); }
          .files li { padding: 16px 20px; background: rgba(255, 255, 255, 0.02); display: flex; justify-content: space-between; align-items: center; transition: background 0.2s; border-bottom: 1px solid rgba(255, 255, 255, 0.04); }
          .files li:last-child { border-bottom: none; }
          .files li:hover { background: rgba(255, 255, 255, 0.05); }
          .file-name { display: flex; align-items: center; gap: 12px; font-weight: 500; }
          .file-name i { color: #38bdf8; font-size: 1.2rem; }
          .files li a.download-btn { color: #fff; background: rgba(56, 189, 248, 0.1); border: 1px solid rgba(56, 189, 248, 0.2); padding: 8px 16px; border-radius: 8px; text-decoration: none; font-size: 0.85rem; font-weight: 600; transition: all 0.2s; }
          .files li a.download-btn:hover { background: #38bdf8; color: #000; box-shadow: 0 0 15px rgba(56, 189, 248, 0.4); }
          .btn-primary { display: inline-flex; align-items: center; gap: 8px; padding: 12px 24px; background: linear-gradient(135deg, #38bdf8 0%, #2563eb 100%); color: #fff; text-decoration: none; border-radius: 10px; font-weight: 600; font-size: 1rem; margin-bottom: 24px; transition: all 0.3s; box-shadow: 0 4px 15px rgba(37, 99, 235, 0.3); }
          .btn-primary:hover { transform: translateY(-2px); box-shadow: 0 8px 25px rgba(37, 99, 235, 0.5); }
          .file-size { color: #64748b; font-size: 0.9rem; margin-right: 20px; }
          .actions { display: flex; align-items: center; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1><i class="fa-solid fa-folder-open" style="color: #f59e0b;"></i> ${item.name}</h1>
          <div class="folder-meta">Total Size: ${formatBytes(item.size)} &bull; ${item.files.length} Files</div>
          <div class="zip-progress-container" id="zip-progress-container" style="display: none; margin-bottom: 24px;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 8px; font-weight: 500;">
              <span>Zipping Folder...</span>
              <span id="zip-pct">0%</span>
            </div>
            <div style="background: rgba(255,255,255,0.1); border-radius: 8px; height: 10px; overflow: hidden;">
              <div id="zip-bar" style="background: linear-gradient(135deg, #38bdf8 0%, #2563eb 100%); height: 100%; width: 0%; transition: width 0.3s ease;"></div>
            </div>
          </div>
          <button id="zip-btn" class="btn-primary" onclick="startZip()" style="border:none; cursor:pointer;"><i class="fa-solid fa-file-zipper"></i> Download Folder as ZIP</button>
          
          <script>
            async function startZip() {
              document.getElementById('zip-btn').style.display = 'none';
              document.getElementById('zip-progress-container').style.display = 'block';
              
              try {
                const res = await fetch('/api/zip/start/${id}', { method: 'POST' });
                const data = await res.json();
                if (data.status === 'done') {
                  window.location.href = data.url;
                  document.getElementById('zip-progress-container').style.display = 'none';
                  document.getElementById('zip-btn').style.display = 'inline-flex';
                  return;
                }
                pollZipStatus();
              } catch (err) {
                alert('Error starting zip');
              }
            }

            async function pollZipStatus() {
              try {
                const res = await fetch('/api/zip/status/${id}');
                const data = await res.json();
                
                if (data.status === 'zipping') {
                  let pct = 0;
                  if (data.total > 0) pct = Math.round((data.progress / data.total) * 100);
                  document.getElementById('zip-pct').innerText = pct + '%';
                  document.getElementById('zip-bar').style.width = pct + '%';
                  setTimeout(pollZipStatus, 1000);
                } else if (data.status === 'done') {
                  document.getElementById('zip-pct').innerText = '100%';
                  document.getElementById('zip-bar').style.width = '100%';
                  setTimeout(() => {
                    window.location.href = data.url;
                    document.getElementById('zip-progress-container').style.display = 'none';
                    document.getElementById('zip-btn').style.display = 'inline-flex';
                  }, 1000);
                } else if (data.status === 'error') {
                  alert('Error creating zip: ' + data.error);
                }
              } catch (err) {
                setTimeout(pollZipStatus, 1000);
              }
            }
          </script>
          
          <ul class="files">
    `;

    item.files.forEach(f => {
       const isImage = f.mimeType && f.mimeType.startsWith('image');
       const icon = isImage ? 'fa-image' : 'fa-file-lines';
       html += `<li>
         <div class="file-name"><i class="fa-solid ${icon}"></i> ${f.relativePath}</div>
         <div class="actions">
           <span class="file-size">${formatBytes(f.size)}</span>
           <a href="${baseUrl}/d/${id}/${encodeURIComponent(f.relativePath)}" class="download-btn"><i class="fa-solid fa-download"></i> Download</a>
         </div>
       </li>`;
    });

    html += `
          </ul>
        </div>
      </body>
      </html>
    `;
    return res.send(html);
  }

  // File logic
  const filePath = path.join(UPLOADS_DIR, id, item.name);
  if (!fs.existsSync(filePath)) {
    return res.status(404).send('<h1>404 - File Not Found</h1><p>The file is missing from the server filesystem.</p>');
  }

  db.files[fileIndex].downloads += 1;
  writeDatabase(db);
  res.download(filePath, item.name, (err) => {
    if (err && !res.headersSent) res.status(500).send('Error sending file');
  });
};

app.get('/d/:id', downloadHandler);
app.get('/d/:id/*', downloadHandler);

// Backward Compatibility Short URL Redirect Endpoint
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

// Short URL Redirect Endpoint (New Direct format)
app.get('/:code', (req, res, next) => {
  const { code } = req.params;
  
  // We only intercept codes that start with 'suvo'
  if (!code.startsWith('suvo')) {
    return next();
  }

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

