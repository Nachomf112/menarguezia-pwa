// api/get-access.js v5
// Lee accesos y filtra los que están en accesos:deleted

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
      return res.status(500).json({ error: 'Upstash no configurado' });
    }

    const headers = { Authorization: `Bearer ${token}` };

    // Leer lista de accesos y SET de borrados en paralelo
    const [listResp, deletedResp] = await Promise.all([
      fetch(`${url}/lrange/accesos/0/199`, { headers }),
      fetch(`${url}/smembers/accesos:deleted`, { headers })
    ]);

    const listData = await listResp.json();
    const deletedData = await deletedResp.json();

    const deletedSet = new Set((deletedData.result || []).map(String));

    if (!listData.result) {
      return res.status(200).json({ ok: true, entries: [], total: 0 });
    }

    const entries = listData.result.map((item, listIdx) => {
      try {
        const parsed = typeof item === 'string' ? JSON.parse(item) : item;
        const obj = Array.isArray(parsed) ? JSON.parse(parsed[0]) : parsed;
        if (!obj || !obj.nombre) return null;

        // Filtrar borrados
        if (obj.id && deletedSet.has(String(obj.id))) return null;

        const _id = [obj.fecha || '', obj.hora || '', obj.nombre || '', listIdx].join('|');
        return { ...obj, _id, _listIdx: listIdx, _entryId: obj.id };
      } catch {
        return null;
      }
    }).filter(Boolean);

    return res.status(200).json({ ok: true, entries, total: entries.length });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
