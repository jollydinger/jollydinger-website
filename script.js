// ── Config ────────────────────────────────────────────────────────────────────
const WS_URL       = 'wss://rpc.testnet.postfiat.org:6007';
const VALIDATOR_KEY = 'nHBM2nzq3pZUg8JsxvEt3G7gAAtc5Sukaef6YmvVx64uAoRK4QWM';

// ── State ─────────────────────────────────────────────────────────────────────
let ws             = null;
let reconnectTimer = null;
let reconnectDelay = 2000;   // starts at 2 s, caps at 30 s
let lastValidatedAt = null;
let relativeTimer  = null;

// ── DOM refs ──────────────────────────────────────────────────────────────────
const elDot          = document.getElementById('wsDot');
const elLabel        = document.getElementById('wsLabel');
const elUpdated      = document.getElementById('lastUpdated');
const elUptime       = document.getElementById('statUptime');
const elAgreements   = document.getElementById('statAgreements');
const elMissed       = document.getElementById('statMissed');
const elLedger       = document.getElementById('statLedger');
const elLastVal      = document.getElementById('lastValidated');

// ── WebSocket lifecycle ───────────────────────────────────────────────────────
function connect() {
  setStatus('connecting');

  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    setStatus('live');
    reconnectDelay = 2000;

    // Fetch full validator list for agreement/uptime stats
    send({ id: 'validators', command: 'validators' });

    // Subscribe to live ledger close + validation messages
    send({
      id: 'subscribe',
      command: 'subscribe',
      streams: ['ledger', 'validations'],
    });
  };

  ws.onmessage = (evt) => {
    let data;
    try { data = JSON.parse(evt.data); } catch { return; }
    handleMessage(data);
  };

  ws.onerror = () => {};   // onclose handles reconnect

  ws.onclose = () => {
    setStatus('error');
    scheduleReconnect();
  };
}

function send(payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    reconnectDelay = Math.min(reconnectDelay * 1.5, 30000);
    connect();
  }, reconnectDelay);
}

// ── Message routing ───────────────────────────────────────────────────────────
function handleMessage(data) {
  // Response to `validators` command
  if (data.id === 'validators' && data.result) {
    handleValidators(data.result);
  }

  // Live ledger-closed events
  if (data.type === 'ledgerClosed') {
    handleLedgerClosed(data);
  }

  // Live validation messages — fires each time a validator signs a ledger
  if (data.type === 'validationReceived') {
    handleValidation(data);
  }
}

// ── Handlers ──────────────────────────────────────────────────────────────────
function handleValidators(result) {
  const list = result.validators || [];
  const v = list.find(
    (x) => x.validation_public_key === VALIDATOR_KEY
  );

  if (!v) {
    // Validator not in trusted list yet — show key is known but no stats
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

  // Colour-code uptime
  elUptime.className = 'live-val ' + (score >= 0.95 ? 'live-val--green' : score < 0.8 ? 'live-val--red' : '');

  stampUpdated();
}

function handleLedgerClosed(data) {
  if (data.ledger_index) {
    elLedger.textContent = formatNum(data.ledger_index);
  }

  // Re-poll validator stats every ~60 ledgers (~1 min) to keep uptime fresh
  if (data.ledger_index && data.ledger_index % 60 === 0) {
    send({ id: 'validators', command: 'validators' });
  }
}

function handleValidation(data) {
  // Only care about our validator
  if (data.validation_public_key !== VALIDATOR_KEY) return;

  lastValidatedAt = Date.now();
  flashLastValidated();
  startRelativeTimer();
}

// ── UI helpers ────────────────────────────────────────────────────────────────
function setStatus(state) {
  // Reset classes
  elDot.className   = 'ws-dot';
  elLabel.className = 'ws-label';

  if (state === 'connecting') {
    elDot.classList.add('ws-dot--connecting');
    elLabel.classList.add('ws-label--connecting');
    elLabel.textContent = 'CONNECTING';
  } else if (state === 'live') {
    elDot.classList.add('ws-dot--live');
    elLabel.classList.add('ws-label--live');
    elLabel.textContent = 'LIVE';
  } else {
    elDot.classList.add('ws-dot--error');
    elLabel.classList.add('ws-label--error');
    elLabel.textContent = 'RECONNECTING';
  }
}

function stampUpdated() {
  const now = new Date();
  elUpdated.textContent = 'Updated ' + now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
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
    if (secs < 60) {
      elLastVal.textContent = `⬡ Last validated ${secs}s ago`;
    } else {
      const mins = Math.floor(secs / 60);
      elLastVal.textContent = `⬡ Last validated ${mins}m ago`;
    }
  }, 1000);
}

function formatNum(n) {
  return Number(n).toLocaleString();
}

// ── Copy key to clipboard ─────────────────────────────────────────────────────
function copyKey(btn, key) {
  navigator.clipboard.writeText(key).then(() => {
    btn.classList.add('copied');
    btn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="20 6 9 17 4 12"/>
      </svg>Copied!`;
    setTimeout(() => {
      btn.classList.remove('copied');
      btn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="9" y="9" width="13" height="13" rx="2"/>
          <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
        </svg>Copy`;
    }, 2000);
  });
}

// ── Subtle mouse parallax on bg glow ─────────────────────────────────────────
document.addEventListener('mousemove', (e) => {
  const glow = document.querySelector('.bg-glow');
  if (!glow) return;
  const x = (e.clientX / window.innerWidth)  * 10 - 5;
  const y = (e.clientY / window.innerHeight) * 10 - 5;
  glow.style.transform = `translate(${x}px, ${y}px)`;
});

// ── Boot ──────────────────────────────────────────────────────────────────────
connect();
