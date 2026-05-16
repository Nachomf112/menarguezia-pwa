// ════════════════════════════════════════════════════════════════
// api/get-stats.js — Menarguez-IA Solutions
// ════════════════════════════════════════════════════════════════
// FUNCIÓN: Devuelve estadísticas para el dashboard de analytics:
//   - Uso por módulo (hash stats:modules)
//   - Análisis por día (hash stats:daily, últimos 7 días)
//   - Distribución por plan (calculada desde los códigos)
//   - Dispositivos (calculado desde los accesos)
// AUTENTICACIÓN: Requiere ADMIN_PASSWORD en query param
// ════════════════════════════════════════════════════════════════

export default async function handler(req, res) {

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).end();

  const { pwd } = req.query;
  if (!pwd || pwd !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ ok: false, error: 'No autorizado' });
  }

  const kvUrl   = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_READ_ONLY_TOKEN;

  if (!kvUrl || !kvToken) {
    return res.status(500).json({ ok: false, error: 'Upstash no configurado' });
  }

  const headers = { Authorization: `Bearer ${kvToken}` };

  try {

    // ── 1. MÓDULOS ────────────────────────────────────────────
    const modulesResp = await fetch(`${kvUrl}/hgetall/stats:modules`, { headers });
    const modulesData = await modulesResp.json();
    const modulesRaw  = modulesData.result || [];

    // HGETALL devuelve array plano [key, value, key, value, ...]
    const modules = {};
    for (let i = 0; i < modulesRaw.length; i += 2) {
      modules[modulesRaw[i]] = parseInt(modulesRaw[i + 1]) || 0;
    }

    // ── 2. ANÁLISIS POR DÍA (últimos 7 días) ─────────────────
    const dailyResp = await fetch(`${kvUrl}/hgetall/stats:daily`, { headers });
    const dailyData = await dailyResp.json();
    const dailyRaw  = dailyData.result || [];

    const dailyAll = {};
    for (let i = 0; i < dailyRaw.length; i += 2) {
      dailyAll[dailyRaw[i]] = parseInt(dailyRaw[i + 1]) || 0;
    }

    // Generar los últimos 7 días en formato YYYY-MM-DD
    const daily = {};
    for (let d = 6; d >= 0; d--) {
      const date = new Date();
      date.setDate(date.getDate() - d);
      const key = date.toLocaleDateString('es-ES', {
        timeZone: 'Europe/Madrid',
        year: 'numeric', month: '2-digit', day: '2-digit'
      }).split('/').reverse().join('-');
      daily[key] = dailyAll[key] || 0;
    }

    // ── 3. DISTRIBUCIÓN POR PLAN ──────────────────────────────
    // Leer todos los códigos y agrupar por plan
    const scanResp = await fetch(`${kvUrl}/scan/0?match=code:*&count=100`, { headers });
    const scanData = await scanResp.json();
    const codeKeys = (scanData.result && scanData.result[1]) ? scanData.result[1] : [];

    const planCounts = { free: 0, pro: 0, business: 0, enterprise: 0 };
    const empresaCounts = {};
    let totalAnalisis = 0;

    await Promise.all(codeKeys.map(async (key) => {
      try {
        const r = await fetch(`${kvUrl}/get/${encodeURIComponent(key)}`, { headers });
        const d = await r.json();
        let raw = d.result;
        if (Array.isArray(raw)) raw = raw[0];
        if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch(e) {} }
        if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch(e) {} }
        if (raw && typeof raw === 'object' && raw.activo) {
          const plan = (raw.plan || 'free').toLowerCase();
          if (planCounts.hasOwnProperty(plan)) planCounts[plan]++;
          else planCounts.free++;

          totalAnalisis += raw.usos_usados || 0;

          if (raw.empresa) {
            empresaCounts[raw.empresa] = (empresaCounts[raw.empresa] || 0) + (raw.usos_usados || 0);
          }
        }
      } catch(e) {}
    }));

    // ── 4. DISPOSITIVOS ───────────────────────────────────────
    const accResp = await fetch(`${kvUrl}/lrange/accesos/0/99`, { headers });
    const accData = await accResp.json();
    const accList = accData.result || [];

    const deviceCounts = { Desktop: 0, Móvil: 0, Tablet: 0 };
    accList.forEach(item => {
      try {
        let obj = typeof item === 'string' ? JSON.parse(item) : item;
        if (Array.isArray(obj)) obj = JSON.parse(obj[0]);
        if (obj && obj.dispositivo) {
          const d = obj.dispositivo;
          if (deviceCounts.hasOwnProperty(d)) deviceCounts[d]++;
        }
      } catch(e) {}
    });

    // ── TOP EMPRESAS (por usos) ───────────────────────────────
    const topEmpresas = Object.entries(empresaCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([empresa, usos]) => ({ empresa, usos }));

    return res.status(200).json({
      ok: true,
      modules,
      daily,
      plans: planCounts,
      devices: deviceCounts,
      topEmpresas,
      totalAnalisis
    });

  } catch (err) {
    console.error('get-stats error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
