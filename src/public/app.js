const state = {
  user: null, page: 'dashboard', settings: null, health: null,
  conversations: [], activeConversation: null, archived: false,
  groups: [], broadcasts: [], broadcastSignature: '', broadcastPolling: false,
  knowledge: [], knowledgeType: '', settingsTab: 'profile'
};
let realtimeTimer = null;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHTML = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
const formatDate = (value) => value ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '-';
const formatTime = (value) => value ? new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : '';
const initials = (value = '') => value.split(/\s+/).filter(Boolean).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'WA';

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) { showLogin(); throw new Error('Sesi berakhir'); }
  if (!response.ok) throw new Error(data.error || 'Permintaan gagal');
  return data;
}

function toast(message, type = 'success') {
  const node = document.createElement('div');
  node.className = `toast ${type}`;
  node.textContent = message;
  $('#toast-stack').append(node);
  setTimeout(() => node.remove(), 4000);
}

function showLogin() {
  stopRealtimeUpdates();
  $('#login-view').classList.remove('hidden');
  $('#app-view').classList.add('hidden');
}

function showApp() {
  $('#login-view').classList.add('hidden');
  $('#app-view').classList.remove('hidden');
  $('#user-name').textContent = state.user.name;
  $('#user-email').textContent = state.user.email;
  $('#user-avatar').textContent = initials(state.user.name);
  $('#settings-users-nav').classList.toggle('hidden', state.user.role !== 'superadmin');
  startRealtimeUpdates();
}

const pageMeta = {
  dashboard: ['OVERVIEW', 'Ringkasan'],
  inbox: ['CONVERSATIONS', 'Inbox'],
  groups: ['WHATSAPP', 'Grup'],
  broadcasts: ['CAMPAIGNS', 'Broadcast'],
  knowledge: ['AI TRAINING', 'Knowledge'],
  settings: ['WORKSPACE', 'Settings']
};

async function navigate(page) {
  state.page = page;
  $$('.page').forEach((node) => node.classList.toggle('active', node.id === `page-${page}`));
  $$('.nav-button').forEach((node) => node.classList.toggle('active', node.dataset.page === page));
  $('#page-kicker').textContent = pageMeta[page][0];
  $('#page-title').textContent = pageMeta[page][1];
  if (page === 'dashboard') await loadDashboard();
  if (page === 'inbox') await loadConversations();
  if (page === 'groups') await loadGroups();
  if (page === 'broadcasts') await loadBroadcasts();
  if (page === 'knowledge') await loadKnowledge();
  if (page === 'settings') await loadSettings();
}

async function boot() {
  try {
    const data = await api('/api/auth/me');
    state.user = data.user;
    showApp();
    await navigate('dashboard');
  } catch { showLogin(); }
}

$('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('#login-error').classList.add('hidden');
  try {
    const data = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: $('#login-email').value, password: $('#login-password').value }) });
    state.user = data.user; showApp(); await navigate('dashboard');
  } catch (error) { $('#login-error').textContent = error.message; $('#login-error').classList.remove('hidden'); }
});

$('#logout-button').addEventListener('click', async () => { await api('/api/auth/logout', { method: 'POST' }).catch(() => {}); state.user = null; showLogin(); });
$('#main-nav').addEventListener('click', (event) => { const button = event.target.closest('[data-page]'); if (button) navigate(button.dataset.page); });
$$('[data-goto]').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.goto)));
$('#refresh-button').addEventListener('click', () => navigate(state.page));

async function loadDashboard() {
  const data = await api('/api/dashboard');
  const broadcastMap = Object.fromEntries((data.broadcasts || []).map((item) => [item.status, item._count._all]));
  const metrics = [
    ['Percakapan aktif', data.sessions, 'Customer dan grup'],
    ['Pesan hari ini', data.messagesToday, 'Masuk dan keluar'],
    ['Menunggu admin', data.waitingAdmin, 'Perlu ditindaklanjuti'],
    ['Broadcast selesai', broadcastMap.completed || 0, `${broadcastMap.scheduled || 0} terjadwal`]
  ];
  $('#metric-grid').innerHTML = metrics.map(([label, value, detail]) => `<article class="metric"><span>${label}</span><strong>${value}</strong><small>${detail}</small></article>`).join('');
  $('#waiting-badge').textContent = data.waitingAdmin;
  $('#waiting-badge').classList.toggle('hidden', !data.waitingAdmin);
  $('#recent-activity').innerHTML = data.recent.length ? data.recent.map((item) => `
    <div class="activity-item"><span class="activity-icon">${item.type === 'incoming' ? '↓' : '↑'}</span><div><strong>${escapeHTML(item.fromPhone)}</strong><small>${escapeHTML(item.message || item.response || '-')}</small></div><time>${formatTime(item.timestamp)}</time></div>
  `).join('') : empty('Belum ada aktivitas');
  await loadHealth(false);
}

async function loadHealth(test = true) {
  if (test) state.health = await api('/api/settings/test', { method: 'POST' });
  const values = state.health || { database: { ok: true }, starsender: { ok: null, message: 'Belum dites' }, gemini: { ok: null, message: 'Belum dites' } };
  $('#health-list').innerHTML = Object.entries(values).map(([name, result]) => `<div class="health-item"><strong>${name === 'starsender' ? 'Starsender' : name === 'gemini' ? 'Gemini AI' : 'Database'}</strong><span class="status ${result.ok === true ? 'ok' : result.ok === false ? 'error' : 'warn'}">${result.ok === true ? 'Terhubung' : result.ok === false ? 'Bermasalah' : 'Belum dites'}</span></div>`).join('');
  const allOk = Object.values(values).every((item) => item.ok);
  $('#system-pill').className = `system-pill ${allOk ? 'ok' : 'error'}`;
  $('#system-pill span').textContent = allOk ? 'Semua sistem aktif' : 'Perlu perhatian';
}
$('#dashboard-test-button').addEventListener('click', async () => { try { await loadHealth(true); toast('Pengecekan koneksi selesai'); } catch (error) { toast(error.message, 'error'); } });

async function loadConversations() {
  const search = $('#conversation-search').value.trim();
  const data = await api(`/api/conversations?archived=${state.archived}&search=${encodeURIComponent(search)}`);
  state.conversations = data.sessions;
  renderConversations();
}
function renderConversations() {
  $('#conversation-list').innerHTML = state.conversations.length ? state.conversations.map((item) => `
    <button class="conversation-item ${state.activeConversation === item.phoneNumber ? 'active' : ''}" data-phone="${escapeHTML(item.phoneNumber)}">
      <span class="avatar">${initials(item.displayName || item.phoneNumber)}</span><span class="conversation-copy"><strong>${escapeHTML(item.displayName || item.phoneNumber)}</strong><span>${escapeHTML(item.latestMessage?.message || item.latestMessage?.response || 'Belum ada pesan')}</span></span>
      <span class="conversation-meta"><time>${formatTime(item.lastActivity)}</time>${item.unreadCount ? `<b class="unread">${item.unreadCount}</b>` : ''}</span>
    </button>`).join('') : empty('Tidak ada percakapan');
}
$('#conversation-list').addEventListener('click', (event) => { const item = event.target.closest('[data-phone]'); if (item) openConversation(item.dataset.phone); });
$('#conversation-search').addEventListener('input', debounce(loadConversations, 300));
$('#inbox-open').addEventListener('click', () => switchInbox(false));
$('#inbox-archived').addEventListener('click', () => switchInbox(true));
function switchInbox(archived) { state.archived = archived; $('#inbox-open').classList.toggle('active', !archived); $('#inbox-archived').classList.toggle('active', archived); loadConversations(); }

async function openConversation(phone) {
  state.activeConversation = phone;
  renderConversations();
  const session = state.conversations.find((item) => item.phoneNumber === phone);
  const data = await api(`/api/conversations/${encodeURIComponent(phone)}/messages`);
  const detail = $('#conversation-detail');
  detail.className = 'workspace-detail mobile-open';
  detail.innerHTML = `
    <header class="chat-header"><div class="chat-contact"><span class="avatar">${initials(session.displayName || phone)}</span><div><strong>${escapeHTML(session.displayName || phone)}</strong><small>${escapeHTML(phone)} · ${session.humanMode ? 'Ditangani admin' : 'Mode bot'}</small></div></div>
    <div class="chat-actions"><button class="button secondary small" id="mode-button">${session.humanMode ? 'Kembalikan ke bot' : 'Ambil alih'}</button><button class="button secondary small" id="archive-button">${session.archived ? 'Buka arsip' : 'Arsipkan'}</button></div></header>
    <div class="chat-body" id="chat-body">${data.messages.map((message) => `<div class="bubble ${message.type === 'outgoing' ? 'outgoing' : ''}">${escapeHTML(message.type === 'incoming' ? message.message : message.response)}<time>${formatTime(message.timestamp)}</time></div>`).join('')}</div>
    <form class="chat-composer" id="chat-form"><input id="chat-message" placeholder="Tulis balasan admin..." required><button class="button primary">Kirim</button></form>`;
  $('#chat-body').scrollTop = $('#chat-body').scrollHeight;
  $('#mode-button').onclick = async () => { await api(`/api/conversations/${encodeURIComponent(phone)}/mode`, { method: 'POST', body: JSON.stringify({ humanMode: !session.humanMode }) }); toast('Mode percakapan diperbarui'); await loadConversations(); await openConversation(phone); };
  $('#archive-button').onclick = async () => { await api(`/api/conversations/${encodeURIComponent(phone)}`, { method: 'PATCH', body: JSON.stringify({ archived: !session.archived }) }); state.activeConversation = null; detail.className = 'workspace-detail empty-detail'; detail.innerHTML = `<div class="empty-state"><h2>Percakapan diperbarui</h2></div>`; await loadConversations(); };
  $('#chat-form').onsubmit = async (event) => { event.preventDefault(); const input = $('#chat-message'); const message = input.value.trim(); if (!message) return; input.disabled = true; try { await api(`/api/conversations/${encodeURIComponent(phone)}/send`, { method: 'POST', body: JSON.stringify({ message }) }); input.value = ''; await openConversation(phone); } catch (error) { toast(error.message, 'error'); } finally { input.disabled = false; } };
}

async function loadGroups(refresh = false) {
  const data = await api(`/api/groups${refresh ? '?refresh=true' : ''}`);
  state.groups = data.groups || [];
  renderGroups();
}
function renderGroups() {
  const term = $('#group-search').value.toLowerCase();
  const groups = state.groups.filter((group) => `${group.name} ${group.id}`.toLowerCase().includes(term));
  $('#group-grid').innerHTML = groups.length ? groups.map((group) => `<article class="data-card"><h3>${escapeHTML(group.name || 'Tanpa nama')}</h3><p>${escapeHTML(group.id)}</p><div class="card-actions"><button class="button secondary small" data-send-group="${escapeHTML(group.id)}" data-name="${escapeHTML(group.name)}">Kirim pesan</button></div></article>`).join('') : empty('Grup tidak ditemukan');
}
$('#group-search').addEventListener('input', renderGroups);
$('#reload-groups').addEventListener('click', () => loadGroups(true).then(() => toast('Daftar grup diperbarui')).catch((error) => toast(error.message, 'error')));
$('#group-grid').addEventListener('click', (event) => { const button = event.target.closest('[data-send-group]'); if (button) openGroupMessage(button.dataset.sendGroup, button.dataset.name); });
function openGroupMessage(groupId, name) {
  openModal(`<div class="modal-header"><h2>Kirim ke ${escapeHTML(name)}</h2><button class="icon-button" data-close>×</button></div><form id="group-message-form"><div class="modal-body"><label>Pesan<textarea id="group-message-text" required placeholder="Tulis pesan untuk grup..."></textarea></label></div><div class="modal-footer"><button type="button" class="button secondary" data-close>Batal</button><button class="button primary">Kirim sekarang</button></div></form>`);
  $('#group-message-form').onsubmit = async (event) => { event.preventDefault(); try { await api(`/api/groups/${encodeURIComponent(groupId)}/send`, { method: 'POST', body: JSON.stringify({ message: $('#group-message-text').value }) }); closeModal(); toast('Pesan berhasil dikirim'); } catch (error) { toast(error.message, 'error'); } };
}

async function loadBroadcasts(silent = false) {
  if (state.broadcastPolling) return;
  state.broadcastPolling = true;
  try {
    const data = await api('/api/broadcasts');
    const signature = JSON.stringify(data.broadcasts.map((item) => [
      item.id,
      item.status,
      item.scheduledAt,
      item.completedAt,
      item.recipients.map((recipient) => [recipient.id, recipient.status, recipient.sentAt])
    ]));
    if (!silent || signature !== state.broadcastSignature) {
      state.broadcasts = data.broadcasts;
      state.broadcastSignature = signature;
      renderBroadcasts();
    }
  } finally {
    state.broadcastPolling = false;
  }
}

function startRealtimeUpdates() {
  if (realtimeTimer) return;
  realtimeTimer = setInterval(() => {
    if (state.user && state.page === 'broadcasts') {
      loadBroadcasts(true).catch(() => {});
    }
  }, 2000);
}

function stopRealtimeUpdates() {
  if (!realtimeTimer) return;
  clearInterval(realtimeTimer);
  realtimeTimer = null;
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state.user && state.page === 'broadcasts') {
    loadBroadcasts(true).catch(() => {});
  }
});
function renderBroadcasts() {
  const statuses = state.broadcasts.reduce((map, item) => ({ ...map, [item.status]: (map[item.status] || 0) + 1 }), {});
  $('#broadcast-summary').innerHTML = ['draft','scheduled','processing','completed','partial','failed'].map((status) => `<div class="mini-metric"><strong>${statuses[status] || 0}</strong><span>${status.toUpperCase()}</span></div>`).join('');

  const upcoming = state.broadcasts
    .filter((item) => item.status === 'scheduled' && item.scheduledAt)
    .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt))
    .slice(0, 6);
  $('#scheduler-timezone').textContent = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Waktu lokal';
  $('#broadcast-schedule').innerHTML = upcoming.length ? upcoming.map((item) => {
    const date = new Date(item.scheduledAt);
    return `<article class="schedule-item"><div class="schedule-date"><strong>${date.toLocaleDateString('id-ID', { day: '2-digit' })}</strong><span>${date.toLocaleDateString('id-ID', { month: 'short' })}</span></div><div class="schedule-copy"><strong>${escapeHTML(item.title)}</strong><small>${date.toLocaleString('id-ID', { weekday: 'short', hour: '2-digit', minute: '2-digit' })} ? ${item.recipients.length} grup</small><span class="status warn">Terjadwal</span></div></article>`;
  }).join('') : '<div class="schedule-empty"><strong>Belum ada jadwal aktif</strong><small>Buat broadcast baru dan tentukan waktu kirimnya.</small></div>';

  $('#broadcast-list').innerHTML = state.broadcasts.length ? state.broadcasts.map((item) => {
    const sent = item.recipients.filter((recipient) => recipient.status === 'sent').length;
    const failed = item.recipients.filter((recipient) => recipient.status === 'failed').length;
    return `<article class="broadcast-row"><div><h3>${escapeHTML(item.title)}</h3><small>${escapeHTML(item.message || 'Media broadcast')}</small></div><small>${formatDate(item.scheduledAt || item.createdAt)}</small><span class="status ${item.status === 'completed' ? 'ok' : ['failed','partial'].includes(item.status) ? 'error' : 'warn'}">${item.status}</span><small>${sent}/${item.recipients.length} terkirim${failed ? ` ? ${failed} gagal` : ''}</small><div class="broadcast-actions">${item.status === 'draft' ? `<button class="button primary small" data-schedule="${item.id}">Jadwalkan</button>` : ''}${['draft','scheduled'].includes(item.status) ? `<button class="button secondary small" data-cancel="${item.id}">Batalkan</button>` : ''}${['failed','partial'].includes(item.status) ? `<button class="button primary small" data-retry="${item.id}">Retry</button>` : ''}<button class="button secondary small" data-delete="${item.id}">Hapus</button></div></article>`;
  }).join('') : empty('Belum ada broadcast');
}
$('#new-broadcast-button').addEventListener('click', openBroadcastComposer);
$('#broadcast-list').addEventListener('click', async (event) => {
  const action = event.target.closest('[data-schedule],[data-cancel],[data-retry],[data-delete]'); if (!action) return;
  try {
    if (action.dataset.schedule) openScheduleModal(action.dataset.schedule);
    if (action.dataset.cancel) { await api(`/api/broadcasts/${action.dataset.cancel}/cancel`, { method: 'POST' }); toast('Broadcast dibatalkan'); await loadBroadcasts(); }
    if (action.dataset.retry) { await api(`/api/broadcasts/${action.dataset.retry}/retry`, { method: 'POST' }); toast('Penerima gagal dijadwalkan ulang'); await loadBroadcasts(); }
    if (action.dataset.delete && confirm('Hapus riwayat broadcast ini?')) { await api(`/api/broadcasts/${action.dataset.delete}`, { method: 'DELETE' }); await loadBroadcasts(); }
  } catch (error) { toast(error.message, 'error'); }
});

async function openBroadcastComposer() {
  if (!state.groups.length) { try { await loadGroups(); } catch (error) { return toast(`Tidak dapat mengambil grup: ${error.message}`, 'error'); } }
  const defaultSchedule = localDateTimeValue(new Date());
  openModal(`<div class="modal-header"><h2>Broadcast baru</h2><button class="icon-button" data-close>&times;</button></div><form id="broadcast-form"><div class="modal-body">
    <div class="form-grid"><label class="full">Nama kampanye<input id="broadcast-title" required placeholder="Contoh: Pengumuman kelas Juni"></label>
    <label class="full">Pesan<textarea id="broadcast-message" required placeholder="Tulis pesan yang akan diterima anggota grup..."></textarea></label>
    <label>Waktu kirim<input id="broadcast-schedule-time" type="datetime-local" min="${defaultSchedule}" value="${defaultSchedule}" required></label>
    <label>Gambar opsional<input id="broadcast-image" type="file" accept="image/png,image/jpeg,image/webp,image/gif"></label></div>
    <div class="panel-heading" style="padding:12px 0"><div><strong>Pilih grup</strong><p class="muted" id="selected-count">0 grup dipilih</p></div><button type="button" class="text-button" id="select-all-groups">Pilih semua</button></div>
    <input id="broadcast-group-search" class="search-input" placeholder="Cari grup..." style="margin-bottom:8px">
    <div id="broadcast-group-picker" class="group-picker">${renderGroupOptions(state.groups)}</div>
  </div><div class="modal-footer"><button type="button" class="button secondary" data-close>Batal</button><button class="button primary">Lanjut ke preview</button></div></form>`);
  const updateCount = () => $('#selected-count').textContent = `${$$('#broadcast-group-picker input:checked').length} grup dipilih`;
  $('#broadcast-group-picker').addEventListener('change', updateCount);
  $('#select-all-groups').onclick = () => { const visible = $$('.group-option:not(.hidden) input'); const allChecked = visible.every((item) => item.checked); visible.forEach((item) => item.checked = !allChecked); updateCount(); };
  $('#broadcast-group-search').oninput = (event) => { const term = event.target.value.toLowerCase(); $$('.group-option').forEach((item) => item.classList.toggle('hidden', !item.textContent.toLowerCase().includes(term))); };
  $('#broadcast-form').onsubmit = async (event) => {
    event.preventDefault();
    const recipients = $$('#broadcast-group-picker input:checked').map((input) => ({ groupId: input.value, groupName: input.dataset.name }));
    if (!recipients.length) return toast('Pilih minimal satu grup', 'error');
    const scheduledAt = new Date($('#broadcast-schedule-time').value);
    if (Number.isNaN(scheduledAt.getTime())) return toast('Pilih waktu kirim', 'error');
    let imageUrl = null;
    const file = $('#broadcast-image').files[0];
    if (file) imageUrl = await uploadImage(file);
    showBroadcastPreview({ title: $('#broadcast-title').value.trim(), message: $('#broadcast-message').value.trim(), imageUrl, recipients, scheduledAt: scheduledAt.toISOString() });
  };
}
function renderGroupOptions(groups) { return groups.map((group, index) => `<label class="group-option"><input type="checkbox" value="${escapeHTML(group.id)}" data-name="${escapeHTML(group.name || group.id)}"><span>${escapeHTML(group.name || 'Tanpa nama')} <small class="muted">#${index + 1} · ${escapeHTML(String(group.id).slice(-12))}</small></span></label>`).join(''); }
async function uploadImage(file) { if (file.size > 5 * 1024 * 1024) throw new Error('Gambar maksimal 5 MB'); const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); }); return (await api('/api/uploads', { method: 'POST', body: JSON.stringify({ filedata: data }) })).url; }
function showBroadcastPreview(payload) {
  openModal(`<div class="modal-header"><h2>Periksa broadcast</h2><button class="icon-button" data-close>&times;</button></div><div class="modal-body"><p class="eyebrow">KAMPANYE</p><h2>${escapeHTML(payload.title)}</h2><p class="muted">${payload.recipients.length} grup akan menerima pesan ini.</p><div class="schedule-preview"><span>Waktu kirim</span><strong>${formatDate(payload.scheduledAt)}</strong></div><div class="preview-box">${escapeHTML(payload.message)}</div>${payload.imageUrl ? `<img src="${escapeHTML(payload.imageUrl)}" alt="" style="max-width:220px;margin-top:12px;border-radius:8px">` : ''}<p class="muted">Periksa penerima, isi pesan, dan waktu kirim sebelum mengaktifkan scheduler.</p></div><div class="modal-footer"><button class="button secondary" data-close>Batal</button><button id="test-broadcast-message" class="button secondary">Kirim test</button><button id="save-broadcast-draft" class="button secondary">Simpan draft</button><button id="schedule-broadcast-message" class="button primary">Jadwalkan broadcast</button></div>`);
  $('#test-broadcast-message').onclick = async () => {
    const recipient = payload.recipients[0];
    if (!confirm(`Kirim pesan test ke ${recipient.groupName}?`)) return;
    try {
      await api('/api/broadcasts/test', { method: 'POST', body: JSON.stringify({ groupId: recipient.groupId, message: payload.message, imageUrl: payload.imageUrl }) });
      toast('Pesan test berhasil dikirim');
    } catch (error) { toast(error.message, 'error'); }
  };
  $('#save-broadcast-draft').onclick = async () => {
    try {
      await api('/api/broadcasts', { method: 'POST', body: JSON.stringify(payload) });
      closeModal(); toast('Draft broadcast tersimpan'); await loadBroadcasts();
    } catch (error) { toast(error.message, 'error'); }
  };
  $('#schedule-broadcast-message').onclick = async () => {
    try {
      const data = await api('/api/broadcasts', { method: 'POST', body: JSON.stringify(payload) });
      await api(`/api/broadcasts/${data.broadcast.id}/schedule`, { method: 'POST', body: JSON.stringify({ scheduledAt: payload.scheduledAt }) });
      closeModal(); toast('Broadcast masuk ke scheduler'); await loadBroadcasts();
    } catch (error) { toast(error.message, 'error'); }
  };
}
function openScheduleModal(id) {
  const min = localDateTimeValue(new Date(Date.now() + 60000));
  openModal(`<div class="modal-header"><h2>Jadwalkan broadcast</h2><button class="icon-button" data-close>&times;</button></div><form id="schedule-form"><div class="modal-body"><label>Waktu kirim (waktu lokal perangkat)<input id="schedule-time" type="datetime-local" min="${min}" required></label><p class="muted">Setelah dikonfirmasi, scheduler akan mengirim otomatis. Pastikan jumlah grup dan isi pesan sudah benar.</p></div><div class="modal-footer"><button type="button" class="button secondary" data-close>Batal</button><button class="button primary">Konfirmasi jadwal</button></div></form>`);
  $('#schedule-form').onsubmit = async (event) => { event.preventDefault(); try { await api(`/api/broadcasts/${id}/schedule`, { method: 'POST', body: JSON.stringify({ scheduledAt: new Date($('#schedule-time').value).toISOString() }) }); closeModal(); toast('Broadcast berhasil dijadwalkan'); await loadBroadcasts(); } catch (error) { toast(error.message, 'error'); } };
}
function localDateTimeValue(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

async function loadKnowledge() {
  const data = await api(`/api/knowledge${state.knowledgeType ? `?type=${state.knowledgeType}` : ''}`); state.knowledge = data.items; renderKnowledge();
}
function renderKnowledge() { $('#knowledge-grid').innerHTML = state.knowledge.length ? state.knowledge.map((item) => `<article class="data-card"><span class="status ${item.type === 'product' ? 'warn' : 'ok'}">${item.type}</span><h3 style="margin-top:12px">${escapeHTML(item.title)}</h3><p>${escapeHTML(item.content.slice(0,180))}${item.content.length > 180 ? '…' : ''}</p><div class="card-actions"><button class="button secondary small" data-edit-knowledge="${item.id}">Edit</button><button class="button danger small" data-delete-knowledge="${item.id}">Hapus</button></div></article>`).join('') : empty('Belum ada knowledge'); }
$$('[data-knowledge-type]').forEach((button) => button.addEventListener('click', () => { state.knowledgeType = button.dataset.knowledgeType; $$('[data-knowledge-type]').forEach((item) => item.classList.toggle('active', item === button)); loadKnowledge(); }));
$('#new-knowledge-button').addEventListener('click', () => openKnowledgeModal());
$('#knowledge-grid').addEventListener('click', async (event) => { const edit = event.target.closest('[data-edit-knowledge]'); const del = event.target.closest('[data-delete-knowledge]'); if (edit) openKnowledgeModal(state.knowledge.find((item) => item.id === edit.dataset.editKnowledge)); if (del && confirm('Hapus data knowledge ini?')) { await api(`/api/knowledge/${del.dataset.deleteKnowledge}`, { method: 'DELETE' }); await loadKnowledge(); } });
function openKnowledgeModal(item = null) {
  openModal(`<div class="modal-header"><h2>${item ? 'Edit' : 'Tambah'} knowledge</h2><button class="icon-button" data-close>×</button></div><form id="knowledge-form"><div class="modal-body"><div class="form-grid"><label>Jenis<select id="knowledge-type"><option value="general">Umum</option><option value="product">Produk</option></select></label><label>Judul<input id="knowledge-title" required value="${escapeHTML(item?.title || '')}"></label><label class="full">Tags<input id="knowledge-tags" value="${escapeHTML((item?.tags || []).join(', '))}" placeholder="harga, refund, pengiriman"></label><label class="full">Isi<textarea id="knowledge-content" required>${escapeHTML(item?.content || '')}</textarea></label><label>Nama produk<input id="knowledge-product-name" value="${escapeHTML(item?.productName || '')}"></label><label>Link produk<input id="knowledge-product-link" value="${escapeHTML(item?.productLink || '')}"></label></div></div><div class="modal-footer"><button type="button" class="button secondary" data-close>Batal</button><button class="button primary">Simpan</button></div></form>`);
  $('#knowledge-type').value = item?.type || 'general';
  $('#knowledge-form').onsubmit = async (event) => { event.preventDefault(); const body = { type: $('#knowledge-type').value, title: $('#knowledge-title').value, tags: $('#knowledge-tags').value.split(','), content: $('#knowledge-content').value, productName: $('#knowledge-product-name').value, productLink: $('#knowledge-product-link').value }; try { await api(item ? `/api/knowledge/${item.id}` : '/api/knowledge', { method: item ? 'PUT' : 'POST', body: JSON.stringify(body) }); closeModal(); toast('Knowledge tersimpan'); await loadKnowledge(); } catch (error) { toast(error.message, 'error'); } };
}

async function loadSettings() {
  const data = await api('/api/settings'); state.settings = data.settings; renderSettings();
}
$$('[data-settings-tab]').forEach((button) => button.addEventListener('click', () => { state.settingsTab = button.dataset.settingsTab; $$('[data-settings-tab]').forEach((item) => item.classList.toggle('active', item === button)); renderSettings(); }));
async function renderSettings() {
  const root = $('#settings-content');
  if (state.settingsTab === 'profile') {
    root.innerHTML = `<h2>Workspace</h2><p class="muted">Identitas bot dan jam operasional untuk akun ini.</p><form id="profile-settings-form"><div class="form-grid"><label>Nama workspace<input id="setting-store" value="${escapeHTML(state.settings.storeName)}"></label><label>Nama bot<input id="setting-bot" value="${escapeHTML(state.settings.botName)}"></label><label>Jam mulai<input id="setting-start" type="time" value="${state.settings.operationalStart}"></label><label>Jam selesai<input id="setting-end" type="time" value="${state.settings.operationalEnd}"></label><label class="full">Nomor notifikasi admin<input id="setting-admin-phone" value="${escapeHTML(state.settings.adminNotificationPhone)}" placeholder="62812..."></label></div><div class="switch-row"><div><strong>Auto reply</strong><p>Bot membalas pesan baru secara otomatis.</p></div><input id="setting-auto-reply" class="switch" type="checkbox" ${state.settings.autoReplyEnabled ? 'checked' : ''}></div><div class="switch-row"><div><strong>Gemini AI</strong><p>Gunakan AI dan knowledge untuk menyusun jawaban.</p></div><input id="setting-ai" class="switch" type="checkbox" ${state.settings.aiEnabled ? 'checked' : ''}></div><div style="margin-top:18px"><button class="button primary">Simpan perubahan</button></div></form>`;
    $('#profile-settings-form').onsubmit = saveSettings;
  } else if (state.settingsTab === 'integrations') {
    root.innerHTML = `<h2>Integrasi API</h2><p class="muted">API key disimpan terenkripsi. Kosongkan input jika tidak ingin menggantinya.</p><form id="integration-settings-form"><label>Starsender API Key<input id="setting-starsender" type="password" placeholder="${escapeHTML(state.settings.starsenderApiKeyMasked || 'Belum diatur')}"></label><label>Gemini API Key<input id="setting-gemini" type="password" placeholder="${escapeHTML(state.settings.geminiApiKeyMasked || 'Belum diatur')}"></label><label>Model Gemini<input id="setting-model" value="${escapeHTML(state.settings.geminiModel)}"></label><div style="display:flex;gap:8px"><button class="button primary">Simpan API</button><button type="button" id="test-settings-button" class="button secondary">Test koneksi</button></div></form><div id="settings-test-result" class="health-list" style="margin-top:18px"></div>`;
    $('#integration-settings-form').onsubmit = saveSettings;
    $('#test-settings-button').onclick = async () => { try { const result = await api('/api/settings/test', { method: 'POST' }); $('#settings-test-result').innerHTML = Object.entries(result).map(([key, value]) => `<div class="health-item"><strong>${key}</strong><span class="status ${value.ok ? 'ok' : 'error'}">${value.ok ? 'Terhubung' : escapeHTML(value.message || 'Gagal')}</span></div>`).join(''); } catch (error) { toast(error.message, 'error'); } };
  } else if (state.settingsTab === 'webhook') {
    root.innerHTML = `<h2>Webhook Starsender</h2><p class="muted">Masukkan URL ini sebagai webhook incoming message pada device Starsender milik user ini.</p><label>Webhook URL<input id="webhook-url-setting" readonly value="${escapeHTML(state.settings.webhookUrl)}"></label><div style="display:flex;gap:8px"><button id="copy-webhook-button" class="button primary">Salin URL</button><button id="rotate-webhook-button" class="button danger">Buat token baru</button></div><p class="muted">Membuat token baru akan langsung menonaktifkan URL lama.</p>`;
    $('#webhook-url-setting').onclick = (event) => event.currentTarget.select();
    $('#copy-webhook-button').onclick = async () => {
      try {
        await copyText(state.settings.webhookUrl);
        openModal(`<div class="modal-header"><h2>URL berhasil disalin</h2><button class="icon-button" data-close>&times;</button></div><div class="modal-body"><p class="muted">Webhook Starsender sudah masuk ke clipboard.</p><div class="preview-box">${escapeHTML(state.settings.webhookUrl)}</div></div><div class="modal-footer"><button class="button primary" data-close>Oke</button></div>`);
      } catch {
        const input = $('#webhook-url-setting');
        input.focus();
        input.select();
        toast('Clipboard dibatasi browser. URL sudah dipilih, tekan Ctrl+C.', 'error');
      }
    };
    $('#rotate-webhook-button').onclick = async () => { if (!confirm('URL webhook lama akan berhenti bekerja. Lanjutkan?')) return; const data = await api('/api/settings/rotate-webhook', { method: 'POST' }); state.settings = data.settings; renderSettings(); toast('Webhook token diperbarui'); };
  } else {
    const data = await api('/api/users');
    root.innerHTML = `<div class="panel-heading" style="padding:0 0 16px"><div><h2>Pengguna</h2><p class="muted">Setiap user memiliki data, API, grup, dan webhook terpisah.</p></div><button id="new-user-button" class="button primary">＋ User</button></div><div class="broadcast-list">${data.users.map((user) => `<article class="broadcast-row" style="grid-template-columns:1fr 160px 100px auto"><div><h3>${escapeHTML(user.name)}</h3><small>${escapeHTML(user.email)}</small></div><small>${formatDate(user.createdAt)}</small><span class="status ${user.isActive ? 'ok' : 'error'}">${user.isActive ? 'aktif' : 'nonaktif'}</span><div class="broadcast-actions"><button class="button secondary small" data-toggle-user="${user.id}" data-active="${user.isActive}">${user.isActive ? 'Nonaktifkan' : 'Aktifkan'}</button><button class="button secondary small" data-reset-user="${user.id}">Reset password</button></div></article>`).join('')}</div>`;
    $('#new-user-button').onclick = openUserModal;
    root.onclick = async (event) => { const toggle = event.target.closest('[data-toggle-user]'); const reset = event.target.closest('[data-reset-user]'); if (toggle) { await api(`/api/users/${toggle.dataset.toggleUser}`, { method: 'PATCH', body: JSON.stringify({ isActive: toggle.dataset.active !== 'true' }) }); renderSettings(); } if (reset) resetUserPassword(reset.dataset.resetUser); };
  }
}
async function saveSettings(event) {
  event.preventDefault();
  const body = { ...state.settings };
  if ($('#setting-store')) Object.assign(body, { storeName: $('#setting-store').value, botName: $('#setting-bot').value, operationalStart: $('#setting-start').value, operationalEnd: $('#setting-end').value, adminNotificationPhone: $('#setting-admin-phone').value, autoReplyEnabled: $('#setting-auto-reply').checked, aiEnabled: $('#setting-ai').checked });
  if ($('#setting-starsender')) Object.assign(body, { starsenderApiKey: $('#setting-starsender').value, geminiApiKey: $('#setting-gemini').value, geminiModel: $('#setting-model').value });
  const data = await api('/api/settings', { method: 'PUT', body: JSON.stringify(body) }); state.settings = data.settings; toast('Settings tersimpan'); renderSettings();
}
function openUserModal() {
  openModal(`<div class="modal-header"><h2>Tambah pengguna</h2><button class="icon-button" data-close>×</button></div><form id="user-form"><div class="modal-body"><label>Nama<input id="new-user-name" required></label><label>Email<input id="new-user-email" type="email" required></label><label>Password awal<input id="new-user-password" type="password" minlength="8" required></label></div><div class="modal-footer"><button type="button" class="button secondary" data-close>Batal</button><button class="button primary">Buat user</button></div></form>`);
  $('#user-form').onsubmit = async (event) => { event.preventDefault(); try { await api('/api/users', { method: 'POST', body: JSON.stringify({ name: $('#new-user-name').value, email: $('#new-user-email').value, password: $('#new-user-password').value }) }); closeModal(); toast('User baru dibuat'); renderSettings(); } catch (error) { toast(error.message, 'error'); } };
}
function resetUserPassword(id) {
  openModal(`<div class="modal-header"><h2>Reset password</h2><button class="icon-button" data-close>×</button></div><form id="reset-form"><div class="modal-body"><label>Password baru<input id="reset-password" type="password" minlength="8" required></label></div><div class="modal-footer"><button type="button" class="button secondary" data-close>Batal</button><button class="button primary">Simpan password</button></div></form>`);
  $('#reset-form').onsubmit = async (event) => { event.preventDefault(); await api(`/api/users/${id}`, { method: 'PATCH', body: JSON.stringify({ password: $('#reset-password').value }) }); closeModal(); toast('Password diperbarui'); };
}

async function copyText(value) {
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (copied) return;

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  throw new Error('Clipboard tidak tersedia');
}

function openModal(content) { $('#modal').innerHTML = content; $('#modal-backdrop').classList.remove('hidden'); $$('[data-close]', $('#modal')).forEach((button) => button.onclick = closeModal); }
function closeModal() { $('#modal-backdrop').classList.add('hidden'); $('#modal').innerHTML = ''; }
$('#modal-backdrop').addEventListener('click', (event) => { if (event.target === $('#modal-backdrop')) closeModal(); });
function empty(text) { return `<div class="empty-state"><span>◇</span><h2>${escapeHTML(text)}</h2></div>`; }
function debounce(fn, wait) { let timer; return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), wait); }; }

boot();
