// ════════════════════════════════════════════════════════════════
// api/delete-code.js — Menarguez-IA Solutions
// ════════════════════════════════════════════════════════════════
// FUNCIÓN: Borra uno o varios códigos de acceso de Upstash Redis
// AUTENTICACIÓN: Requiere ADMIN_PASSWORD en el body
// ════════════════════════════════════════════════════════════════

export default async function handler(req, res) {

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { pwd, codes } = req.body;

    // ── AUTENTICACIÓN ─────────────────────────────────────────
    if (!pwd || pwd !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({ ok: false, error: 'No autorizado' });
    }

    // ── VALIDAR CÓDIGOS ───────────────────────────────────────
    if (!codes || !Array.isArray(codes) || codes.length === 0) {
      return res.status(400).json({ ok: false, error: 'No se especificaron códigos' });
    }

    const KV_URL   = process.env.KV_REST_API_URL;
    const KV_TOKEN = process.env.KV_REST_API_TOKEN;

    if (!KV_URL || !KV_TOKEN) {
      return res.status(500).json({ ok: false, error: 'Upstash no configurado' });
    }

    // ── BORRAR CADA CÓDIGO ────────────────────────────────────
    const results = await Promise.all(
      codes.map(async (code) => {
        const key = code.startsWith('code:') ? code : 'code:' + code;
        const resp = await fetch(`${KV_URL}/del/${encodeURIComponent(key)}`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${KV_TOKEN}` }
        });
        const data = await resp.json();
        return { code, deleted: data.result === 1 };
      })
    );

    const deletedCount = results.filter(r => r.deleted).length;

    return res.status(200).json({
      ok: true,
      deleted: deletedCount,
      results
    });

  } catch (err) {
    console.error('delete-code error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
