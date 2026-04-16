// DepositDefender — analyze.js
// POST { image: dataURL } → { id, analysis: { headline_metric, dollars_at_risk, findings[], recommended_language } }
// Owner: Casey

const TABLE = process.env.TOOL_TABLE || 'deposit_defender_analyses';
const GEMINI_MODEL = 'gemini-2.0-flash';
const SCHEMA_PROMPT = `You are a tenant-rights documentation assistant. Examine this photo of an apartment that a renter is moving into. Identify any defects (scuffs, stains, cracks, holes, water damage, broken fixtures, worn flooring, etc) that a landlord could later try to charge the tenant for if undocumented.

Return a STRICT JSON object — no prose, no markdown — with this exact shape:

{
  "headline_metric": { "value": <integer 0-100>, "label": "Deposit Defense Score", "scale": "0-100" },
  "dollars_at_risk": <integer USD>,
  "findings": [
    { "location": "<short, e.g. 'kitchen wall, near outlet'>", "defect_type": "<short, e.g. 'paint scuff'>", "severity": "<low|medium|high>", "description": "<one plain-English sentence>" }
  ],
  "recommended_language": "<one paragraph of plain-English, legally-worded log entry text the tenant could send to the landlord. Mention the date, the specific location, and that the defect predates the tenancy. Do NOT include legal advice or attorney-style claims.>"
}

Scoring rubric for headline_metric.value (Deposit Defense Score):
  0-39  = poor evidence (bad lighting, cropped, no defect visible)
  40-69 = adequate evidence
  70-89 = strong evidence (clear lighting, defect framed)
  90-100 = excellent evidence (multiple corroborating details visible)

Estimate dollars_at_risk by summing realistic landlord deduction amounts in USD for the visible defects (e.g. "wall scuff" $40, "carpet stain" $200, "broken blinds" $80, "hole in drywall" $150). Cap at 4000.

Return at least 1 finding and at most 4. If no defect is visible, still return one finding describing the room state and set value low and dollars_at_risk to 0.`;

function jsonResponse(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function newId() {
  // short, URL-safe, unguessable enough for share URLs
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 10);
  return `${t}-${r}`;
}

function extractJson(text) {
  if (!text) return null;
  // Strip markdown code fences if Gemini ignored the no-prose instruction
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try { return JSON.parse(cleaned); } catch {}
  // Last-resort: find the first {...} block
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}

async function callGeminiVision(imageBase64) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY missing');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  const body = {
    contents: [{
      role: 'user',
      parts: [
        { text: SCHEMA_PROMPT },
        { inline_data: { mime_type: 'image/jpeg', data: imageBase64 } },
      ],
    }],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 1024,
      responseMimeType: 'application/json',
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Gemini ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const parsed = extractJson(text);
  if (!parsed) throw new Error('Could not parse Gemini response as JSON');
  return parsed;
}

function clampAnalysis(raw) {
  const value = Math.max(0, Math.min(100, parseInt(raw?.headline_metric?.value, 10) || 0));
  const dollars = Math.max(0, Math.min(4000, parseInt(raw?.dollars_at_risk, 10) || 0));
  const findings = Array.isArray(raw?.findings) ? raw.findings.slice(0, 4).map(f => ({
    location: String(f.location || '').slice(0, 120),
    defect_type: String(f.defect_type || '').slice(0, 80),
    severity: ['low', 'medium', 'high'].includes(String(f.severity).toLowerCase()) ? String(f.severity).toLowerCase() : 'medium',
    description: String(f.description || '').slice(0, 400),
  })) : [];
  return {
    headline_metric: { value, label: 'Deposit Defense Score', scale: '0-100' },
    dollars_at_risk: dollars,
    findings,
    recommended_language: String(raw?.recommended_language || '').slice(0, 1200),
  };
}

async function tursoExecute(stmt, args) {
  const url = process.env.TURSO_DB_URL;
  const token = process.env.TURSO_DB_TOKEN;
  if (!url || !token) return null; // DB persistence is best-effort; never block a result

  // Convert libsql:// to https://
  const httpUrl = url.replace(/^libsql:\/\//, 'https://') + '/v2/pipeline';

  const body = {
    requests: [
      { type: 'execute', stmt: { sql: stmt, args: args || [] } },
      { type: 'close' },
    ],
  };
  const res = await fetch(httpUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
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
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      score INTEGER NOT NULL,
      dollars_at_risk INTEGER NOT NULL,
      finding_count INTEGER NOT NULL,
      location TEXT,
      severity TEXT,
      public INTEGER NOT NULL DEFAULT 1
    )
  `);
}

async function persistAnalysis(id, analysis) {
  try {
    await ensureTable();
    const top = analysis.findings[0] || {};
    await tursoExecute(
      `INSERT INTO ${TABLE} (id, created_at, score, dollars_at_risk, finding_count, location, severity, public) VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        { type: 'text', value: id },
        { type: 'integer', value: String(Date.now()) },
        { type: 'integer', value: String(analysis.headline_metric.value) },
        { type: 'integer', value: String(analysis.dollars_at_risk) },
        { type: 'integer', value: String(analysis.findings.length) },
        { type: 'text', value: top.location || '' },
        { type: 'text', value: top.severity || '' },
      ],
    );
  } catch (e) {
    console.error('persistAnalysis failed', e);
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'method not allowed' });
  let payload;
  try { payload = JSON.parse(event.body || '{}'); } catch { return jsonResponse(400, { error: 'invalid json' }); }
  const dataUrl = payload.image;
  if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
    return jsonResponse(400, { error: 'image required as data URL' });
  }
  const base64 = dataUrl.split(',')[1] || '';
  if (base64.length < 100) return jsonResponse(400, { error: 'image data too small' });
  if (base64.length > 11_500_000) return jsonResponse(413, { error: 'image too large' }); // ~8MB after base64

  try {
    const raw = await callGeminiVision(base64);
    const analysis = clampAnalysis(raw);
    const id = newId();
    await persistAnalysis(id, analysis);
    return jsonResponse(200, { id, analysis });
  } catch (err) {
    console.error('analyze failed', err);
    return jsonResponse(502, { error: err.message || 'analysis failed' });
  }
};
