// Vercel Serverless Proxy — Menarguez-IA Solutions
// Rate limit: 50 requests/day global + 10 requests/hour per IP

const DAILY_LIMIT = 50;
const HOURLY_LIMIT_PER_IP = 10;

// In-memory counters (reset on cold start, good enough for hobby tier)
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

  // Reset daily counter
  if (now > dailyReset) {
    dailyCount = 0;
    dailyReset = now + 86400000;
  }

  // Reset hourly per-IP counter
  if (!ipCounters[ip] || now > ipCounters[ip].reset) {
    ipCounters[ip] = { count: 0, reset: now + 3600000 };
  }

  // Check daily global limit
  if (dailyCount >= DAILY_LIMIT) {
    return res.status(429).json({
      error: 'limite_diario',
      message: 'Límite diario de análisis alcanzado. Vuelve mañana o contacta con info@imenarguez-ia.com para acceso ilimitado.'
    });
  }

  // Check hourly per-IP limit
  if (ipCounters[ip].count >= HOURLY_LIMIT_PER_IP) {
    return res.status(429).json({
      error: 'limite_ip',
      message: 'Has alcanzado el límite de 10 análisis por hora. Espera un momento o contacta con nosotros para acceso Pro.'
    });
  }

  // Check API key
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'API key no configurada' });
  }

  try {
    dailyCount++;
    ipCounters[ip].count++;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(req.body)
    });

    const data = await response.json();

    // Add usage info to response
    data._usage = {
      daily_remaining: DAILY_LIMIT - dailyCount,
      hourly_remaining: HOURLY_LIMIT_PER_IP - ipCounters[ip].count
    };

    return res.status(200).json(data);

  } catch (err) {
    dailyCount--;
    ipCounters[ip].count--;
    return res.status(500).json({ error: err.message });
  }
}
