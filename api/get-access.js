// api/get-access.js
// Devuelve los accesos al panel admin

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).end();

  // Simple password check via query param
  const { pwd } = req.query;
  if (pwd !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  try {
    const url = process.env.KV_REST_API_URL;
    const token = process.env.KV_REST_API_READ_ONLY_TOKEN;

    if (!url || !token) {
      return res.status(500).json({ error: 'Upstash no configurado' });
    }

    // Get last 100 entries
    const resp = await fetch(`${url}/lrange/accesos/0/99`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    const data = await resp.json();
    const entries = (data.result || []).map(item => {
      try { return JSON.parse(decodeURIComponent(item)); }
      catch { return null; }
    }).filter(Boolean);

    return res.status(200).json({ ok: true, entries, total: entries.length });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
