// --- Global State ---
let PASSWORD = localStorage.getItem('suvshare_password') || '';
let filesData = [];
let currentLayout = 'grid'; // 'grid' or 'list'

// --- DOM Elements ---
const authScreen = document.getElementById('auth-screen');
const dashboardScreen = document.getElementById('dashboard-screen');
const authForm = document.getElementById('auth-form');
const authPasswordInput = document.getElementById('auth-password');
const authError = document.getElementById('auth-error');
const logoutBtn = document.getElementById('logout-btn');

const sidebarDrawer = document.getElementById('sidebar-drawer');
const mobileMenuToggle = document.getElementById('mobile-menu-toggle');
const mobileMenuClose = document.getElementById('mobile-menu-close');

const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const uploadsContainer = document.getElementById('uploads-container');
const activeUploadsList = document.getElementById('active-uploads-list');

const filesGridContainer = document.getElementById('files-grid-container');
const filesEmptyState = document.getElementById('files-empty-state');
const searchInput = document.getElementById('search-input');
const toggleGridBtn = document.getElementById('toggle-grid');
const toggleListBtn = document.getElementById('toggle-list');
const toastContainer = document.getElementById('toast-container');

// Stats Widgets
const statsTotalFiles = document.getElementById('stats-total-files');
const statsTotalSize = document.getElementById('stats-total-size');
const statsTotalDownloads = document.getElementById('stats-total-downloads');

// QR Modal
const qrModal = document.getElementById('qr-modal');
const qrImage = document.getElementById('qr-image');
const qrLinkInput = document.getElementById('qr-link-input');
const qrCopyBtn = document.getElementById('qr-copy-btn');
const qrCloseBtn = document.getElementById('qr-close-btn');

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
  if (PASSWORD) {
    verifyPasswordAndInit(PASSWORD);
  } else {
    showScreen('auth-screen');
  }

  // Bind Auth & Logout Events
  authForm.addEventListener('submit', handleAuthSubmit);
  logoutBtn.addEventListener('click', handleLogout);

  // Mobile Drawer Controls
  mobileMenuToggle.addEventListener('click', () => {
    sidebarDrawer.classList.add('mobile-open');
  });
  mobileMenuClose.addEventListener('click', () => {
    sidebarDrawer.classList.remove('mobile-open');
  });

  // Section Navigation Links
  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      
      // Update active nav link style
      document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
      link.classList.add('active');

      // Toggle visible panel sections
      const targetId = link.getAttribute('data-target');
      document.querySelectorAll('.panel-section').forEach(section => {
        section.classList.remove('active');
      });
      document.getElementById(targetId).classList.add('active');

      // Auto close mobile drawer
      sidebarDrawer.classList.remove('mobile-open');
    });
  });

  // Layout View Swapping
  toggleGridBtn.addEventListener('click', () => {
    currentLayout = 'grid';
    toggleGridBtn.classList.add('active');
    toggleListBtn.classList.remove('active');
    filesGridContainer.className = 'files-grid grid-layout';
    renderFiles(filesData);
  });

  toggleListBtn.addEventListener('click', () => {
    currentLayout = 'list';
    toggleListBtn.classList.add('active');
    toggleGridBtn.classList.remove('active');
    filesGridContainer.className = 'files-grid list-layout';
    renderFiles(filesData);
  });

  // Drag & Drop File Upload Bindings
  dropZone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', handleFileSelect);

  ['dragenter', 'dragover'].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.add('dragover');
    }, false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.remove('dragover');
    }, false);
  });

  dropZone.addEventListener('drop', handleDrop, false);

  // Search input filtering
  searchInput.addEventListener('input', handleSearch);

  // QR Modal Close Trigger
  qrCloseBtn.addEventListener('click', () => {
    qrModal.classList.remove('active');
  });
  qrModal.addEventListener('click', (e) => {
    if (e.target === qrModal) {
      qrModal.classList.remove('active');
    }
  });

  qrCopyBtn.addEventListener('click', () => {
    copyToClipboard(qrLinkInput.value, true);
  });
});

// --- Screen Switching Helper ---
function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(screen => {
    screen.classList.remove('active');
  });
  document.getElementById(screenId).classList.add('active');
}

// --- Authentication Logic ---
async function verifyPasswordAndInit(password) {
  try {
    const response = await fetch('/api/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });

    if (response.ok) {
      PASSWORD = password;
      localStorage.setItem('suvshare_password', password);
      showScreen('dashboard-screen');
      loadFiles();
      showToast('Dashboard connection established', 'success');
    } else {
      localStorage.removeItem('suvshare_password');
      PASSWORD = '';
      showScreen('auth-screen');
      showAuthError('Credentials expired. Please re-authenticate.');
    }
  } catch (err) {
    console.error('Verify error:', err);
    showAuthError('Failed to verify session connection.');
    showScreen('auth-screen');
  }
}

async function handleAuthSubmit(e) {
  e.preventDefault();
  const password = authPasswordInput.value.trim();
  if (!password) return;

  authError.classList.add('hide');

  try {
    const response = await fetch('/api/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });

    if (response.ok) {
      PASSWORD = password;
      localStorage.setItem('suvshare_password', password);
      authPasswordInput.value = '';
      showScreen('dashboard-screen');
      loadFiles();
      showToast('Admin authorization successful', 'success');
    } else {
      const data = await response.json();
      showAuthError(data.error || 'Incorrect administration password.');
    }
  } catch (err) {
    console.error('Auth error:', err);
    showAuthError('Database connection error.');
  }
}

function handleLogout() {
  localStorage.removeItem('suvshare_password');
  PASSWORD = '';
  showScreen('auth-screen');
  showToast('Dashboard locked successfully', 'info');
}

function showAuthError(msg) {
  authError.innerText = msg;
  authError.classList.remove('hide');
}

// --- Chunked Resumable Upload Logic ---
const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB chunks
const activeUploadRequests = {};

function getFileFingerprint(file) {
  return `${file.name.replace(/[^a-zA-Z0-9]/g, '')}_${file.size}_${file.lastModified}`;
}

function handleFileSelect(e) {
  const files = e.target.files;
  if (files.length > 0) {
    uploadFiles(files);
  }
}

function handleDrop(e) {
  const dt = e.dataTransfer;
  const files = dt.files;
  if (files.length > 0) {
    uploadFiles(files);
  }
}

function uploadFiles(files) {
  uploadsContainer.classList.remove('hide');
  Array.from(files).forEach(file => {
    uploadFile(file);
  });
}

function uploadFile(file) {
  const itemId = 'upload-' + Math.random().toString(36).substr(2, 9);
  
  // Progress item creation with pause control
  const uploadItem = document.createElement('div');
  uploadItem.className = 'upload-item';
  uploadItem.id = itemId;
  uploadItem.innerHTML = `
    <div class="upload-item-header">
      <span class="upload-filename" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span>
      <div style="display: flex; align-items: center; gap: 8px;">
        <span class="upload-percent" id="pct-${itemId}">0%</span>
        <button class="btn-icon-m" id="btn-ctrl-${itemId}" style="width: 24px; height: 24px; border-radius: 4px; padding: 0; font-size: 0.72rem;" title="Pause Upload">
          <i class="fa-solid fa-pause"></i>
        </button>
      </div>
    </div>
    <div class="progress-bar-bg">
      <div class="progress-bar-fill" id="fill-${itemId}"></div>
    </div>
    <div class="upload-meta">
      <span id="speed-${itemId}">Connecting...</span>
      <span>${formatBytes(file.size)}</span>
    </div>
  `;
  activeUploadsList.appendChild(uploadItem);

  // Initialize upload state structure
  activeUploadRequests[itemId] = {
    xhr: null,
    paused: false,
    file: file,
    uploadId: null,
    fingerprint: getFileFingerprint(file),
    startTime: Date.now()
  };

  // Bind pause/resume click listener
  const ctrlBtn = document.getElementById(`btn-ctrl-${itemId}`);
  ctrlBtn.addEventListener('click', () => {
    toggleUploadState(itemId);
  });

  // Begin session initialization
  initiateUpload(itemId);
}

async function initiateUpload(itemId) {
  const uploadState = activeUploadRequests[itemId];
  if (!uploadState) return;

  const file = uploadState.file;
  
  try {
    const response = await fetch('/api/upload/init', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'X-Password': PASSWORD
      },
      body: JSON.stringify({
        name: file.name,
        size: file.size,
        mimeType: file.type,
        chunkSize: CHUNK_SIZE,
        fingerprint: uploadState.fingerprint
      })
    });

    if (!response.ok) {
      if (response.status === 401) {
        handleLogout();
        throw new Error('Unauthorized');
      }
      const data = await response.json();
      throw new Error(data.error || 'Upload initialization rejected');
    }

    const data = await response.json();
    uploadState.uploadId = data.uploadId;
    
    if (data.resumed && data.nextChunkIndex > 0) {
      showToast(`Resuming ${file.name} chunk upload...`, 'info');
      // Set the progress bar roughly to where we resumed
      const resumedProgress = Math.round(((data.nextChunkIndex * CHUNK_SIZE) / file.size) * 100);
      document.getElementById(`pct-${itemId}`).innerText = resumedProgress + '%';
      document.getElementById(`fill-${itemId}`).style.width = resumedProgress + '%';
    }

    // Begin chunk loop
    uploadNextChunk(itemId, data.nextChunkIndex);
  } catch (err) {
    handleUploadError(itemId, err.message || 'Server connection failed');
  }
}

function uploadNextChunk(itemId, chunkIndex) {
  const uploadState = activeUploadRequests[itemId];
  if (!uploadState || uploadState.paused) return;

  const file = uploadState.file;
  const uploadId = uploadState.uploadId;
  const start = chunkIndex * CHUNK_SIZE;

  // Stop if end of file reached
  if (start >= file.size) return;

  const end = Math.min(start + CHUNK_SIZE, file.size);
  const chunk = file.slice(start, end);

  const formData = new FormData();
  formData.append('uploadId', uploadId);
  formData.append('chunkIndex', chunkIndex);
  formData.append('chunk', chunk, file.name);

  const xhr = new XMLHttpRequest();
  uploadState.xhr = xhr;

  // Track upload progress inside chunk
  xhr.upload.addEventListener('progress', (e) => {
    if (e.lengthComputable && !uploadState.paused) {
      const loadedOverall = start + e.loaded;
      const percentComplete = Math.round((loadedOverall / file.size) * 100);

      // Speed calculation
      const elapsedSeconds = (Date.now() - uploadState.startTime) / 1000;
      let speedText = 'Uploading...';
      if (elapsedSeconds > 0) {
        const bytesPerSecond = loadedOverall / elapsedSeconds;
        speedText = formatBytes(bytesPerSecond) + '/s';
      }

      document.getElementById(`pct-${itemId}`).innerText = percentComplete + '%';
      document.getElementById(`fill-${itemId}`).style.width = percentComplete + '%';
      document.getElementById(`speed-${itemId}`).innerText = speedText;
    }
  });

  // Handle chunk response
  xhr.addEventListener('load', () => {
    if (xhr.status === 200) {
      try {
        const res = JSON.parse(xhr.responseText);
        if (res.success) {
          if (res.completed) {
            // Success complete merge
            finalizeUpload(itemId, res.file);
          } else {
            // Upload next chunk slice
            uploadNextChunk(itemId, res.nextChunkIndex);
          }
        } else {
          handleUploadError(itemId, res.error || 'Failed to upload slice');
        }
      } catch (err) {
        handleUploadError(itemId, 'Metadata processing error');
      }
    } else {
      let errMsg = 'Slice upload failed';
      try {
        const res = JSON.parse(xhr.responseText);
        errMsg = res.error || errMsg;
      } catch (e) {}
      handleUploadError(itemId, errMsg);
    }
  });

  xhr.addEventListener('error', () => {
    handleUploadError(itemId, 'Upload connection broken. Retry to resume.');
    const ctrlBtn = document.getElementById(`btn-ctrl-${itemId}`);
    if (ctrlBtn) {
      ctrlBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
      ctrlBtn.title = 'Resume Upload';
    }
  });

  xhr.open('POST', '/api/upload/chunk');
  xhr.setRequestHeader('X-Password', PASSWORD);
  xhr.send(formData);
}

function toggleUploadState(itemId) {
  const uploadState = activeUploadRequests[itemId];
  if (!uploadState) return;

  const ctrlBtn = document.getElementById(`btn-ctrl-${itemId}`);

  if (!uploadState.paused) {
    // PAUSE STATE
    uploadState.paused = true;
    if (uploadState.xhr) {
      uploadState.xhr.abort();
    }
    ctrlBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
    ctrlBtn.title = 'Resume Upload';
    document.getElementById(`speed-${itemId}`).innerText = 'Upload Paused';
    showToast(`Paused uploading ${uploadState.file.name}`, 'info');
  } else {
    // RESUME STATE
    uploadState.paused = false;
    uploadState.startTime = Date.now(); // reset timer
    ctrlBtn.innerHTML = '<i class="fa-solid fa-pause"></i>';
    ctrlBtn.title = 'Pause Upload';
    document.getElementById(`speed-${itemId}`).innerText = 'Re-establishing...';
    
    // Call server to locate resume index
    initiateUpload(itemId);
  }
}

function finalizeUpload(itemId, fileData) {
  const uploadItem = document.getElementById(itemId);
  if (!uploadItem) return;

  // Remove control button
  const ctrlBtn = document.getElementById(`btn-ctrl-${itemId}`);
  if (ctrlBtn) ctrlBtn.remove();

  // Mark success UI indicators
  document.getElementById(`pct-${itemId}`).innerHTML = '<i class="fa-solid fa-circle-check" style="color:var(--success-gradient)"></i>';
  document.getElementById(`speed-${itemId}`).innerText = 'Completed successfully!';
  document.getElementById(`fill-${itemId}`).style.background = 'var(--success-gradient)';
  
  showToast(`Uploaded ${fileData.name}`, 'success');
  
  // Auto-copy download link
  copyToClipboard(fileData.downloadUrl, false);
  showToast(`Direct download link copied!`, 'info');

  // Reload statistics & grids
  loadFiles();

  delete activeUploadRequests[itemId];

  // Auto clean list row
  setTimeout(() => {
    uploadItem.style.opacity = '0';
    uploadItem.style.transition = 'opacity 0.5s ease';
    setTimeout(() => {
      uploadItem.remove();
      if (activeUploadsList.children.length === 0) {
        uploadsContainer.classList.add('hide');
      }
    }, 500);
  }, 4000);
}

function handleUploadError(itemId, message) {
  document.getElementById(`pct-${itemId}`).innerHTML = '<i class="fa-solid fa-circle-xmark" style="color:#f43f5e"></i>';
  document.getElementById(`speed-${itemId}`).innerText = message;
  document.getElementById(`fill-${itemId}`).style.background = 'var(--danger-gradient)';
  showToast(`Error: ${message}`, 'error');
}

// --- Fetch Files List & Render ---
async function loadFiles() {
  try {
    const response = await fetch('/api/files', {
      headers: { 'X-Password': PASSWORD }
    });

    if (response.ok) {
      const data = await response.json();
      filesData = data.files || [];
      updateMetrics(filesData, data.maxStorage);
      renderFiles(filesData);
    } else if (response.status === 401) {
      handleLogout();
    } else {
      showToast('Error reading cloud files list', 'error');
    }
  } catch (err) {
    console.error('Load error:', err);
    showToast('Failed to connect to cloud database', 'error');
  }
}

function updateMetrics(files) {
  // Update stats widget numbers
  statsTotalFiles.innerText = files.length;
  
  const totalBytes = files.reduce((acc, file) => acc + file.size, 0);
  const maxStorage = 20 * 1024 * 1024 * 1024; // 20 GB
  statsTotalSize.innerText = `${formatBytes(totalBytes)} / 20 GB`;
  
  // Calculate storage capacity percentage
  const pct = Math.min((totalBytes / maxStorage) * 100, 100);
  const statsStorageBar = document.getElementById('stats-storage-bar');
  if (statsStorageBar) {
    statsStorageBar.style.width = pct + '%';
    if (pct > 90) {
      statsStorageBar.style.background = 'var(--danger-gradient)';
    } else if (pct > 75) {
      statsStorageBar.style.background = 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)'; // Amber warn color
    } else {
      statsStorageBar.style.background = 'var(--btn-primary-gradient)';
    }
  }
  
  const totalDownloads = files.reduce((acc, file) => acc + file.downloads, 0);
  statsTotalDownloads.innerText = totalDownloads;
}

function renderFiles(files) {
  filesGridContainer.innerHTML = '';
  
  if (files.length === 0) {
    filesEmptyState.classList.remove('hide');
    filesGridContainer.classList.add('hide');
    return;
  }

  filesEmptyState.classList.add('hide');
  filesGridContainer.classList.remove('hide');

  files.forEach(file => {
    const fileCard = document.createElement('div');
    fileCard.className = 'file-card glass-morphic';
    
    const iconClass = getFileIcon(file.name);
    const dateFormatted = formatDate(file.uploadedAt);
    const sizeFormatted = formatBytes(file.size);

    if (currentLayout === 'grid') {
      // Grid Card render
      fileCard.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: flex-start; width: 100%;">
          <div class="file-card-visual">
            <i class="${iconClass}"></i>
          </div>
          <span class="file-card-downloads">
            <i class="fa-solid fa-download"></i> ${file.downloads}
          </span>
        </div>
        <div class="file-card-details">
          <a href="${file.directUrl}" class="file-card-name" target="_blank" title="Download direct">${escapeHtml(file.name)}</a>
          <div class="file-card-meta">
            <span>${sizeFormatted}</span>
            <span class="meta-separator"></span>
            <span>${dateFormatted}</span>
          </div>
        </div>
        <div class="file-card-actions">
          <button class="btn-icon-m" onclick="copyLink('${file.downloadUrl}', this)" title="Copy Direct Download Link">
            <i class="fa-solid fa-link"></i>
          </button>
          <button class="btn-icon-m" onclick="openQrModal('${file.downloadUrl}')" title="Scan QR Code">
            <i class="fa-solid fa-qrcode"></i>
          </button>
          <button class="btn-icon-m" onclick="deleteFile('${file.id}', '${escapeHtml(file.name)}')" title="Delete File" style="color:#f43f5e;">
            <i class="fa-solid fa-trash-can"></i>
          </button>
        </div>
      `;
    } else {
      // List Card render
      fileCard.innerHTML = `
        <div class="file-card-left">
          <div class="file-card-visual"><i class="${iconClass}"></i></div>
          <div class="file-card-details">
            <a href="${file.directUrl}" class="file-card-name" target="_blank" title="Download direct">${escapeHtml(file.name)}</a>
            <div class="file-card-meta">
              <span>${sizeFormatted}</span>
              <span>${dateFormatted}</span>
              <span class="file-card-downloads"><i class="fa-solid fa-download"></i> ${file.downloads}</span>
            </div>
          </div>
        </div>
        <div class="file-card-actions">
          <button class="btn-icon-m btn-action-block" onclick="copyLink('${file.downloadUrl}', this)" title="Copy Download Link">
            <i class="fa-solid fa-link"></i>
          </button>
          <button class="btn-icon-m btn-action-block" onclick="openQrModal('${file.downloadUrl}')" title="Scan QR Code">
            <i class="fa-solid fa-qrcode"></i>
          </button>
          <button class="btn-icon-m btn-action-block" onclick="deleteFile('${file.id}', '${escapeHtml(file.name)}')" title="Delete File" style="color:#f43f5e;">
            <i class="fa-solid fa-trash-can"></i>
          </button>
        </div>
      `;
    }

    filesGridContainer.appendChild(fileCard);
  });
}

// --- Action Commands ---
function copyLink(url, element) {
  copyToClipboard(url, true);
  
  // Custom micro-interaction: change icon temporarily
  if (element) {
    const icon = element.querySelector('i');
    const oldClass = icon.className;
    icon.className = 'fa-solid fa-circle-check';
    icon.style.color = '#10b981';
    
    setTimeout(() => {
      icon.className = oldClass;
      icon.style.color = '';
    }, 2000);
  }
}

function openQrModal(link) {
  qrLinkInput.value = link;
  // Generate QR using API (180x180 px)
  qrImage.src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(link)}`;
  qrModal.classList.add('active');
}

function copyToClipboard(text, notify = true) {
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(() => {
      if (notify) showToast('Link copied to clipboard', 'success');
    }).catch(err => {
      fallbackCopyToClipboard(text, notify);
    });
  } else {
    fallbackCopyToClipboard(text, notify);
  }
}

function fallbackCopyToClipboard(text, notify) {
  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.style.position = 'fixed';
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  try {
    document.execCommand('copy');
    if (notify) showToast('Link copied!', 'success');
  } catch (err) {
    console.error('Fallback copy error:', err);
  }
  document.body.removeChild(textArea);
}

async function deleteFile(id, name) {
  // Native modern confirm popup
  if (!confirm(`Are you sure you want to permanently delete "${name}"?`)) {
    return;
  }

  try {
    const response = await fetch(`/api/files/${id}`, {
      method: 'DELETE',
      headers: { 'X-Password': PASSWORD }
    });

    if (response.ok) {
      showToast(`Deleted "${name}"`, 'success');
      loadFiles();
    } else {
      const data = await response.json();
      showToast(data.error || 'Failed to delete file', 'error');
    }
  } catch (err) {
    console.error('Delete error:', err);
    showToast('Failed to establish server connection', 'error');
  }
}

// --- Search Handler ---
function handleSearch(e) {
  const term = e.target.value.toLowerCase().trim();
  if (!term) {
    renderFiles(filesData);
    return;
  }

  const filtered = filesData.filter(file => 
    file.name.toLowerCase().includes(term)
  );
  renderFiles(filtered);
}

// --- Toast Alert System ---
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  let icon = 'fa-circle-info';
  if (type === 'success') icon = 'fa-circle-check';
  if (type === 'error') icon = 'fa-triangle-exclamation';

  toast.innerHTML = `
    <i class="fa-solid ${icon} toast-icon"></i>
    <div class="toast-body">${escapeHtml(message)}</div>
    <i class="fa-solid fa-xmark toast-close"></i>
  `;

  toastContainer.appendChild(toast);

  toast.querySelector('.toast-close').addEventListener('click', () => {
    toast.remove();
  });

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px) scale(0.95)';
    toast.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// --- Formatters & Helper Utils ---
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function formatDate(dateStr) {
  const date = new Date(dateStr);
  const options = { month: 'short', day: 'numeric', year: 'numeric' };
  return date.toLocaleDateString('en-US', options);
}

function getFileIcon(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  
  const iconMap = {
    // Images
    'jpg': 'fa-solid fa-file-image',
    'jpeg': 'fa-solid fa-file-image',
    'png': 'fa-solid fa-file-image',
    'gif': 'fa-solid fa-file-image',
    'webp': 'fa-solid fa-file-image',
    'svg': 'fa-solid fa-file-image',
    // Audio
    'mp3': 'fa-solid fa-file-audio',
    'wav': 'fa-solid fa-file-audio',
    'ogg': 'fa-solid fa-file-audio',
    'm4a': 'fa-solid fa-file-audio',
    // Video
    'mp4': 'fa-solid fa-file-video',
    'mkv': 'fa-solid fa-file-video',
    'mov': 'fa-solid fa-file-video',
    'avi': 'fa-solid fa-file-video',
    // Archives
    'zip': 'fa-solid fa-file-zipper',
    'rar': 'fa-solid fa-file-zipper',
    'tar': 'fa-solid fa-file-zipper',
    'gz': 'fa-solid fa-file-zipper',
    '7z': 'fa-solid fa-file-zipper',
    // Documents
    'pdf': 'fa-solid fa-file-pdf',
    'doc': 'fa-solid fa-file-word',
    'docx': 'fa-solid fa-file-word',
    'xls': 'fa-solid fa-file-excel',
    'xlsx': 'fa-solid fa-file-excel',
    'ppt': 'fa-solid fa-file-powerpoint',
    'pptx': 'fa-solid fa-file-powerpoint',
    'txt': 'fa-solid fa-file-lines',
    // Code
    'html': 'fa-solid fa-file-code',
    'css': 'fa-solid fa-file-code',
    'js': 'fa-solid fa-file-code',
    'json': 'fa-solid fa-file-code',
    'py': 'fa-solid fa-file-code',
    'sh': 'fa-solid fa-file-code'
  };

  return iconMap[ext] || 'fa-solid fa-file';
}

function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, function(m) { return map[m]; });
}
