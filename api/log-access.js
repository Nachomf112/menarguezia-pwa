// api/log-access.js v2
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { nombre, empresa } = req.body;
    if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });

    // DESPUÉS (fuerza zona horaria de Madrid)
    const now = new Date();
    const fecha = now.toLocaleDateString('es-ES', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      timeZone: 'Europe/Madrid'
    });
    const hora = now.toLocaleTimeString('es-ES', {
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      timeZone: 'Europe/Madrid'
    });

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

    const url = process.env.KV_REST_API_URL;
    const token = process.env.KV_REST_API_TOKEN;

    if (!url || !token) {
      return res.status(500).json({ error: 'Upstash no configurado' });
    }

    await fetch(`${url}/lpush/accesos`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify([JSON.stringify(entry)])
    });

    await fetch(`${url}/ltrim/accesos/0/199`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify([0, 199])
    });

    return res.status(200).json({ ok: true });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
