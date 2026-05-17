// api/delete-access.js v3 — Menarguez-IA Solutions
// FIX v3: borra por _id unico (fecha|hora|nombre|idx) en lugar de indice posicional

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { pwd, ids } = req.body;

    if (!pwd || pwd !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({ ok: false, error: 'No autorizado' });
    }
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
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

    const idsSet = new Set(ids);

    // Filtrar por _id reconstruido (igual que get-access.js)
    const toKeep = [];
    rawList.forEach((item, listIdx) => {
      try {
        let obj = typeof item === 'string' ? JSON.parse(item) : item;
        if (Array.isArray(obj)) obj = JSON.parse(obj[0]);
        if (typeof obj === 'string') obj = JSON.parse(obj);
        if (!obj || !obj.nombre) { toKeep.push(item); return; }
        const _id = [obj.fecha || '', obj.hora || '', obj.nombre || '', listIdx].join('|');
        if (!idsSet.has(_id)) toKeep.push(item);
      } catch(e) {
        toKeep.push(item); // entrada corrupta: conservar
      }
    });

    // Borrar lista entera
    await fetch(`${KV_URL}/del/accesos`, { method: 'GET', headers });

    // Reescribir en orden original (LPUSH de atrás hacia adelante)
    for (let i = toKeep.length - 1; i >= 0; i--) {
      const value = typeof toKeep[i] === 'string' ? toKeep[i] : JSON.stringify(toKeep[i]);
      await fetch(`${KV_URL}/lpush/accesos`, {
        method: 'POST', headers, body: JSON.stringify(value)
      });
    }

    return res.status(200).json({ ok: true, deleted: rawList.length - toKeep.length, remaining: toKeep.length });

  } catch (err) {
    console.error('delete-access error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
