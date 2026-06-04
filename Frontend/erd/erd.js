/**
 * ERD Viewer — erd.js
 * Interactive entity-relationship diagram for admin_console_BATOOL
 *
 * Architecture:
 *  - Fetch schema from FastAPI backend (/api/schema/*)
 *  - Render draggable nodes + SVG edges on a pannable/zoomable canvas
 *  - Right inspector panel: schema + live data preview
 *  - No external dependencies; vanilla JS only
 */

'use strict';

/* ── Config ──────────────────────────────────────────────────── */
const API_BASE   = (typeof window !== 'undefined' && window.ERD_API_BASE) ? window.ERD_API_BASE : '';
const PAGE_LIMIT = 50;
const NODE_W     = 220;
const NODE_H_HDR = 38;
const NODE_ROW_H = 24;
const MAX_COLS   = 7;           // columns shown before "+N more"

/* ── State ───────────────────────────────────────────────────── */
const state = {
  tables:    [],    // [{table_name}]
  columns:   {},    // { tableName: [{column_name,data_type,is_nullable,...}] }
  relations: [],    // [{table_name,column_name,foreign_table,foreign_column}]
  positions: {},    // { tableName: {x,y} }
  selectedTable: null,
  inspectorTab: 'schema',
  dataOffset: 0,
  dataTotal: null,
  dataRows: [],
  zoom: 1,
  pan:  { x: 60, y: 60 },
};

/* ── DOM refs ────────────────────────────────────────────────── */
const $ = id => document.getElementById(id);
const wrap      = $('erd-canvas-wrap');
const canvas    = $('erd-canvas');
const svg       = $('erd-svg');
const inspector = $('erd-inspector');
const inspBody  = $('inspector-body');
const statusPill = $('status-pill');
const statusText = $('status-text');

/* ── Utility ─────────────────────────────────────────────────── */
function setStatus(type, text) {
  statusPill.className = `status-pill ${type}`;
  statusText.textContent = text;
}

function shortType(t = '') {
  return t.replace('character varying', 'varchar')
          .replace('timestamp without time zone', 'timestamp')
          .replace('timestamp with time zone', 'timestamptz')
          .replace('double precision', 'float8')
          .replace('boolean', 'bool')
          .replace('integer', 'int4')
          .replace('bigint', 'int8')
          .substring(0, 14);
}

function isPK(col) {
  return col.column_name === 'id' ||
         (col.column_default && col.column_default.includes('nextval')) ||
         (col.column_default && col.column_default.includes('gen_random_uuid')) ||
         col.column_name.toLowerCase() === 'uuid';
}

function isFK(tableName, colName) {
  return state.relations.some(r =>
    r.table_name === tableName && r.column_name === colName
  );
}

async function apiFetch(path) {
  const r = await fetch(API_BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
  });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} — ${path}`);
  return r.json();
}

/* ── Force layout ────────────────────────────────────────────── */
function computeLayout() {
  const n = state.tables.length;
  if (n === 0) return;

  // Build adjacency
  const adj = {};
  state.tables.forEach(t => { adj[t.table_name] = new Set(); });
  state.relations.forEach(r => {
    adj[r.table_name]?.add(r.foreign_table);
    adj[r.foreign_table]?.add(r.table_name);
  });

  // Grid seed positions (fast, avoids expensive force simulation for large schemas)
  const cols = Math.ceil(Math.sqrt(n * 1.4));
  state.tables.forEach((t, i) => {
    if (state.positions[t.table_name]) return; // keep user-dragged positions
    const col = i % cols;
    const row = Math.floor(i / cols);
    state.positions[t.table_name] = {
      x: 40 + col * (NODE_W + 50),
      y: 40 + row * 220,
    };
  });
}

/* ── Render nodes ────────────────────────────────────────────── */
function renderNodes() {
  // Remove old nodes
  canvas.querySelectorAll('.erd-node').forEach(n => n.remove());

  state.tables.forEach(t => {
    const name = t.table_name;
    const cols  = state.columns[name] || [];
    const pos   = state.positions[name] || { x: 0, y: 0 };
    const fkCols = new Set(
      state.relations.filter(r => r.table_name === name).map(r => r.column_name)
    );

    const node = document.createElement('div');
    node.className = 'erd-node';
    node.dataset.table = name;
    node.style.left = pos.x + 'px';
    node.style.top  = pos.y + 'px';

    const previewCols = cols.slice(0, MAX_COLS);
    const extra = cols.length - previewCols.length;

    node.innerHTML = `
      <div class="node-header">
        <div class="node-icon">T</div>
        <div class="node-title" title="${name}">${name}</div>
        <div class="node-badge">${cols.length}</div>
      </div>
      <div class="node-cols">
        ${previewCols.map(c => {
          const pk = isPK(c);
          const fk = fkCols.has(c.column_name);
          const keyIcon = pk
            ? `<svg viewBox="0 0 10 10" fill="none" stroke="var(--amber)" stroke-width="1.2"><circle cx="4" cy="4" r="2.5"/><path d="M6.5 4H9M7.5 3v2" stroke-linecap="round"/></svg>`
            : fk
              ? `<svg viewBox="0 0 10 10" fill="none" stroke="var(--accent)" stroke-width="1.2"><path d="M2 5h6M6 3l2 2-2 2" stroke-linecap="round" stroke-linejoin="round"/></svg>`
              : ``;
          return `
            <div class="node-col">
              <span class="col-key">${keyIcon}</span>
              <span class="col-name ${pk ? 'pk' : fk ? 'fk' : ''}">${c.column_name}</span>
              <span class="col-type">${shortType(c.data_type)}</span>
            </div>`;
        }).join('')}
        ${extra > 0 ? `<div class="node-more">+${extra} more columns</div>` : ''}
      </div>`;

    // Drag
    makeDraggable(node, name);

    // Click → inspector
    node.addEventListener('click', e => {
      if (node.classList.contains('dragging')) return;
      e.stopPropagation();
      selectTable(name);
    });

    canvas.appendChild(node);
  });
}

/* ── Render edges ────────────────────────────────────────────── */
function renderEdges() {
  // Clear old edges
  svg.querySelectorAll('.erd-edge, .erd-edge-path').forEach(e => e.remove());

  state.relations.forEach((rel, i) => {
    const src = state.positions[rel.table_name];
    const dst = state.positions[rel.foreign_table];
    if (!src || !dst || rel.table_name === rel.foreign_table) return;

    const x1 = src.x + NODE_W;
    const y1 = src.y + 28;
    const x2 = dst.x;
    const y2 = dst.y + 28;

    const cx1 = x1 + (x2 - x1) * 0.5;
    const cx2 = x2 - (x2 - x1) * 0.5;

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('class', 'erd-edge');
    path.setAttribute('d', `M ${x1} ${y1} C ${cx1} ${y1}, ${cx2} ${y2}, ${x2} ${y2}`);
    path.setAttribute('marker-end', 'url(#arrow)');
    path.dataset.src = rel.table_name;
    path.dataset.dst = rel.foreign_table;

    path.addEventListener('mouseenter', () => highlightRelation(rel.table_name, rel.foreign_table));
    path.addEventListener('mouseleave', clearHighlight);
    path.addEventListener('click', () => selectTable(rel.table_name));

    svg.appendChild(path);
  });
}

/* Edge positions update (called after drag) */
function updateEdgeForTable(tableName) {
  svg.querySelectorAll('.erd-edge').forEach(path => {
    const src = path.dataset.src;
    const dst = path.dataset.dst;
    if (src !== tableName && dst !== tableName) return;

    const srcPos = state.positions[src];
    const dstPos = state.positions[dst];
    if (!srcPos || !dstPos) return;

    const x1 = srcPos.x + NODE_W;
    const y1 = srcPos.y + 28;
    const x2 = dstPos.x;
    const y2 = dstPos.y + 28;
    const cx1 = x1 + (x2 - x1) * 0.5;
    const cx2 = x2 - (x2 - x1) * 0.5;
    path.setAttribute('d', `M ${x1} ${y1} C ${cx1} ${y1}, ${cx2} ${y2}, ${x2} ${y2}`);
  });
}

/* ── Highlight relations ─────────────────────────────────────── */
function highlightRelation(srcTable, dstTable) {
  canvas.querySelectorAll('.erd-node').forEach(node => {
    const t = node.dataset.table;
    if (t === srcTable || t === dstTable) {
      node.classList.remove('dimmed');
    } else {
      node.classList.add('dimmed');
    }
  });
  svg.querySelectorAll('.erd-edge').forEach(path => {
    if (path.dataset.src === srcTable && path.dataset.dst === dstTable) {
      path.classList.add('highlighted');
      path.classList.remove('dimmed');
    } else {
      path.classList.add('dimmed');
      path.classList.remove('highlighted');
    }
  });
}

function clearHighlight() {
  canvas.querySelectorAll('.erd-node').forEach(n => n.classList.remove('dimmed'));
  svg.querySelectorAll('.erd-edge').forEach(p => {
    p.classList.remove('highlighted', 'dimmed');
  });
}

/* ── Drag ────────────────────────────────────────────────────── */
function makeDraggable(node, tableName) {
  const header = node.querySelector('.node-header');
  let dragging = false;
  let startMouse = { x: 0, y: 0 };
  let startPos   = { x: 0, y: 0 };

  function onDown(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    dragging = true;
    startMouse = { x: e.clientX, y: e.clientY };
    startPos   = { ...state.positions[tableName] };
    node.classList.add('dragging');
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  function onMove(e) {
    if (!dragging) return;
    const dx = (e.clientX - startMouse.x) / state.zoom;
    const dy = (e.clientY - startMouse.y) / state.zoom;
    const x = Math.max(0, startPos.x + dx);
    const y = Math.max(0, startPos.y + dy);
    state.positions[tableName] = { x, y };
    node.style.left = x + 'px';
    node.style.top  = y + 'px';
    updateEdgeForTable(tableName);
  }

  function onUp() {
    dragging = false;
    node.classList.remove('dragging');
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  }

  header.addEventListener('mousedown', onDown);
}

/* ── Pan & zoom ──────────────────────────────────────────────── */
(function initPanZoom() {
  let panning = false;
  let startPan = { x: 0, y: 0 };
  let startMouse = { x: 0, y: 0 };

  wrap.addEventListener('mousedown', e => {
    if (e.target !== wrap && e.target !== canvas && e.target !== svg) return;
    panning = true;
    startPan = { ...state.pan };
    startMouse = { x: e.clientX, y: e.clientY };
    wrap.classList.add('panning');
  });

  document.addEventListener('mousemove', e => {
    if (!panning) return;
    state.pan.x = startPan.x + e.clientX - startMouse.x;
    state.pan.y = startPan.y + e.clientY - startMouse.y;
    applyTransform();
  });

  document.addEventListener('mouseup', () => {
    panning = false;
    wrap.classList.remove('panning');
  });

  wrap.addEventListener('wheel', e => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.1 : -0.1;
    const newZoom = Math.min(2, Math.max(0.2, state.zoom + delta));

    // Zoom towards cursor
    const rect = wrap.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    state.pan.x = mx - (mx - state.pan.x) * (newZoom / state.zoom);
    state.pan.y = my - (my - state.pan.y) * (newZoom / state.zoom);
    state.zoom = newZoom;
    applyTransform();
  }, { passive: false });

  $('btn-zoom-in').addEventListener('click', () => changeZoom(0.15));
  $('btn-zoom-out').addEventListener('click', () => changeZoom(-0.15));

  function changeZoom(d) {
    const rect = wrap.getBoundingClientRect();
    const cx = rect.width / 2, cy = rect.height / 2;
    const nz = Math.min(2, Math.max(0.2, state.zoom + d));
    state.pan.x = cx - (cx - state.pan.x) * (nz / state.zoom);
    state.pan.y = cy - (cy - state.pan.y) * (nz / state.zoom);
    state.zoom = nz;
    applyTransform();
  }
})();

function applyTransform() {
  canvas.style.transform = `translate(${state.pan.x}px,${state.pan.y}px) scale(${state.zoom})`;
  $('zoom-label').textContent = Math.round(state.zoom * 100) + '%';
}

/* ── Fit to screen ───────────────────────────────────────────── */
function fitView() {
  if (state.tables.length === 0) return;
  const rect = wrap.getBoundingClientRect();
  const positions = Object.values(state.positions);
  const minX = Math.min(...positions.map(p => p.x));
  const minY = Math.min(...positions.map(p => p.y));
  const maxX = Math.max(...positions.map(p => p.x + NODE_W));
  const maxY = Math.max(...positions.map(p => p.y + 180));
  const contentW = maxX - minX + 80;
  const contentH = maxY - minY + 80;
  const zx = rect.width / contentW;
  const zy = (rect.height) / contentH;
  state.zoom = Math.min(1.2, Math.max(0.2, Math.min(zx, zy)));
  state.pan.x = (rect.width  - contentW * state.zoom) / 2 - minX * state.zoom + 40;
  state.pan.y = (rect.height - contentH * state.zoom) / 2 - minY * state.zoom + 40;
  applyTransform();
}

$('btn-fit').addEventListener('click', fitView);

$('btn-reset-layout').addEventListener('click', () => {
  state.positions = {};
  computeLayout();
  renderNodes();
  renderEdges();
  fitView();
});

$('btn-refresh').addEventListener('click', async () => {
  await apiFetch('/api/schema/refresh').catch(() => {});
  state.columns = {};
  await loadSchema();
});

/* ── Inspector ───────────────────────────────────────────────── */
async function selectTable(tableName) {
  state.selectedTable = tableName;
  state.dataOffset = 0;

  // Highlight selected node
  canvas.querySelectorAll('.erd-node').forEach(n => {
    n.classList.toggle('selected', n.dataset.table === tableName);
  });

  // Highlight connected edges/nodes
  const connected = new Set([tableName]);
  state.relations.forEach(r => {
    if (r.table_name === tableName) connected.add(r.foreign_table);
    if (r.foreign_table === tableName) connected.add(r.table_name);
  });

  canvas.querySelectorAll('.erd-node').forEach(n => {
    n.classList.toggle('dimmed', !connected.has(n.dataset.table) && n.dataset.table !== tableName);
  });

  svg.querySelectorAll('.erd-edge').forEach(p => {
    const rel = p.dataset.src === tableName || p.dataset.dst === tableName;
    p.classList.toggle('highlighted', rel);
    p.classList.toggle('dimmed', !rel);
  });

  // Open inspector
  $('inspector-table-name').textContent = tableName;
  inspector.classList.add('open');

  // Load columns if needed
  if (!state.columns[tableName]) {
    await loadColumns(tableName);
  }

  renderInspector();

  if (state.inspectorTab === 'data') {
    await loadData(tableName, 0);
  }
}

function closeInspector() {
  inspector.classList.remove('open');
  state.selectedTable = null;
  canvas.querySelectorAll('.erd-node').forEach(n => n.classList.remove('selected', 'dimmed'));
  svg.querySelectorAll('.erd-edge').forEach(p => p.classList.remove('highlighted', 'dimmed'));
}

$('inspector-close-btn').addEventListener('click', closeInspector);
wrap.addEventListener('click', e => {
  if (e.target === wrap || e.target === canvas) closeInspector();
});

// Tabs
document.querySelectorAll('.inspector-tab').forEach(tab => {
  tab.addEventListener('click', async () => {
    document.querySelectorAll('.inspector-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    state.inspectorTab = tab.dataset.tab;
    renderInspector();
    if (state.inspectorTab === 'data' && state.selectedTable) {
      await loadData(state.selectedTable, state.dataOffset);
    }
  });
});

function renderInspector() {
  if (state.inspectorTab === 'schema') {
    renderSchemaTab();
    $('data-pagination').style.display = 'none';
  } else {
    renderDataTab();
  }
}

function renderSchemaTab() {
  const tableName = state.selectedTable;
  const cols = state.columns[tableName] || [];
  const fkSet = new Set(
    state.relations.filter(r => r.table_name === tableName).map(r => r.column_name)
  );

  const inboundRels = state.relations.filter(r => r.foreign_table === tableName);
  const outboundRels = state.relations.filter(r => r.table_name === tableName);

  inspBody.innerHTML = `
    <div class="schema-section">
      <div class="schema-label">Columns (${cols.length})</div>
      ${cols.map(c => {
        const pk = isPK(c);
        const fk = fkSet.has(c.column_name);
        return `
          <div class="schema-col-row">
            <span class="schema-col-name ${pk ? 'pk' : fk ? 'fk' : ''}">${c.column_name}</span>
            <span class="schema-col-type">${shortType(c.data_type)}</span>
            ${pk ? '<span class="schema-badge badge-pk">PK</span>' : ''}
            ${fk ? '<span class="schema-badge badge-fk">FK</span>' : ''}
            ${c.is_nullable === 'YES' && !pk ? '<span class="schema-badge badge-nullable">null</span>' : ''}
          </div>`;
      }).join('')}
    </div>

    ${outboundRels.length > 0 ? `
    <div class="schema-section" style="border-top:1px solid var(--border);padding-top:14px">
      <div class="schema-label">References →</div>
      ${outboundRels.map(r => `
        <div class="schema-col-row" style="cursor:pointer" onclick="selectTable('${r.foreign_table}')">
          <span class="schema-col-name fk">${r.column_name}</span>
          <span class="schema-col-type">→ ${r.foreign_table}.${r.foreign_column}</span>
        </div>`).join('')}
    </div>` : ''}

    ${inboundRels.length > 0 ? `
    <div class="schema-section" style="border-top:1px solid var(--border);padding-top:14px">
      <div class="schema-label">Referenced by ←</div>
      ${inboundRels.map(r => `
        <div class="schema-col-row" style="cursor:pointer" onclick="selectTable('${r.table_name}')">
          <span class="schema-col-name" style="color:var(--green)">${r.table_name}.${r.column_name}</span>
          <span class="schema-col-type">← ${r.column_name}</span>
        </div>`).join('')}
    </div>` : ''}
  `;
}

function renderDataTab() {
  inspBody.innerHTML = `<div class="data-loading">Loading data…</div>`;
  $('data-pagination').style.display = 'none';
}

/* ── Data loading ────────────────────────────────────────────── */
async function loadData(tableName, offset) {
  inspBody.innerHTML = `<div class="data-loading">⟳ Fetching rows…</div>`;
  $('data-pagination').style.display = 'none';

  try {
    const result = await apiFetch(`/api/table/${encodeURIComponent(tableName)}/data?limit=${PAGE_LIMIT}&offset=${offset}`);
    state.dataRows   = result.rows;
    state.dataOffset = offset;
    state.dataTotal  = result.total;
    renderDataRows(tableName, result.rows, result.total, offset);
  } catch (err) {
    inspBody.innerHTML = `<div class="data-loading" style="color:var(--red)">Error: ${err.message}</div>`;
  }
}

function renderDataRows(tableName, rows, total, offset) {
  if (!rows || rows.length === 0) {
    inspBody.innerHTML = `<div class="data-loading">No rows returned.</div>`;
    return;
  }

  const headers = Object.keys(rows[0]);

  const table = `
    <div class="data-table-wrap">
      <table class="data-table">
        <thead>
          <tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr>
        </thead>
        <tbody>
          ${rows.map(row => `
            <tr>${headers.map(h => {
              const v = row[h];
              if (v === null || v === undefined) return `<td class="null-val">NULL</td>`;
              const str = typeof v === 'object' ? JSON.stringify(v) : String(v);
              return `<td title="${str.replace(/"/g, '&quot;')}">${str.substring(0, 80)}</td>`;
            }).join('')}</tr>`).join('')}
        </tbody>
      </table>
    </div>`;

  inspBody.innerHTML = table;

  // Pagination
  const pag = $('data-pagination');
  const info = $('pg-info');
  pag.style.display = 'flex';
  info.textContent = `${offset + 1}–${offset + rows.length}${total != null ? ' of ~' + total : ''}`;
  $('pg-prev').disabled = offset === 0;
  $('pg-next').disabled = rows.length < PAGE_LIMIT;
  $('pg-prev').onclick = () => loadData(tableName, Math.max(0, offset - PAGE_LIMIT));
  $('pg-next').onclick = () => loadData(tableName, offset + PAGE_LIMIT);
}

/* ── Schema loading ──────────────────────────────────────────── */
async function loadColumns(tableName) {
  try {
    const cols = await apiFetch(`/api/schema/columns/${encodeURIComponent(tableName)}`);
    state.columns[tableName] = cols;
  } catch (e) {
    console.warn(`Could not load columns for ${tableName}:`, e);
    state.columns[tableName] = [];
  }
}

async function prefetchAllColumns() {
  // Load columns for all tables in parallel (batched)
  const batchSize = 10;
  for (let i = 0; i < state.tables.length; i += batchSize) {
    const batch = state.tables.slice(i, i + batchSize);
    await Promise.all(batch.map(t => loadColumns(t.table_name)));
    // Re-render nodes as column data comes in
    renderNodes();
  }
}

/* ── Bootstrap ───────────────────────────────────────────────── */
async function loadSchema() {
  setStatus('loading', 'Fetching tables…');
  try {
    const [tables, relations] = await Promise.all([
      apiFetch('/api/schema/tables'),
      apiFetch('/api/schema/relations'),
    ]);

    state.tables    = tables;
    state.relations = relations;

    $('table-count').textContent = `${tables.length} tables · ${relations.length} relations`;

    setStatus('loading', `Laying out ${tables.length} tables…`);
    computeLayout();
    renderNodes();
    renderEdges();

    setStatus('ready', 'Schema loaded');

    // Fit after a tiny delay (so nodes have rendered dimensions)
    setTimeout(fitView, 80);

    // Background-fetch all column metadata
    prefetchAllColumns();

  } catch (err) {
    setStatus('error', 'Failed to load schema');
    canvas.innerHTML = `
      <div class="erd-empty">
        <div class="empty-icon">⚠</div>
        <p>Could not connect to the API.<br>${err.message}</p>
      </div>`;
    console.error(err);
  }
}

// Expose for inline onclick handlers in schema tab
window.selectTable = name => selectTable(name);

// Start
applyTransform();
loadSchema();
