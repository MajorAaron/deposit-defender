// DepositDefender — history.js
// GET → [{ location, score, dollars_at_risk, severity, created_at }, ...] (most recent 5)
// Owner: Casey
// Used as social proof on the tool page. Returns no PII (location is the AI-generated short string from the photo, e.g. "kitchen wall").

const TABLE = process.env.TOOL_TABLE || 'deposit_defender_analyses';

function jsonResponse(status, body, extraHeaders = {}) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60', ...extraHeaders },
    body: JSON.stringify(body),
  };
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
  if (!res.ok) return null;
  return res.json();
}

function rowsFromPipeline(data) {
  const rows = data?.results?.[0]?.response?.result?.rows || [];
  const cols = data?.results?.[0]?.response?.result?.cols || [];
  return rows.map(r => {
    const obj = {};
    cols.forEach((c, i) => { obj[c.name] = r[i]?.value; });
    return obj;
  });
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return jsonResponse(405, { error: 'method not allowed' });
  const data = await tursoExecute(
    `SELECT location, score, dollars_at_risk, severity, created_at FROM ${TABLE} WHERE public = 1 ORDER BY created_at DESC LIMIT 5`,
    [],
  );
  if (!data) return jsonResponse(200, []);
  const rows = rowsFromPipeline(data);
  const items = rows.map(r => ({
    location: r.location || 'A renter',
    score: parseInt(r.score, 10) || 0,
    dollars_at_risk: parseInt(r.dollars_at_risk, 10) || 0,
    severity: r.severity || 'medium',
    created_at: parseInt(r.created_at, 10) || 0,
  }));
  return jsonResponse(200, items);
};
