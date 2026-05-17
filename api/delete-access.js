// api/delete-access.js v6 — Menarguez-IA Solutions
// ESTRATEGIA NUEVA: no toca la lista accesos nunca.
// Guarda los IDs borrados en 'accesos:deleted' (SET de Redis).
// get-access.js filtra esos IDs al leer.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { pwd, entryIds } = req.body;

    if (!pwd || pwd !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({ ok: false, error: 'No autorizado' });
    }
    if (!entryIds || !Array.isArray(entryIds) || entryIds.length === 0) {
      return res.status(400).json({ ok: false, error: 'No se especificaron IDs' });
    }

    const KV_URL   = process.env.KV_REST_API_URL;
    const KV_TOKEN = process.env.KV_REST_API_TOKEN;
    if (!KV_URL || !KV_TOKEN) {
      return res.status(500).json({ ok: false, error: 'Upstash no configurado' });
    }

    const headers = { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' };

    // Añadir cada ID al SET de borrados
    // SADD accesos:deleted id1 id2 ...
    for (const id of entryIds) {
  await fetch(`${KV_URL}/sadd/accesos:deleted/${String(id)}`, {
    method: 'GET',
    headers
  });
}

return res.status(200).json({ ok: true, deleted: entryIds.length });

  } catch (err) {
    console.error('delete-access error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
