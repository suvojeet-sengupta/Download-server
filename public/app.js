/* SuvShare client.
   Vanilla ES2020, no build step. Organised as: state -> api -> render -> actions. */
(() => {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const el = (tag, cls) => { const n = document.createElement(tag); if (cls) n.className = cls; return n; };
  const icon = (name) => `<svg><use href="#i-${name}"/></svg>`;

  const CHUNK = 8 * 1024 * 1024;
  const KEY = 'suvshare.pw';

  const state = {
    pw: sessionStorage.getItem(KEY) || '',
    items: [],
    links: [],
    view: 'all',
    query: '',
    sort: 'new',
    layout: localStorage.getItem('suvshare.layout') || 'list',
    selected: new Set(),
    lastIndex: -1,
    maxStorage: 0,
    previewIndex: -1,
  };

  const SORTS = {
    new: { label: 'Newest', fn: (a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt) },
    old: { label: 'Oldest', fn: (a, b) => new Date(a.uploadedAt) - new Date(b.uploadedAt) },
    name: { label: 'Name', fn: (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }) },
    big: { label: 'Largest', fn: (a, b) => b.size - a.size },
  };

  const TITLES = {
    all: 'All files', folder: 'Folders', image: 'Images', video: 'Video',
    audio: 'Audio', document: 'Documents', archive: 'Archives', links: 'Short links',
  };

  const ICONS = {
    folder: 'folder', image: 'image', video: 'video',
    audio: 'audio', document: 'doc', archive: 'archive', other: 'file',
  };

  /* ---------------- helpers ---------------- */

  function bytes(n) {
    if (!n) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), u.length - 1);
    return `${parseFloat((n / Math.pow(1024, i)).toFixed(i ? 1 : 0))} ${u[i]}`;
  }

  function when(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const diff = (Date.now() - d) / 1000;
    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)} d ago`;
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function toast(msg, kind) {
    const t = el('div', 'toast' + (kind === 'err' ? ' is-err' : ''));
    t.innerHTML = icon(kind === 'err' ? 'x' : 'check') + `<span>${escape(msg)}</span>`;
    $('#toasts').appendChild(t);
    setTimeout(() => t.remove(), 3200);
  }

  function escape(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = el('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); ta.remove();
    }
  }

  /* ---------------- api ---------------- */

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      ...opts,
      headers: { 'x-password': state.pw, ...(opts.headers || {}) },
    });
    if (res.status === 401) { signOut(); throw new Error('Session expired'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  const json = (body) => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  /* ---------------- auth ---------------- */

  async function signIn(pw) {
    const res = await fetch('/api/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw }),
    });
    if (!res.ok) throw new Error('Incorrect password');
    state.pw = pw;
    sessionStorage.setItem(KEY, pw);
  }

  function signOut() {
    sessionStorage.removeItem(KEY);
    state.pw = '';
    $('#app').hidden = true;
    $('#login').hidden = false;
    $('#loginPassword').value = '';
  }

  async function start() {
    $('#login').hidden = true;
    $('#app').hidden = false;
    await refresh();
  }

  /* ---------------- data ---------------- */

  async function refresh() {
    const [files, stats] = await Promise.all([api('/api/files'), api('/api/stats')]);
    state.items = files.files;
    state.maxStorage = files.maxStorage;
    paintStats(stats);
    if (state.view === 'links') await loadLinks(); else render();
  }

  async function loadLinks() {
    const data = await api('/api/shorten');
    state.links = data.links;
    renderLinks();
    $('[data-count=links]').textContent = state.links.length || '';
  }

  function paintStats(s) {
    const pct = s.total ? Math.min(100, Math.round((s.used / s.total) * 100)) : 0;
    $('#storageBar').style.width = pct + '%';
    $('#storageBar').classList.toggle('is-high', pct >= 90);
    $('#storagePct').textContent = pct + '%';
    $('#storageText').textContent = `${bytes(s.used)} of ${bytes(s.total)} used`;
    $('[data-count=all]').textContent = s.items || '';
    for (const key of ['folder', 'image', 'video', 'audio', 'document', 'archive']) {
      $(`[data-count=${key}]`).textContent = s.byCategory?.[key]?.count || '';
    }
  }

  function visible() {
    const q = state.query.trim().toLowerCase();
    return state.items
      .filter((f) => state.view === 'all' || f.category === state.view)
      .filter((f) => !q || f.name.toLowerCase().includes(q))
      .sort(SORTS[state.sort].fn);
  }

  /* ---------------- render ---------------- */

  function render() {
    $('#filesView').hidden = false;
    $('#linksView').hidden = true;

    const rows = visible();
    $('#viewTitle').textContent = TITLES[state.view];
    $('#viewCount').textContent = rows.length ? `${rows.length} item${rows.length > 1 ? 's' : ''}` : '';

    const list = $('#fileList');
    list.className = 'list' + (state.layout === 'grid' ? ' is-grid' : '');
    list.innerHTML = '';

    $('#empty').hidden = rows.length > 0;
    if (!rows.length) {
      $('#emptyTitle').textContent = state.query ? 'No matches' : 'Nothing here yet';
      $('#emptyText').textContent = state.query
        ? `Nothing matches “${state.query}”.`
        : 'Drag files anywhere on this page, or use the Upload button.';
      paintSelection();
      return;
    }

    const frag = document.createDocumentFragment();
    rows.forEach((f, i) => frag.appendChild(rowFor(f, i)));
    list.appendChild(frag);
    paintSelection();
  }

  function rowFor(f, index) {
    const row = el('div', 'row');
    row.dataset.id = f.id;
    row.dataset.index = index;
    if (state.selected.has(f.id)) row.classList.add('is-sel');

    const thumb = f.category === 'image'
      ? `<div class="row-thumb"><img loading="lazy" src="${f.previewUrl}" alt=""></div>`
      : `<div class="row-thumb">${icon(ICONS[f.category] || 'file')}</div>`;

    const sub = f.type === 'folder'
      ? `${f.files?.length || 0} files`
      : `${bytes(f.size)} · ${when(f.uploadedAt)}`;

    row.innerHTML = `
      <div class="row-check" data-act="check">${icon('check')}</div>
      ${thumb}
      <div class="row-name"><b>${escape(f.name)}</b><span>${sub}</span></div>
      <div class="row-size">${bytes(f.size)}</div>
      <div class="row-date">${when(f.uploadedAt)}</div>
      <button class="icon-btn row-more" data-act="more" aria-label="Actions">${icon('more')}</button>`;
    return row;
  }

  function renderLinks() {
    $('#filesView').hidden = true;
    $('#linksView').hidden = false;
    $('#linkCount').textContent = state.links.length ? `${state.links.length} link${state.links.length > 1 ? 's' : ''}` : '';

    const box = $('#linkList');
    box.innerHTML = '';
    if (!state.links.length) {
      box.innerHTML = `<div class="empty">${icon('link')}<h3>No short links</h3><p>Create one above to shorten any address.</p></div>`;
      return;
    }
    for (const l of state.links) {
      const r = el('div', 'link-row');
      r.innerHTML = `
        <span class="code">/${escape(l.id)}</span>
        <span class="target">${escape(l.longUrl)}</span>
        <span class="clicks">${l.clicks} click${l.clicks === 1 ? '' : 's'}</span>
        <button class="icon-btn" data-copy="${escape(l.shortUrl)}" aria-label="Copy">${icon('copy')}</button>
        <button class="icon-btn" data-del="${escape(l.id)}" aria-label="Delete">${icon('trash')}</button>`;
      box.appendChild(r);
    }
  }

  function paintSelection() {
    const n = state.selected.size;
    $('#selbar').hidden = n === 0;
    $('#selCount').textContent = `${n} selected`;
    document.querySelectorAll('.row').forEach((r) => {
      r.classList.toggle('is-sel', state.selected.has(r.dataset.id));
    });
  }

  /* ---------------- selection ---------------- */

  function toggle(id, index, shift) {
    if (shift && state.lastIndex >= 0) {
      const rows = visible();
      const [a, b] = [state.lastIndex, index].sort((x, y) => x - y);
      for (let i = a; i <= b; i++) state.selected.add(rows[i].id);
    } else if (state.selected.has(id)) {
      state.selected.delete(id);
    } else {
      state.selected.add(id);
    }
    state.lastIndex = index;
    paintSelection();
  }

  function clearSelection() {
    state.selected.clear();
    state.lastIndex = -1;
    paintSelection();
  }

  const chosen = () => state.items.filter((f) => state.selected.has(f.id));

  /* ---------------- preview ---------------- */

  const previewable = () => visible().filter((f) => f.type !== 'folder');

  function openPreview(id) {
    const list = previewable();
    const i = list.findIndex((f) => f.id === id);
    if (i === -1) { window.open(`/d/${id}`, '_blank'); return; }
    state.previewIndex = i;
    showPreview();
    $('#preview').hidden = false;
  }

  function showPreview() {
    const list = previewable();
    const f = list[state.previewIndex];
    if (!f) return;

    $('#previewName').textContent = f.name;
    $('#previewDownload').href = f.downloadUrl;
    $('#previewPrev').hidden = list.length < 2;
    $('#previewNext').hidden = list.length < 2;

    const stage = $('#previewStage');
    stage.innerHTML = '';
    const mime = (f.mimeType || '').toLowerCase();

    if (f.category === 'image') {
      const img = el('img'); img.src = f.previewUrl; img.alt = f.name;
      stage.appendChild(img);
    } else if (f.category === 'video') {
      const v = el('video'); v.src = f.previewUrl; v.controls = true; v.autoplay = true;
      stage.appendChild(v);
    } else if (f.category === 'audio') {
      const a = el('audio'); a.src = f.previewUrl; a.controls = true; a.autoplay = true;
      a.style.width = 'min(520px, 90vw)';
      stage.appendChild(a);
    } else if (mime === 'application/pdf' || /\.pdf$/i.test(f.name)) {
      const fr = el('iframe'); fr.src = f.previewUrl;
      stage.appendChild(fr);
    } else if (mime.startsWith('text/') || /\.(txt|md|json|csv|log|ya?ml|ini|conf)$/i.test(f.name)) {
      const pre = el('pre'); pre.textContent = 'Loading…';
      stage.appendChild(pre);
      fetch(f.previewUrl).then((r) => r.text()).then((t) => {
        pre.textContent = t.slice(0, 200000);
      }).catch(() => { pre.textContent = 'Could not load this file.'; });
    } else {
      const d = el('div', 'no-preview');
      d.innerHTML = `${icon(ICONS[f.category] || 'file')}<p>No preview for this type</p>`;
      stage.appendChild(d);
    }
  }

  function stepPreview(delta) {
    const list = previewable();
    if (!list.length) return;
    state.previewIndex = (state.previewIndex + delta + list.length) % list.length;
    showPreview();
  }

  function closePreview() {
    $('#preview').hidden = true;
    $('#previewStage').innerHTML = '';
  }

  /* ---------------- dialogs ---------------- */

  function ask({ title, text, value, ok, danger }) {
    return new Promise((resolve) => {
      const sheet = $('#dialog');
      $('#dialogTitle').textContent = title;
      $('#dialogText').textContent = text || '';
      $('#dialogText').hidden = !text;
      const input = $('#dialogInput');
      input.hidden = value === undefined;
      input.value = value ?? '';
      const okBtn = $('#dialogOk');
      okBtn.textContent = ok || 'Save';
      okBtn.classList.toggle('btn-danger', !!danger);
      sheet.hidden = false;
      setTimeout(() => (value !== undefined ? input.focus() : okBtn.focus()), 30);

      const done = (result) => {
        sheet.hidden = true;
        $('#dialogForm').onsubmit = null;
        $('#dialogCancel').onclick = null;
        resolve(result);
      };
      $('#dialogForm').onsubmit = (e) => { e.preventDefault(); done(value === undefined ? true : input.value.trim()); };
      $('#dialogCancel').onclick = () => done(null);
    });
  }

  /* ---------------- actions ---------------- */

  async function doRename(f) {
    const name = await ask({ title: 'Rename', value: f.name, ok: 'Rename' });
    if (!name || name === f.name) return;
    try {
      await api(`/api/files/${f.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
      toast('Renamed');
      await refresh();
    } catch (e) { toast(e.message, 'err'); }
  }

  async function doDelete(ids) {
    const many = ids.length > 1;
    const okd = await ask({
      title: many ? `Delete ${ids.length} items?` : 'Delete item?',
      text: 'This permanently removes the files and their share links.',
      ok: 'Delete', danger: true,
    });
    if (!okd) return;
    try {
      await api('/api/files/delete', json({ ids }));
      toast(many ? `${ids.length} items deleted` : 'Deleted');
      clearSelection();
      await refresh();
    } catch (e) { toast(e.message, 'err'); }
  }

  async function copyLinks(files) {
    await copy(files.map((f) => f.downloadUrl).join('\n'));
    toast(files.length > 1 ? `${files.length} links copied` : 'Link copied');
  }

  function download(files) {
    files.forEach((f, i) => setTimeout(() => {
      const a = el('a'); a.href = f.downloadUrl; a.download = f.name;
      document.body.appendChild(a); a.click(); a.remove();
    }, i * 350));
  }

  /* ---------------- context menu ---------------- */

  function openMenu(f, x, y) {
    const menu = $('#ctxMenu');
    const isFolder = f.type === 'folder';
    menu.innerHTML = `
      ${isFolder ? '' : `<button data-m="open">${icon('image')}Preview</button>`}
      <button data-m="download">${icon('download')}Download</button>
      <button data-m="copy">${icon('link')}Copy link</button>
      <hr>
      <button data-m="rename">${icon('pencil')}Rename</button>
      <button data-m="delete" class="danger">${icon('trash')}Delete</button>`;
    menu.hidden = false;

    const r = menu.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(x, window.innerWidth - r.width - 8)) + 'px';
    // Flip above the anchor when there is not enough room below.
    const top = y + r.height + 8 > window.innerHeight ? y - r.height - 30 : y;
    menu.style.top = Math.max(8, top) + 'px';

    menu.onclick = async (e) => {
      const btn = e.target.closest('[data-m]');
      if (!btn) return;
      menu.hidden = true;
      switch (btn.dataset.m) {
        case 'open': openPreview(f.id); break;
        case 'download': download([f]); break;
        case 'copy': copyLinks([f]); break;
        case 'rename': doRename(f); break;
        case 'delete': doDelete([f.id]); break;
      }
    };
  }

  /* ---------------- uploads ---------------- */

  let queue = 0;

  function dockRow(name) {
    $('#dock').hidden = false;
    const row = el('div', 'up');
    row.innerHTML = `<div class="up-name">${escape(name)}</div><div class="up-state">Waiting</div><div class="up-bar"><i></i></div>`;
    $('#dockBody').prepend(row);
    return {
      progress(pct, label) {
        row.querySelector('i').style.width = pct + '%';
        row.querySelector('.up-state').textContent = label ?? pct + '%';
      },
      done(label) {
        row.classList.add('is-done');
        row.querySelector('i').style.width = '100%';
        const s = row.querySelector('.up-state');
        s.textContent = label || 'Done'; s.className = 'up-state is-ok';
      },
      fail(msg) {
        row.classList.add('is-err');
        row.querySelector('i').style.width = '100%';
        const s = row.querySelector('.up-state');
        s.textContent = msg; s.className = 'up-state is-err';
      },
    };
  }

  function tickQueue(delta) {
    queue += delta;
    $('#dockTitle').textContent = queue > 0 ? `Uploading ${queue} item${queue > 1 ? 's' : ''}` : 'Uploads complete';
    if (queue === 0) refresh().catch(() => {});
  }

  async function uploadSmall(file, ui, extra) {
    const fd = new FormData();
    fd.append('file', file);
    Object.entries(extra || {}).forEach(([k, v]) => fd.append(k, v));
    ui.progress(45, 'Sending');
    await api('/api/upload', { method: 'POST', body: fd });
    ui.done();
  }

  async function uploadChunked(file, ui, folderId, relativePath) {
    const fingerprint = `${file.name}-${file.size}-${file.lastModified}`;
    const init = await api('/api/upload/init', json({
      name: file.name, size: file.size, mimeType: file.type || 'application/octet-stream',
      chunkSize: CHUNK, fingerprint, folderId, relativePath,
    }));

    const total = Math.ceil(file.size / CHUNK) || 1;
    let index = init.nextChunkIndex || 0;
    if (init.resumed && index > 0) ui.progress(Math.round((index / total) * 100), 'Resuming');

    while (index < total) {
      const blob = file.slice(index * CHUNK, (index + 1) * CHUNK);
      const fd = new FormData();
      fd.append('uploadId', init.uploadId);
      fd.append('chunkIndex', String(index));
      fd.append('chunk', blob);
      const res = await api('/api/upload/chunk', { method: 'POST', body: fd });
      index = res.completed ? total : (res.nextChunkIndex ?? index + 1);
      ui.progress(Math.round((Math.min(index, total) / total) * 100));
    }
    ui.done();
  }

  async function uploadOne(file, folderId, relativePath) {
    const ui = dockRow(relativePath || file.name);
    tickQueue(1);
    try {
      if (file.size > CHUNK || folderId) {
        await uploadChunked(file, ui, folderId, relativePath);
      } else {
        await uploadSmall(file, ui);
      }
    } catch (e) {
      ui.fail(e.message || 'Failed');
    } finally {
      tickQueue(-1);
    }
  }

  async function uploadFiles(files) {
    for (const f of files) await uploadOne(f);
  }

  async function uploadFolder(files) {
    const list = Array.from(files);
    if (!list.length) return;
    const rootName = (list[0].webkitRelativePath || '').split('/')[0] || 'Folder';
    const size = list.reduce((s, f) => s + f.size, 0);
    try {
      const { folderId } = await api('/api/folder/create', json({ name: rootName, size }));
      for (const f of list) {
        const rel = (f.webkitRelativePath || f.name).split('/').slice(1).join('/') || f.name;
        await uploadOne(f, folderId, rel);
      }
    } catch (e) { toast(e.message, 'err'); }
  }

  /* ---------------- events ---------------- */

  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#loginBtn');
    btn.disabled = true;
    $('#loginError').hidden = true;
    try {
      await signIn($('#loginPassword').value);
      await start();
    } catch (err) {
      $('#loginError').textContent = err.message;
      $('#loginError').hidden = false;
    } finally { btn.disabled = false; }
  });

  $('#logoutBtn').addEventListener('click', signOut);

  // sidebar
  document.querySelectorAll('.nav-item').forEach((b) => b.addEventListener('click', async () => {
    document.querySelectorAll('.nav-item').forEach((x) => x.classList.remove('is-active'));
    b.classList.add('is-active');
    state.view = b.dataset.view;
    clearSelection();
    closeDrawer();
    if (state.view === 'links') { try { await loadLinks(); } catch (e) { toast(e.message, 'err'); } }
    else render();
  }));

  const openDrawer = () => { $('#sidebar').classList.add('is-open'); $('#scrim').classList.add('is-on'); };
  const closeDrawer = () => { $('#sidebar').classList.remove('is-open'); $('#scrim').classList.remove('is-on'); };
  $('#menuBtn').addEventListener('click', openDrawer);
  $('#scrim').addEventListener('click', closeDrawer);

  // search
  $('#search').addEventListener('input', (e) => { state.query = e.target.value; render(); });

  // sort + layout
  $('#sortBtn').addEventListener('click', () => {
    const keys = Object.keys(SORTS);
    state.sort = keys[(keys.indexOf(state.sort) + 1) % keys.length];
    $('#sortLabel').textContent = SORTS[state.sort].label;
    render();
  });
  const setLayout = (v) => {
    state.layout = v;
    localStorage.setItem('suvshare.layout', v);
    $('#listViewBtn').classList.toggle('is-on', v === 'list');
    $('#gridViewBtn').classList.toggle('is-on', v === 'grid');
    render();
  };
  $('#listViewBtn').addEventListener('click', () => setLayout('list'));
  $('#gridViewBtn').addEventListener('click', () => setLayout('grid'));

  // rows
  $('#fileList').addEventListener('click', (e) => {
    const row = e.target.closest('.row');
    if (!row) return;
    const f = state.items.find((x) => x.id === row.dataset.id);
    if (!f) return;

    if (e.target.closest('[data-act=check]')) {
      toggle(f.id, Number(row.dataset.index), e.shiftKey);
      return;
    }
    const moreBtn = e.target.closest('[data-act=more]');
    if (moreBtn) {
      // The document-level close handler runs after this one as the event
      // bubbles. Without stopping it, the menu we are about to open is hidden
      // again in the same click.
      e.stopPropagation();
      const r = moreBtn.getBoundingClientRect();
      openMenu(f, r.right - 186, r.bottom + 4);
      return;
    }
    if (state.selected.size > 0 || e.ctrlKey || e.metaKey) {
      toggle(f.id, Number(row.dataset.index), e.shiftKey);
      return;
    }
    if (f.type === 'folder') window.location.href = `/d/${f.id}`;
    else openPreview(f.id);
  });

  $('#fileList').addEventListener('contextmenu', (e) => {
    const row = e.target.closest('.row');
    if (!row) return;
    e.preventDefault();
    e.stopPropagation();
    const f = state.items.find((x) => x.id === row.dataset.id);
    if (f) openMenu(f, e.clientX, e.clientY);
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#ctxMenu')) $('#ctxMenu').hidden = true;
  });

  // selection bar
  $('#selClear').addEventListener('click', clearSelection);
  $('#selCopy').addEventListener('click', () => copyLinks(chosen()));
  $('#selDownload').addEventListener('click', () => download(chosen()));
  $('#selDelete').addEventListener('click', () => doDelete([...state.selected]));

  // preview
  $('#previewClose').addEventListener('click', closePreview);
  $('#previewPrev').addEventListener('click', () => stepPreview(-1));
  $('#previewNext').addEventListener('click', () => stepPreview(1));
  $('#preview').addEventListener('click', (e) => { if (e.target.id === 'preview') closePreview(); });

  // uploads — offer files vs folder, since folder picking needs a separate input
  function uploadMenu(anchor) {
    const menu = $('#ctxMenu');
    menu.innerHTML = `
      <button data-u="files">${icon('upload')}Upload files</button>
      <button data-u="folder">${icon('folderup')}Upload folder</button>`;
    menu.hidden = false;
    const r = anchor.getBoundingClientRect();
    const m = menu.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(r.left, window.innerWidth - m.width - 8)) + 'px';
    menu.style.top = (r.bottom + 6 + m.height > window.innerHeight ? r.top - m.height - 6 : r.bottom + 6) + 'px';
    menu.onclick = (e) => {
      const btn = e.target.closest('[data-u]');
      if (!btn) return;
      menu.hidden = true;
      $(btn.dataset.u === 'folder' ? '#folderInput' : '#fileInput').click();
    };
  }
  $('#uploadBtn').addEventListener('click', (e) => { e.stopPropagation(); uploadMenu(e.currentTarget); });
  $('#fabUpload').addEventListener('click', (e) => { e.stopPropagation(); uploadMenu(e.currentTarget); });
  $('#fileInput').addEventListener('change', (e) => { uploadFiles(Array.from(e.target.files)); e.target.value = ''; });
  $('#folderInput').addEventListener('change', (e) => { uploadFolder(e.target.files); e.target.value = ''; });
  $('#dockClose').addEventListener('click', () => { $('#dock').hidden = true; $('#dockBody').innerHTML = ''; });
  $('#dockToggle').addEventListener('click', () => $('#dock').classList.toggle('is-min'));

  // drag & drop
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer?.types?.includes('Files') || $('#app').hidden) return;
    dragDepth++; $('#dropzone').classList.add('is-on');
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('#dropzone').classList.remove('is-on'); } });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    $('#dropzone').classList.remove('is-on');
    if ($('#app').hidden) return;
    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length) uploadFiles(files);
  });

  // short links
  $('#linkForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/shorten', json({ url: $('#linkUrl').value, customAlias: $('#linkAlias').value || undefined }));
      $('#linkUrl').value = ''; $('#linkAlias').value = '';
      toast('Short link created');
      await loadLinks();
    } catch (err) { toast(err.message, 'err'); }
  });

  $('#linkList').addEventListener('click', async (e) => {
    const c = e.target.closest('[data-copy]');
    if (c) { await copy(c.dataset.copy); toast('Link copied'); return; }
    const d = e.target.closest('[data-del]');
    if (d) {
      if (!(await ask({ title: 'Delete short link?', ok: 'Delete', danger: true }))) return;
      try { await api(`/api/shorten/${d.dataset.del}`, { method: 'DELETE' }); toast('Deleted'); await loadLinks(); }
      catch (err) { toast(err.message, 'err'); }
    }
  });

  // keyboard
  document.addEventListener('keydown', (e) => {
    if ($('#app').hidden) return;
    const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName);

    if (!$('#preview').hidden) {
      if (e.key === 'Escape') closePreview();
      if (e.key === 'ArrowLeft') stepPreview(-1);
      if (e.key === 'ArrowRight') stepPreview(1);
      return;
    }
    if (e.key === 'Escape') { clearSelection(); $('#ctxMenu').hidden = true; closeDrawer(); return; }
    if (typing) return;

    if (e.key === '/') { e.preventDefault(); $('#search').focus(); }
    if ((e.key === 'a' || e.key === 'A') && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      visible().forEach((f) => state.selected.add(f.id));
      paintSelection();
    }
    if (e.key === 'Delete' && state.selected.size) doDelete([...state.selected]);
  });

  /* ---------------- boot ---------------- */

  $('#sortLabel').textContent = SORTS[state.sort].label;
  setLayout(state.layout);

  if (state.pw) {
    start().catch(() => signOut());
  } else {
    $('#login').hidden = false;
  }
})();
