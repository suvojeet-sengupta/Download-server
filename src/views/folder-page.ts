import type { StoredFolder } from '../types/domain';
import { categoryOfFile } from '../utils/category';
import { formatBytes } from '../utils/format';

/** Minimal HTML escaping for values interpolated into the listing. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const ICON_FOR: Record<string, string> = {
  image: 'i-image',
  video: 'i-video',
  audio: 'i-audio',
  document: 'i-doc',
  archive: 'i-archive',
  folder: 'i-folder',
  other: 'i-file',
};

/**
 * Icon sprite. Inlined rather than linked so the public share page has no
 * external dependency: no icon CDN, no web font, one request for the stylesheet
 * and nothing else.
 */
const SPRITE = `<svg class="sprite" aria-hidden="true">
  <symbol id="i-folder" viewBox="0 0 24 24"><path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4.1a1.5 1.5 0 0 1 1.2.6l.9 1.2a1.5 1.5 0 0 0 1.2.6h6.6A1.5 1.5 0 0 1 20 9.9v7.6a1.5 1.5 0 0 1-1.5 1.5h-14A1.5 1.5 0 0 1 3 17.5z"/></symbol>
  <symbol id="i-file" viewBox="0 0 24 24"><path d="M13 3H7a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 7 21h10a1.5 1.5 0 0 0 1.5-1.5V8.5z"/><path d="M13 3v4.5a1 1 0 0 0 1 1h4.5"/></symbol>
  <symbol id="i-image" viewBox="0 0 24 24"><rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m5 17 4.2-4.2a1.5 1.5 0 0 1 2.1 0L15 16.5m0 0 1.6-1.6a1.5 1.5 0 0 1 2.1 0L20 16"/></symbol>
  <symbol id="i-video" viewBox="0 0 24 24"><rect x="3" y="5.5" width="13" height="13" rx="2"/><path d="m16 11.5 4.2-2.6a.6.6 0 0 1 .9.5v5.2a.6.6 0 0 1-.9.5L16 12.5z"/></symbol>
  <symbol id="i-audio" viewBox="0 0 24 24"><path d="M9 17.5V6.2l9-1.7v11"/><circle cx="6.8" cy="17.6" r="2.4"/><circle cx="15.8" cy="15.6" r="2.4"/></symbol>
  <symbol id="i-doc" viewBox="0 0 24 24"><path d="M13 3H7a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 7 21h10a1.5 1.5 0 0 0 1.5-1.5V8.5z"/><path d="M13 3v4.5a1 1 0 0 0 1 1h4.5M8.5 13h7M8.5 16.5h4.5"/></symbol>
  <symbol id="i-archive" viewBox="0 0 24 24"><rect x="3.5" y="4.5" width="17" height="5" rx="1.5"/><path d="M5 9.5v8.5A1.5 1.5 0 0 0 6.5 19.5h11a1.5 1.5 0 0 0 1.5-1.5V9.5M10.5 13.5h3"/></symbol>
  <symbol id="i-download" viewBox="0 0 24 24"><path d="M12 4.5v11M7.5 11 12 15.5 16.5 11M4.5 19.5h15"/></symbol>
  <symbol id="i-upload" viewBox="0 0 24 24"><path d="M12 16V4.5M7.5 9 12 4.5 16.5 9M4.5 15v3A1.5 1.5 0 0 0 6 19.5h12a1.5 1.5 0 0 0 1.5-1.5v-3"/></symbol>
</svg>`;

function renderRow(folderId: string, baseUrl: string, child: StoredFolder['files'][number]): string {
  const iconId = ICON_FOR[categoryOfFile(child.name, child.mimeType)] ?? 'i-file';
  const href = `${baseUrl}/d/${folderId}/${encodeURIComponent(child.relativePath)}`;
  const dir = child.relativePath.includes('/')
    ? child.relativePath.slice(0, child.relativePath.lastIndexOf('/'))
    : '';

  return `<tr>
        <td class="c-name">
          <span class="t-cell">
            <svg class="t-icon"><use href="#${iconId}"/></svg>
            <span class="t-text">
              <span class="t-file">${escapeHtml(child.name)}</span>
              ${dir ? `<span class="t-dir">${escapeHtml(dir)}</span>` : ''}
            </span>
          </span>
        </td>
        <td class="c-size">${formatBytes(child.size)}</td>
        <td class="c-act"><a class="t-get" href="${href}" aria-label="Download ${escapeHtml(child.name)}"><svg><use href="#i-download"/></svg></a></td>
      </tr>`;
}

/**
 * Public landing page for a folder share. Anyone with the link sees this, so it
 * carries no management affordances - just what was shared, how large it is,
 * and two ways to take it.
 */
export function renderFolderPage(folder: StoredFolder, baseUrl: string): string {
  const rows = folder.files.map((child) => renderRow(folder.id, baseUrl, child)).join('\n');
  const title = escapeHtml(folder.name);
  const count = folder.files.length;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<meta name="robots" content="noindex, nofollow">
<title>${title} — SuvShare</title>
<link rel="stylesheet" href="/style.css">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><rect width='24' height='24' rx='5' fill='%231a1d21'/><path d='M7 15.5h10M12 6v7.5M8.5 10.5 12 14l3.5-3.5' stroke='white' stroke-width='1.8' fill='none' stroke-linecap='round' stroke-linejoin='round'/></svg>">
</head>
<body class="share">
${SPRITE}

<header class="share-top">
  <a class="brand" href="/">
    <span class="brand-mark"><svg><use href="#i-upload"/></svg></span>
    <span class="brand-name">SuvShare</span>
  </a>
</header>

<main class="share-main">
  <section class="share-head">
    <span class="share-icon"><svg><use href="#i-folder"/></svg></span>
    <div class="share-meta">
      <h1>${title}</h1>
      <p>${count} file${count === 1 ? '' : 's'} &middot; ${formatBytes(folder.size)}</p>
    </div>
    <button class="btn btn-primary" id="zipBtn">
      <svg><use href="#i-download"/></svg>Download all
    </button>
  </section>

  <section class="share-zip" id="zipBox" hidden>
    <div class="share-zip-row">
      <span id="zipLabel">Preparing archive…</span>
      <span id="zipPct">0%</span>
    </div>
    <div class="meter"><div class="meter-fill" id="zipBar"></div></div>
  </section>

  ${
    count === 0
      ? `<div class="share-empty"><svg><use href="#i-folder"/></svg><p>This folder is empty.</p></div>`
      : `<table class="share-table">
    <thead>
      <tr><th scope="col">Name</th><th scope="col" class="c-size">Size</th><th scope="col"><span class="sr">Download</span></th></tr>
    </thead>
    <tbody>
${rows}
    </tbody>
  </table>`
  }
</main>

<footer class="share-foot">Shared with SuvShare</footer>

<script>
(function () {
  var id = ${JSON.stringify(folder.id)};
  var btn = document.getElementById('zipBtn');
  if (!btn) return;
  var box = document.getElementById('zipBox');
  var bar = document.getElementById('zipBar');
  var pct = document.getElementById('zipPct');
  var label = document.getElementById('zipLabel');

  function idle() {
    btn.disabled = false;
    box.hidden = true;
    bar.style.width = '0%';
    pct.textContent = '0%';
  }

  function finish(url) {
    label.textContent = 'Archive ready';
    pct.textContent = '100%';
    bar.style.width = '100%';
    setTimeout(function () { window.location.href = url; idle(); }, 700);
  }

  function fail(message) {
    label.textContent = message || 'Could not build the archive';
    bar.style.width = '100%';
    bar.classList.add('is-high');
    btn.disabled = false;
  }

  function poll() {
    fetch('/api/zip/status/' + id)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.status === 'zipping') {
          var value = data.total > 0 ? Math.round((data.progress / data.total) * 100) : 0;
          label.textContent = 'Compressing files…';
          pct.textContent = value + '%';
          bar.style.width = value + '%';
          setTimeout(poll, 1000);
        } else if (data.status === 'done') {
          finish(data.url);
        } else if (data.status === 'error') {
          fail(data.error);
        } else {
          setTimeout(poll, 1000);
        }
      })
      .catch(function () { setTimeout(poll, 1500); });
  }

  btn.addEventListener('click', function () {
    btn.disabled = true;
    box.hidden = false;
    bar.classList.remove('is-high');
    label.textContent = 'Preparing archive…';
    fetch('/api/zip/start/' + id, { method: 'POST' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.status === 'done') { finish(data.url); return; }
        poll();
      })
      .catch(function () { fail('Could not start the archive'); });
  });
})();
</script>
</body>
</html>`;
}
