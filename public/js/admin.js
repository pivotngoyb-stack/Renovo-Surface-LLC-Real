/** Shared helpers for admin pages. Redirects to login on any 401. */
async function adminFetch(url, options = {}) {
  const res = await fetch(url, options);
  if (res.status === 401) {
    window.location.href = '/admin/login.html';
    throw new Error('Not authenticated');
  }
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
