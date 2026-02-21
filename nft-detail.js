// ── Collection helper (mirrors nft-viewer.js) ─────────────────────────────────
function getCollection(nft) {
  if (nft.collection) return nft.collection;
  if (nft.name && nft.name.startsWith('PFT Profile')) return 'PFT Profiles';
  return nft.issuer.slice(0, 8) + '…';
}

// ── Load + render ─────────────────────────────────────────────────────────────
async function loadNFTDetail() {
  const params = new URLSearchParams(window.location.search);
  const id     = params.get('id');

  if (!id) { showError('No NFT ID specified.'); return; }

  try {
    const res  = await fetch('nft-data.json?t=' + Date.now());
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();

    const nft = (data.nfts || []).find(n => n.id === id);
    if (!nft) { showError('NFT not found in the dataset.'); return; }

    renderNFTDetail(nft);
  } catch (err) {
    console.error('NFT detail load error:', err);
    showError('Failed to load NFT data.');
  }
}

function renderNFTDetail(nft) {
  document.title = (nft.name || 'NFT') + ' — JollyDinger';

  const collection    = getCollection(nft);
  const ipfsGatewayUrl = nft.uri && nft.uri.startsWith('ipfs://')
    ? 'https://pft-ipfs-testnet-node-1.fly.dev/ipfs/' + nft.uri.slice(7)
    : (nft.uri || null);

  const content = document.getElementById('nftDetailContent');
  content.innerHTML = '';

  // ── Outer layout ──────────────────────────────────────────────────────────
  const layout = document.createElement('div');
  layout.className = 'nft-detail-layout';

  // ── Image column ──────────────────────────────────────────────────────────
  const imgCol = document.createElement('div');
  imgCol.className = 'nft-detail-image-col';

  const imgWrap = document.createElement('div');
  imgWrap.className = 'nft-detail-img-wrap';

  const ph = document.createElement('div');
  ph.className = 'nft-img-ph';
  ph.innerHTML = `<svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
  imgWrap.appendChild(ph);

  const img = document.createElement('img');
  img.src       = nft.imageUrl;
  img.alt       = nft.name || 'NFT';
  img.className = 'nft-detail-img';
  img.addEventListener('load',  () => { img.classList.add('nft-detail-img--loaded'); ph.style.display = 'none'; });
  img.addEventListener('error', () => { img.style.display = 'none'; });
  imgWrap.appendChild(img);

  imgCol.appendChild(imgWrap);

  // Color chips under image
  if (nft.colors && nft.colors.length > 0) {
    const colorRow = document.createElement('div');
    colorRow.className = 'nft-detail-colors';
    nft.colors.forEach(c => {
      const chip = document.createElement('span');
      chip.className = `detail-color-chip detail-color-chip--${c}`;
      chip.textContent = c;
      colorRow.appendChild(chip);
    });
    imgCol.appendChild(colorRow);
  }

  layout.appendChild(imgCol);

  // ── Info column ───────────────────────────────────────────────────────────
  const infoCol = document.createElement('div');
  infoCol.className = 'nft-detail-info-col';

  // Collection badge + title + description
  const header = document.createElement('div');
  header.className = 'nft-detail-header';

  const collBadge = document.createElement('span');
  collBadge.className = 'nft-detail-collection-badge';
  collBadge.textContent = collection;
  header.appendChild(collBadge);

  const title = document.createElement('h1');
  title.className = 'nft-detail-title';
  title.textContent = nft.name || 'Unnamed NFT';
  header.appendChild(title);

  if (nft.description) {
    const desc = document.createElement('p');
    desc.className = 'nft-detail-desc';
    desc.textContent = nft.description;
    header.appendChild(desc);
  }

  infoCol.appendChild(header);

  // Metadata table
  const table = document.createElement('div');
  table.className = 'nft-detail-meta-table';

  function addRow(label, value, opts = {}) {
    const row = document.createElement('div');
    row.className = 'nft-detail-meta-row';

    const labelEl = document.createElement('span');
    labelEl.className = 'nft-detail-meta-label';
    labelEl.textContent = label;
    row.appendChild(labelEl);

    const valWrap = document.createElement('div');
    valWrap.className = 'nft-detail-meta-val-wrap';

    let valueEl;
    if (opts.href) {
      valueEl = document.createElement('a');
      valueEl.href   = opts.href;
      valueEl.target = '_blank';
      valueEl.rel    = 'noopener';
      valueEl.className = 'nft-uri-link' + (opts.mono ? ' nft-detail-mono' : '');
    } else {
      valueEl = document.createElement('span');
      valueEl.className = 'nft-detail-meta-value' + (opts.mono ? ' nft-detail-mono' : '');
    }
    valueEl.textContent = value;
    valWrap.appendChild(valueEl);

    if (opts.copyable) {
      const btn = document.createElement('button');
      btn.className   = 'copy-btn';
      btn.textContent = 'Copy';
      btn.addEventListener('click', () => {
        navigator.clipboard.writeText(value).then(() => {
          btn.textContent = 'Copied!';
          btn.classList.add('copied');
          setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
        });
      });
      valWrap.appendChild(btn);
    }

    row.appendChild(valWrap);
    table.appendChild(row);
  }

  addRow('NFT ID',     nft.id,     { mono: true, copyable: true });
  addRow('Issuer',     nft.issuer, { mono: true, copyable: true });
  addRow('Sequence',   String(nft.seq));
  addRow('Collection', collection);
  if (nft.uri) {
    addRow('URI', nft.uri, { mono: true, href: ipfsGatewayUrl });
  }

  infoCol.appendChild(table);

  // Action buttons
  const actions = document.createElement('div');
  actions.className = 'nft-detail-actions';

  const backBtn = document.createElement('a');
  backBtn.href      = 'pftnftviewer.html';
  backBtn.className = 'tile-cta tile-cta--purple';
  backBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg> Back to Viewer`;
  actions.appendChild(backBtn);

  if (ipfsGatewayUrl) {
    const ipfsBtn = document.createElement('a');
    ipfsBtn.href      = ipfsGatewayUrl;
    ipfsBtn.target    = '_blank';
    ipfsBtn.rel       = 'noopener';
    ipfsBtn.className = 'tile-cta tile-cta--alt';
    ipfsBtn.textContent = 'View on IPFS ↗';
    actions.appendChild(ipfsBtn);
  }

  infoCol.appendChild(actions);
  layout.appendChild(infoCol);
  content.appendChild(layout);
}

// ── Error state ───────────────────────────────────────────────────────────────
function showError(msg) {
  const content = document.getElementById('nftDetailContent');
  content.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.className = 'nft-empty';
  wrap.style.minHeight = '50vh';

  wrap.innerHTML = `
    <div class="nft-empty-icon">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
    </div>`;

  const msgEl = document.createElement('div');
  msgEl.textContent = msg;
  wrap.appendChild(msgEl);

  const back = document.createElement('a');
  back.href      = 'pftnftviewer.html';
  back.className = 'tile-cta tile-cta--purple';
  back.style.marginTop = '1.5rem';
  back.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg> Back to Viewer`;
  wrap.appendChild(back);

  content.appendChild(wrap);
}

// ── Boot ──────────────────────────────────────────────────────────────────────
loadNFTDetail();
