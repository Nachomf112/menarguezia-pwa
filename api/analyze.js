// ════════════════════════════════════════════════════════════════
// api/analyze.js — Menarguez-IA Solutions
// ════════════════════════════════════════════════════════════════
// FUNCIÓN: Proxy entre suite.html y la API de Claude (Anthropic)
// NOVEDAD v2: Registra el módulo usado en Upstash (stats:modules)
//             para el dashboard de analytics del admin.
// ════════════════════════════════════════════════════════════════

const DAILY_LIMIT = 50;
const HOURLY_LIMIT_PER_IP = 10;

const ipCounters = {};
let dailyCount = 0;
let dailyReset = Date.now() + 86400000;

export default async function handler(req, res) {

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const now = Date.now();
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';

  if (now > dailyReset) {
    dailyCount = 0;
    dailyReset = now + 86400000;
  }

  if (!ipCounters[ip] || now > ipCounters[ip].reset) {
    ipCounters[ip] = { count: 0, reset: now + 3600000 };
  }

  if (dailyCount >= DAILY_LIMIT) {
    return res.status(429).json({
      error: 'limite_diario',
      message: 'Límite diario de análisis alcanzado. Vuelve mañana o contacta con info@imenarguez-ia.com para acceso ilimitado.'
    });
  }

  if (ipCounters[ip].count >= HOURLY_LIMIT_PER_IP) {
    return res.status(429).json({
      error: 'limite_ip',
      message: 'Has alcanzado el límite de 10 análisis por hora. Espera un momento o contacta con nosotros para acceso Pro.'
    });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'API key no configurada' });
  }

  try {
    dailyCount++;
    ipCounters[ip].count++;

    // ── EXTRAER userCode Y module DEL BODY ────────────────────
    // Ni userCode ni module son campos de Claude — los extraemos
    // antes de reenviar el body a Anthropic.
    const { userCode, module: moduleName, ...claudeBody } = req.body;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(claudeBody)
    });

    const data = await response.json();

    data._usage = {
      daily_remaining: DAILY_LIMIT - dailyCount,
      hourly_remaining: HOURLY_LIMIT_PER_IP - ipCounters[ip].count
    };

    // ── REGISTRO EN UPSTASH ───────────────────────────────────
    if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
      const kvUrl   = process.env.KV_REST_API_URL;
      const kvToken = process.env.KV_REST_API_TOKEN;
      const kvHeaders = {
        Authorization: `Bearer ${kvToken}`,
        'Content-Type': 'application/json'
      };

      // ── 1. INCREMENTAR USOS DEL CÓDIGO ───────────────────────
      if (userCode) {
        try {
          const getResp = await fetch(`${kvUrl}/get/code:${userCode}`, { headers: kvHeaders });
          const getData = await getResp.json();
          if (getData.result) {
            let raw = getData.result;
            if (Array.isArray(raw)) raw = raw[0];
            if (typeof raw === 'string') raw = JSON.parse(raw);
            if (typeof raw === 'string') raw = JSON.parse(raw);
            const codeData = raw;
            codeData.usos_usados = (codeData.usos_usados || 0) + 1;
            await fetch(`${kvUrl}/set/code:${userCode}`, {
              method: 'POST',
              headers: kvHeaders,
              body: JSON.stringify(codeData)
            });
            data._usage.usos_usados = codeData.usos_usados;
            data._usage.usos_max = codeData.usos_max || 0;
          }
        } catch (usosErr) {
          console.warn('Error incrementando usos:', usosErr.message);
        }
      }

      // ── 2. REGISTRAR USO DE MÓDULO EN stats:modules ──────────
      // HINCRBY incrementa un campo del hash en 1.
      // stats:modules es un hash: { detector: 12, humanizer: 8, ... }
      if (moduleName) {
        try {
          await fetch(`${kvUrl}/hincrby/stats:modules/${moduleName}/1`, {
            headers: kvHeaders
          });
        } catch (statsErr) {
          console.warn('Error registrando módulo:', statsErr.message);
        }
      }

      // ── 3. REGISTRAR ANÁLISIS POR DÍA EN stats:daily ─────────
      // stats:daily es un hash: { "2026-05-16": 14, "2026-05-17": 9, ... }
      try {
        const fechaHoy = new Date().toLocaleDateString('es-ES', {
          timeZone: 'Europe/Madrid',
          year: 'numeric', month: '2-digit', day: '2-digit'
        }).split('/').reverse().join('-'); // → YYYY-MM-DD
        await fetch(`${kvUrl}/hincrby/stats:daily/${fechaHoy}/1`, {
          headers: kvHeaders
        });
      } catch (dailyErr) {
        console.warn('Error registrando día:', dailyErr.message);
      }
    }

    return res.status(200).json(data);

  } catch (err) {
    dailyCount--;
    ipCounters[ip].count--;
    return res.status(500).json({ error: err.message });
  }
}
