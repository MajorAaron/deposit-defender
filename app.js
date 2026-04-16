// DepositDefender — client logic
// Owner: Casey

const els = {
  dropzone: document.getElementById('dropzone'),
  fileInput: document.getElementById('file-input'),
  status: document.getElementById('status'),
  result: document.getElementById('result'),
  card: document.getElementById('card'),
  cardPhoto: document.getElementById('card-photo'),
  cardScoreValue: document.getElementById('card-score-value'),
  cardScoreScale: document.getElementById('card-score-scale'),
  cardDollars: document.getElementById('card-dollars'),
  cardFindingText: document.getElementById('card-finding-text'),
  cardDate: document.getElementById('card-date'),
  copyLink: document.getElementById('copy-link'),
  shareX: document.getElementById('share-x'),
  shareLI: document.getElementById('share-li'),
  emailGate: document.getElementById('email-gate'),
  emailForm: document.getElementById('email-form'),
  emailInput: document.getElementById('email-input'),
  historyList: document.getElementById('history-list'),
};

const MAX_LONG_EDGE = 1280;
const MAX_BYTES = 8 * 1024 * 1024;

let lastAnalysisId = null;

function setStatus(msg, isError = false) {
  if (!msg) { els.status.hidden = true; return; }
  els.status.hidden = false;
  els.status.textContent = msg;
  els.status.classList.toggle('status--error', isError);
}

async function readFileAsImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

async function resizeAndStripExif(file) {
  const img = await readFileAsImage(file);
  const longEdge = Math.max(img.width, img.height);
  const scale = longEdge > MAX_LONG_EDGE ? MAX_LONG_EDGE / longEdge : 1;
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  // toDataURL produces a fresh JPEG with no EXIF — that's our strip.
  return canvas.toDataURL('image/jpeg', 0.86);
}

function fmtMoney(n) {
  const v = Math.max(0, Math.round(Number(n) || 0));
  return '$' + v.toLocaleString('en-US');
}

function renderCard(analysis, photoDataUrl) {
  els.cardPhoto.src = photoDataUrl;
  els.cardScoreValue.textContent = String(analysis.headline_metric.value);
  els.cardScoreScale.textContent = '/' + (analysis.headline_metric.scale.split('-')[1] || '100');
  els.cardDollars.textContent = fmtMoney(analysis.dollars_at_risk);
  els.cardFindingText.textContent = analysis.recommended_language || (analysis.findings && analysis.findings[0] && analysis.findings[0].description) || '';
  els.cardDate.textContent = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  els.result.classList.add('result--active');
  els.emailGate.classList.add('email-gate--active');
}

function shareUrlFor(platform) {
  const slug = lastAnalysisId || 'demo';
  const base = `${location.origin}/share/${slug}`;
  const url = new URL(base);
  url.searchParams.set('utm_source', platform);
  url.searchParams.set('ref', 'share');
  return url.toString();
}

function wireShareButtons() {
  els.copyLink.addEventListener('click', async () => {
    const u = shareUrlFor('copy');
    try { await navigator.clipboard.writeText(u); setStatus('Link copied. Send it to a friend who just signed a lease.'); }
    catch { setStatus(u); }
  });
  els.shareX.addEventListener('click', (e) => {
    e.preventDefault();
    const u = shareUrlFor('x');
    const text = encodeURIComponent('Just defended my deposit with DepositDefender.');
    window.open(`https://twitter.com/intent/tweet?text=${text}&url=${encodeURIComponent(u)}`, '_blank', 'noopener');
  });
  els.shareLI.addEventListener('click', (e) => {
    e.preventDefault();
    const u = shareUrlFor('linkedin');
    window.open(`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(u)}`, '_blank', 'noopener');
  });
}

async function analyze(file) {
  if (file.size > MAX_BYTES) {
    setStatus('That photo is over 8 MB. Try a smaller one or let your phone resize before uploading.', true);
    return;
  }
  setStatus('Resizing photo on your device…');
  const dataUrl = await resizeAndStripExif(file);

  setStatus('Looking for defects and scoring deposit risk…');
  const res = await fetch('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: dataUrl }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    setStatus(`We couldn't analyze that one. ${err || 'Try another photo.'}`, true);
    return;
  }

  const data = await res.json();
  lastAnalysisId = data.id || null;
  setStatus('');
  renderCard(data.analysis, dataUrl);
}

function wireDropzone() {
  els.dropzone.addEventListener('dragover', (e) => { e.preventDefault(); els.dropzone.classList.add('dropzone--active'); });
  els.dropzone.addEventListener('dragleave', () => els.dropzone.classList.remove('dropzone--active'));
  els.dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    els.dropzone.classList.remove('dropzone--active');
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) analyze(f).catch(err => setStatus(err.message || 'Upload failed.', true));
  });
  els.fileInput.addEventListener('change', () => {
    const f = els.fileInput.files && els.fileInput.files[0];
    if (f) analyze(f).catch(err => setStatus(err.message || 'Upload failed.', true));
  });
}

function wireEmailForm() {
  els.emailForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = els.emailInput.value.trim();
    if (!email) return;
    const res = await fetch('/api/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, analysis_id: lastAnalysisId }),
    });
    if (res.ok) {
      els.emailGate.innerHTML = '<p>Sent. Check your inbox in a minute or two.</p>';
    } else {
      setStatus('We had trouble sending the email. Try again in a moment.', true);
    }
  });
}

async function loadHistory() {
  try {
    const res = await fetch('/api/history');
    if (!res.ok) return;
    const items = await res.json();
    if (!Array.isArray(items) || !items.length) return;
    els.historyList.innerHTML = items.slice(0, 5).map(it => `
      <li class="history__item">
        <span>${(it.location || 'A renter').replace(/[<>&]/g, '')}</span>
        <span class="history__item-score">${Number(it.score || 0)}</span>
        <span>${fmtMoney(it.dollars_at_risk)} at risk</span>
      </li>
    `).join('');
  } catch { /* silent — history is decoration */ }
}

wireDropzone();
wireShareButtons();
wireEmailForm();
loadHistory();
