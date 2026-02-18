// ── Config ────────────────────────────────────────────────────────────────────
const VALIDATOR_KEY = 'nHBM2nzq3pZUg8JsxvEt3G7gAAtc5Sukaef6YmvVx64uAoRK4QWM';
const VHS_URL       = `https://vhs.testnet.postfiat.org/v1/network/validator/${VALIDATOR_KEY}`;
const REFRESH_MS    = 60 * 1000;   // refresh every 60 seconds

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
    const res = await fetch(VHS_URL + '?t=' + Date.now());
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    if (data.result !== 'success') throw new Error('result: ' + data.result);
    render(data);
  } catch {
    setStatus('error');
  }
}

function render(data) {
  setStatus('live');

  const a1h   = data.agreement_1h  || {};
  const score = parseFloat(a1h.score || 0);

  elUptime.textContent     = (score * 100).toFixed(2) + '%';
  elAgreements.textContent = formatNum((a1h.total || 0) - (a1h.missed || 0));
  elMissed.textContent     = formatNum(a1h.missed || 0);
  elLedger.textContent     = data.current_index ? formatNum(data.current_index) : '—';

  elUptime.className = 'live-val ' +
    (score >= 0.95 ? 'live-val--green' : score < 0.80 ? 'live-val--red' : '');

  // ── "Updated X min ago" ticker ──
  const fetchedAt = Date.now();
  elUpdated.textContent = 'Updated just now';
  clearInterval(window._updateTick);
  window._updateTick = setInterval(() => {
    const m = Math.round((Date.now() - fetchedAt) / 60000);
    elUpdated.textContent = m < 1 ? 'Updated just now' : `Updated ${m}m ago`;
  }, 60000);

  // ── Footer info row ──
  const a24h = data.agreement_24h || {};
  const score24 = a24h.score ? (parseFloat(a24h.score) * 100).toFixed(2) + '%' : '—';
  elLastVal.textContent = `⬡ Chain: ${data.chain || 'test'}  ·  24h score: ${score24}  ·  v${data.server_version || '—'}`;
}

// ── Status badge ──────────────────────────────────────────────────────────────
function setStatus(state) {
  elDot.className   = 'ws-dot';
  elLabel.className = 'ws-label';

  const map = {
    live:  { dot: 'ws-dot--live',  label: 'ws-label--live',  text: 'LIVE'  },
    error: { dot: 'ws-dot--error', label: 'ws-label--error', text: 'ERROR' },
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
