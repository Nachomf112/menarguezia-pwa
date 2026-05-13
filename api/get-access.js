// api/get-access.js
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).end();

  const { pwd } = req.query;
  if (pwd !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  try {
    const url = process.env.KV_REST_API_URL;
    const token = process.env.KV_REST_API_READ_ONLY_TOKEN;

    if (!url || !token) {
      return res.status(500).json({ error: 'Upstash no configurado', url: !!url, token: !!token });
    }

    // Get last 100 entries from Redis list
    const resp = await fetch(`${url}/lrange/accesos/0/99`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` }
    });

    const data = await resp.json();

    if (!data.result) {
      return res.status(200).json({ ok: true, entries: [], total: 0, raw: data });
    }

    const entries = data.result.map(item => {
      try {
        return typeof item === 'string' ? JSON.parse(item) : item;
      } catch {
        return null;
      }
    }).filter(Boolean);

    return res.status(200).json({ ok: true, entries, total: entries.length });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
