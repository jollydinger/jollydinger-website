// ── Config ────────────────────────────────────────────────────────────────────
const DATA_URL      = '/data/validator.json';
const REFRESH_MS    = 15 * 60 * 1000;   // re-fetch every 15 min (matches Action)
const STALE_WARN_MS = 20 * 60 * 1000;   // amber if data older than 20 min
const STALE_ERR_MS  = 60 * 60 * 1000;   // red if older than 60 min

// ── DOM refs ──────────────────────────────────────────────────────────────────
const elDot        = document.getElementById('wsDot');
const elLabel      = document.getElementById('wsLabel');
const elUpdated    = document.getElementById('lastUpdated');
const elUptime     = document.getElementById('statUptime');
const elAgreements = document.getElementById('statAgreements');
const elMissed     = document.getElementById('statMissed');
const elLedger     = document.getElementById('statLedger');
const elLastVal    = document.getElementById('lastValidated');

// ── Fetch & render ────────────────────────────────────────────────────────────
async function fetchStats() {
  try {
    // Cache-bust so GitHub Pages doesn't serve stale file
    const res  = await fetch(DATA_URL + '?t=' + Date.now());
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    render(data);
  } catch {
    setStatus('error');
  }
}

function render(data) {
  const updatedAt = data.updated_at ? new Date(data.updated_at) : null;
  const ageMs     = updatedAt ? Date.now() - updatedAt.getTime() : Infinity;

  // ── Badge status based on data freshness ──
  if (ageMs < STALE_WARN_MS) {
    setStatus('live');
  } else if (ageMs < STALE_ERR_MS) {
    setStatus('polling');   // amber = stale but not dead
  } else {
    setStatus('error');
  }

  // ── Uptime / agreement ──
  if (data.validator_found && data.score !== '') {
    const score = parseFloat(data.score);

    elUptime.textContent     = (score * 100).toFixed(1) + '%';
    elAgreements.textContent = formatNum(data.total - data.missed);
    elMissed.textContent     = formatNum(data.missed);
    elUptime.className       = 'live-val ' +
      (score >= 0.95 ? 'live-val--green' : score < 0.80 ? 'live-val--red' : '');
  } else {
    elUptime.textContent     = 'N/A';
    elAgreements.textContent = 'N/A';
    elMissed.textContent     = 'N/A';
  }

  // Ledger is not in the static file — keep showing — if we ever add it
  // elLedger stays at — until a future enhancement

  // ── "Updated X min ago" ──
  if (updatedAt) {
    const mins = Math.round(ageMs / 60000);
    elUpdated.textContent = mins < 1
      ? 'Updated just now'
      : `Updated ${mins}m ago`;

    // Tick the relative timestamp every minute
    clearInterval(window._updateTick);
    window._updateTick = setInterval(() => {
      const m = Math.round((Date.now() - updatedAt.getTime()) / 60000);
      elUpdated.textContent = m < 1 ? 'Updated just now' : `Updated ${m}m ago`;
    }, 60000);
  }

  // ── Network state in the last-validated row ──
  if (data.network_state && data.network_state !== 'unknown') {
    elLastVal.textContent = `⬡ Network: ${data.network_state}`;
  }
}

// ── Status badge ──────────────────────────────────────────────────────────────
function setStatus(state) {
  elDot.className   = 'ws-dot';
  elLabel.className = 'ws-label';

  const map = {
    live:    { dot: 'ws-dot--live',        label: 'ws-label--live',        text: 'LIVE'    },
    polling: { dot: 'ws-dot--polling',     label: 'ws-label--polling',     text: 'STALE'   },
    error:   { dot: 'ws-dot--error',        label: 'ws-label--error',        text: 'ERROR'   },
  };

  const s = map[state] || map.error;
  elDot.classList.add(s.dot);
  elLabel.classList.add(s.label);
  elLabel.textContent = s.text;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatNum(n) {
  return Number(n).toLocaleString();
}

// ── Copy key ──────────────────────────────────────────────────────────────────
function copyKey(btn, key) {
  navigator.clipboard.writeText(key).then(() => {
    btn.classList.add('copied');
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>Copied!`;
    setTimeout(() => {
      btn.classList.remove('copied');
      btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>Copy`;
    }, 2000);
  });
}

// ── Mouse parallax ────────────────────────────────────────────────────────────
document.addEventListener('mousemove', (e) => {
  const glow = document.querySelector('.bg-glow');
  if (!glow) return;
  glow.style.transform = `translate(${(e.clientX / window.innerWidth) * 10 - 5}px, ${(e.clientY / window.innerHeight) * 10 - 5}px)`;
});

// ── Boot ──────────────────────────────────────────────────────────────────────
fetchStats();
setInterval(fetchStats, REFRESH_MS);
