// api/log-access.js
// Guarda cada login en Upstash Redis

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { nombre, empresa } = req.body;
    if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });

    const now = new Date();
    const fecha = now.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const hora = now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    // Detect device from user agent
    const ua = req.headers['user-agent'] || '';
    let dispositivo = 'Desktop';
    if (/mobile/i.test(ua)) dispositivo = 'Móvil';
    else if (/tablet|ipad/i.test(ua)) dispositivo = 'Tablet';

    const entry = {
      id: Date.now(),
      fecha,
      hora,
      nombre: nombre.trim(),
      empresa: (empresa || 'No especificada').trim(),
      dispositivo,
      ip: req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'N/A'
    };

    // Save to Upstash Redis via REST API
    const url = process.env.KV_REST_API_URL;
    const token = process.env.KV_REST_API_TOKEN;

    if (!url || !token) {
      return res.status(500).json({ error: 'Upstash no configurado' });
    }

    // Push to a list (max 500 entries)
    await fetch(`${url}/lpush/accesos/${encodeURIComponent(JSON.stringify(entry))}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` }
    });

    // Trim list to last 500
    await fetch(`${url}/ltrim/accesos/0/499`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` }
    });

    return res.status(200).json({ ok: true });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
