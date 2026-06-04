<!DOCTYPE html>
<html lang="th" data-theme="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Database Explorer · BA Tool</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="erd.css" />
  <style>
    /* override font vars ให้ match project เดิม */
    :root {
      --mono: 'JetBrains Mono', monospace;
      --sans: 'DM Sans', system-ui, sans-serif;
    }
  </style>
</head>
<body>

<div id="erd-root">

  <!-- ── Toolbar ─────────────────────────────────────────────── -->
  <div id="erd-toolbar">
    <div class="logo">
      <div class="dot"></div>
      Database Explorer
    </div>

    <!-- back to admin console -->
    <a href="../index.html" style="
      display:flex;align-items:center;gap:6px;
      padding:5px 10px;border-radius:5px;border:1px solid var(--border);
      background:transparent;color:var(--text-2);
      font-family:var(--mono);font-size:11px;
      text-decoration:none;transition:all 160ms ease;
    " onmouseover="this.style.background='var(--bg-3)';this.style.color='var(--text)'"
       onmouseout="this.style.background='transparent';this.style.color='var(--text-2)'">
      ← Admin Console
    </a>

    <div class="sep"></div>

    <button class="tb-btn" id="btn-fit" title="Fit to screen">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M1 6V1h5M10 1h5v5M15 10v5h-5M6 15H1v-5"/>
      </svg>
      Fit
    </button>

    <button class="tb-btn" id="btn-reset-layout" title="Re-arrange layout">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M13.7 2.3A7 7 0 1 0 15 8" stroke-linecap="round"/>
        <path d="M11 2h3v3" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      Re-layout
    </button>

    <button class="tb-btn" id="btn-refresh" title="Refresh schema">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
        <circle cx="8" cy="8" r="6"/>
        <path d="M8 5v3l2 2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      Refresh
    </button>

    <div class="spacer"></div>

    <span id="table-count" style="font-family:var(--mono);font-size:10px;color:var(--text-3);"></span>

    <div class="sep"></div>

    <div id="status-pill" class="status-pill loading">
      <div class="indicator"></div>
      <span id="status-text">Loading schema…</span>
    </div>
  </div>

  <!-- ── Canvas ──────────────────────────────────────────────── -->
  <div id="erd-canvas-wrap">
    <div id="erd-canvas">
      <svg id="erd-svg" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <marker id="arrow" markerWidth="8" markerHeight="8"
                  refX="6" refY="3" orient="auto">
            <path d="M0,0 L0,6 L8,3 z" class="erd-edge-arrow" fill="var(--border-2)"/>
          </marker>
          <marker id="arrow-hl" markerWidth="8" markerHeight="8"
                  refX="6" refY="3" orient="auto">
            <path d="M0,0 L0,6 L8,3 z" fill="var(--accent)"/>
          </marker>
        </defs>
      </svg>
    </div>
  </div>

  <!-- ── Zoom controls ───────────────────────────────────────── -->
  <div id="erd-zoom-controls">
    <button class="zoom-btn" id="btn-zoom-in" title="Zoom in">+</button>
    <div id="zoom-label">100%</div>
    <button class="zoom-btn" id="btn-zoom-out" title="Zoom out">−</button>
  </div>

  <!-- ── Inspector panel ─────────────────────────────────────── -->
  <div id="erd-inspector">
    <div class="inspector-header">
      <div class="inspector-title" id="inspector-table-name">—</div>
      <button class="inspector-close" id="inspector-close-btn" title="Close">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M1 1l10 10M11 1L1 11"/>
        </svg>
      </button>
    </div>

    <div class="inspector-tabs">
      <div class="inspector-tab active" data-tab="schema">Schema</div>
      <div class="inspector-tab" data-tab="data">Data</div>
    </div>

    <div class="inspector-body" id="inspector-body"></div>

    <div class="data-pagination" id="data-pagination" style="display:none">
      <span class="pg-info" id="pg-info">—</span>
      <button id="pg-prev">← Prev</button>
      <button id="pg-next">Next →</button>
    </div>
  </div>

</div><!-- #erd-root -->

<script>
  /* ดึง API_URL เหมือนกับ app.js เดิม */
  function getDefaultApiUrl() {
    return 'https://admin-console-batool.onrender.com';
  }
  window.ERD_API_BASE = (
    window.BA_API_URL ||
    window.API_URL ||
    localStorage.getItem('ba_api_url') ||
    getDefaultApiUrl()
  ).replace(/\/$/, '');
</script>
<script src="erd.js"></script>

</body>
</html>
