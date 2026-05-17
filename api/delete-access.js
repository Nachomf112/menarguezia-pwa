// api/delete-access.js v5 — Menarguez-IA Solutions
// FIX v5: borra por campo 'id' (timestamp) que es unico en cada entrada

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { pwd, entryIds } = req.body; // entryIds = array de timestamps (campo 'id')

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

    // Leer lista completa
    const rangeResp = await fetch(`${KV_URL}/lrange/accesos/0/-1`, { headers });
    const rangeData = await rangeResp.json();
    const rawList = rangeData.result || [];
    if (!rawList.length) return res.status(200).json({ ok: true, deleted: 0 });

    const idsSet = new Set(entryIds.map(String));

    // Filtrar: conservar los que NO tienen el id en idsSet
    const toKeep = [];
    for (const item of rawList) {
      try {
        // Formato guardado: ["{"id":123,...}"] → array con string JSON
        let parsed = typeof item === 'string' ? JSON.parse(item) : item;
        let obj = Array.isArray(parsed) ? JSON.parse(parsed[0]) : parsed;
        if (typeof obj === 'string') obj = JSON.parse(obj);

        if (!obj || !obj.id || !idsSet.has(String(obj.id))) {
          toKeep.push(item); // conservar
        }
        // si tiene el id → no lo añadimos (se borra)
      } catch(e) {
        toKeep.push(item); // entrada corrupta: conservar
      }
    }

    // Borrar lista entera
    await fetch(`${KV_URL}/del/accesos`, { method: 'GET', headers });

    // Reescribir en orden original (LPUSH de atrás hacia adelante)
    for (let i = toKeep.length - 1; i >= 0; i--) {
  const original = toKeep[i];
  await fetch(`${KV_URL}/lpush/accesos`, {
    method: 'POST', headers, body: JSON.stringify([original])
  });
}

    const deleted = rawList.length - toKeep.length;
return res.status(200).json({ ok: true, deleted, remaining: toKeep.length });

  } catch (err) {
    console.error('delete-access error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
