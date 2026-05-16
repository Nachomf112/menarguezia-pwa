// ════════════════════════════════════════════════════════════════
// api/delete-access.js v2 — Menarguez-IA Solutions
// ════════════════════════════════════════════════════════════════
// FUNCIÓN: Borra entradas específicas de la lista 'accesos' en Upstash
// ESTRATEGIA: Lee toda la lista → filtra los índices a borrar →
//             borra la lista → reescribe los que quedan
// AUTENTICACIÓN: Requiere ADMIN_PASSWORD en el body
// ════════════════════════════════════════════════════════════════

export default async function handler(req, res) {

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { pwd, listIdxs } = req.body;

    // ── AUTENTICACIÓN ─────────────────────────────────────────
    if (!pwd || pwd !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({ ok: false, error: 'No autorizado' });
    }

    if (!listIdxs || !Array.isArray(listIdxs) || listIdxs.length === 0) {
      return res.status(400).json({ ok: false, error: 'No se especificaron índices' });
    }

    const KV_URL   = process.env.KV_REST_API_URL;
    const KV_TOKEN = process.env.KV_REST_API_TOKEN;

    if (!KV_URL || !KV_TOKEN) {
      return res.status(500).json({ ok: false, error: 'Upstash no configurado' });
    }

    const headers = {
      Authorization: `Bearer ${KV_TOKEN}`,
      'Content-Type': 'application/json'
    };

    // ── LEER LISTA COMPLETA ───────────────────────────────────
    const rangeResp = await fetch(`${KV_URL}/lrange/accesos/0/-1`, { headers });
    const rangeData = await rangeResp.json();
    const rawList = rangeData.result || [];

    if (!rawList.length) {
      return res.status(200).json({ ok: true, deleted: 0 });
    }

    // ── FILTRAR: quedan los que NO están en listIdxs ──────────
    const idxSet = new Set(listIdxs.map(Number));
    const toKeep = rawList.filter((_, idx) => !idxSet.has(idx));

    // ── BORRAR LISTA ENTERA ───────────────────────────────────
    await fetch(`${KV_URL}/del/accesos`, { method: 'GET', headers });

    // ── REESCRIBIR LOS QUE QUEDAN ─────────────────────────────
    if (toKeep.length > 0) {
      const reversed = [...toKeep].reverse();
      for (const item of reversed) {
        const value = typeof item === 'string' ? item : JSON.stringify(item);
        await fetch(`${KV_URL}/lpush/accesos`, {
          method: 'POST',
          headers,
          body: JSON.stringify(value)
        });
      }
    }

    const deleted = rawList.length - toKeep.length;
    return res.status(200).json({ ok: true, deleted, remaining: toKeep.length });

  } catch (err) {
    console.error('delete-access error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
