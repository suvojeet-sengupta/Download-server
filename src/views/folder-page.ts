import type { StoredFolder } from '../types/domain';
import { formatBytes } from '../utils/format';

/** Minimal HTML escaping for values interpolated into the folder listing. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderRow(folderId: string, baseUrl: string, child: StoredFolder['files'][number]): string {
  const icon = child.mimeType?.startsWith('image') ? 'fa-image' : 'fa-file-lines';
  const href = `${baseUrl}/d/${folderId}/${encodeURIComponent(child.relativePath)}`;
  return `<li>
        <div class="file-name"><i class="fa-solid ${icon}"></i> ${escapeHtml(child.relativePath)}</div>
        <div class="actions">
          <span class="file-size">${formatBytes(child.size)}</span>
          <a href="${href}" class="download-btn"><i class="fa-solid fa-download"></i> Download</a>
        </div>
      </li>`;
}

/**
 * Public landing page for a folder share. Lists members and drives the
 * background ZIP build through /api/zip/*.
 */
export function renderFolderPage(folder: StoredFolder, baseUrl: string): string {
  const rows = folder.files.map((child) => renderRow(folder.id, baseUrl, child)).join('\n');
  const title = escapeHtml(folder.name);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Folder: ${title}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <style>
    body { font-family: 'Outfit', sans-serif; padding: 2rem; background: #0f111a; color: #fff; margin: 0; }
    .container { max-width: 900px; margin: 0 auto; background: rgba(255,255,255,0.03); padding: 2.5rem; border-radius: 20px; border: 1px solid rgba(255,255,255,0.05); box-shadow: 0 10px 30px rgba(0,0,0,0.5); backdrop-filter: blur(10px); }
    h1 { margin-top: 0; color: #fff; font-size: 2rem; display: flex; align-items: center; gap: 12px; }
    .folder-meta { margin-bottom: 2rem; color: #94a3b8; font-size: 0.95rem; }
    .files { list-style: none; padding: 0; margin: 0; border-radius: 12px; overflow: hidden; border: 1px solid rgba(255,255,255,0.08); }
    .files li { padding: 16px 20px; background: rgba(255,255,255,0.02); display: flex; justify-content: space-between; align-items: center; transition: background 0.2s; border-bottom: 1px solid rgba(255,255,255,0.04); }
    .files li:last-child { border-bottom: none; }
    .files li:hover { background: rgba(255,255,255,0.05); }
    .file-name { display: flex; align-items: center; gap: 12px; font-weight: 500; word-break: break-all; }
    .file-name i { color: #38bdf8; font-size: 1.2rem; }
    .files li a.download-btn { color: #fff; background: rgba(56,189,248,0.1); border: 1px solid rgba(56,189,248,0.2); padding: 8px 16px; border-radius: 8px; text-decoration: none; font-size: 0.85rem; font-weight: 600; transition: all 0.2s; white-space: nowrap; }
    .files li a.download-btn:hover { background: #38bdf8; color: #000; box-shadow: 0 0 15px rgba(56,189,248,0.4); }
    .btn-primary { display: inline-flex; align-items: center; gap: 8px; padding: 12px 24px; background: linear-gradient(135deg, #38bdf8 0%, #2563eb 100%); color: #fff; text-decoration: none; border-radius: 10px; font-weight: 600; font-size: 1rem; margin-bottom: 24px; transition: all 0.3s; box-shadow: 0 4px 15px rgba(37,99,235,0.3); }
    .btn-primary:hover { transform: translateY(-2px); box-shadow: 0 8px 25px rgba(37,99,235,0.5); }
    .file-size { color: #64748b; font-size: 0.9rem; margin-right: 20px; }
    .actions { display: flex; align-items: center; }
  </style>
</head>
<body>
  <div class="container">
    <h1><i class="fa-solid fa-folder-open" style="color:#f59e0b;"></i> ${title}</h1>
    <div class="folder-meta">Total Size: ${formatBytes(folder.size)} &bull; ${folder.files.length} Files</div>

    <div class="zip-progress-container" id="zip-progress-container" style="display:none; margin-bottom:24px;">
      <div style="display:flex; justify-content:space-between; margin-bottom:8px; font-weight:500;">
        <span>Zipping Folder...</span>
        <span id="zip-pct">0%</span>
      </div>
      <div style="background:rgba(255,255,255,0.1); border-radius:8px; height:10px; overflow:hidden;">
        <div id="zip-bar" style="background:linear-gradient(135deg,#38bdf8 0%,#2563eb 100%); height:100%; width:0%; transition:width 0.3s ease;"></div>
      </div>
    </div>

    <button id="zip-btn" class="btn-primary" style="border:none; cursor:pointer;">
      <i class="fa-solid fa-file-zipper"></i> Download Folder as ZIP
    </button>

    <ul class="files">
${rows}
    </ul>
  </div>

  <script>
    (function () {
      var id = ${JSON.stringify(folder.id)};
      var btn = document.getElementById('zip-btn');
      var box = document.getElementById('zip-progress-container');
      var pct = document.getElementById('zip-pct');
      var bar = document.getElementById('zip-bar');

      function reset() { box.style.display = 'none'; btn.style.display = 'inline-flex'; }

      function finish(url) {
        pct.innerText = '100%';
        bar.style.width = '100%';
        setTimeout(function () { window.location.href = url; reset(); }, 1000);
      }

      function poll() {
        fetch('/api/zip/status/' + id)
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (data.status === 'zipping') {
              var value = data.total > 0 ? Math.round((data.progress / data.total) * 100) : 0;
              pct.innerText = value + '%';
              bar.style.width = value + '%';
              setTimeout(poll, 1000);
            } else if (data.status === 'done') {
              finish(data.url);
            } else if (data.status === 'error') {
              alert('Error creating zip: ' + data.error);
              reset();
            } else {
              setTimeout(poll, 1000);
            }
          })
          .catch(function () { setTimeout(poll, 1000); });
      }

      btn.addEventListener('click', function () {
        btn.style.display = 'none';
        box.style.display = 'block';
        fetch('/api/zip/start/' + id, { method: 'POST' })
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (data.status === 'done') { finish(data.url); return; }
            poll();
          })
          .catch(function () { alert('Error starting zip'); reset(); });
      });
    })();
  </script>
</body>
</html>`;
}
