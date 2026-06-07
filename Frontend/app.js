// ════════════════════════════════════════════════════════════
//  XSS PROTECTION — HTML escape utility
//  Use escapeHtml() for ALL user-controlled data rendered in innerHTML
// ════════════════════════════════════════════════════════════
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// API URL: configured via window.BA_API_URL (set in index.html env block),
// never falls back to a hardcoded production URL in this file.
const API_URL = (
  window.BA_API_URL ||
  window.API_URL ||
  localStorage.getItem('ba_api_url') ||
  ''
).replace(/\/$/, '');

// ════════════════════════════════════════════════════════════
//  API + TOKEN REFRESH
// ════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════
//  API + TOKEN REFRESH
// ════════════════════════════════════════════════════════════

function _getToken() {
  return sessionStorage.getItem('ba_token') || localStorage.getItem('ba_token');
}

function _saveToken(token, remember) {
  if (remember) localStorage.setItem('ba_token', token);
  else          sessionStorage.setItem('ba_token', token);
}

async function _refreshToken() {
  const token = _getToken();
  if (!token) return false;
  try {
    const res = await fetch(API_URL + '/api/auth/refresh', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    if (!res.ok) return false;
    const data = await res.json();
    const newToken = data?.data?.access_token;
    if (!newToken) return false;
    const inLocal = !!localStorage.getItem('ba_token');
    _saveToken(newToken, inLocal);
    return true;
  } catch {
    return false;
  }
}

function _formatApiError(detail, fallback) {
  if (!detail) return fallback;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) return detail.map(d => d.msg || d.message || JSON.stringify(d)).join(', ');
  if (typeof detail === 'object') return detail.message || detail.msg || JSON.stringify(detail);
  return String(detail);
}

async function apiCall(path, options = {}) {
  const token = _getToken();
  let res;
  try {
    res = await fetch(API_URL + path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        ...(options.headers || {}),
      },
    });
  } catch (error) {
    throw new Error(`${error.message} (${API_URL + path})`);
  }
  let data = {};
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    try { data = await res.json(); } catch { data = {}; }
  } else {
    const text = await res.text();
    if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
    return { success: true, message: text, data: null };
  }

  if (res.status === 401) {
    const refreshed = await _refreshToken();
    if (refreshed) return apiCall(path, options);
    sessionStorage.removeItem('ba_token');
    localStorage.removeItem('ba_token');
    if (typeof doLogout === 'function') doLogout();
    throw new Error('Session expired');
  }

  if (!res.ok) throw new Error(_formatApiError(data.detail, data.message || `HTTP ${res.status}`));
  return data;
}

const TOKEN_REFRESH_INTERVAL = 55 * 60 * 1000;
setInterval(async () => { if (_getToken()) await _refreshToken(); }, TOKEN_REFRESH_INTERVAL);


// ════════════════════════════════════════════════════════════
//  THEME
// ════════════════════════════════════════════════════════════

(function initTheme() {
  const saved = localStorage.getItem('ba_theme');
  if (saved) document.documentElement.setAttribute('data-theme', saved);
})();

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('ba_theme', theme);
  const settingsCb = document.getElementById('settingsThemeToggle');
  if (settingsCb) settingsCb.checked = (theme === 'light');
}

// ════════════════════════════════════════════════════════════
//  MOBILE SIDEBAR
// ════════════════════════════════════════════════════════════

const sidebar  = document.getElementById('sidebar');
const mainWrap = document.getElementById('mainWrap');

let sidebarOverlay = document.querySelector('.sidebar-overlay');
if (!sidebarOverlay) {
  sidebarOverlay = document.createElement('div');
  sidebarOverlay.className = 'sidebar-overlay';
  document.body.appendChild(sidebarOverlay);
}

function isMobile() { return window.innerWidth <= 768; }
function openMobileSidebar()  { sidebar.classList.add('mobile-open');    sidebarOverlay.classList.add('active');    document.body.style.overflow = 'hidden'; }
function closeMobileSidebar() { sidebar.classList.remove('mobile-open'); sidebarOverlay.classList.remove('active'); document.body.style.overflow = ''; }

sidebarOverlay.addEventListener('click', closeMobileSidebar);

const sidebarToggle = document.getElementById('sidebarToggle');
if (sidebarToggle) {
  sidebarToggle.addEventListener('click', () => {
    if (isMobile()) {
      sidebar.classList.contains('mobile-open') ? closeMobileSidebar() : openMobileSidebar();
    } else {
      const collapsed = sidebar.classList.toggle('collapsed');
      mainWrap.classList.toggle('expanded', collapsed);
    }
  });
}
window.addEventListener('resize', () => { if (!isMobile()) { closeMobileSidebar(); document.body.style.overflow = ''; } });

// ════════════════════════════════════════════════════════════
//  NAVIGATION
// ════════════════════════════════════════════════════════════

function navigate(page) {
  // ปิด modal ทั้งหมดที่เปิดค้างอยู่ทุกครั้งที่เปลี่ยนหน้า
  document.querySelectorAll('.modal-overlay:not(.hidden)').forEach(m => m.classList.add('hidden'));

  document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
  const target = document.getElementById('page-' + page);
  if (target) target.classList.remove('hidden');

  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const activeNav = document.querySelector(`.nav-item[data-page="${page}"]`);
  if (activeNav) activeNav.classList.add('active');

  const bcPage = document.getElementById('bcPage');
  if (bcPage) {
    const labels = { dashboard:'Dashboard', mapping:'Mapping Manager', databases:'Database Registry', sessions:'Session Monitor', settings:'Settings', activity:'Update Activity', adminlogs:'Admin Logs' };
    bcPage.textContent = labels[page] || page;
  }
  if (page === 'activity') {
    fetchActivities();
  }
  if (page === 'settings') {
    _loadSettingsValues();
    loadSystemSettings();
    fetchMyRole().then(() => loadMaintenanceState());
  }
  if (page === 'adminlogs') {
    fetchMyRole().then(() => fetchAdminLogs());
  }
  if (isMobile()) closeMobileSidebar();
}

document.querySelectorAll('.nav-item[data-page]').forEach(item => {
  item.addEventListener('click', e => { e.preventDefault(); navigate(item.dataset.page); });
});

// ════════════════════════════════════════════════════════════
//  THEME TOGGLE
// ════════════════════════════════════════════════════════════

const themeToggle = document.getElementById('themeToggle');
if (themeToggle) {
  themeToggle.addEventListener('click', () => {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    applyTheme(isDark ? 'light' : 'dark');
  });
}

function toggleThemeFromSettings(checkbox) {
  applyTheme(checkbox.checked ? 'light' : 'dark');
}

document.querySelector('.nav-item[data-page="settings"]')?.addEventListener('click', () => {
  const theme = document.documentElement.getAttribute('data-theme') || 'dark';
  const cb = document.getElementById('settingsThemeToggle');
  if (cb) cb.checked = (theme === 'light');
});

// ════════════════════════════════════════════════════════════
//  AVATAR DROPDOWN
// ════════════════════════════════════════════════════════════

function toggleAvatarMenu() { document.getElementById('avatarDropdown')?.classList.toggle('hidden'); }
function closeAvatarMenu()  { document.getElementById('avatarDropdown')?.classList.add('hidden'); }
document.addEventListener('click', e => {
  const wrap = document.getElementById('avatarWrap');
  if (wrap && !wrap.contains(e.target)) closeAvatarMenu();
});

// ════════════════════════════════════════════════════════════
//  TOAST
// ════════════════════════════════════════════════════════════

const toastContainer = document.getElementById('toastContainer');
function showToast(message, type = 'info') {
  if (!toastContainer) return;
  const icons = { success:'✓', error:'✕', warn:'⚠', info:'ℹ' };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span class="toast-icon">${icons[type]||icons.info}</span><span class="toast-msg">${escapeHtml(message)}</span>`;
  toastContainer.appendChild(toast);
  setTimeout(() => { toast.classList.add('out'); setTimeout(() => toast.remove(), 220); }, 3000);
}

// ════════════════════════════════════════════════════════════
//  MODAL
// ════════════════════════════════════════════════════════════

function openModal(id) {
  // ปิด modal อื่นที่เปิดค้างอยู่ก่อนเสมอ เพื่อป้องกัน modal ซ้อนทับกัน
  document.querySelectorAll('.modal-overlay:not(.hidden)').forEach(m => {
    if (m.id !== id) m.classList.add('hidden');
  });
  const el = document.getElementById(id);
  if (el) el.classList.remove('hidden');
}
function closeModal(id) { const el = document.getElementById(id); if (el) el.classList.add('hidden'); }

document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.add('hidden'); });
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { document.querySelectorAll('.modal-overlay:not(.hidden)').forEach(m => m.classList.add('hidden')); closeAvatarMenu(); }
});

// ════════════════════════════════════════════════════════════
//  DASHBOARD
// ════════════════════════════════════════════════════════════

async function refreshDashboard() {
  try {
    const start = Date.now();
    const [health, dbsRes, mappingsRes, sessionsRes, logsRes] = await Promise.allSettled([
      apiCall('/api/health'),
      apiCall('/api/databases'),
      apiCall('/api/mappings'),
      apiCall('/api/sessions'),
      apiCall('/api/logs'),
    ]);
    const ping = Date.now() - start;

    const healthData = health.status === 'fulfilled' ? (health.value?.data || {}) : {};
    const healthOk   = health.status === 'fulfilled' && health.value?.success;
    const dbOk       = healthData.database !== false;

    const cardByLabel = {};
    document.querySelectorAll('.status-card').forEach(card => {
      const label = card.querySelector('.sc-label')?.textContent?.trim();
      if (label) cardByLabel[label] = card;
    });

    const apiCard = cardByLabel['Backend API'];
    if (apiCard) {
      apiCard.querySelector('.sc-val').textContent  = healthOk ? 'Online' : 'Error';
      apiCard.querySelector('.sc-ping').textContent = `${ping} ms`;
    }

    const dbCard = cardByLabel['Database API'] || cardByLabel['PostgreSQL'];
    if (dbCard) {
      dbCard.querySelector('.sc-val').textContent  = dbOk ? 'Connected' : 'Degraded';
      dbCard.querySelector('.sc-ping').textContent = dbOk ? `${Math.max(1, Math.round(ping * 0.4))} ms` : '—';
    }

    const statusDot   = document.querySelector('.status-dot');
    const statusLabel = document.querySelector('.status-label');
    if (statusDot)   statusDot.className    = `status-dot ${healthOk ? 'online' : 'offline'}`;
    if (statusLabel) statusLabel.textContent = healthOk ? 'System Online' : 'System Offline';

    const metrics    = document.querySelectorAll('.metric-card');
    const dbList     = dbsRes.status     === 'fulfilled' ? (dbsRes.value?.data     || []) : [];
    const mappingList = mappingsRes.status === 'fulfilled' ? (mappingsRes.value?.data || []) : [];

    if (metrics[0]) { metrics[0].querySelector('.metric-val').textContent = dbList.length || '-'; metrics[0].querySelector('.metric-sub').textContent = dbList.map(d => d.name).join(', ') || '-'; }
    if (metrics[1]) { metrics[1].querySelector('.metric-val').textContent = mappingList.length || '-'; metrics[1].querySelector('.metric-sub').textContent = `${mappingList.length} conversion rules`; }

    const sessionPayload = sessionsRes.status === 'fulfilled' ? (sessionsRes.value?.data || {}) : {};
    const sessionStats   = sessionPayload.stats    || { active: 0, warning: 0, expired: 0 };
    const sessionList    = sessionPayload.sessions || [];
    const today          = new Date().toISOString().slice(0, 10);
    const createdToday   = sessionList.filter(s => s.created?.startsWith(today)).length;
    const totalSessionRefs = sessionStats.active + sessionStats.warning + sessionStats.expired;
    const healthRate = totalSessionRefs ? Math.round((sessionStats.active / totalSessionRefs) * 100) : 100;
    const sessionCard = cardByLabel['Sessions'] || cardByLabel['Cache Store'];
    if (sessionCard) {
      sessionCard.querySelector('.sc-val').textContent  = sessionStats.warning ? 'Warning' : 'Normal';
      sessionCard.querySelector('.sc-ping').textContent = `${healthRate}% health`;
    }
    if (metrics[2]) { metrics[2].querySelector('.metric-val').textContent = sessionStats.active + sessionStats.warning; metrics[2].querySelector('.metric-sub').textContent = `${createdToday} created today`; }

    const logList          = logsRes.status === 'fulfilled' ? (logsRes.value?.data || []) : [];
    const conversionsToday = logList.filter(l => l.message?.includes('Convert') && l.timestamp?.startsWith(today)).length;
    const warningsToday    = logList.filter(l => l.level === 'WARNING' && l.timestamp?.startsWith(today)).length;
    const errorCountToday  = logList.filter(l => (l.level || '').toUpperCase() === 'ERROR' && l.timestamp?.startsWith(today)).length;
    const logActiveToday   = logList.filter(l => (l.timestamp || '').startsWith(today)).length;
    const healthPct        = Math.max(0, 100 - (errorCountToday * 5));
    const logCard = cardByLabel['Log Stream'];
    if (logCard) {
      logCard.querySelector('.sc-val').textContent  = logActiveToday ? 'Active' : 'Idle';
      logCard.querySelector('.sc-ping').textContent = `${healthPct}% health`;
    }
    if (metrics[3]) { metrics[3].querySelector('.metric-val').textContent = conversionsToday; metrics[3].querySelector('.metric-sub').textContent = warningsToday ? `⚠ ${warningsToday} warning(s) today` : 'No warnings today'; }

    const coverageList = document.getElementById('dbCoverageList');
    const coverageLegend = document.getElementById('dbCoverageLegend');
    if (coverageList && dbList.length && mappingList.length) {
      const pairCount = {};
      mappingList.forEach(m => { const key = (m.src_db || '').toLowerCase(); pairCount[key] = (pairCount[key] || 0) + 1; });
      const total = Math.max(...Object.values(pairCount), 1);
      const coverage = dbList.map(db => {
        const key = (db.key || db.name || '').toLowerCase();
        const pct = Math.round(((pairCount[key] || 0) / total) * 100);
        return { name: db.name || db.key || 'Unknown', pct };
      });
      coverageList.classList.add('circle-view');
      coverageList.innerHTML = coverage.map(c => {
        const ringClass = c.pct >= 80 ? 'high' : c.pct >= 40 ? 'mid' : 'low';
        return `<div class="db-cov-circle-item"><div class="db-cov-ring ${ringClass}" style="--pct:${c.pct}"><span>${escapeHtml(c.pct)}%</span></div><div class="db-cov-dbname">${escapeHtml(c.name)}</div></div>`;
      }).join('');
      if (coverageLegend) {
        coverageLegend.innerHTML = coverage.map(c => `<div class="db-legend-row"><span class="db-legend-dot"></span><span class="db-legend-name">${escapeHtml(c.name)}</span><span class="db-legend-pct">${escapeHtml(c.pct)}%</span></div>`).join('');
      }
    } else {
      if (coverageList) {
        coverageList.classList.remove('circle-view');
        coverageList.innerHTML = `<div style="text-align: center; padding: 20px; color: var(--text3);">No coverage data available</div>`;
      }
      if (coverageLegend) coverageLegend.innerHTML = '';
    }

    const activityFeed = document.getElementById('activityFeed');
    if (activityFeed && logList.length) {
      const recent = [...logList].reverse().slice(0, 8);
      activityFeed.innerHTML = recent.map(l => {
        const level    = (l.level || 'INFO').toUpperCase();
        const dotClass = level === 'WARNING' ? 'warn' : level === 'ERROR' ? 'error' : 'success';
        return `<div class="activity-item"><div class="activity-dot ${dotClass}"></div><div class="activity-body"><div class="activity-msg">${escapeHtml(l.message)}</div><div class="activity-time">${formatLocalDateTime(l.timestamp)}</div></div></div>`;
      }).join('');
    }

    showToast('Dashboard refreshed', 'success');
  } catch (e) {
    showToast('Refresh failed: ' + e.message, 'error');
  }
}

// ════════════════════════════════════════════════════════════
//  MAPPING MANAGER
// ════════════════════════════════════════════════════════════

let mappingData = [];
let mappingCurrentPage = 1;
const MAPPING_PAGE_SIZE = 8;
let selectedMappings = new Set();

function normMapping(m) {
  return {
    id:          m.id,
    srcDb:       m.src_db,
    sourceType:  m.source_type   || '',
    rawType:     m.raw_type,
    logicalType: m.logical_type,
    masterType:  m.master_type,
    destDb:      m.dest_db,
    finalType:   m.final_type,
    confidence:  m.confidence    ?? 100,
    status:      m.status,
    updated:     m.updated,
  };
}

async function fetchMappings() {
  try {
    const data = await apiCall('/api/mappings');
    mappingData = (data.data || []).map(normMapping);
    const badge = document.querySelector('.nav-item[data-page="mapping"] .nav-badge');
    if (badge) badge.textContent = mappingData.length;
    populateMappingFilters();
    renderMappingTable();
  } catch (e) { showToast('Failed to load mappings: ' + e.message, 'error'); }
}

function populateMappingFilters() {
  const srcDbs  = [...new Set(mappingData.map(m => m.srcDb).filter(Boolean))].sort();
  const destDbs = [...new Set(mappingData.map(m => m.destDb).filter(Boolean))].sort();
  const srcSel  = document.getElementById('filterSrcDb');
  const destSel = document.getElementById('filterDestDb');
  if (srcSel)  { const cur = srcSel.value;  srcSel.innerHTML  = '<option value="">All Source DBs</option>' + srcDbs.map(db  => `<option value="${db}"  ${db===cur?'selected':''}>${db}</option>`).join(''); }
  if (destSel) { const cur = destSel.value; destSel.innerHTML = '<option value="">All Dest DBs</option>'   + destDbs.map(db => `<option value="${db}" ${db===cur?'selected':''}>${db}</option>`).join(''); }
}

function getFilteredMappings() {
  const search = (document.getElementById('mappingSearch')?.value || '').toLowerCase();
  const srcDb  = document.getElementById('filterSrcDb')?.value  || '';
  const destDb = document.getElementById('filterDestDb')?.value || '';
  const status = document.getElementById('filterStatus')?.value || '';
  return mappingData.filter(m =>
    (!search || [m.srcDb,m.sourceType,m.rawType,m.logicalType,m.masterType,m.finalType].some(v => (v||'').toLowerCase().includes(search))) &&
    (!srcDb  || m.srcDb  === srcDb)  &&
    (!destDb || m.destDb === destDb) &&
    (!status || m.status === status)
  );
}

function renderMappingTable() {
  const filtered   = getFilteredMappings();
  const totalPages = Math.max(1, Math.ceil(filtered.length / MAPPING_PAGE_SIZE));
  if (mappingCurrentPage > totalPages) mappingCurrentPage = 1;
  const start = (mappingCurrentPage - 1) * MAPPING_PAGE_SIZE;
  const page  = filtered.slice(start, start + MAPPING_PAGE_SIZE);
  const tbody = document.getElementById('mappingBody');
  if (!tbody) return;
  if (!page.length) {
    tbody.innerHTML = `<tr><td colspan="13" style="text-align:center;padding:32px;color:var(--text3)">No mapping rules found</td></tr>`;
  } else {
    tbody.innerHTML = page.map(m => `
      <tr>
        <td class="th-check"><input type="checkbox" ${selectedMappings.has(m.id)?'checked':''} onchange="toggleSelect(${m.id},this.checked)" /></td>
        <td class="td-name">${escapeHtml(m.srcDb)}</td>
        <td style="font-family:var(--mono);font-size:11px;color:var(--text3)">${escapeHtml(m.sourceType)}</td>
        <td>${escapeHtml(m.rawType)}</td>
        <td>${escapeHtml(m.logicalType)}</td>
        <td>${escapeHtml(m.masterType)}</td>
        <td>${escapeHtml(m.destDb)}</td>
        <td>${escapeHtml(m.finalType)}</td>
        <td><div class="confidence-bar"><div class="conf-track"><div class="conf-fill" style="width:${m.confidence}%"></div></div><span class="conf-txt">${escapeHtml(m.confidence)}%</span></div></td>
        <td><span class="badge badge-${escapeHtml(m.status)}">${escapeHtml(m.status)}</span></td>
        <td>${formatActivityDate(m.updated)}</td>
        <td>${(_currentRole === 'admin' || _currentRole === 'editor') ? `<div class="row-actions"><button class="row-btn" title="Edit" onclick="editMapping(${m.id})">✎</button>${_currentRole === 'admin' ? `<button class="row-btn danger" title="Delete" onclick="deleteMapping(${m.id})">✕</button>` : ''}</div>` : ''}</td>
      </tr>`).join('');
  }
  const countEl = document.getElementById('mappingCount');
  if (countEl) countEl.textContent = `Showing ${filtered.length} rules`;
  renderMappingPagination(totalPages);
  updateBulkBar();
}

function renderMappingPagination(totalPages) {
  const pag = document.getElementById('mappingPagination');
  if (!pag) return;
  let html = `<button class="page-btn" onclick="goMappingPage(${mappingCurrentPage-1})" ${mappingCurrentPage===1?'disabled':''}>‹</button>`;
  for (let i = 1; i <= totalPages; i++) html += `<button class="page-btn ${i===mappingCurrentPage?'active':''}" onclick="goMappingPage(${i})">${i}</button>`;
  html += `<button class="page-btn" onclick="goMappingPage(${mappingCurrentPage+1})" ${mappingCurrentPage===totalPages?'disabled':''}>›</button>`;
  pag.innerHTML = html;
}

function goMappingPage(p) {
  const filtered   = getFilteredMappings();
  const totalPages = Math.max(1, Math.ceil(filtered.length / MAPPING_PAGE_SIZE));
  if (p < 1 || p > totalPages) return;
  mappingCurrentPage = p;
  renderMappingTable();
}

function filterMappings() { mappingCurrentPage = 1; selectedMappings.clear(); renderMappingTable(); }

function selectFilterOption(selectEl, candidates) {
  if (!selectEl) return false;
  const clean = value => String(value || '').trim().toLowerCase();
  const normalized = candidates.map(clean).filter(Boolean);
  const options = Array.from(selectEl.options);
  const match = options.find(opt => normalized.includes(clean(opt.value)) || normalized.includes(clean(opt.textContent)));
  if (!match) return false;
  selectEl.value = match.value;
  return true;
}

function escapeAttr(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function viewDatabaseRules(dbKey, dbName) {
  if (!mappingData.length) await fetchMappings();

  navigate('mapping');

  const searchInput = document.getElementById('mappingSearch');
  const srcSel      = document.getElementById('filterSrcDb');
  const destSel     = document.getElementById('filterDestDb');
  const statusSel   = document.getElementById('filterStatus');
  const candidates  = [dbKey, dbName];

  if (searchInput) searchInput.value = '';
  if (destSel) destSel.value = '';
  if (statusSel) statusSel.value = '';

  const found = selectFilterOption(srcSel, candidates);
  if (!found && srcSel) srcSel.value = '';

  filterMappings();
  document.querySelector('.page-content')?.scrollTo({ top: 0, behavior: 'smooth' });

  const count = getFilteredMappings().length;
  showToast(found ? `Showing ${count} rule(s) for ${dbName}` : `No source rules found for ${dbName}`, found ? 'info' : 'warn');
}

function toggleSelect(id, checked)  { checked ? selectedMappings.add(id) : selectedMappings.delete(id); updateBulkBar(); }
function toggleAll(checkbox) {
  const filtered = getFilteredMappings();
  const start    = (mappingCurrentPage - 1) * MAPPING_PAGE_SIZE;
  filtered.slice(start, start + MAPPING_PAGE_SIZE).forEach(m => { checkbox.checked ? selectedMappings.add(m.id) : selectedMappings.delete(m.id); });
  renderMappingTable();
}
function updateBulkBar() {
  const bar     = document.getElementById('tableBulk');
  const countEl = document.getElementById('bulkCount');
  if (!bar) return;
  const count = selectedMappings.size;
  bar.style.display = count > 0 ? 'flex' : 'none';
  if (countEl) countEl.textContent = `${count} selected`;
}

// ════════════════════════════════════════════════════════════
//  SEARCHABLE SELECT
// ════════════════════════════════════════════════════════════

let _ssOptions = {};
let _ssActive  = null;

function _ssCloseAll(exceptId) {
  document.querySelectorAll('.ss-list').forEach(el => {
    if (el.dataset.ssId !== exceptId) {
      el.classList.add('hidden');
    }
  });
  if (_ssActive && _ssActive !== exceptId) _ssActive = null;
}

document.addEventListener('mousedown', (e) => {
  if (!e.target.closest('.searchable-select-wrap')) {
    _ssCloseAll(null);
    _ssActive = null;
  }
});

function _ssBuildList(id) {
  const wrap = document.querySelector(`.searchable-select-wrap[data-ss="${id}"]`);
  if (!wrap) return null;
  let list = wrap.querySelector('.ss-list');
  if (!list) {
    list = document.createElement('ul');
    list.className = 'ss-list hidden';
    list.dataset.ssId = id;
    wrap.appendChild(list);
  }
  return list;
}

function _ssRenderList(id, opts) {
  const list = _ssBuildList(id);
  if (!list) return;
  if (!opts || opts.length === 0) {
    list.innerHTML = '<li class="ss-empty">No results</li>';
    return;
  }
  list.innerHTML = opts.map(o =>
    `<li class="ss-item" data-value="${o.value}">${o.label}</li>`
  ).join('');
  list.querySelectorAll('.ss-item').forEach(li => {
    li.addEventListener('mousedown', (e) => {
      e.preventDefault();
      _ssPick(id, li.dataset.value);
    });
  });
}

function _ssPick(id, value) {
  const opts   = _ssOptions[id] || [];
  const match  = opts.find(o => o.value === value);
  const input  = document.getElementById(id + 'Search');
  const hidden = document.getElementById(id + 'Val');
  if (input)  input.value  = match ? match.label : value;
  if (hidden) hidden.value = value;
  _ssCloseAll(null);
  _ssActive = null;
  clearFieldError(id);
}

function _ssSetup(id, options) {
  _ssOptions[id] = options;
  const sel = document.getElementById(id);
  if (sel) {
    sel.innerHTML = options.map(o =>
      `<option value="${o.value}">${o.label}</option>`
    ).join('');
  }
  _ssRenderList(id, options);
}

function filterSearchableSelect(id, query) {
  const q    = (query || '').toLowerCase();
  const opts = (_ssOptions[id] || []).filter(o =>
    !q || o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q)
  );
  _ssRenderList(id, opts);

  const list = _ssBuildList(id);
  if (list) {
    list.classList.remove('hidden');
    _ssActive = id;
  }

  if (!query) {
    const hidden = document.getElementById(id + 'Val');
    if (hidden) hidden.value = '';
  }
}

function openSearchableSelect(id) {
  _ssCloseAll(id);
  const query = (document.getElementById(id + 'Search') || {}).value || '';
  const q     = query.toLowerCase();
  const opts  = (_ssOptions[id] || []).filter(o =>
    !q || o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q)
  );
  _ssRenderList(id, opts);
  const list = _ssBuildList(id);
  if (list) {
    list.classList.remove('hidden');
    _ssActive = id;
  }
}

function pickSearchableSelect(id) {
  const sel = document.getElementById(id);
  if (sel && sel.value) _ssPick(id, sel.value);
}

function commitSearchableSelect(id) {
  setTimeout(() => {
    const list   = _ssBuildList(id);
    if (list) list.classList.add('hidden');
    const input  = document.getElementById(id + 'Search');
    const hidden = document.getElementById(id + 'Val');
    if (!input || !hidden) return;
    if (hidden.value) return;
    const q = input.value.trim().toLowerCase();
    if (q) {
      const match = (_ssOptions[id] || []).find(o =>
        o.label.toLowerCase() === q || o.value.toLowerCase() === q
      );
      if (match) {
        hidden.value = match.value;
        input.value  = match.label;
        clearFieldError(id);
      }
    }
    if (_ssActive === id) _ssActive = null;
  }, 200);
}

function setSearchableSelectValue(id, value) {
  const opts  = _ssOptions[id] || [];
  const match = opts.find(o => o.value === value);
  const input  = document.getElementById(id + 'Search');
  const hidden = document.getElementById(id + 'Val');
  if (input)  input.value  = match ? match.label : value;
  if (hidden) hidden.value = value;
}

function getSearchableSelectValue(id) {
  const hidden = document.getElementById(id + 'Val');
  return hidden ? hidden.value.trim() : '';
}

// ════════════════════════════════════════════════════════════
//  MAPPING FORM — load dropdown options from API
// ════════════════════════════════════════════════════════════

let _mappingFormOptionsLoaded = false;

async function loadMappingFormOptions(force = false) {
  if (_mappingFormOptionsLoaded && !force) return;
  const loadingEl  = document.getElementById('mFormLoadingState');
  const errorEl    = document.getElementById('mFormErrorState');
  const fieldsEl   = document.getElementById('mFormFields');
  if (loadingEl) loadingEl.classList.remove('hidden');
  if (errorEl)   errorEl.classList.add('hidden');
  if (fieldsEl)  fieldsEl.style.opacity = '0.4';
  try {
    const [dbRes, typeRes] = await Promise.all([
      apiCall('/api/database-records/enabled?limit=200'),
      apiCall('/api/datatype-standard/list?limit=200'),
    ]);
    const dbOptions   = (dbRes.data   || []).map(d => ({ value: d.key,           label: d.key }));
    const typeOptions = (typeRes.data || []).map(t => ({ value: t.standard_type, label: t.standard_type }));
    _ssSetup('mSrcDb',      dbOptions);
    _ssSetup('mDestDb',     dbOptions);
    _ssSetup('mMasterType', typeOptions);
    _mappingFormOptionsLoaded = true;
  } catch (e) {
    if (errorEl) {
      errorEl.classList.remove('hidden');
      const errText = document.getElementById('mFormErrorText');
      if (errText) errText.textContent = 'Failed to load options: ' + e.message;
    }
  } finally {
    if (loadingEl) loadingEl.classList.add('hidden');
    if (fieldsEl)  fieldsEl.style.opacity = '';
  }
}

function setFieldError(id, msg) {
  const input = document.getElementById(id) || document.getElementById(id + 'Search');
  const errEl = document.getElementById(id + 'Err');
  if (input) input.classList.add('input-error');
  if (errEl) { errEl.textContent = msg || ''; errEl.classList.remove('hidden'); }
}

function clearFieldError(id) {
  const input = document.getElementById(id) || document.getElementById(id + 'Search');
  const errEl = document.getElementById(id + 'Err');
  if (input) { input.classList.remove('input-error'); input.classList.add('input-ok'); }
  if (errEl) errEl.classList.add('hidden');
}

function validateMappingField(id) {
  const el  = document.getElementById(id);
  const val = el ? el.value.trim() : '';
  if (!val) setFieldError(id, 'This field is required');
  else      clearFieldError(id);
  return !!val;
}

function _validateMappingForm() {
  let ok = true;
  const srcDb  = getSearchableSelectValue('mSrcDb');
  const destDb = getSearchableSelectValue('mDestDb');
  const master = getSearchableSelectValue('mMasterType');

  if (!srcDb)  { setFieldError('mSrcDb',      'Source DB is required');       ok = false; }
  else           clearFieldError('mSrcDb');
  if (!destDb) { setFieldError('mDestDb',     'Destination DB is required');  ok = false; }
  else           clearFieldError('mDestDb');
  if (!master) { setFieldError('mMasterType', 'Master Type is required');     ok = false; }
  else           clearFieldError('mMasterType');

  ['mSourceType', 'mRawType', 'mLogicalType', 'mFinalType'].forEach(id => {
    if (!validateMappingField(id)) ok = false;
  });

  return ok;
}

function editMapping(id) {
  const m = mappingData.find(r => r.id === id);
  if (!m) return;
  loadMappingFormOptions().then(() => {
    setSearchableSelectValue('mSrcDb',      m.srcDb);
    setSearchableSelectValue('mDestDb',     m.destDb);
    setSearchableSelectValue('mMasterType', m.masterType);

    const sourceTypeEl = document.getElementById('mSourceType');
    const rawTypeEl    = document.getElementById('mRawType');
    const logicalEl    = document.getElementById('mLogicalType');
    const finalTypeEl  = document.getElementById('mFinalType');
    const confidenceEl = document.getElementById('mConfidence');
    const statusEl     = document.getElementById('mStatus');

    if (sourceTypeEl) sourceTypeEl.value = m.sourceType;
    if (rawTypeEl)    rawTypeEl.value    = m.rawType;
    if (logicalEl)    logicalEl.value    = m.logicalType;
    if (finalTypeEl)  finalTypeEl.value  = m.finalType;
    if (confidenceEl) confidenceEl.value = m.confidence;
    _syncStatusPill(m.status || 'pending');

    ['mSrcDb', 'mDestDb', 'mMasterType', 'mSourceType', 'mRawType', 'mLogicalType', 'mFinalType']
      .forEach(clearFieldError);
  });
  document.getElementById('mappingModalTitle').textContent = 'Edit Mapping Rule';
  document.getElementById('mappingModal').dataset.editId = id;
  openModal('mappingModal');
}

function deleteMapping(id) {
  const m = mappingData.find(r => r.id === id);
  if (!m) return;
  document.getElementById('deleteWarnText').textContent = `Delete mapping "${m.rawType} → ${m.finalType}"? This cannot be undone.`;
  const _delBtn = document.getElementById('deleteConfirmBtn');
  if (_delBtn) _delBtn.textContent = 'Delete';
  if (_delBtn) _delBtn.onclick = async () => {
    try { await apiCall(`/api/mappings/${id}`, { method: 'DELETE' }); selectedMappings.delete(id); showToast('Mapping rule deleted', 'info'); closeModal('deleteModal'); await fetchMappings(); }
    catch (e) { showToast('Delete failed: ' + e.message, 'error'); }
  };
  openModal('deleteModal');
}

function bulkDelete() {
  if (!selectedMappings.size) return;
  document.getElementById('deleteWarnText').textContent = `Delete ${selectedMappings.size} selected mapping(s)? This cannot be undone.`;
  const _bulkDelBtn = document.getElementById('deleteConfirmBtn');
  if (_bulkDelBtn) _bulkDelBtn.textContent = 'Delete';
  if (_bulkDelBtn) _bulkDelBtn.onclick = async () => {
    try {
      await Promise.all([...selectedMappings].map(id => apiCall(`/api/mappings/${id}`, { method: 'DELETE' })));
      selectedMappings.clear(); showToast('Selected mappings deleted', 'info'); closeModal('deleteModal'); await fetchMappings();
    } catch (e) { showToast('Bulk delete failed: ' + e.message, 'error'); }
  };
  openModal('deleteModal');
}

function bulkApprove() {
  if (!selectedMappings.size) return;
  Promise.all([...selectedMappings].map(id => apiCall(`/api/mappings/${id}`, { method:'PUT', body:JSON.stringify({ status:'active' }) })))
    .then(() => { showToast(`${selectedMappings.size} mapping(s) set to active`, 'success'); selectedMappings.clear(); fetchMappings(); })
    .catch(e => showToast('Approve failed: ' + e.message, 'error'));
}

function selectStatusPill(btn) {
  document.querySelectorAll('#mStatusPills .status-pill, #mFormFields .status-pill').forEach(b => b.classList.remove('active-pill'));
  btn.classList.add('active-pill');
  document.getElementById('mStatus').value = btn.dataset.val;
}

function _syncStatusPill(val) {
  document.querySelectorAll('#mFormFields .status-pill').forEach(b => {
    b.classList.toggle('active-pill', b.dataset.val === val);
  });
  const el = document.getElementById('mStatus');
  if (el) el.value = val;
}

function openAddMapping() {
  document.getElementById('mappingModalTitle').textContent = 'Add Mapping Rule';

  ['mSrcDb', 'mDestDb', 'mMasterType'].forEach(id => {
    const inp  = document.getElementById(id + 'Search');
    const hid  = document.getElementById(id + 'Val');
    if (inp) inp.value = '';
    if (hid) hid.value = '';
    clearFieldError(id);
    const wrap = document.querySelector(`.searchable-select-wrap[data-ss="${id}"]`);
    if (wrap) { const list = wrap.querySelector('.ss-list'); if (list) list.classList.add('hidden'); }
  });

  ['mSourceType', 'mRawType', 'mLogicalType', 'mFinalType'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.value = ''; el.classList.remove('input-error', 'input-ok'); }
    clearFieldError(id);
  });

  const confEl = document.getElementById('mConfidence');
  if (confEl) confEl.value = 100;
  _syncStatusPill('pending');

  delete document.getElementById('mappingModal').dataset.editId;
  loadMappingFormOptions();
  openModal('mappingModal');
}

async function saveMapping() {
  if (!_validateMappingForm()) {
    showToast('Please fix the errors before saving', 'error');
    return;
  }
  const saveBtn = document.getElementById('mSaveBtn');
  if (saveBtn) { saveBtn.classList.add('btn-loading'); saveBtn.textContent = 'Saving…'; }

  const payload = {
    src_db:       getSearchableSelectValue('mSrcDb'),
    source_type:  document.getElementById('mSourceType').value.trim(),
    raw_type:     document.getElementById('mRawType').value.trim(),
    logical_type: document.getElementById('mLogicalType').value.trim(),
    master_type:  getSearchableSelectValue('mMasterType'),
    dest_db:      getSearchableSelectValue('mDestDb'),
    final_type:   document.getElementById('mFinalType').value.trim(),
    confidence:   Number(document.getElementById('mConfidence')?.value ?? 100),
    status:       document.getElementById('mStatus')?.value || 'pending',
  };

  const editId = document.getElementById('mappingModal').dataset.editId;
  try {
    if (editId) {
      await apiCall(`/api/mappings/${editId}`, { method: 'PUT', body: JSON.stringify(payload) });
      showToast('Mapping rule updated', 'success');
    } else {
      await apiCall('/api/mappings', { method: 'POST', body: JSON.stringify(payload) });
      showToast('Mapping rule saved', 'success');
    }
    closeModal('mappingModal');
    await fetchMappings();
  } catch (e) {
    let msg = e.message;
    try { const parsed = JSON.parse(e.message); msg = parsed.message || msg; } catch {}
    showToast('Save failed: ' + msg, 'error');
  } finally {
    if (saveBtn) { saveBtn.classList.remove('btn-loading'); saveBtn.textContent = 'Save Rule'; }
  }
}

// ════════════════════════════════════════════════════════════
//  BULK IMPORT  (xlsx / JSON → Mapping Rules)
// ════════════════════════════════════════════════════════════

const IMPORT_REQUIRED_COLS = ['src_db', 'raw_type', 'dest_db'];
const IMPORT_ALL_COLS      = ['src_db','raw_type','source_type','logical_type','master_type','dest_db','final_type','confidence','status'];
let   _importRows          = [];
let   _importHasErrors     = false;

function openBulkImport() {
  importReset();
  openModal('importModal');
}

function importReset() {
  _importRows      = [];
  _importHasErrors = false;

  document.getElementById('importStep1').classList.remove('hidden');
  document.getElementById('importStep2').classList.add('hidden');
  document.getElementById('importStep3').classList.add('hidden');
  document.getElementById('importRunBtn').classList.add('hidden');

  const fi = document.getElementById('importFileInput');
  if (fi) fi.value = '';

  document.getElementById('importPreviewHead').innerHTML = '';
  document.getElementById('importPreviewBody').innerHTML = '';
  document.getElementById('importPreviewMeta').textContent = '';
  document.getElementById('importValidationErrors').classList.add('hidden');
  document.getElementById('importValidationErrors').innerHTML = '';

  document.getElementById('importProgressBar').style.width = '0%';
  document.getElementById('importProgressCount').textContent = '0 / 0';
  document.getElementById('importProgressLabel').textContent = 'Importing…';
  document.getElementById('importResultLog').innerHTML = '';
}

// ── Drag & drop ──────────────────────────────────────────────────────────────

function importDragOver(e) {
  e.preventDefault();
  document.getElementById('importDropzone').classList.add('drag-over');
}
function importDragLeave(e) {
  document.getElementById('importDropzone').classList.remove('drag-over');
}
function importDrop(e) {
  e.preventDefault();
  document.getElementById('importDropzone').classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) _importHandleFile(file);
}
function importFileSelected(input) {
  if (input.files[0]) _importHandleFile(input.files[0]);
}

// ── File reading & parsing ────────────────────────────────────────────────────

function _importHandleFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (!['xlsx', 'json'].includes(ext)) {
    showToast('Only xlsx and JSON files are supported', 'error');
    return;
  }

  const reader = new FileReader();

  if (ext === 'xlsx') {
    // ✅ อ่านเป็น ArrayBuffer สำหรับ xlsx จริง
    reader.onload = (e) => {
      try {
        if (typeof XLSX === 'undefined') {
          showToast('SheetJS library not loaded — please refresh the page', 'error');
          return;
        }
        const wb   = XLSX.read(e.target.result, { type: 'array' });
        const ws   = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
        // normalize keys เป็น lowercase + trim
        const normalized = rows.map(r => {
          const out = {};
          Object.keys(r).forEach(k => {
            out[k.trim().toLowerCase()] = String(r[k] ?? '');
          });
          return out;
        });
        _importShowPreview(normalized, file.name);
      } catch (err) {
        showToast('Failed to parse xlsx: ' + err.message, 'error');
      }
    };
    reader.readAsArrayBuffer(file);
  } else {
    // JSON — อ่านเป็น text เหมือนเดิม
    reader.onload = (e) => {
      try {
        const rows = _parseJSON(e.target.result);
        _importShowPreview(rows, file.name);
      } catch (err) {
        showToast('Failed to parse file: ' + err.message, 'error');
      }
    };
    reader.readAsText(file, 'utf-8');
  }
}

function _parseJSON(text) {
  const data = JSON.parse(text);
  if (!Array.isArray(data)) throw new Error('JSON must be an array of objects');
  return data.map(item => {
    const row = {};
    IMPORT_ALL_COLS.forEach(col => { row[col] = item[col] !== undefined ? String(item[col]) : ''; });
    return row;
  });
}

// ── Preview & validation ──────────────────────────────────────────────────────

function _importShowPreview(rows, filename) {
  _importRows      = rows;
  _importHasErrors = false;

  const errors     = [];
  const errorRows  = new Set();

  rows.forEach((row, i) => {
    IMPORT_REQUIRED_COLS.forEach(col => {
      if (!row[col] || !String(row[col]).trim()) {
        errors.push(`Row ${i + 1}: missing required field "${col}"`);
        errorRows.add(i);
        _importHasErrors = true;
      }
    });
    const conf = row.confidence;
    if (conf !== undefined && conf !== '') {
      const n = Number(conf);
      if (isNaN(n) || n < 0 || n > 100) {
        errors.push(`Row ${i + 1}: "confidence" must be 0–100`);
        errorRows.add(i);
        _importHasErrors = true;
      }
    }
  });

  document.getElementById('importStep1').classList.add('hidden');
  document.getElementById('importStep2').classList.remove('hidden');

  const metaEl = document.getElementById('importPreviewMeta');
  metaEl.innerHTML = `<strong>${escapeHtml(filename)}</strong> — ${rows.length} row(s)` +
    (_importHasErrors ? ` <span style="color:#ef4444">⚠ ${errors.length} error(s)</span>` : ' <span style="color:#22c55e">✓ Valid</span>');

  const cols    = IMPORT_ALL_COLS.filter(c => rows.some(r => r[c]));
  const headEl  = document.getElementById('importPreviewHead');
  const bodyEl  = document.getElementById('importPreviewBody');

  headEl.innerHTML = '<tr>' + cols.map(c => `<th>${escapeHtml(c)}</th>`).join('') + '</tr>';

  const displayRows = rows.slice(0, 50);
  bodyEl.innerHTML = displayRows.map((row, i) =>
    `<tr class="${errorRows.has(i) ? 'row-error' : ''}">` +
    cols.map(c => `<td title="${escapeHtml(row[c]||'')}">${row[c] ? escapeHtml(row[c]) : '<span style="color:var(--text3)">—</span>'}</td>`).join('') +
    '</tr>'
  ).join('');

  if (rows.length > 50) {
    bodyEl.innerHTML += `<tr><td colspan="${cols.length}" style="color:var(--text3);text-align:center;padding:8px">… and ${rows.length - 50} more rows</td></tr>`;
  }

  const errEl = document.getElementById('importValidationErrors');
  if (errors.length > 0) {
    errEl.classList.remove('hidden');
    errEl.innerHTML = '<ul>' + errors.slice(0, 10).map(e => `<li>${escapeHtml(e)}</li>`).join('') +
      (errors.length > 10 ? `<li>…and ${errors.length - 10} more</li>` : '') + '</ul>';
  } else {
    errEl.classList.add('hidden');
  }

  const runBtn = document.getElementById('importRunBtn');
  if (_importHasErrors) {
    runBtn.classList.add('hidden');
  } else {
    runBtn.classList.remove('hidden');
    runBtn.textContent = `Import ${rows.length} Row(s)`;
    runBtn.disabled = false;
  }
}

// ── Run import ────────────────────────────────────────────────────────────────

async function runBulkImport() {
  if (!_importRows.length) return;

  const runBtn = document.getElementById('importRunBtn');
  runBtn.disabled = true;

  document.getElementById('importStep2').classList.add('hidden');
  document.getElementById('importStep3').classList.remove('hidden');

  const total    = _importRows.length;
  const logEl    = document.getElementById('importResultLog');
  const barEl    = document.getElementById('importProgressBar');
  const countEl  = document.getElementById('importProgressCount');
  const labelEl  = document.getElementById('importProgressLabel');

  barEl.style.width = '10%';
  labelEl.textContent = `กำลัง import ${total} rows…`;

  const rows = _importRows.map(row => ({
    src_db:       row.src_db      || '',
    raw_type:     row.raw_type    || '',
    source_type:  row.source_type || '',
    logical_type: row.logical_type|| '',
    master_type:  row.master_type || '',
    dest_db:      row.dest_db     || '',
    final_type:   row.final_type  || '',
    confidence:   row.confidence !== '' ? Number(row.confidence) : 100,
    status:       row.status      || 'draft',
  }));

  let ok = 0, skipped = 0, failed = 0;

  try {
    const res = await apiCall('/api/mappings/bulk-import', {
      method: 'POST',
      body: JSON.stringify({ rows, skip_duplicates: true }),
    });
    const m = res.data || {};
    ok      = m.imported ?? 0;
    skipped = m.skipped  ?? 0;
    failed  = m.failed   ?? 0;
    barEl.style.width = '100%';
    countEl.textContent = `${total} / ${total}`;
    labelEl.textContent = `Done! ${ok} imported, ${skipped} skipped, ${failed} failed`;
    labelEl.style.color = failed > 0 ? 'var(--danger,#ef4444)' : ok > 0 ? '#22c55e' : 'var(--text2)';

    const summary = document.createElement('div');
    summary.className = 'log-line log-ok';
    summary.textContent = `✓ Bulk import — imported: ${ok}, skipped: ${skipped}, failed: ${failed}`;
    logEl.appendChild(summary);
    (m.errors || []).slice(0, 20).forEach(err => {
      const line = document.createElement('div');
      line.className = 'log-line log-err';
      line.textContent = `✗ ${err}`;
      logEl.appendChild(line);
    });
    showToast(`Import complete: ${ok} added, ${skipped} skipped, ${failed} failed`, failed > 0 ? 'warn' : 'success');
    await fetchMappings();
  } catch (err) {
    barEl.style.width = '100%';
    labelEl.textContent = 'Import failed';
    labelEl.style.color = 'var(--danger,#ef4444)';
    const line = document.createElement('div');
    line.className = 'log-line log-err';
    line.textContent = `✗ ${err.message}`;
    logEl.appendChild(line);
    showToast('Import failed: ' + err.message, 'error');
  }

  runBtn.textContent = 'Close';
  runBtn.disabled    = false;
  runBtn.classList.remove('hidden');
  runBtn.onclick     = () => closeModal('importModal');
}

// ── Template download ─────────────────────────────────────────────────────────

function downloadImportTemplate(type) {
  const sample = [
    { src_db:'postgres', raw_type:'varchar', source_type:'string', logical_type:'string', master_type:'STRING', dest_db:'kafka', final_type:'string', confidence:100, status:'active' },
    { src_db:'mysql',    raw_type:'int',     source_type:'int',    logical_type:'integer',master_type:'INTEGER',dest_db:'kafka', final_type:'int',    confidence:100, status:'active' },
  ];

  if (type === 'xlsx') {
    // ✅ สร้าง xlsx จริงด้วย SheetJS
    if (typeof XLSX === 'undefined') {
      showToast('SheetJS library not loaded — please refresh the page', 'error');
      return;
    }

    // สร้าง rows ตาม column order ที่กำหนด
    const sheetData = sample.map(r => {
      const row = {};
      IMPORT_ALL_COLS.forEach(c => { row[c] = r[c] ?? ''; });
      return row;
    });

    const ws = XLSX.utils.json_to_sheet(sheetData, { header: IMPORT_ALL_COLS });

    // กำหนด column width ให้อ่านง่าย
    ws['!cols'] = IMPORT_ALL_COLS.map(c => ({ wch: Math.max(c.length + 4, 14) }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Mappings');
    XLSX.writeFile(wb, 'mapping_import_template.xlsx');
    return;
  }

  // JSON template
  const content  = JSON.stringify(sample, null, 2);
  const blob     = new Blob([content], { type: 'application/json' });
  const a        = document.createElement('a');
  a.href         = URL.createObjectURL(blob);
  a.download     = 'mapping_import_template.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

// ════════════════════════════════════════════════════════════
//  DATABASE REGISTRY
// ════════════════════════════════════════════════════════════

let dbData = [];
const DB_ICONS = { sqlserver:'🗄', postgresql:'🐘', mysql:'🐬', oracle:'🔴', confluent:'⚡', default:'🗄' };

async function fetchDatabases() {
  try {
    const data = await apiCall('/api/databases');
    dbData = data.data || [];
    renderDatabases();
  } catch (e) {
    dbData = [];
    renderDatabaseError(e);
    showToast('Failed to load databases: ' + e.message, 'error');
  }
}

function renderDatabases() {
  const grid = document.getElementById('dbGrid');
  if (!grid) return;
  if (!dbData.length) { grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text3);border:1px dashed var(--border2);border-radius:var(--radius);">No databases configured</div>`; return; }
  grid.innerHTML = dbData.map(db => {
    const icon = DB_ICONS[db.key] || DB_ICONS.default;
    return `
    <div class="db-card">
      <div class="db-card-header">
        <div class="db-card-info">
          <div class="db-logo">${icon}</div>
          <div><div class="db-card-name">${escapeHtml(db.name)}</div><div class="db-card-key">${escapeHtml(db.key)}${db.version?' · '+escapeHtml(db.version):''}</div></div>
        </div>
        <label class="toggle-switch"><input type="checkbox" ${db.enabled?'checked':''} onchange="toggleDatabase(${db.id},this.checked)" /><span class="toggle-track"></span></label>
      </div>
      <div class="db-card-stats">
        <div class="db-stat"><div class="db-stat-label">Mapping Rules</div><div class="db-stat-val">${db.rules}</div></div>
        <div class="db-stat"><div class="db-stat-label">Active Sessions</div><div class="db-stat-val">${db.sessions}</div></div>
      </div>
      <div class="db-card-actions">
        <button class="btn btn-sm btn-ghost" data-db-key="${escapeAttr(db.key)}" data-db-name="${escapeAttr(db.name)}" onclick="viewDatabaseRules(this.dataset.dbKey, this.dataset.dbName)">View Rules</button>
        <button class="btn btn-sm btn-ghost" onclick="editDatabase(${db.id})">Edit</button>
        <button class="btn btn-sm btn-danger" onclick="confirmDeleteDatabase(${db.id})">Delete</button>
      </div>
    </div>`;
  }).join('');
}

function renderDatabaseError(error) {
  const grid = document.getElementById('dbGrid');
  if (!grid) return;
  const detail = error?.message || 'Unknown error';
  const pageOrigin = window.location.origin || 'file://';
  grid.innerHTML = `
    <div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text3);border:1px dashed var(--border2);border-radius:var(--radius);">
      <div style="font-weight:600;color:var(--text);margin-bottom:8px">Unable to load databases</div>
      <div style="margin-bottom:16px">${escapeHtml(detail)}</div>
      <div style="font-family:var(--mono);font-size:11px;line-height:1.6;margin-bottom:16px;color:var(--text3)">
        API: ${escapeHtml(API_URL)}<br />
        Page: ${escapeHtml(pageOrigin)}
      </div>
      <button class="btn btn-primary" onclick="fetchDatabases()">Retry</button>
    </div>`;
}

async function toggleDatabase(id, enabled) {
  const db = dbData.find(d => d.id === id);
  if (!db) return;
  try { await apiCall(`/api/databases/${id}`, { method:'PUT', body:JSON.stringify({ enabled }) }); db.enabled = enabled; showToast(`${db.name} ${enabled?'enabled':'disabled'}`, enabled?'success':'warn'); }
  catch (e) { showToast('Update failed: ' + e.message, 'error'); renderDatabases(); }
}

function editDatabase(id) {
  const db = dbData.find(d => d.id === id);
  if (!db) return;
  ['dbName','dbLabel','dbVersion'].forEach(fid => {
    const el = document.getElementById(fid);
    if (el) el.classList.remove('input-error', 'input-ok');
  });
  ['dbNameErr','dbLabelErr'].forEach(fid => {
    const el = document.getElementById(fid);
    if (el) el.classList.add('hidden');
  });
  const preview = document.getElementById('dbKeyPreview');
  if (preview) preview.style.display = 'none';
  document.getElementById('dbName').value    = db.key;
  document.getElementById('dbLabel').value   = db.name;
  document.getElementById('dbVersion').value = db.version || '';
  document.getElementById('dbStatus').value  = db.status || 'active';
  document.getElementById('dbModalTitle').textContent = 'Edit Database';
  document.getElementById('dbModal').dataset.editId = id;
  const saveBtn = document.querySelector('#dbModal .btn-primary');
  if (saveBtn) saveBtn.textContent = 'Save Changes';
  openModal('dbModal');
}

function confirmDeleteDatabase(id) {
  const db = dbData.find(d => d.id === id);
  if (!db) return;
  document.getElementById('deleteWarnText').textContent = `Delete "${db.name}"? All associated mapping rules (${db.rules}) will also be removed.`;
  const _dbDelBtn = document.getElementById('deleteConfirmBtn');
  if (_dbDelBtn) _dbDelBtn.textContent = 'Delete';
  if (_dbDelBtn) _dbDelBtn.onclick = async () => {
    try { await apiCall(`/api/databases/${id}`, { method:'DELETE' }); showToast(`${db.name} removed`, 'warn'); closeModal('deleteModal'); await fetchDatabases(); }
    catch (e) { showToast('Delete failed: ' + e.message, 'error'); }
  };
  openModal('deleteModal');
}

// ════════════════════════════════════════════════════════════
//  DATABASE KEY SANITIZE
// ════════════════════════════════════════════════════════════
function sanitizeDbKey(raw) {
  return (raw || '').trim().toLowerCase().replace(/\s+/g, '');
}

const _DB_KEY_RE = /^[a-z0-9_]+$/;

function onDbKeyInput(input) {
  const raw       = input.value;
  const sanitized = sanitizeDbKey(raw);
  const preview    = document.getElementById('dbKeyPreview');
  const previewVal = document.getElementById('dbKeyPreviewVal');
  if (sanitized && sanitized !== raw.trim().toLowerCase()) {
    if (preview)    preview.style.display = '';
    if (previewVal) previewVal.textContent = sanitized;
  } else {
    if (preview) preview.style.display = 'none';
  }
  const errEl = document.getElementById('dbNameErr');
  if (!sanitized) {
    input.classList.add('input-error');
    input.classList.remove('input-ok');
    if (errEl) errEl.classList.remove('hidden');
  } else if (!_DB_KEY_RE.test(sanitized)) {
    input.classList.add('input-error');
    input.classList.remove('input-ok');
    if (errEl) { errEl.textContent = 'Only a–z, 0–9, _ allowed'; errEl.classList.remove('hidden'); }
  } else {
    input.classList.remove('input-error');
    input.classList.add('input-ok');
    if (errEl) errEl.classList.add('hidden');
  }
}

function validateDbField(id) {
  const el  = document.getElementById(id);
  const errEl = document.getElementById(id + 'Err');
  const val = el ? el.value.trim() : '';
  if (!val) {
    if (el) { el.classList.add('input-error'); el.classList.remove('input-ok'); }
    if (errEl) errEl.classList.remove('hidden');
    return false;
  }
  if (el) { el.classList.remove('input-error'); el.classList.add('input-ok'); }
  if (errEl) errEl.classList.add('hidden');
  return true;
}

function openAddDatabase() {
  ['dbName','dbLabel','dbVersion'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.value = ''; el.classList.remove('input-error', 'input-ok'); }
  });
  ['dbNameErr','dbLabelErr'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });
  const preview = document.getElementById('dbKeyPreview');
  if (preview) preview.style.display = 'none';
  document.getElementById('dbModalTitle').textContent = 'Add Database';
  delete document.getElementById('dbModal').dataset.editId;
  // reset save button text ทุกครั้งที่เปิด Add
  const saveBtn = document.querySelector('#dbModal .btn-primary');
  if (saveBtn) saveBtn.textContent = 'Add Database';
  openModal('dbModal');
}

async function saveDatabase() {
  const rawKey  = document.getElementById('dbName')?.value || '';
  const key     = sanitizeDbKey(rawKey);
  const name    = document.getElementById('dbLabel')?.value.trim();
  const version = document.getElementById('dbVersion')?.value.trim();
  const status  = document.getElementById('dbStatus')?.value || 'active';

  let ok = true;
  if (!key || !_DB_KEY_RE.test(key)) {
    const errEl = document.getElementById('dbNameErr');
    const input = document.getElementById('dbName');
    if (input) input.classList.add('input-error');
    if (errEl) { errEl.textContent = 'Key must use only a–z, 0–9, _'; errEl.classList.remove('hidden'); }
    ok = false;
  }
  if (!validateDbField('dbLabel')) ok = false;
  if (!ok) { showToast('Please fix the errors before saving', 'error'); return; }

  const saveBtn = document.querySelector('#dbModal .btn-primary');
  if (saveBtn) { saveBtn.classList.add('btn-loading'); saveBtn.textContent = 'Saving…'; }
  const editId = document.getElementById('dbModal').dataset.editId;
  try {
    if (editId) {
      await apiCall(`/api/databases/${editId}`, { method:'PUT', body:JSON.stringify({ name, key, version, status }) });
      showToast(`Database "${name}" updated`, 'success');
    } else {
      await apiCall('/api/databases', { method:'POST', body:JSON.stringify({ name, key, version, status, enabled:true }) });
      showToast(`Database "${name}" added`, 'success');
    }
    closeModal('dbModal');
    await fetchDatabases();
    _mappingFormOptionsLoaded = false;
  } catch (e) {
    let msg = e.message;
    try { const d = JSON.parse(e.message); msg = d.message || msg; } catch {}
    showToast('Save failed: ' + msg, 'error');
  } finally {
    if (saveBtn) {
      saveBtn.classList.remove('btn-loading');
      saveBtn.textContent = editId ? 'Save Changes' : 'Add Database';
    }
  }
}

// ════════════════════════════════════════════════════════════
//  SESSION MONITOR
// ════════════════════════════════════════════════════════════

let presenceWs        = null;
let presencePingTimer = null;
const PRESENCE_PING_INTERVAL    = 25_000;
const PRESENCE_RECONNECT_DELAY  = 5_000;

async function connectPresence() {
  if (presenceWs && presenceWs.readyState < 2) return;
  const token = _getToken();
  if (!token) return;

  let wsUrl;
  try {
    const ticketRes = await fetch(API_URL + '/api/auth/ws-ticket', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    if (ticketRes.ok) {
      const ticketData = await ticketRes.json();
      const ticket = ticketData?.data?.ticket;
      if (ticket) {
        const proto = location.protocol === 'https:' ? 'wss' : 'ws';
        const host  = new URL(API_URL).host;
        wsUrl = `${proto}://${host}/ws/presence/admin?ticket=${encodeURIComponent(ticket)}`;
      }
    }
  } catch { /* fallback */ }

  if (!wsUrl) {
    // Legacy fallback: pass token directly (deprecated)
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const host  = new URL(API_URL).host;
    wsUrl = `${proto}://${host}/ws/presence/admin?token=${encodeURIComponent(token)}`;
  }

  presenceWs = new WebSocket(wsUrl);

  presenceWs.onopen = () => { startPresencePing(); };
  presenceWs.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.event === 'update_online_users') renderOnlineUsers(msg.users || [], msg.total || 0);
    } catch { /* ignore */ }
  };
  presenceWs.onclose = () => { stopPresencePing(); setTimeout(connectPresence, PRESENCE_RECONNECT_DELAY); };
  presenceWs.onerror = () => presenceWs.close();
}

function startPresencePing() { stopPresencePing(); presencePingTimer = setInterval(() => { if (presenceWs?.readyState === WebSocket.OPEN) presenceWs.send(JSON.stringify({ event:'ping' })); }, PRESENCE_PING_INTERVAL); }
function stopPresencePing()  { clearInterval(presencePingTimer); }

function renderOnlineUsers(users, total) {
  const badge    = document.querySelector('.nav-item[data-page="sessions"] .nav-badge.live');
  if (badge)     badge.textContent = total;
  const countEl  = document.getElementById('onlineUserCount');
  if (countEl)   countEl.textContent = total;
  const topbarCount = document.getElementById('topbarUserCount');
  if (topbarCount) topbarCount.textContent = total;

  const active   = users.filter(u => u.idle_seconds < 60).length;
  const expiring = users.filter(u => u.idle_seconds >= 60 && u.idle_seconds < 90).length;
  /* sessActive/sessExpiring มาจาก fetchSessions — ไม่ overwrite ด้วย online count */

  const tbody = document.getElementById('onlineUsersBody');
  if (!tbody) return;
  if (!users.length) { tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:32px;color:var(--text3)">No users online</td></tr>`; return; }
  tbody.innerHTML = users.map(u => {
    const idleMin = Math.floor(u.idle_seconds / 60);
    const idleTxt = idleMin > 0 ? `${idleMin}m ago` : 'just now';
    return `<tr>
      <td style="font-family:var(--mono);font-size:11px">${escapeHtml(u.client_id.slice(0,8))}…</td>
      <td>${!u.user_id ? '<span style="color:var(--text3)">Guest</span>' : escapeHtml(u.user_id)}</td>
      <td style="font-family:var(--mono);font-size:11px">${escapeHtml(u.page)}</td>
      <td style="font-size:11px;color:var(--text3)">${formatLocalTime(u.connected_at)}</td>
      <td><span class="badge badge-${u.idle_seconds<60?'active':'draft'}">${escapeHtml(idleTxt)}</span></td>
    </tr>`;
  }).join('');
}

let sessionData = [];

async function fetchSessions() {
  try {
    const data    = await apiCall('/api/sessions');
    const payload = data.data || {};
    sessionData   = payload.sessions || [];
    const stats   = payload.stats    || { active:0, warning:0, expired:0 };
    const elActive   = document.getElementById('sessActive');
    const elExpiring = document.getElementById('sessExpiring');
    const elExpired = document.getElementById('sessExpired');
    if (elActive)   elActive.textContent = stats.active;
    if (elExpiring) elExpiring.textContent = stats.warning;
    if (elExpired) elExpired.textContent = stats.expired;
    const liveBadge = document.querySelector('.nav-item[data-page="sessions"] .nav-badge.live');
    if (liveBadge) liveBadge.textContent = stats.active + stats.warning;
    renderSessions();
  } catch (e) { showToast('Failed to load sessions: ' + e.message, 'error'); }
}

function renderSessions() {
  const tbody = document.getElementById('sessionBody');
  if (!tbody) return;
  if (!sessionData.length) { tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:32px;color:var(--text3)">No active sessions found</td></tr>`; return; }
  tbody.innerHTML = sessionData.map(s => {
    const ttlClass = s.ttl === 0 ? 'expired' : s.ttl < 10 ? 'warn' : 'ok';
    const ttlText  = s.ttl === 0 ? 'Expired' : `${s.ttl}m`;
    return `<tr>
      <td style="font-family:var(--mono);font-size:11px;color:var(--accent)">${escapeHtml(s.id)}</td>
      <td style="color:var(--text2)">${escapeHtml(s.user)}</td>
      <td><span class="badge badge-active">${escapeHtml(s.role)}</span></td>
      <td style="font-family:var(--mono);font-size:11px">${escapeHtml(s.db)}</td>
      <td style="font-family:var(--mono)">${escapeHtml(s.tables)}</td>
      <td style="font-family:var(--mono);font-size:11px;color:var(--text3)">${formatLocalDateTime(s.created)}</td>
      <td><span class="ttl-badge ${ttlClass}">⏱ ${escapeHtml(ttlText)}</span></td>
      <td><span class="badge badge-${s.status==='active'?'active':s.status==='warning'?'draft':'deprecated'}">${escapeHtml(s.status)}</span></td>
      <td><div class="row-actions"><button class="row-btn danger" onclick="revokeSession('${escapeHtml(s.id)}')">✕ Revoke</button></div></td>
    </tr>`;
  }).join('');
}

function revokeSession(id) {
  const confirmBtn = document.getElementById('deleteConfirmBtn');
  document.getElementById('deleteWarnText').textContent = `Revoke session ${id}? The user will be disconnected immediately.`;
  if (confirmBtn) confirmBtn.textContent = 'Revoke';
  if (confirmBtn) confirmBtn.onclick = async () => {
    try {
      await apiCall(`/api/sessions/${id}`, { method:'DELETE' });
      showToast(`Session ${id} revoked`, 'warn');
      closeModal('deleteModal');
      // reset button text กลับ
      if (confirmBtn) confirmBtn.textContent = 'Delete';
      await fetchSessions();
    }
    catch (e) { showToast('Revoke failed: ' + e.message, 'error'); }
  };
  openModal('deleteModal');
}

async function cleanupSessions() {
  try { const data = await apiCall('/api/sessions', { method:'DELETE' }); const removed = data.data?.removed??0; showToast(`${removed} expired session(s) cleaned up`, removed?'success':'info'); await fetchSessions(); }
  catch (e) { showToast('Cleanup failed: ' + e.message, 'error'); }
}

async function refreshSessions() { await fetchSessions(); showToast('Sessions refreshed', 'success'); }

// ════════════════════════════════════════════════════════════
//  LOG VIEWER
// ════════════════════════════════════════════════════════════

let logAutoScroll  = true;
let logLevelFilter = 'ALL';

function setLogFilter(level, btn) {
  logLevelFilter = level;
  document.querySelectorAll('.log-filter-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  filterLogs();
}

async function fetchLogs() {
  try {
    const data     = await apiCall('/api/logs');
    const terminal = document.getElementById('logTerminal');
    if (!terminal) return;
    terminal.innerHTML = '';
    (data.data || []).forEach(entry => appendLogLine(terminal, entry.timestamp, entry.level, entry.message, entry.source_file));
    if (logAutoScroll) terminal.scrollTop = terminal.scrollHeight;
  } catch (e) { showToast('Failed to load logs: ' + e.message, 'error'); }
}

function appendLogLine(terminal, timestamp, level, message, sourceFile) {
  const ts   = (timestamp || new Date().toISOString()).slice(0, 19).replace('T', ' ');
  const line = document.createElement('div');
  line.className = 'log-line';
  const fileBadge = sourceFile
    ? `<span class="log-file" title="${escapeHtml(sourceFile)}">${escapeHtml(_shortSourceFile(sourceFile))}</span>`
    : '';
  line.innerHTML = `<span class="log-ts">${escapeHtml(ts)}</span><span class="log-lvl ${escapeHtml((level||'info').toLowerCase())}">${escapeHtml(level)}</span>${fileBadge}<span class="log-msg">${escapeHtml(message)}</span>`;
  terminal.appendChild(line);
  const lines = terminal.querySelectorAll('.log-line');
  if (lines.length > 200) lines[0].remove();
}

/**
 * ย่อ source_file ให้สั้นลง เช่น
 * "routers/mappings.py:164" → "mappings.py:164"
 * "middleware/logging_middleware.py:45" → "logging_middleware.py:45"
 */
function _shortSourceFile(sf) {
  if (!sf) return '';
  const parts = sf.split('/');
  return parts[parts.length - 1] || sf;
}

function filterLogs() {
  const terminal = document.getElementById('logTerminal');
  if (!terminal) return;
  const search = (document.getElementById('logSearch')?.value || '').toLowerCase();
  terminal.querySelectorAll('.log-line').forEach(line => {
    const lvl     = line.querySelector('.log-lvl')?.textContent.trim() || '';
    const msg     = line.querySelector('.log-msg')?.textContent.toLowerCase() || '';
    const levelOk = logLevelFilter === 'ALL' || lvl === logLevelFilter;
    const searchOk = !search || msg.includes(search) || lvl.toLowerCase().includes(search);
    line.style.display = levelOk && searchOk ? '' : 'none';
  });
  if (logAutoScroll) { const t = document.getElementById('logTerminal'); if (t) t.scrollTop = t.scrollHeight; }
}

function clearLogs() {
  apiCall('/api/logs', { method: 'DELETE' })
    .then(res => {
      const terminal = document.getElementById('logTerminal');
      if (terminal) terminal.innerHTML = '';
      showToast(`ล้าง log แล้ว (${res.data?.deleted ?? 0} รายการ)`, 'info');
    })
    .catch(e => showToast('ล้าง log ไม่สำเร็จ: ' + e.message, 'error'));
}

// ── Wake BA Tool API ──────────────────────────────────────────────────────────

const BA_TOOL_URL = 'https://ba-tool-yvb0.onrender.com';

async function wakeBAToolApi() {
  const btn  = document.getElementById('wakeApiBtn');
  const icon = document.getElementById('wakeApiIcon');
  const terminal = document.getElementById('logTerminal');

  if (btn.disabled) return;

  btn.disabled = true;
  btn.style.opacity = '0.7';
  if (icon) icon.textContent = '⏳';

  _appendWakeLog(terminal, 'INFO', `กำลัง ping BA Tool API: ${BA_TOOL_URL} …`);

  try {
    // เรียกผ่าน Backend Admin Console เพื่อหลีกเลี่ยง CORS
    const data = await apiCall('/api/wake-batool', { method: 'POST' });
    const elapsed = data.data?.elapsed_seconds?.toFixed(1) ?? '?';
    const status  = data.data?.status ?? 'ok';

    _appendWakeLog(terminal, 'INFO', `✅ BA Tool API ตื่นแล้ว (${elapsed}s) — status: ${escapeHtml(String(status))}`);
    showToast(`BA Tool API พร้อมใช้งาน (${elapsed}s)`, 'success');
    if (icon) icon.textContent = '✅';
    setTimeout(() => { if (icon) icon.textContent = '⚡'; }, 3000);
  } catch (err) {
    _appendWakeLog(terminal, 'ERROR', `❌ Wake ล้มเหลว: ${escapeHtml(err.message)}`);
    showToast('Wake ล้มเหลว: ' + err.message, 'error');
    if (icon) icon.textContent = '⚡';
  } finally {
    btn.disabled = false;
    btn.style.opacity = '';
  }
}

function _appendWakeLog(terminal, level, message) {
  if (!terminal) return;
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  appendLogLine(terminal, now, level, message, null);
  if (logAutoScroll) terminal.scrollTop = terminal.scrollHeight;
}

function toggleAutoScroll() {
  logAutoScroll = !logAutoScroll;
  const btn = document.getElementById('autoScrollBtn');
  if (btn) { btn.textContent = logAutoScroll ? '↓ Auto-scroll' : '⏸ Auto-scroll'; btn.classList.toggle('btn-accent', logAutoScroll); }
  showToast(`Auto-scroll ${logAutoScroll ? 'enabled' : 'paused'}`, 'info');
}

setInterval(async () => {
  const terminal = document.getElementById('logTerminal');
  if (!terminal) return;
  try {
    const data    = await apiCall('/api/logs/new');
    const entries = data.data || [];
    entries.forEach(e => appendLogLine(terminal, e.timestamp, e.level, e.message, e.source_file));
    if (entries.length > 0) {
      if (logAutoScroll) terminal.scrollTop = terminal.scrollHeight;
      filterLogs();
    }
  } catch { /* silent */ }
}, 10_000);

// ════════════════════════════════════════════════════════════
//  SETTINGS
// ════════════════════════════════════════════════════════════

function switchSettings(section, btn) {
  document.querySelectorAll('.settings-nav-item').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  document.querySelectorAll('.settings-section').forEach(s => s.classList.add('hidden'));
  const target = document.getElementById('settings-' + section);
  if (target) target.classList.remove('hidden');
  if (section === 'users')                               { fetchMyRole().then(() => fetchUsers()); }
  if (section === 'security' || section === 'ratelimit') { _loadSettingsValues(); loadSystemSettings(); }
  if (section === 'sync')                               { _loadSettingsValues(); loadSystemSettings().then(() => loadSyncStatus()); }
  if (section === 'general')                             { fetchMyRole().then(() => loadMaintenanceState()); }
}

function saveSettings() { showToast('Settings saved successfully', 'success'); }
function toggleApiKey() { const input = document.getElementById('apiKeyInput'); if (!input) return; input.type = input.type === 'password' ? 'text' : 'password'; }
function rotateApiKey() {
  const input = document.getElementById('apiKeyInput');
  if (!input) return;
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let key = 'sk-admin-';
  for (let i = 0; i < 24; i++) key += chars[Math.floor(Math.random() * chars.length)];
  input.value = key; input.type = 'text';
  showToast('API key rotated — remember to update your clients', 'warn');
}

// ════════════════════════════════════════════════════════════
//  MAINTENANCE MODE
// ════════════════════════════════════════════════════════════

let _maintenanceActive = false;
let _maintenancePollTimer = null;

async function loadMaintenanceState() {
  const isAdmin = _currentRole === 'admin';
  const group   = document.getElementById('maintenanceGroup');
  if (group) group.style.display = isAdmin ? '' : 'none';
  if (!isAdmin) return;

  try {
    const res    = await apiCall('/api/system/maintenance');
    const active = res.data?.maintenance ?? false;
    _maintenanceActive = active;
    _applyMaintenanceUI(active);

    const rRes = await apiCall('/api/system/maintenance/reason');
    const reasonEl = document.getElementById('maintenanceReason');
    if (reasonEl && rRes.data?.reason) reasonEl.value = rRes.data.reason;
  } catch (e) {
    console.warn('loadMaintenanceState failed:', e.message);
  }
}

function _applyMaintenanceUI(active) {
  const toggle = document.getElementById('maintenanceToggle');
  if (toggle) toggle.checked = active;

  const badge = document.getElementById('maintenanceBadge');
  if (badge) badge.style.display = active ? '' : 'none';

  const reasonRow = document.getElementById('maintenanceReasonRow');
  if (reasonRow) reasonRow.style.display = active ? '' : 'none';

  const banner = document.getElementById('maintenanceBanner');
  if (banner) banner.style.display = active ? '' : 'none';

  const dot   = document.getElementById('sidebarStatusDot');
  const label = document.getElementById('sidebarStatusLabel');
  if (dot) {
    dot.className = active ? 'status-dot maintenance' : 'status-dot online';
  }
  if (label) {
    label.textContent = active ? '🔧 Maintenance' : 'System Online';
  }
}

async function onMaintenanceToggle(el, forceOff = false) {
  const enabled = forceOff ? false : el.checked;

  if (enabled && !confirm(
    '⚠️ ยืนยันเปิด Maintenance Mode?\n\nผู้ใช้ทุกคนจะไม่สามารถใช้งาน BATOOL ได้ทันที\n(Admin ยังคงใช้งานได้ตามปกติ)'
  )) {
    const toggle = document.getElementById('maintenanceToggle');
    if (toggle) toggle.checked = false;
    return;
  }

  try {
    const reason = document.getElementById('maintenanceReason')?.value.trim() || '';
    await apiCall('/api/system/maintenance', {
      method: 'POST',
      body:   JSON.stringify({ enabled, reason }),
    });
    _maintenanceActive = enabled;
    _applyMaintenanceUI(enabled);
    showToast(
      enabled ? '🔧 Maintenance Mode เปิดแล้ว — ผู้ใช้ถูกบล็อค' : '✅ Maintenance Mode ปิดแล้ว — ระบบกลับมาปกติ',
      enabled ? 'warn' : 'success'
    );

    const toggle = document.getElementById('maintenanceToggle');
    if (toggle) toggle.checked = enabled;
  } catch (e) {
    showToast('เปลี่ยนสถานะ maintenance ล้มเหลว: ' + e.message, 'error');
    const toggle = document.getElementById('maintenanceToggle');
    if (toggle) toggle.checked = _maintenanceActive;
  }
}

async function saveMaintenanceReason() {
  const reason = document.getElementById('maintenanceReason')?.value.trim() || '';
  try {
    await apiCall('/api/system/maintenance', {
      method: 'POST',
      body:   JSON.stringify({ enabled: _maintenanceActive, reason }),
    });
    showToast('บันทึกข้อความสำเร็จ', 'success');
  } catch (e) {
    showToast('บันทึกล้มเหลว: ' + e.message, 'error');
  }
}

// ── Security Settings ─────────────────────────────────────────────────────────

function clampNumberInput(id, fallback) {
  const el = document.getElementById(id);
  if (!el) return fallback;
  const min = Number(el.min || -Infinity);
  const max = Number(el.max || Infinity);
  let value = parseInt(el.value, 10);
  if (Number.isNaN(value)) value = fallback;
  value = Math.min(max, Math.max(min, value));
  el.value = value;
  return value;
}

function getSettingsFormValues() {
  const syncMinutes = clampNumberInput('syncIntervalMinutes', 5);
  return {
    sec_session_timeout: String(clampNumberInput('secSessionTimeout', 60)),
    sec_min_pw_len: String(clampNumberInput('secMinPwLen', 6)),
    sec_max_attempts: String(clampNumberInput('secMaxAttempts', 5)),
    rl_max_req_min: String(clampNumberInput('rlMaxReqMin', 300)),
    rl_bulk_limit: String(clampNumberInput('rlBulkLimit', 5000)),
    rl_sync_interval: String(Math.max(60, syncMinutes * 60)),
    rl_max_retry: String(clampNumberInput('syncMaxRetry', 3)),
  };
}

function saveSettingsLocally(values) {
  Object.entries(values).forEach(([key, value]) => localStorage.setItem(key, value));
}

function applySystemSettings(values = {}) {
  const map = {
    secSessionTimeout: 'sec_session_timeout',
    secMinPwLen: 'sec_min_pw_len',
    secMaxAttempts: 'sec_max_attempts',
    rlMaxReqMin: 'rl_max_req_min',
    rlBulkLimit: 'rl_bulk_limit',
    syncMaxRetry: 'rl_max_retry',
  };
  Object.entries(map).forEach(([id, key]) => {
    const el = document.getElementById(id);
    if (el && values[key] !== undefined && values[key] !== null) el.value = values[key];
  });
  const minsEl = document.getElementById('syncIntervalMinutes');
  if (minsEl && values.rl_sync_interval !== undefined && values.rl_sync_interval !== null) {
    const sec = parseInt(values.rl_sync_interval, 10);
    minsEl.value = Math.max(1, Math.min(1440, Math.round((Number.isNaN(sec) ? 300 : sec) / 60)));
  }
}

async function loadSystemSettings() {
  try {
    const res = await apiCall('/api/system/settings');
    const values = res.data || {};
    saveSettingsLocally(values);
    applySystemSettings(values);
  } catch (_) {
    _loadSettingsValues();
  }
}

async function saveSystemSettings(keys, label) {
  const values = getSettingsFormValues();
  const payload = Object.fromEntries(keys.map(key => [key, values[key]]));
  saveSettingsLocally(payload);
  try {
    const res = await apiCall('/api/system/settings', {
      method: 'PUT',
      body: JSON.stringify({ settings: payload }),
    });
    saveSettingsLocally(res.data || payload);
    applySystemSettings(res.data || payload);
    showToast(`${label} settings saved`, 'success');
  } catch (e) {
    showToast(`${label} saved on this browser only: ${e.message}`, 'warn');
  }
}

async function saveSecuritySettings() {
  await saveSystemSettings(
    ['sec_session_timeout', 'sec_min_pw_len', 'sec_max_attempts'],
    'Security'
  );
}

async function cleanExpiredSessions() {
  try {
    const data = await apiCall('/api/sessions', { method: 'DELETE' });
    const removed = data.data?.removed ?? 0;
    showToast(`ล้าง ${removed} expired session(s) แล้ว`, removed ? 'success' : 'info');
    await fetchSessions();
  } catch (e) {
    showToast('Cleanup failed: ' + e.message, 'error');
  }
}

async function revokeAllSessions() {
  if (!confirm('ยืนยันการยกเลิก session ทั้งหมด? ผู้ใช้ทุกคนจะถูก logout (ยกเว้นคุณ)')) return;
  try {
    const res = await apiCall('/api/sessions/all', { method: 'DELETE' });
    const revoked = res.data?.revoked ?? 0;
    showToast(`ยกเลิก ${revoked} session(s) แล้ว`, 'warn');
    await fetchSessions();
  } catch (e) {
    showToast('Revoke failed: ' + e.message, 'error');
  }
}

// ── Rate Limit Settings ───────────────────────────────────────────────────────

async function saveRateLimitSettings() {
  await saveSystemSettings(
    ['rl_max_req_min', 'rl_bulk_limit'],
    'Rate limiting'
  );
}

async function saveSyncSettings() {
  await saveSystemSettings(
    ['rl_sync_interval', 'rl_max_retry'],
    'Sync'
  );
  await loadSyncStatus();
}

function _loadSettingsValues() {
  const si = document.getElementById('secSessionTimeout');
  const sp = document.getElementById('secMinPwLen');
  const sa = document.getElementById('secMaxAttempts');
  const rr = document.getElementById('rlMaxReqMin');
  const rb = document.getElementById('rlBulkLimit');
  const sm = document.getElementById('syncIntervalMinutes');
  const sr = document.getElementById('syncMaxRetry');
  if (si) si.value = localStorage.getItem('sec_session_timeout') || 60;
  if (sp) sp.value = localStorage.getItem('sec_min_pw_len') || 6;
  if (sa) sa.value = localStorage.getItem('sec_max_attempts') || 5;
  if (rr) rr.value = localStorage.getItem('rl_max_req_min') || 300;
  if (rb) rb.value = localStorage.getItem('rl_bulk_limit') || 5000;
  if (sm) {
    const sec = parseInt(localStorage.getItem('rl_sync_interval') || '300', 10);
    sm.value = Math.max(1, Math.round((Number.isNaN(sec) ? 300 : sec) / 60));
  }
  if (sr) sr.value = localStorage.getItem('rl_max_retry') || 3;
}

// ════════════════════════════════════════════════════════════
//  GLOBAL SEARCH
// ════════════════════════════════════════════════════════════

(function setKbdHint() {
  const kbd = document.querySelector('.search-kbd');
  if (kbd) { const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent); kbd.textContent = isMac ? '⌘K' : 'Ctrl+K'; }
})();

const globalSearch = document.getElementById('globalSearch');
if (globalSearch) {
  globalSearch.addEventListener('input', () => {
    const val = globalSearch.value.trim().toLowerCase();
    if (!val) return;
    const mappingPage = document.getElementById('page-mapping');
    if (mappingPage?.classList.contains('hidden')) navigate('mapping');
    const ms = document.getElementById('mappingSearch');
    if (ms) { ms.value = val; filterMappings(); }
  });
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); globalSearch.focus(); globalSearch.select(); }
    if (e.key === 'Escape') globalSearch.blur();
  });
}

// ════════════════════════════════════════════════════════════
//  SYNC ENGINE TRIGGER
// ════════════════════════════════════════════════════════════

async function loadSyncStatus() {
  const panel = document.getElementById('syncStatusPanel');
  try {
    const res = await apiCall('/api/sync/status');
    const s = res.data || {};
    const m = s.last_metrics || {};
    // ใช้ formatLocalDateTime() เพื่อ handle UTC timezone ถูกต้อง
    const lastRun = s.last_run_at
      ? formatLocalDateTime(s.last_run_at)
      : 'ยังไม่เคยรัน';
    const intervalMin = s.interval_minutes ?? Math.round((s.interval_seconds || 300) / 60);
    const stateLabel = s.running
      ? '<span style="color:var(--warn,#f59e0b)">● กำลังซิงค์…</span>'
      : (s.scheduler_active
        ? '<span style="color:var(--success,#22c55e)">● พร้อม (scheduler ทำงาน)</span>'
        : '<span style="color:var(--danger,#ef4444)">● Scheduler หยุด</span>');
    
    if (panel) {
      panel.innerHTML = `
        <div>${stateLabel}</div>
        <div>ช่วงเวลาอัตโนมัติ: <strong>${intervalMin}</strong> นาที</div>
        <div>รอบล่าสุด: ${lastRun}</div>
        <div>ผลลัพธ์ล่าสุด — processed: ${m.processed ?? 0}, synced: ${m.synced ?? 0}, errors: ${m.errors ?? 0}${m.elapsed_seconds != null ? ` (${m.elapsed_seconds}s)` : ''}</div>
      `;
    }

    // Update Topbar Workspace Capsule Sync Status
    const topbarSync = document.getElementById('topbarSyncStatus');
    if (topbarSync) {
      const capsuleText = topbarSync.querySelector('.capsule-text');
      const syncIcon = topbarSync.querySelector('.sync-icon');
      if (s.running) {
        capsuleText.textContent = 'Syncing...';
        capsuleText.style.color = 'var(--warn)';
        syncIcon.style.color = 'var(--warn)';
        syncIcon.style.animation = 'spin 1s linear infinite';
      } else {
        capsuleText.textContent = 'Synced';
        capsuleText.style.color = 'var(--text2)';
        syncIcon.style.color = 'var(--text2)';
        syncIcon.style.animation = 'none';
      }
    }
  } catch (e) {
    if (panel) panel.textContent = 'โหลดสถานะไม่สำเร็จ: ' + e.message;
  }
}

async function triggerSync() {
  const btn = document.getElementById('syncBtn');
  if (btn) { btn.classList.add('btn-loading'); btn.disabled = true; btn.textContent = '⟳ กำลังซิงค์…'; }
  try {
    const res = await apiCall('/api/sync/run', { method: 'POST' });
    const m   = res.data || {};
    showToast(
      `ซิงค์เสร็จ — synced ${m.synced ?? 0}, errors ${m.errors ?? 0}`,
      (m.errors ?? 0) > 0 ? 'warn' : 'success',
    );
    await fetchMappings();
    await loadSyncStatus();
  } catch (e) {
    if (/already in progress/i.test(e.message)) {
      showToast('กำลังซิงค์อยู่แล้ว — รอสักครู่แล้วลองใหม่', 'warn');
    } else {
      showToast('ซิงค์ล้มเหลว: ' + e.message, 'error');
    }
  } finally {
    if (btn) {
      btn.classList.remove('btn-loading');
      btn.disabled = false;
      btn.textContent = '⟳ ซิงค์ทันที';
    }
  }
}

// ════════════════════════════════════════════════════════════
//  INIT
// ════════════════════════════════════════════════════════════

function init() {
  fetchMyRole().then(() => {
    fetchMappings();
    fetchDatabases();
    fetchSessions();
    fetchLogs();
    refreshDashboard();
    connectPresence();
    fetchActivities();
    loadSystemSettings();
  });
}

// ════════════════════════════════════════════════════════════
//  UPDATE ACTIVITY
// ════════════════════════════════════════════════════════════

let activityData   = [];
let activityPage   = 1;
const ACTIVITY_PAGE_SIZE = 15;

function actionBadgeClass(action) {
  return { create: 'success', update: 'warning', delete: 'error', bulk_import: 'info' }[action] || 'draft';
}

function actionLabel(action) {
  return { create: '➕ Create', update: '✏ Update', delete: '✕ Delete', bulk_import: '⬆ Bulk' }[action] || action;
}

function formatActivityDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    const date = d.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' });
    const time = d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    return `<span style="display:block;font-size:12px;font-weight:600">${date}</span><span style="display:block;font-size:11px;color:var(--text3)">${time}</span>`;
  } catch { return iso; }
}

function formatLocalTime(iso) {
  if (!iso) return '—';
  try {
    let clean = iso.trim().replace(' ', 'T');
    if (!clean.endsWith('Z') && !clean.includes('+') && !clean.includes('GMT')) {
      clean += 'Z';
    }
    const d = new Date(clean);
    if (isNaN(d.getTime())) return iso;
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${hh}:${min}:${ss}`;
  } catch {
    return iso;
  }
}

function formatLocalDateTime(iso) {
  if (!iso) return '—';
  try {
    let clean = iso.trim().replace(' ', 'T');
    if (!clean.endsWith('Z') && !clean.includes('+') && !clean.includes('GMT')) {
      clean += 'Z';
    }
    const d = new Date(clean);
    if (isNaN(d.getTime())) return iso;
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
  } catch {
    return iso;
  }
}

async function fetchActivities() {
  try {
    const res = await apiCall('/api/activities?limit=200');
    activityData  = (res.data?.activities || []);
    const badge   = document.getElementById('activityNavBadge');
    if (badge) { badge.textContent = activityData.length; badge.style.display = activityData.length ? '' : 'none'; }
    activityPage  = 1;
    filterActivities();
  } catch (e) {
    showToast('ไม่สามารถโหลด Activity: ' + e.message, 'error');
  }
}

function getFilteredActivities() {
  const user   = (document.getElementById('activitySearchUser')?.value  || '').toLowerCase();
  const action = document.getElementById('activityFilterAction')?.value || '';
  const type   = document.getElementById('activityFilterType')?.value   || '';
  return activityData.filter(a =>
    (!user   || (a.username || '').toLowerCase().includes(user)) &&
    (!action || a.action      === action) &&
    (!type   || a.target_type === type)
  );
}

function filterActivities() {
  activityPage = 1;
  renderActivityTable();
}

function renderActivityTable() {
  const filtered   = getFilteredActivities();
  const totalPages = Math.max(1, Math.ceil(filtered.length / ACTIVITY_PAGE_SIZE));
  if (activityPage > totalPages) activityPage = 1;
  const start = (activityPage - 1) * ACTIVITY_PAGE_SIZE;
  const page  = filtered.slice(start, start + ACTIVITY_PAGE_SIZE);

  const tbody = document.getElementById('activityBody');
  if (!tbody) return;

  const countEl = document.getElementById('activityCount');
  if (countEl) countEl.textContent = `แสดง ${filtered.length} รายการ`;

  if (!page.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--text3)">ไม่พบข้อมูล Activity</td></tr>`;
  } else {
    tbody.innerHTML = page.map(a => `
      <tr style="cursor:default">
        <td style="font-family:var(--mono);font-size:11px;color:var(--text3)">${escapeHtml(a.id)}</td>
        <td>
          <div style="display:flex;align-items:center;gap:8px">
            <div style="width:28px;height:28px;border-radius:50%;background:var(--accent);color:#000;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0">${escapeHtml((a.username||'?')[0].toUpperCase())}</div>
            <span style="font-weight:500;font-size:13px">${escapeHtml(a.username || '—')}</span>
          </div>
        </td>
        <td><span class="badge badge-${actionBadgeClass(a.action)}">${escapeHtml(actionLabel(a.action))}</span></td>
        <td style="font-size:12px;color:var(--text3)">${escapeHtml(a.target_type || '—')}</td>
        <td style="font-family:var(--mono);font-size:11px">${escapeHtml(a.target_id ?? '—')}</td>
        <td style="font-size:12px;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(a.summary||'')}">${escapeHtml(a.summary || '—')}</td>
        <td>${formatActivityDate(a.created_at)}</td>
        <td>
          <button class="row-btn" title="ดูรายละเอียด" onclick="openActivityDetail(${a.id})">🔍</button>
        </td>
      </tr>`).join('');
  }

  const pag = document.getElementById('activityPagination');
  if (pag) {
    let html = `<button class="page-btn" onclick="goActivityPage(${activityPage-1})" ${activityPage===1?'disabled':''}>‹</button>`;
    for (let i = 1; i <= totalPages; i++) html += `<button class="page-btn ${i===activityPage?'active':''}" onclick="goActivityPage(${i})">${i}</button>`;
    html += `<button class="page-btn" onclick="goActivityPage(${activityPage+1})" ${activityPage===totalPages?'disabled':''}>›</button>`;
    pag.innerHTML = html;
  }
}

function goActivityPage(p) {
  const filtered   = getFilteredActivities();
  const totalPages = Math.max(1, Math.ceil(filtered.length / ACTIVITY_PAGE_SIZE));
  if (p < 1 || p > totalPages) return;
  activityPage = p;
  renderActivityTable();
}

async function openActivityDetail(id) {
  const overlay = document.getElementById('activityDetailModal');
  const body    = document.getElementById('activityModalBody');
  const title   = document.getElementById('activityModalTitle');
  if (!overlay || !body) return;

  body.innerHTML = `<div style="padding:32px;text-align:center;color:var(--text3)">กำลังโหลด…</div>`;
  openModal('activityDetailModal');

  try {
    const res  = await apiCall(`/api/activities/${id}`);
    const act  = res.data;
    title.textContent = `Activity #${act.id} — ${act.username}`;

    const detail = act.detail;
    let detailHtml = '';

    if (detail && typeof detail === 'object') {
      const sections = [];
      if (detail.before) sections.push({ label: '📷 ก่อนแก้ไข (Before)', data: detail.before, color: '#f87171' });
      if (detail.after)  sections.push({ label: '✅ หลังแก้ไข (After)',  data: detail.after,  color: '#34d399' });
      if (detail.changes) sections.push({ label: '✏ ค่าที่เปลี่ยน (Changes)', data: detail.changes, color: 'var(--accent)' });
      if (detail.imported !== undefined) sections.push({ label: '📊 สรุป Import', data: { imported: detail.imported, skipped: detail.skipped, failed: detail.failed }, color: 'var(--accent)' });

      sections.forEach(sec => {
        detailHtml += `<div style="margin-bottom:20px">
          <div style="font-size:12px;font-weight:700;color:${sec.color};margin-bottom:8px;padding:0 24px">${sec.label}</div>
          <div style="background:var(--bg2);border-radius:8px;margin:0 16px;overflow:hidden">
            <table style="width:100%;border-collapse:collapse">
              ${Object.entries(sec.data).map(([k,v]) => `
                <tr style="border-bottom:1px solid var(--border)">
                  <td style="padding:8px 16px;font-size:12px;color:var(--text3);font-family:var(--mono);width:140px;white-space:nowrap">${escapeHtml(k)}</td>
                  <td style="padding:8px 16px;font-size:12px;word-break:break-all">${v === null ? '<em style="color:var(--text3)">null</em>' : escapeHtml(String(v))}</td>
                </tr>`).join('')}
            </table>
          </div>
        </div>`;
      });

      if (!sections.length) {
        detailHtml = `<div style="padding:0 24px"><pre style="font-size:11px;background:var(--bg2);padding:16px;border-radius:8px;overflow:auto">${escapeHtml(JSON.stringify(detail, null, 2))}</pre></div>`;
      }
    } else {
      detailHtml = `<div style="padding:0 24px;font-size:13px;color:var(--text3)">ไม่มีข้อมูลรายละเอียดเพิ่มเติม</div>`;
    }

    body.innerHTML = `
      <div style="padding:20px 0 8px">
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;padding:0 24px 20px;border-bottom:1px solid var(--border);margin-bottom:20px">
          <div>
            <div style="font-size:11px;color:var(--text3);margin-bottom:4px">ผู้ใช้งาน</div>
            <div style="font-weight:600;font-size:14px">${escapeHtml(act.username)}</div>
          </div>
          <div>
            <div style="font-size:11px;color:var(--text3);margin-bottom:4px">Action</div>
            <span class="badge badge-${actionBadgeClass(act.action)}">${escapeHtml(actionLabel(act.action))}</span>
          </div>
          <div>
            <div style="font-size:11px;color:var(--text3);margin-bottom:4px">Target</div>
            <div style="font-size:13px">${escapeHtml(act.target_type)}${act.target_id ? ' #'+escapeHtml(act.target_id) : ''}</div>
          </div>
          <div style="grid-column:1/-1">
            <div style="font-size:11px;color:var(--text3);margin-bottom:4px">สรุป</div>
            <div style="font-size:13px">${escapeHtml(act.summary || '—')}</div>
          </div>
          <div style="grid-column:1/-1">
            <div style="font-size:11px;color:var(--text3);margin-bottom:4px">วันที่ / เวลา</div>
            <div style="font-size:13px;font-family:var(--mono)">${formatActivityDate(act.created_at)}</div>
          </div>
        </div>
        ${detailHtml}
      </div>`;
  } catch (e) {
    body.innerHTML = `<div style="padding:24px;color:var(--error)">โหลดข้อมูลล้มเหลว: ${escapeHtml(e.message)}</div>`;
  }
}

function closeActivityModal() {
  const overlay = document.getElementById('activityDetailModal');
  if (overlay) overlay.classList.add('hidden');
}

// ════════════════════════════════════════════════════════════
//  USER MANAGEMENT
// ════════════════════════════════════════════════════════════

let _usersData    = [];
let _currentRole  = 'viewer';
let _editingUserId = null;
let _resetPwUserId = null;

async function fetchMyRole() {
  try {
    const res = await apiCall('/api/auth/me');
    _currentRole = res.data?.role || 'viewer';
    _applyMappingRoleUI();
    _applyUserAdminUI();
  } catch (_) { /* ignore */ }
}

function _applyMappingRoleUI() {
  const canEdit  = _currentRole === 'admin' || _currentRole === 'editor';
  const isAdmin  = _currentRole === 'admin';
  const btnBulk  = document.getElementById('btnBulkImport');
  const btnAdd   = document.getElementById('btnAddRule');
  if (btnBulk) btnBulk.style.display = canEdit ? '' : 'none';
  if (btnAdd)  btnAdd.style.display  = canEdit ? '' : 'none';
  const bulkApproveBtn = document.querySelector('[onclick="bulkApprove()"]');
  const bulkDeleteBtn  = document.querySelector('[onclick="bulkDelete()"]');
  if (bulkApproveBtn) bulkApproveBtn.style.display = canEdit ? '' : 'none';
  if (bulkDeleteBtn)  bulkDeleteBtn.style.display  = isAdmin ? '' : 'none';
}

async function fetchUsers() {
  try {
    const res  = await apiCall('/api/users');
    _usersData = res.data || [];
    renderUsersTable();
    _applyUserAdminUI();
  } catch (e) {
    const tbody = document.getElementById('usersBody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:32px;color:var(--error)">โหลดข้อมูลล้มเหลว: ${escapeHtml(e.message)}</td></tr>`;
  }
}

function _applyUserAdminUI() {
  const isAdmin = _currentRole === 'admin';
  const btn     = document.getElementById('btnAddUser');
  const notice  = document.getElementById('userAdminNotice');
  const actHdr  = document.getElementById('userActionHeader');
  if (btn)    { btn.style.display    = isAdmin ? '' : 'none'; }
  if (notice) { notice.classList[isAdmin ? 'remove' : 'add']('hidden'); }
  if (actHdr) actHdr.textContent = isAdmin ? 'Actions' : '';
}

function roleBadgeClass(role) {
  return { admin: 'success', editor: 'warning', viewer: 'draft' }[role] || 'draft';
}

function roleLabel(role) {
  return { admin: '🛡 Admin', editor: '✏ Editor', viewer: '👁 Viewer' }[role] || role;
}

function fmtDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('th-TH', { year:'numeric', month:'short', day:'numeric' }); }
  catch { return iso; }
}

function renderUsersTable() {
  const tbody   = document.getElementById('usersBody');
  if (!tbody) return;
  const isAdmin = _currentRole === 'admin';

  if (!_usersData.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--text3)">ยังไม่มีผู้ใช้ในระบบ</td></tr>`;
    return;
  }

  tbody.innerHTML = _usersData.map(u => `
    <tr>
      <td style="font-family:var(--mono);font-size:11px;color:var(--text3)">${escapeHtml(u.id)}</td>
      <td>
        <div style="display:flex;align-items:center;gap:8px">
          <div style="width:30px;height:30px;border-radius:50%;background:var(--accent);color:#000;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0">${escapeHtml((u.username||'?')[0].toUpperCase())}</div>
          <div>
            <div style="font-weight:600;font-size:13px">${escapeHtml(u.username)}</div>
          </div>
        </div>
      </td>
      <td style="font-size:13px;color:var(--text2)">${escapeHtml(u.display_name || '—')}</td>
      <td><span class="badge badge-${roleBadgeClass(u.role)}">${escapeHtml(roleLabel(u.role))}</span></td>
      <td>
        <span style="display:inline-flex;align-items:center;gap:4px;font-size:12px;${u.is_active ? 'color:#34d399' : 'color:var(--text3)'}">
          ${u.is_active ? '● Active' : '○ Inactive'}
        </span>
      </td>
      <td style="font-size:12px;color:var(--text3)">${fmtDate(u.created_at)}</td>
      <td style="font-size:12px;color:var(--text3)">${u.last_login ? fmtDate(u.last_login) : '—'}</td>
      <td>
        ${isAdmin ? `
        <div class="row-actions">
          <button class="row-btn" title="แก้ไข" onclick="openUserModal(${u.id})">✎</button>
          <button class="row-btn" title="Reset Password" onclick="openResetPwModal(${u.id},'${escapeHtml(u.username)}')">🔑</button>
          <button class="row-btn danger" title="ลบ" onclick="deleteUser(${u.id},'${escapeHtml(u.username)}')">✕</button>
        </div>` : ''}
      </td>
    </tr>`).join('');
}

function openUserModal(userId = null) {
  _editingUserId = userId;
  const overlay = document.getElementById('userModal');
  const title   = document.getElementById('userModalTitle');
  const pwRow   = document.getElementById('uPasswordRow');
  const actRow  = document.getElementById('uActiveRow');
  if (!overlay) return;

  document.getElementById('uUsername').value    = '';
  document.getElementById('uPassword').value    = '';
  document.getElementById('uDisplayName').value = '';
  document.getElementById('uRole').value        = 'viewer';
  document.getElementById('uIsActive').checked  = true;
  ['uUsernameErr','uPasswordErr'].forEach(id => document.getElementById(id)?.classList.add('hidden'));

  if (userId) {
    const u = _usersData.find(x => x.id === userId);
    if (!u) return;
    title.textContent = `แก้ไขผู้ใช้: ${u.username}`;
    document.getElementById('uUsername').value    = u.username;
    document.getElementById('uUsername').disabled = true;
    document.getElementById('uDisplayName').value = u.display_name || '';
    document.getElementById('uRole').value        = u.role;
    document.getElementById('uIsActive').checked  = u.is_active;
    pwRow?.classList.add('hidden');
    actRow?.classList.remove('hidden');
    document.getElementById('btnSaveUser').textContent = 'บันทึกการแก้ไข';
  } else {
    title.textContent = 'เพิ่มผู้ใช้ใหม่';
    document.getElementById('uUsername').disabled = false;
    pwRow?.classList.remove('hidden');
    actRow?.classList.add('hidden');
    document.getElementById('btnSaveUser').textContent = 'สร้างผู้ใช้';
  }
  openModal('userModal');
}

function closeUserModal() {
  document.getElementById('userModal')?.classList.add('hidden');
  _editingUserId = null;
}

async function saveUser() {
  const btn = document.getElementById('btnSaveUser');
  let valid = true;

  const username    = document.getElementById('uUsername')?.value.trim().toLowerCase();
  const password    = document.getElementById('uPassword')?.value;
  const displayName = document.getElementById('uDisplayName')?.value.trim();
  const role        = document.getElementById('uRole')?.value;
  const isActive    = document.getElementById('uIsActive')?.checked ?? true;

  if (!_editingUserId) {
    const unErr = document.getElementById('uUsernameErr');
    if (!username || username.length < 3 || !/^[a-z0-9_\-.]+$/.test(username)) {
      unErr?.classList.remove('hidden');
      unErr.textContent = !username ? 'Username ต้องไม่ว่าง' : username.length < 3 ? 'ต้องมีอย่างน้อย 3 ตัวอักษร' : 'ใช้ได้เฉพาะ a-z, 0-9, _, -, .';
      valid = false;
    } else unErr?.classList.add('hidden');

    const pwErr = document.getElementById('uPasswordErr');
    const minPw = parseInt(localStorage.getItem('sec_min_pw_len') || '6', 10) || 6;
    if (!password || password.length < minPw) {
      pwErr?.classList.remove('hidden');
      if (pwErr) pwErr.textContent = `Password ต้องมีอย่างน้อย ${minPw} ตัวอักษร`;
      valid = false;
    } else pwErr?.classList.add('hidden');
  }

  if (!valid) return;

  if (btn) { btn.disabled = true; btn.textContent = 'กำลังบันทึก…'; }

  try {
    if (_editingUserId) {
      await apiCall(`/api/users/${_editingUserId}`, {
        method: 'PUT',
        body: JSON.stringify({ role, display_name: displayName, is_active: isActive }),
      });
      showToast('อัปเดตผู้ใช้สำเร็จ', 'success');
    } else {
      await apiCall('/api/users', {
        method: 'POST',
        body: JSON.stringify({ username, password, role, display_name: displayName }),
      });
      showToast(`สร้างผู้ใช้ '${username}' สำเร็จ`, 'success');
    }
    closeUserModal();
    await fetchUsers();
  } catch (e) {
    showToast(e.message || 'บันทึกล้มเหลว', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = _editingUserId ? 'บันทึกการแก้ไข' : 'สร้างผู้ใช้'; }
  }
}

function openResetPwModal(userId, username) {
  _resetPwUserId = userId;
  const overlay = document.getElementById('resetPwModal');
  const nameEl  = document.getElementById('resetPwUsername');
  const inp     = document.getElementById('newPwInput');
  if (!overlay) return;
  if (nameEl) nameEl.textContent = username;
  if (inp)    inp.value = '';
  document.getElementById('newPwErr')?.classList.add('hidden');
  openModal('resetPwModal');
}

function closeResetPwModal() {
  document.getElementById('resetPwModal')?.classList.add('hidden');
  _resetPwUserId = null;
}

async function confirmResetPw() {
  const pw  = document.getElementById('newPwInput')?.value;
  const err = document.getElementById('newPwErr');
  if (!pw || pw.length < 6) {
    err?.classList.remove('hidden');
    return;
  }
  err?.classList.add('hidden');
  try {
    await apiCall(`/api/users/${_resetPwUserId}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ new_password: pw }),
    });
    showToast('Reset password สำเร็จ', 'success');
    closeResetPwModal();
  } catch (e) {
    showToast(e.message || 'Reset ล้มเหลว', 'error');
  }
}

async function deleteUser(userId, username) {
  if (!confirm(`ยืนยันลบผู้ใช้ "${username}" ?\nการกระทำนี้ไม่สามารถยกเลิกได้`)) return;
  try {
    await apiCall(`/api/users/${userId}`, { method: 'DELETE' });
    showToast(`ลบผู้ใช้ '${username}' สำเร็จ`, 'success');
    await fetchUsers();
  } catch (e) {
    showToast(e.message || 'ลบล้มเหลว', 'error');
  }
}

function toggleFieldPw(inputId, iconEl) {
  const inp  = document.getElementById(inputId);
  if (!inp) return;
  const hide = inp.type === 'password';
  inp.type   = hide ? 'text' : 'password';
  if (iconEl) iconEl.style.color = hide ? 'var(--accent)' : 'var(--text3)';
}

// ════════════════════════════════════════════════════════════
//  CLEAR ACTIVITY LOG
// ════════════════════════════════════════════════════════════

let _clearMode     = 'now';   // 'now' | 'schedule'
let _clearDays     = 0;
let _schedDays     = 7;
const SCHED_KEY    = 'ba_activity_clear_schedule';

function openClearActivityModal() {
  _clearMode = 'now';
  _clearDays = 0;
  _schedDays = parseInt(localStorage.getItem(SCHED_KEY + '_days') || '7');

  // reset UI
  document.getElementById('clearModeNow').classList.add('active');
  document.getElementById('clearModeSchedule').classList.remove('active');
  document.getElementById('clearNowPanel').style.display = '';
  document.getElementById('clearSchedulePanel').style.display = 'none';
  document.getElementById('scheduleActiveLabel').style.display = 'none';
  document.getElementById('scheduleActiveText').style.display = 'none';

  // reset day buttons
  document.querySelectorAll('[data-days]').forEach(b => b.classList.toggle('active', parseInt(b.dataset.days) === 0));
  document.getElementById('clearDaysLabel').textContent = 'ทั้งหมด';

  // schedule buttons
  document.querySelectorAll('[data-sched]').forEach(b => {
    b.classList.toggle('active', parseInt(b.dataset.sched) === _schedDays);
    b.onclick = () => selectSchedDays(parseInt(b.dataset.sched));
  });
  _updateScheduleStatus();

  document.getElementById('clearNowPanel').querySelectorAll('[data-days]').forEach(b => {
    b.onclick = () => selectClearDays(parseInt(b.dataset.days), b);
  });

  document.getElementById('btnConfirmClear').textContent = 'ยืนยันเคลียร์';
  openModal('clearActivityModal');
}

function closeClearActivityModal() {
  document.getElementById('clearActivityModal').classList.add('hidden');
}

function setClearMode(mode) {
  _clearMode = mode;
  document.getElementById('clearModeNow').classList.toggle('active', mode === 'now');
  document.getElementById('clearModeSchedule').classList.toggle('active', mode === 'schedule');
  document.getElementById('clearNowPanel').style.display      = mode === 'now' ? '' : 'none';
  document.getElementById('clearSchedulePanel').style.display = mode === 'schedule' ? 'flex' : 'none';
  document.getElementById('scheduleActiveLabel').style.display = mode === 'schedule' ? '' : 'none';
  document.getElementById('scheduleActiveText').style.display  = mode === 'schedule' ? '' : 'none';

  const isActive = !!localStorage.getItem(SCHED_KEY + '_next');
  const cb = document.getElementById('scheduleActive');
  if (cb) cb.checked = isActive;

  document.getElementById('btnConfirmClear').textContent = mode === 'schedule' ? 'บันทึกตั้งเวลา' : 'ยืนยันเคลียร์';
}

function selectClearDays(days, btn) {
  _clearDays = days;
  document.querySelectorAll('[data-days]').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const label = document.getElementById('clearDaysLabel');
  if (label) label.textContent = days === 0 ? 'ทั้งหมด' : `${days} วัน`;
}

function selectSchedDays(days) {
  _schedDays = days;
  document.querySelectorAll('[data-sched]').forEach(b => b.classList.toggle('active', parseInt(b.dataset.sched) === days));
  _updateScheduleStatus();
}

function toggleScheduleActive() {
  const cb = document.getElementById('scheduleActive');
  if (!cb.checked) {
    localStorage.removeItem(SCHED_KEY + '_next');
    localStorage.removeItem(SCHED_KEY + '_days');
  } else {
    _saveSchedule();
  }
  _updateScheduleStatus();
}

function _saveSchedule() {
  const next = new Date();
  next.setDate(next.getDate() + _schedDays);
  localStorage.setItem(SCHED_KEY + '_next', next.toISOString());
  localStorage.setItem(SCHED_KEY + '_days', String(_schedDays));
}

function _updateScheduleStatus() {
  const nextRaw = localStorage.getItem(SCHED_KEY + '_next');
  const label   = document.getElementById('scheduleNextLabel');
  if (!label) return;
  if (nextRaw) {
    const d = new Date(nextRaw);
    label.textContent = d.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
  } else {
    label.textContent = 'ยังไม่ได้ตั้งค่า';
  }
}

async function confirmClearActivity() {
  if (_clearMode === 'schedule') {
    try {
      await apiCall('/api/activities/retention', {
        method: 'PUT',
        body: JSON.stringify({ enabled: true, interval_days: _schedDays }),
      });
      const cb = document.getElementById('scheduleActive');
      if (cb) cb.checked = true;
      _updateScheduleStatus();
      showToast(`ตั้งเวลาเคลียร์ log บน server ทุก ${_schedDays} วัน เรียบร้อย`, 'success');
      closeClearActivityModal();
    } catch (e) {
      showToast('บันทึก schedule ไม่สำเร็จ: ' + e.message, 'error');
    }
    return;
  }

  // immediate clear
  const label = _clearDays === 0 ? 'ทั้งหมด' : `เก่ากว่า ${_clearDays} วัน`;
  if (!confirm(`ยืนยันลบ log ${label}?`)) return;

  try {
    const cutoff = _clearDays === 0 ? null : (() => { const d = new Date(); d.setDate(d.getDate() - _clearDays); return d.toISOString(); })();
    await apiCall('/api/activities/clear' + (cutoff ? `?before=${encodeURIComponent(cutoff)}` : ''), { method: 'DELETE' });
    showToast(`เคลียร์ log ${label} สำเร็จ`, 'success');
    closeClearActivityModal();
    await fetchActivities();
  } catch (e) {
    showToast('เคลียร์ไม่สำเร็จ: ' + e.message, 'error');
  }
}

// Auto-run schedule check removed — ใช้ server scheduler แทน (PUT /api/activities/retention)

// ════════════════════════════════════════════════════════════
//  ADMIN LOGS PAGE (backend/system logs only)
// ════════════════════════════════════════════════════════════

let _alTab            = 'batool';     // 'batool' | 'admin'
let _alActivityData   = [];           // raw list จาก API
let _alActivityPage   = 1;
const AL_PAGE_SIZE    = 20;
let _alSystemLogs     = [];           // raw log list
let _alSystemFilter   = 'ALL';
let _sysLogClearDays  = 0;
let _sysLogRetDays    = 30;
let _sysLogRetHours   = 24;
let _sysLogRetention  = null;

// ── Tab switch ────────────────────────────────────────────────────────────────

function switchAdminLogTab(tab, btn) {
  _alTab = tab === 'admin' ? 'admin' : tab === 'realtime' ? 'realtime' : 'batool';
  document.querySelectorAll('.adminlog-tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const activityPanel = document.getElementById('adminlog-panel-activity');
  const systemPanel   = document.getElementById('adminlog-panel-system');
  const realtimePanel = document.getElementById('adminlog-panel-realtime');
  if (activityPanel) activityPanel.style.display = 'none';
  if (systemPanel)   systemPanel.style.display   = 'none';
  if (realtimePanel) realtimePanel.style.display  = 'none';
  if (_alTab === 'realtime') {
    if (realtimePanel) realtimePanel.style.display = '';
    fetchLogs();
  } else {
    if (systemPanel) systemPanel.style.display = '';
    _fetchAdminSystemLogs();
  }
}

// ── Main fetch ────────────────────────────────────────────────────────────────

async function fetchAdminLogs() {
  if (_alTab === 'realtime') {
    await Promise.all([fetchLogs(), _loadSystemLogRetention()]);
  } else {
    await Promise.all([_fetchAdminSystemLogs(), _loadSystemLogRetention()]);
  }
}

function _adminLogClearOrClear() {
  if (_alTab === 'realtime') {
    clearLogs();
  } else {
    openClearSystemLogModal();
  }
}

// ── Activity Log ──────────────────────────────────────────────────────────────

async function _fetchAdminActivityLogs() {
  try {
    const res = await apiCall('/api/activities?limit=200');
    _alActivityData = res.data?.activities || [];
    const badge = document.getElementById('adminLogsBadge');
    if (badge) { badge.textContent = _alActivityData.length; badge.style.display = _alActivityData.length ? '' : 'none'; }
    _alActivityPage = 1;
    filterAdminActivity();
  } catch (e) {
    showToast('โหลด Activity Log ไม่สำเร็จ: ' + e.message, 'error');
  }
}

function _getFilteredAdminActivity() {
  const user   = (document.getElementById('alSearchUser')?.value   || '').toLowerCase();
  const action = document.getElementById('alFilterAction')?.value   || '';
  const target = document.getElementById('alFilterTarget')?.value   || '';
  const date   = document.getElementById('alFilterDate')?.value     || '';
  return _alActivityData.filter(a =>
    (!user   || (a.username || '').toLowerCase().includes(user)) &&
    (!action || a.action      === action) &&
    (!target || a.target_type === target) &&
    (!date   || (a.created_at || '').startsWith(date))
  );
}

function filterAdminActivity() {
  _alActivityPage = 1;
  _renderAdminActivityTable();
}

function _renderAdminActivityTable() {
  const filtered   = _getFilteredAdminActivity();
  const totalPages = Math.max(1, Math.ceil(filtered.length / AL_PAGE_SIZE));
  if (_alActivityPage > totalPages) _alActivityPage = 1;
  const start = (_alActivityPage - 1) * AL_PAGE_SIZE;
  const page  = filtered.slice(start, start + AL_PAGE_SIZE);

  const tbody = document.getElementById('alActivityBody');
  if (!tbody) return;

  const countEl = document.getElementById('alActivityCount');
  if (countEl) countEl.textContent = `แสดง ${filtered.length} รายการ`;

  if (!page.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--text3)">ไม่พบข้อมูล</td></tr>`;
  } else {
    tbody.innerHTML = page.map(a => {
      const avatar = (a.username || '?')[0].toUpperCase();
      const actionClass = { create:'success', update:'warning', delete:'error', bulk_import:'info', login:'active', logout:'draft' }[a.action] || 'draft';
      const actionLabel = { create:'➕ Create', update:'✏ Update', delete:'✕ Delete', bulk_import:'⬆ Bulk', login:'🔑 Login', logout:'🚪 Logout' }[a.action] || a.action;
      const dateStr = a.created_at ? (() => {
        const d = new Date(a.created_at);
        return `<span style="display:block;font-size:12px;font-weight:600">${d.toLocaleDateString('th-TH',{year:'numeric',month:'short',day:'numeric'})}</span><span style="display:block;font-size:11px;color:var(--text3)">${d.toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}</span>`;
      })() : '—';
      return `<tr>
        <td style="font-family:var(--mono);font-size:11px;color:var(--text3)">${escapeHtml(a.id)}</td>
        <td>
          <div style="display:flex;align-items:center;gap:8px">
            <div style="width:26px;height:26px;border-radius:50%;background:var(--accent);color:#000;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0">${escapeHtml(avatar)}</div>
            <span style="font-weight:500;font-size:13px">${escapeHtml(a.username || '—')}</span>
          </div>
        </td>
        <td><span class="badge badge-${actionClass}">${escapeHtml(actionLabel)}</span></td>
        <td style="font-size:12px;color:var(--text3)">${escapeHtml(a.target_type || '—')}</td>
        <td style="font-family:var(--mono);font-size:11px">${escapeHtml(a.target_id ?? '—')}</td>
        <td style="font-size:12px;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(a.summary||'')}">${escapeHtml(a.summary || '—')}</td>
        <td>${dateStr}</td>
        <td><button class="row-btn" title="รายละเอียด" onclick="openAdminLogDetail(${a.id})">🔍</button></td>
      </tr>`;
    }).join('');
  }

  // pagination
  const pag = document.getElementById('alActivityPagination');
  if (pag) {
    let html = `<button class="page-btn" onclick="goAlPage(${_alActivityPage-1})" ${_alActivityPage===1?'disabled':''}>‹</button>`;
    for (let i = 1; i <= totalPages; i++) html += `<button class="page-btn ${i===_alActivityPage?'active':''}" onclick="goAlPage(${i})">${i}</button>`;
    html += `<button class="page-btn" onclick="goAlPage(${_alActivityPage+1})" ${_alActivityPage===totalPages?'disabled':''}>›</button>`;
    pag.innerHTML = html;
  }
}

function goAlPage(p) {
  const totalPages = Math.max(1, Math.ceil(_getFilteredAdminActivity().length / AL_PAGE_SIZE));
  if (p < 1 || p > totalPages) return;
  _alActivityPage = p;
  _renderAdminActivityTable();
}

async function openAdminLogDetail(id) {
  // reuse existing activity detail modal
  const overlay = document.getElementById('activityDetailModal');
  const body    = document.getElementById('activityModalBody');
  const title   = document.getElementById('activityModalTitle');
  if (!overlay || !body) return;
  body.innerHTML = `<div style="padding:32px;text-align:center;color:var(--text3)">กำลังโหลด…</div>`;
  openModal('activityDetailModal');
  try {
    const res = await apiCall(`/api/activities/${id}`);
    const act = res.data;
    if (title) title.textContent = `Admin Log #${act.id} — ${act.username}`;
    let detailHtml = '';
    const detail = act.detail;
    if (detail && typeof detail === 'object') {
      const sections = [];
      if (detail.before)   sections.push({ label:'📷 ก่อนแก้ไข', data:detail.before,   color:'#f87171' });
      if (detail.after)    sections.push({ label:'✅ หลังแก้ไข', data:detail.after,    color:'#34d399' });
      if (detail.changes)  sections.push({ label:'✏ ค่าที่เปลี่ยน', data:detail.changes, color:'var(--accent)' });
      sections.forEach(sec => {
        detailHtml += `<div style="margin-bottom:20px">
          <div style="font-size:12px;font-weight:700;color:${sec.color};margin-bottom:8px;padding:0 24px">${sec.label}</div>
          <div style="background:var(--bg2);border-radius:8px;margin:0 16px;overflow:hidden">
            <table style="width:100%;border-collapse:collapse">
              ${Object.entries(sec.data).map(([k,v]) => `<tr style="border-bottom:1px solid var(--border)"><td style="padding:8px 16px;font-size:12px;color:var(--text3);font-family:var(--mono);width:140px">${escapeHtml(k)}</td><td style="padding:8px 16px;font-size:12px;word-break:break-all">${v===null?'<em style="color:var(--text3)">null</em>':escapeHtml(String(v))}</td></tr>`).join('')}
            </table>
          </div>
        </div>`;
      });
      if (!sections.length) detailHtml = `<div style="padding:0 24px"><pre style="font-size:11px;background:var(--bg2);padding:16px;border-radius:8px;overflow:auto">${escapeHtml(JSON.stringify(detail,null,2))}</pre></div>`;
    } else {
      detailHtml = `<div style="padding:0 24px;font-size:13px;color:var(--text3)">ไม่มีรายละเอียดเพิ่มเติม</div>`;
    }
    body.innerHTML = `
      <div style="padding:20px 0 8px">
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;padding:0 24px 20px;border-bottom:1px solid var(--border);margin-bottom:20px">
          <div><div style="font-size:11px;color:var(--text3);margin-bottom:4px">ผู้ใช้งาน</div><div style="font-weight:600;font-size:14px">${escapeHtml(act.username)}</div></div>
          <div><div style="font-size:11px;color:var(--text3);margin-bottom:4px">Action</div><span class="badge badge-${{ create:'success', update:'warning', delete:'error', bulk_import:'info' }[act.action]||'draft'}">${escapeHtml(act.action)}</span></div>
          <div><div style="font-size:11px;color:var(--text3);margin-bottom:4px">Target</div><div style="font-size:13px">${escapeHtml(act.target_type)}${act.target_id?' #'+escapeHtml(act.target_id):''}</div></div>
          <div style="grid-column:1/-1"><div style="font-size:11px;color:var(--text3);margin-bottom:4px">สรุป</div><div style="font-size:13px">${escapeHtml(act.summary||'—')}</div></div>
          <div style="grid-column:1/-1"><div style="font-size:11px;color:var(--text3);margin-bottom:4px">วันที่ / เวลา</div><div style="font-size:13px;font-family:var(--mono)">${formatActivityDate(act.created_at)}</div></div>
        </div>
        ${detailHtml}
      </div>`;
  } catch (e) {
    body.innerHTML = `<div style="padding:24px;color:var(--error)">โหลดล้มเหลว: ${escapeHtml(e.message)}</div>`;
  }
}

// ── System Log ────────────────────────────────────────────────────────────────

async function _fetchAdminSystemLogs() {
  try {
    const logType = _alTab === 'admin' ? 'admin' : 'batool';
    const data = await apiCall(`/api/admin-logs?log_type=${logType}`);
    const payload = data?.data;
    const list = Array.isArray(payload?.logs) ? payload.logs : [];
    _alSystemLogs = [...list].reverse();
    filterAdminSystemLogs();
    const countEl = document.getElementById('alSystemCount');
    const tabLabel = logType === 'admin' ? 'Admin Console' : 'BA Tool';
    if (countEl) countEl.textContent = `${_alSystemLogs.length} รายการ (${tabLabel})`;
  } catch (e) {
    showToast('โหลด System Log ไม่สำเร็จ: ' + e.message, 'error');
  }
}

function setAdminLogFilter(level, btn) {
  _alSystemFilter = level;
  document.querySelectorAll('#adminlog-panel-system .log-filter-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  filterAdminSystemLogs();
}

function filterAdminSystemLogs() {
  const search    = (document.getElementById('alSystemSearch')?.value || '').toLowerCase();
  const terminal  = document.getElementById('alSystemTerminal');
  if (!terminal) return;
  terminal.innerHTML = '';
  const filtered = _alSystemLogs.filter(l =>
    (_alSystemFilter === 'ALL' || (l.level || '').toUpperCase().startsWith(_alSystemFilter.toUpperCase())) &&
    (!search ||
      (l.message || '').toLowerCase().includes(search) ||
      (l.operator || '').toLowerCase().includes(search) ||
      (l.username || '').toLowerCase().includes(search) ||
      (l.timestamp || l.created_at || '').includes(search))
  );
  const tabLabel = _alTab === 'admin' ? 'Admin Console' : 'BA Tool';
  const countEl = document.getElementById('alSystemCount');
  if (countEl) countEl.textContent = `${filtered.length} / ${_alSystemLogs.length} รายการ (${tabLabel})`;
  if (!filtered.length) {
    terminal.innerHTML = `<div style="padding:40px;text-align:center;color:var(--text3)">ไม่พบ Log ในตาราง ${tabLabel}</div>`;
    return;
  }
  filtered.slice(0, 300).forEach(l => {
    const ts  = formatLocalDateTime(l.timestamp || l.created_at);
    const lvl = (l.level || 'INFO').toUpperCase();
    const sf  = l.source_file || null;
    const fileBadge = sf
      ? `<span class="log-file" title="${sf}">${_shortSourceFile(sf)}</span>`
      : '';
    const actor = l.operator || l.username || l.user || l.actor || l.converted_by || l.uploaded_by || null;
    const actorBadge = actor
      ? `<span class="log-file" title="ผู้ใช้งาน: ${escapeAttr(actor)}">User: ${escapeAttr(actor)}</span>`
      : '';
    const line = document.createElement('div');
    line.className = 'log-line';
    line.innerHTML = `<span class="log-ts">${ts}</span><span class="log-lvl ${lvl.toLowerCase()}">${lvl}</span>${actorBadge}${fileBadge}<span class="log-msg">${escapeAttr(l.message || '')}</span>`;
    terminal.appendChild(line);
  });
  terminal.scrollTop = 0;
}

// ── Export ────────────────────────────────────────────────────────────────────

function exportAdminLogs() {
  const tabLabel = _alTab === 'admin' ? 'admin_console' : 'batool';
  const lines = _alSystemLogs.map(l => {
    const sf = l.source_file ? ` [${l.source_file}]` : '';
    const actor = l.operator || l.username || l.user || l.actor || l.converted_by || l.uploaded_by;
    const by = actor ? ` user=${actor}` : '';
    return `${l.created_at || l.timestamp || ''} [${l.level || 'INFO'}]${by}${sf} ${l.message || ''}`;
  }).join('\n');
  _downloadText(lines, `${tabLabel}_logs.txt`, 'text/plain');
}

function _downloadText(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ── System Log retention & clear ─────────────────────────────────────────────

async function _loadSystemLogRetention() {
  const statusEl = document.getElementById('alRetentionStatus');
  try {
    const res = await apiCall('/api/admin-logs/retention');
    _sysLogRetention = res.data || {};
    if (statusEl) {
      if (_sysLogRetention.enabled) {
        statusEl.textContent = `เปิดอยู่ — เก็บ ${_sysLogRetention.retention_days} วัน, รันทุก ${_sysLogRetention.interval_hours} ชม.`;
      } else {
        statusEl.textContent = 'ปิดอยู่ — เปิดได้จากปุ่ม "ตั้งเวลาลบ Log"';
      }
    }
  } catch (e) {
    if (statusEl) statusEl.textContent = 'โหลด retention ไม่สำเร็จ';
  }
}

function _renderRetentionModalFields() {
  const r = _sysLogRetention || {};
  const cb = document.getElementById('sysLogRetentionEnabled');
  if (cb) cb.checked = !!r.enabled;
  _sysLogRetDays  = r.retention_days  || 30;
  _sysLogRetHours = r.interval_hours  || 24;
  document.querySelectorAll('[data-ret-days]').forEach(b =>
    b.classList.toggle('active', parseInt(b.dataset.retDays) === _sysLogRetDays));
  document.querySelectorAll('[data-ret-hours]').forEach(b =>
    b.classList.toggle('active', parseInt(b.dataset.retHours) === _sysLogRetHours));
  const lastEl = document.getElementById('sysLogRetentionLastRun');
  const nextEl = document.getElementById('sysLogRetentionNextRun');
  if (lastEl) lastEl.textContent = r.last_run ? formatLocalDateTime(r.last_run) : '—';
  if (nextEl) nextEl.textContent = r.next_run ? formatLocalDateTime(r.next_run) : '—';
}

async function openSystemLogRetentionModal() {
  // fetch ข้อมูลล่าสุดจาก server ก่อนเปิด modal เสมอ
  try {
    await _loadSystemLogRetention();
  } catch (e) {
    console.warn('[retention] load failed, using cached data:', e.message);
  }
  _renderRetentionModalFields();
  document.querySelectorAll('#sysLogRetentionDaysWrap [data-ret-days]').forEach(b => {
    b.onclick = () => {
      _sysLogRetDays = parseInt(b.dataset.retDays);
      document.querySelectorAll('[data-ret-days]').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
    };
  });
  document.querySelectorAll('#sysLogRetentionIntervalWrap [data-ret-hours]').forEach(b => {
    b.onclick = () => {
      _sysLogRetHours = parseInt(b.dataset.retHours);
      document.querySelectorAll('[data-ret-hours]').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
    };
  });
  openModal('systemLogRetentionModal');
}

function closeSystemLogRetentionModal() {
  document.getElementById('systemLogRetentionModal')?.classList.add('hidden');
}

async function saveSystemLogRetention() {
  const enabled = document.getElementById('sysLogRetentionEnabled')?.checked || false;
  try {
    await apiCall('/api/admin-logs/retention', {
      method: 'PUT',
      body: JSON.stringify({
        enabled,
        retention_days: _sysLogRetDays,
        interval_hours: _sysLogRetHours,
      }),
    });
    showToast('บันทึกการตั้งเวลาลบ log แล้ว', 'success');
    closeSystemLogRetentionModal();
    await _loadSystemLogRetention();
  } catch (e) {
    showToast('บันทึกไม่สำเร็จ: ' + e.message, 'error');
  }
}

async function runSystemLogRetentionNow() {
  try {
    const res = await apiCall('/api/admin-logs/retention/run', { method: 'POST' });
    showToast(res.message || 'รันลบ log เก่าแล้ว', 'success');
    await _loadSystemLogRetention();
    await _fetchAdminSystemLogs();
  } catch (e) {
    showToast('รัน retention ไม่สำเร็จ: ' + e.message, 'error');
  }
}

let _sysLogClearMode = 'now';    // 'now' | 'schedule'
let _sysLogSchedDays = 7;

function setSysLogClearMode(mode) {
  _sysLogClearMode = mode;
  document.getElementById('sysLogClearModeNow')?.classList.toggle('active', mode === 'now');
  document.getElementById('sysLogClearModeSchedule')?.classList.toggle('active', mode === 'schedule');
  document.getElementById('sysLogClearNowPanel').style.display      = mode === 'now' ? '' : 'none';
  document.getElementById('sysLogClearSchedulePanel').style.display  = mode === 'schedule' ? 'flex' : 'none';
  const btn = document.getElementById('btnConfirmSysLogClear');
  if (btn) btn.textContent = mode === 'now' ? 'ยืนยันเคลียร์' : 'บันทึกตั้งเวลา';
}

function openClearSystemLogModal() {
  _sysLogClearDays = 0;
  _sysLogClearMode = 'now';

  // reset mode UI
  setSysLogClearMode('now');

  // reset days buttons
  document.querySelectorAll('[data-sys-days]').forEach(b =>
    b.classList.toggle('active', parseInt(b.dataset.sysDays) === 0));
  const label = document.getElementById('sysLogClearLabel');
  if (label) label.textContent = 'ทั้งหมด';

  // bind immediate days buttons
  document.querySelectorAll('#sysLogClearDaysWrap [data-sys-days]').forEach(b => {
    b.onclick = () => {
      _sysLogClearDays = parseInt(b.dataset.sysDays);
      document.querySelectorAll('[data-sys-days]').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      if (label) label.textContent = _sysLogClearDays === 0 ? 'ทั้งหมด' : `${_sysLogClearDays} วัน`;
    };
  });

  // bind schedule days buttons
  document.querySelectorAll('#sysLogSchedDaysWrap [data-sysret-days]').forEach(b => {
    b.onclick = () => {
      _sysLogSchedDays = parseInt(b.dataset.sysretDays);
      document.querySelectorAll('[data-sysret-days]').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
    };
  });

  // load last/next run from retention settings
  const r = _sysLogRetention || {};
  const lastEl = document.getElementById('sysLogSchedLastRun');
  const nextEl = document.getElementById('sysLogSchedNextRun');
  if (lastEl) lastEl.textContent = r.last_run ? formatLocalDateTime(r.last_run) : '—';
  if (nextEl) nextEl.textContent = r.next_run ? formatLocalDateTime(r.next_run) : '—';

  openModal('clearSystemLogModal');
}

function closeClearSystemLogModal() {
  document.getElementById('clearSystemLogModal')?.classList.add('hidden');
}

async function confirmClearSystemLogs() {
  if (_sysLogClearMode === 'schedule') {
    // บันทึกตั้งเวลา retention โดยใช้ interval = _sysLogSchedDays วัน
    try {
      await apiCall('/api/admin-logs/retention', {
        method: 'PUT',
        body: JSON.stringify({
          enabled: true,
          retention_days: _sysLogSchedDays,
          interval_hours: 24,
        }),
      });
      showToast(`ตั้งเวลาลบ log อัตโนมัติทุก ${_sysLogSchedDays} วันแล้ว`, 'success');
      closeClearSystemLogModal();
      await _loadSystemLogRetention();
    } catch (e) {
      showToast('บันทึกไม่สำเร็จ: ' + e.message, 'error');
    }
    return;
  }

  // mode = 'now'
  const label = _sysLogClearDays === 0 ? 'ทั้งหมด' : `เก่ากว่า ${_sysLogClearDays} วัน`;
  if (!confirm(`ยืนยันลบ log ${label}?`)) return;
  try {
    const path = `/api/admin-logs/clear?days=${_sysLogClearDays}&log_type=all`;
    const res = await apiCall(path, { method: 'DELETE' });
    const deleted = res.data?.deleted ?? 0;
    showToast(`ลบ log สำเร็จ (${deleted} รายการ)`, 'success');
    closeClearSystemLogModal();
    await fetchAdminLogs();
  } catch (e) {
    showToast('ลบไม่สำเร็จ: ' + e.message, 'error');
  }
}

async function clearAdminLogs() {
  openClearSystemLogModal();
}