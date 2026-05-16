// api/get-access.js v4
// ── CAMBIO v4: añade _id único a cada entrada (fecha+hora+nombre hash)
//    para que delete-access.js pueda borrar por ID fiable

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).end();

  const { pwd } = req.query;
  if (pwd !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  try {
    const url = process.env.KV_REST_API_URL;
    const token = process.env.KV_REST_API_READ_ONLY_TOKEN;

    if (!url || !token) {
      return res.status(500).json({ error: 'Upstash no configurado', url: !!url, token: !!token });
    }

    const resp = await fetch(`${url}/lrange/accesos/0/99`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` }
    });

    const data = await resp.json();

    if (!data.result) {
      return res.status(200).json({ ok: true, entries: [], total: 0 });
    }

    const entries = data.result.map((item, listIdx) => {
      try {
        const parsed = typeof item === 'string' ? JSON.parse(item) : item;
        const obj = Array.isArray(parsed) ? JSON.parse(parsed[0]) : parsed;
        if (!obj || !obj.nombre) return null;

        // ── Generar _id único: combinación de campos + posición en lista
        // listIdx es la posición real en Upstash (0 = más reciente)
        const _id = [obj.fecha || '', obj.hora || '', obj.nombre || '', listIdx].join('|');

        return { ...obj, _id, _listIdx: listIdx };
      } catch {
        return null;
      }
    }).filter(Boolean);

    return res.status(200).json({ ok: true, entries, total: entries.length });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
