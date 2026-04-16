// DepositDefender — subscribe.js
// POST { email, analysis_id? } → { ok: true }
// Owner: Casey

const SUB_TABLE = process.env.SUB_TABLE || 'deposit_defender_subscribers';
const FROM = `DepositDefender <hello@${process.env.RESEND_FROM_DOMAIN || 'majorsolutions.biz'}>`;

function jsonResponse(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function isEmail(s) {
  return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

async function tursoExecute(stmt, args) {
  const url = process.env.TURSO_DB_URL;
  const token = process.env.TURSO_DB_TOKEN;
  if (!url || !token) return null;
  const httpUrl = url.replace(/^libsql:\/\//, 'https://') + '/v2/pipeline';
  const body = {
    requests: [
      { type: 'execute', stmt: { sql: stmt, args: args || [] } },
      { type: 'close' },
    ],
  };
  const res = await fetch(httpUrl, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error('turso execute failed', res.status, await res.text().catch(() => ''));
    return null;
  }
  return res.json();
}

async function ensureTable() {
  await tursoExecute(`
    CREATE TABLE IF NOT EXISTS ${SUB_TABLE} (
      email TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      analysis_id TEXT,
      utm_source TEXT
    )
  `);
}

async function persistSubscriber(email, analysisId) {
  await ensureTable();
  await tursoExecute(
    `INSERT OR IGNORE INTO ${SUB_TABLE} (email, created_at, analysis_id) VALUES (?, ?, ?)`,
    [
      { type: 'text', value: email },
      { type: 'integer', value: String(Date.now()) },
      { type: analysisId ? 'text' : 'null', value: analysisId || null },
    ],
  );
}

async function sendWelcomeEmail(email) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return; // fail soft

  const subject = 'Your move-in defense kit';
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #15161A; max-width: 560px; margin: auto; padding: 24px;">
      <h1 style="font-family: 'Playfair Display', Georgia, serif; font-size: 28px; margin: 0 0 12px;">Document on day one. Get your deposit on day done.</h1>
      <p style="font-size: 16px; line-height: 1.5;">Thanks for using DepositDefender. Here's how to use this for the rest of your move-in walkthrough:</p>
      <ol style="font-size: 16px; line-height: 1.6;">
        <li>Photograph every room corner-by-corner. Don't skip the kitchen and bath.</li>
        <li>Snap close-ups of any defect, stain, scratch, or worn area.</li>
        <li>Run each photo through the tool. Save the recommended language.</li>
        <li>Email all of them to your landlord on day one. CC yourself.</li>
      </ol>
      <p style="font-size: 14px; color: #6B6862; border-top: 1px solid #D9D2BD; padding-top: 16px;">DepositDefender is a documentation tool, not a legal service. Output is informational. For binding correspondence with your landlord, consult a tenant-rights attorney or local legal aid.</p>
    </div>
  `;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM,
      to: [email],
      subject,
      html,
    }),
  });
  if (!res.ok) {
    console.error('resend send failed', res.status, await res.text().catch(() => ''));
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'method not allowed' });
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return jsonResponse(400, { error: 'invalid json' }); }
  const email = String(body.email || '').trim().toLowerCase();
  if (!isEmail(email)) return jsonResponse(400, { error: 'valid email required' });
  const analysisId = body.analysis_id ? String(body.analysis_id).slice(0, 64) : null;

  try {
    await persistSubscriber(email, analysisId);
  } catch (e) {
    console.error('persistSubscriber failed', e);
  }
  try {
    await sendWelcomeEmail(email);
  } catch (e) {
    console.error('sendWelcomeEmail failed', e);
  }
  return jsonResponse(200, { ok: true });
};
