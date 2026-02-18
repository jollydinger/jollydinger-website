// ── Config ────────────────────────────────────────────────────────────────────
const WS_URL        = 'wss://rpc.testnet.postfiat.org:6007';
const HTTP_URL      = 'https://rpc.testnet.postfiat.org/';
const VALIDATOR_KEY = 'nHBM2nzq3pZUg8JsxvEt3G7gAAtc5Sukaef6YmvVx64uAoRK4QWM';
const MAX_WS_TRIES  = 3;    // give up on WS after this many failed attempts
const POLL_INTERVAL = 10000; // HTTP poll every 10 s

// ── State ─────────────────────────────────────────────────────────────────────
let ws              = null;
let wsAttempts      = 0;
let reconnectTimer  = null;
let reconnectDelay  = 2000;
let pollTimer       = null;
let lastValidatedAt = null;
let relativeTimer   = null;

// ── DOM refs ──────────────────────────────────────────────────────────────────
const elDot        = document.getElementById('wsDot');
const elLabel      = document.getElementById('wsLabel');
const elUpdated    = document.getElementById('lastUpdated');
const elUptime     = document.getElementById('statUptime');
const elAgreements = document.getElementById('statAgreements');
const elMissed     = document.getElementById('statMissed');
const elLedger     = document.getElementById('statLedger');
const elLastVal    = document.getElementById('lastValidated');

// ── Entry point ───────────────────────────────────────────────────────────────
function connect() {
  setStatus('connecting');
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    wsAttempts    = 0;
    reconnectDelay = 2000;
    stopPolling();        // WS is working — don't need HTTP polling
    setStatus('live');

    send({ id: 'validators', command: 'validators' });
    send({ id: 'subscribe', command: 'subscribe', streams: ['ledger', 'validations'] });
  };

  ws.onmessage = (evt) => {
    let data;
    try { data = JSON.parse(evt.data); } catch { return; }
    handleMessage(data);
  };

  ws.onerror = () => {}; // handled in onclose

  ws.onclose = () => {
    wsAttempts++;
    if (wsAttempts >= MAX_WS_TRIES) {
      // WebSocket isn't going to work (likely cert issue on port 6007).
      // Switch permanently to HTTP polling.
      setStatus('polling');
      startPolling();
    } else {
      setStatus('reconnecting');
      scheduleReconnect();
    }
  };
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    reconnectDelay = Math.min(reconnectDelay * 1.5, 30000);
    connect();
  }, reconnectDelay);
}

function send(payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

// ── HTTP polling fallback ─────────────────────────────────────────────────────
function startPolling() {
  fetchHTTP();                            // immediate first hit
  pollTimer = setInterval(fetchHTTP, POLL_INTERVAL);
}

function stopPolling() {
  clearInterval(pollTimer);
  pollTimer = null;
}

async function fetchHTTP() {
  try {
    // Validators — uptime / agreement stats
    const vRes = await fetch(HTTP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'validators', params: [{}] }),
    });
    const vJson = await vRes.json();
    if (vJson.result) handleValidators(vJson.result);

    // Server info — current ledger index
    const sRes = await fetch(HTTP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'server_info', params: [{}] }),
    });
    const sJson = await sRes.json();
    if (sJson.result?.info?.validated_ledger?.seq) {
      elLedger.textContent = formatNum(sJson.result.info.validated_ledger.seq);
    }

    setStatus('polling'); // confirm still healthy after each successful poll
  } catch {
    setStatus('error');
  }
}

// ── Message routing (WebSocket path) ─────────────────────────────────────────
function handleMessage(data) {
  if (data.id === 'validators' && data.result) {
    handleValidators(data.result);
  }
  if (data.type === 'ledgerClosed') {
    handleLedgerClosed(data);
  }
  if (data.type === 'validationReceived') {
    handleValidation(data);
  }
}

// ── Handlers ──────────────────────────────────────────────────────────────────
function handleValidators(result) {
  const list = result.validators || [];
  const v    = list.find((x) => x.validation_public_key === VALIDATOR_KEY);

  if (!v) {
    elUptime.textContent     = 'N/A';
    elAgreements.textContent = 'N/A';
    elMissed.textContent     = 'N/A';
    return;
  }

  const agreement = v.agreement || {};
  const score     = parseFloat(agreement.score ?? 1);
  const total     = agreement.total  ?? 0;
  const missed    = agreement.missed ?? 0;

  elUptime.textContent     = (score * 100).toFixed(1) + '%';
  elAgreements.textContent = formatNum(total - missed);
  elMissed.textContent     = formatNum(missed);
  elUptime.className       = 'live-val ' + (score >= 0.95 ? 'live-val--green' : score < 0.8 ? 'live-val--red' : '');

  stampUpdated();
}

function handleLedgerClosed(data) {
  if (data.ledger_index) {
    elLedger.textContent = formatNum(data.ledger_index);
  }
  // Re-poll validator stats every ~60 ledgers (~1 min)
  if (data.ledger_index && data.ledger_index % 60 === 0) {
    send({ id: 'validators', command: 'validators' });
  }
}

function handleValidation(data) {
  if (data.validation_public_key !== VALIDATOR_KEY) return;
  lastValidatedAt = Date.now();
  flashLastValidated();
  startRelativeTimer();
}

// ── UI helpers ────────────────────────────────────────────────────────────────
function setStatus(state) {
  elDot.className   = 'ws-dot';
  elLabel.className = 'ws-label';

  const states = {
    connecting:   { dot: 'ws-dot--connecting', label: 'ws-label--connecting', text: 'CONNECTING'   },
    live:         { dot: 'ws-dot--live',        label: 'ws-label--live',        text: 'LIVE'         },
    polling:      { dot: 'ws-dot--polling',     label: 'ws-label--polling',     text: 'POLLING'      },
    reconnecting: { dot: 'ws-dot--connecting',  label: 'ws-label--connecting',  text: 'RECONNECTING' },
    error:        { dot: 'ws-dot--error',        label: 'ws-label--error',        text: 'ERROR'        },
  };

  const s = states[state] || states.error;
  elDot.classList.add(s.dot);
  elLabel.classList.add(s.label);
  elLabel.textContent = s.text;
}

function stampUpdated() {
  elUpdated.textContent = 'Updated ' + new Date().toLocaleTimeString([], {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function flashLastValidated() {
  elLastVal.textContent = '⬡ Validation received';
  elLastVal.classList.add('flash');
  setTimeout(() => elLastVal.classList.remove('flash'), 1500);
}

function startRelativeTimer() {
  clearInterval(relativeTimer);
  relativeTimer = setInterval(() => {
    if (!lastValidatedAt) return;
    const secs = Math.floor((Date.now() - lastValidatedAt) / 1000);
    elLastVal.textContent = secs < 60
      ? `⬡ Last validated ${secs}s ago`
      : `⬡ Last validated ${Math.floor(secs / 60)}m ago`;
  }, 1000);
}

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
connect();
