const archiver = require('archiver');

// Function to serve folder view or zip
const downloadHandler = (req, res) => {
  const { id } = req.params;
  const { filename } = req.params;
  const db = readDatabase();
  const fileIndex = db.files.findIndex(f => f.id === id);

  if (fileIndex === -1) {
    return res.status(404).send('<h1>404 - Not Found</h1><p>The file or folder does not exist.</p>');
  }

  const item = db.files[fileIndex];

  if (item.type === 'folder') {
    if (req.query.zip === 'true') {
      // Stream zip
      db.files[fileIndex].downloads += 1;
      writeDatabase(db);

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${item.name}.zip"`);
      
      const archive = archiver('zip', { zlib: { level: 9 } });
      archive.on('error', (err) => {
        if (!res.headersSent) res.status(500).send('Error creating zip');
      });
      archive.pipe(res);
      archive.directory(path.join(UPLOADS_DIR, id), false);
      archive.finalize();
      return;
    }

    if (filename) {
      // Download individual file inside folder
      const file = item.files.find(f => f.name === filename || f.relativePath === filename);
      if (!file) return res.status(404).send('File not found in folder.');
      
      const filePath = path.join(UPLOADS_DIR, id, file.relativePath);
      if (!fs.existsSync(filePath)) return res.status(404).send('File missing.');
      
      return res.download(filePath, file.name);
    }

    // Serve HTML view of the folder
    const baseUrl = PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
    let html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Folder: ${item.name}</title>
        <style>
          body { font-family: sans-serif; padding: 2rem; background: #0f172a; color: #fff; }
          .container { max-width: 800px; margin: 0 auto; background: #1e293b; padding: 2rem; border-radius: 8px; }
          h1 { margin-top: 0; }
          .files { list-style: none; padding: 0; }
          .files li { padding: 10px; border-bottom: 1px solid #334155; display: flex; justify-content: space-between; }
          .files li a { color: #38bdf8; text-decoration: none; }
          .files li a:hover { text-decoration: underline; }
          .btn { display: inline-block; padding: 10px 20px; background: #3b82f6; color: #fff; text-decoration: none; border-radius: 4px; margin-bottom: 20px; }
          .btn:hover { background: #2563eb; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>📁 ${item.name}</h1>
          <a href="?zip=true" class="btn">Download All as ZIP</a>
          <ul class="files">
    `;

    item.files.forEach(f => {
       html += `<li>
         <span>${f.relativePath}</span>
         <div>
           <span style="color:#94a3b8; margin-right:15px;">${formatBytes(f.size)}</span>
           <a href="${baseUrl}/d/${id}/${encodeURIComponent(f.relativePath)}">Download</a>
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
    return res.status(404).send('<h1>404 - File Not Found</h1>');
  }

  db.files[fileIndex].downloads += 1;
  writeDatabase(db);
  res.download(filePath, item.name, (err) => {
    if (err && !res.headersSent) res.status(500).send('Error sending file');
  });
};
