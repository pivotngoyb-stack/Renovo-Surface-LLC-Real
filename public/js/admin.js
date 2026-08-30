/** Shared helpers for admin pages. Redirects to login on any 401. */

/**
 * The admin session now expires on inactivity rather than at a fixed hour, so
 * working has to count as activity. Every admin API call runs through
 * adminFetch, which nudges the session at most once a minute. Walk away and
 * nothing nudges it, so it lapses on its own.
 */
let lastSessionTouch = Date.now();
const SESSION_TOUCH_INTERVAL_MS = 60 * 1000;

function touchSession() {
  const now = Date.now();
  if (now - lastSessionTouch < SESSION_TOUCH_INTERVAL_MS) return;
  lastSessionTouch = now;
  // Plain fetch, not adminFetch: a failure here must never bounce someone to
  // the login page, and it must not recurse back into this function.
  fetch('/api/admin/session', { method: 'POST' }).catch(() => {});
}

async function adminFetch(url, options = {}) {
  const res = await fetch(url, options);
  if (res.status === 401) {
    window.location.href = '/admin/login.html';
    throw new Error('Not authenticated');
  }
  touchSession();
  return res;
}

function money(n) {
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function statusPill(status) {
  return `<span class="status-pill status-${status}">${status}</span>`;
}

async function logout() {
  await fetch('/api/admin/login', { method: 'DELETE' });
  window.location.href = '/admin/login.html';
}

/** Branded toast notification, replaces native alert(). */
function adminToast(message, type = 'error') {
  let container = document.getElementById('adminToastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'adminToastContainer';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `admin-toast admin-toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 4500);
}

/** Branded confirmation dialog, replaces native confirm(). Returns a Promise<boolean>. */
function adminConfirm(message, confirmLabel = 'Confirm') {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'admin-confirm-overlay';
    overlay.innerHTML = `
      <div class="admin-confirm-card">
        <p>${message}</p>
        <div class="admin-confirm-actions">
          <button type="button" class="btn btn-outline btn-sm admin-confirm-cancel">Cancel</button>
          <button type="button" class="btn btn-primary btn-sm admin-confirm-ok">${confirmLabel}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    setTimeout(() => overlay.classList.add('show'), 10);
    function close(result) {
      overlay.classList.remove('show');
      setTimeout(() => overlay.remove(), 200);
      resolve(result);
    }
    overlay.querySelector('.admin-confirm-cancel').addEventListener('click', () => close(false));
    overlay.querySelector('.admin-confirm-ok').addEventListener('click', () => close(true));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
  });
}

/**
 * Downscale and re-encode a photo before upload.
 *
 * Shared because both work orders and estimates take photos on a phone, and a
 * modern phone camera produces 4-8MB files that blow past the 4MB request
 * limit. 1600px on the long edge is plenty for a proposal or a job record and
 * lands well under the cap.
 *
 * Always re-encodes to JPEG: HEIC and PNG screenshots both arrive here, and the
 * upload endpoints only accept JPEG, PNG or WebP.
 */
const MAX_PHOTO_DIMENSION = 1600;

function resizeImageFile(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = () => { img.src = reader.result; };
    reader.onerror = reject;
    img.onload = () => {
      let { width, height } = img;
      if (width > MAX_PHOTO_DIMENSION || height > MAX_PHOTO_DIMENSION) {
        const scale = MAX_PHOTO_DIMENSION / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.75));
    };
    img.onerror = reject;
    reader.readAsDataURL(file);
  });
}
