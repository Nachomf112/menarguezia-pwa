// api/delete-access.js v4 — Menarguez-IA Solutions
// FIX v4: borra usando LREM de Redis — busca el elemento exacto por contenido
// y lo elimina de la lista sin reconstruir nada

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { pwd, rawItems } = req.body;

    if (!pwd || pwd !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({ ok: false, error: 'No autorizado' });
    }
    if (!rawItems || !Array.isArray(rawItems) || rawItems.length === 0) {
      return res.status(400).json({ ok: false, error: 'No se especificaron elementos' });
    }

    const KV_URL   = process.env.KV_REST_API_URL;
    const KV_TOKEN = process.env.KV_REST_API_TOKEN;
    if (!KV_URL || !KV_TOKEN) {
      return res.status(500).json({ ok: false, error: 'Upstash no configurado' });
    }

    const headers = { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' };

    // LREM key count element:
    // count=1 → elimina la primera ocurrencia del elemento exacto
    // Esto es atómico y no requiere reconstruir la lista
    let deleted = 0;
    for (const rawItem of rawItems) {
      const lremResp = await fetch(`${KV_URL}/lrem/accesos/1`, {
        method: 'POST',
        headers,
        body: JSON.stringify(rawItem)
      });
      const lremData = await lremResp.json();
      if (lremData.result >= 1) deleted++;
    }

    return res.status(200).json({ ok: true, deleted });

  } catch (err) {
    console.error('delete-access error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
