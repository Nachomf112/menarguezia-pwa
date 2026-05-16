// ════════════════════════════════════════════════════════════════
// api/delete-access.js — Menarguez-IA Solutions
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
    const { pwd, ids } = req.body;

    // ── AUTENTICACIÓN ─────────────────────────────────────────
    if (!pwd || pwd !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({ ok: false, error: 'No autorizado' });
    }

    // ── VALIDAR IDS ───────────────────────────────────────────
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ ok: false, error: 'No se especificaron IDs' });
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

    // ── LEER TODA LA LISTA DE ACCESOS ─────────────────────────
    const rangeResp = await fetch(`${KV_URL}/lrange/accesos/0/-1`, {
      headers
    });
    const rangeData = await rangeResp.json();
    const rawList = rangeData.result || [];

    if (!rawList.length) {
      return res.status(200).json({ ok: true, deleted: 0 });
    }

    // ── PARSEAR ENTRADAS ──────────────────────────────────────
    const parsed = rawList.map((item, idx) => {
      let obj = item;
      if (typeof obj === 'string') { try { obj = JSON.parse(obj); } catch(e) {} }
      if (typeof obj === 'string') { try { obj = JSON.parse(obj); } catch(e) {} }
      return { idx, raw: item, obj: (obj && typeof obj === 'object') ? obj : null };
    });

    // ── FILTRAR: quedan los que NO están en ids ───────────────
    const idsSet = new Set(ids.map(Number));
    const toKeep = parsed.filter(entry => !idsSet.has(entry.idx));

    // ── BORRAR LA LISTA ENTERA ────────────────────────────────
    await fetch(`${KV_URL}/del/accesos`, { method: 'GET', headers });

    // ── REESCRIBIR LOS QUE QUEDAN (en orden inverso para LPUSH)
    // LPUSH añade al principio, así que empujamos en orden inverso
    // para que queden en el mismo orden original
    if (toKeep.length > 0) {
      const itemsToWrite = toKeep.map(e => e.raw).reverse();
      for (const item of itemsToWrite) {
        await fetch(`${KV_URL}/lpush/accesos`, {
          method: 'POST',
          headers,
          body: JSON.stringify(typeof item === 'string' ? item : JSON.stringify(item))
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
