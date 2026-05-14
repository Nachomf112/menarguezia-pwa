// ════════════════════════════════════════════════════════════════
// api/get-codes.js — Menarguez-IA Solutions
// ════════════════════════════════════════════════════════════════
// FUNCIÓN: Lee todos los códigos de acceso de Upstash para el panel admin
// CUÁNDO SE LLAMA: Desde admin.html al cargar la sección de códigos
// CÓMO SE LLAMA: GET /api/get-codes?pwd=ADMIN_PASSWORD
// QUÉ DEVUELVE: { ok: true, codes: [...] }
//
// TAMBIÉN GESTIONA:
//   - Resetear fingerprint:  POST /api/get-codes?action=reset-fp
//   - Desactivar código:     POST /api/get-codes?action=toggle-active
//
// CÓMO AÑADIR CÓDIGOS: solo desde Upstash CLI (no desde el admin por ahora)
//   SET code:NOMBRE-2026 '{"nombre":"...","empresa":"...",...}'
// ════════════════════════════════════════════════════════════════

export default async function handler(req, res) {

  // ── CABECERAS CORS ────────────────────────────────────────────
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── AUTENTICACIÓN ─────────────────────────────────────────────
  // Misma contraseña que el panel admin (variable ADMIN_PASSWORD en Vercel)
  const pwd = req.method === 'GET'
    ? req.query?.pwd
    : req.body?.pwd;

  if (!pwd || pwd !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ ok: false, error: 'No autorizado' });
  }

  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    return res.status(500).json({ ok: false, error: 'Upstash no configurado' });
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  };

  // ── ACCIÓN: RESETEAR FINGERPRINT ──────────────────────────────
  // Borra el fingerprint de un código para que el usuario pueda
  // entrar desde otro dispositivo. Se llama desde el botón "Resetear"
  if (req.method === 'POST' && req.body?.action === 'reset-fp') {
    const { code } = req.body;
    if (!code) return res.status(400).json({ ok: false, error: 'Código requerido' });

    try {
      // Leer el código actual
      const getResp = await fetch(`${url}/get/code:${code}`, { headers });
      const getData = await getResp.json();
      if (!getData.result) return res.status(404).json({ ok: false, error: 'Código no encontrado' });

      const codeData = typeof getData.result === 'string'
        ? JSON.parse(getData.result)
        : getData.result;

      // Borrar el fingerprint
      delete codeData.fingerprint;

      // Guardar de vuelta en Upstash
      await fetch(`${url}/set/code:${code}`, {
        method: 'POST',
        headers,
        body: JSON.stringify([JSON.stringify(codeData)])
      });

      return res.status(200).json({ ok: true, message: 'Fingerprint reseteado' });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  // ── ACCIÓN: ACTIVAR / DESACTIVAR CÓDIGO ───────────────────────
  // Cambia el campo activo: true/false sin borrar el código
  if (req.method === 'POST' && req.body?.action === 'toggle-active') {
    const { code } = req.body;
    if (!code) return res.status(400).json({ ok: false, error: 'Código requerido' });

    try {
      const getResp = await fetch(`${url}/get/code:${code}`, { headers });
      const getData = await getResp.json();
      if (!getData.result) return res.status(404).json({ ok: false, error: 'Código no encontrado' });

      const codeData = typeof getData.result === 'string'
        ? JSON.parse(getData.result)
        : getData.result;

      // Invertir el estado activo
      codeData.activo = !codeData.activo;

      await fetch(`${url}/set/code:${code}`, {
        method: 'POST',
        headers,
        body: JSON.stringify([JSON.stringify(codeData)])
      });

      return res.status(200).json({ ok: true, activo: codeData.activo });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  // ── ACCIÓN: LEER TODOS LOS CÓDIGOS ───────────────────────────
  // Busca todas las claves que empiecen por "code:" en Upstash
  // y devuelve los datos de cada código para mostrarlos en el admin
  if (req.method === 'GET') {
    try {
      // SCAN busca claves por patrón. "code:*" = todas las claves de códigos
      // count=100 es el número máximo de claves a devolver por llamada
      const scanResp = await fetch(`${url}/scan/0?match=code:*&count=100`, { headers });
      const scanData = await scanResp.json();

      // scanData.result = [cursor, [key1, key2, ...]]
      const keys = scanData.result?.[1] || [];

      if (!keys.length) {
        return res.status(200).json({ ok: true, codes: [] });
      }

      // Leer cada código en paralelo para mayor velocidad
      const codePromises = keys.map(async (key) => {
        const codeKey = key.replace('code:', ''); // ej: "NACHO-2026"
        const getResp = await fetch(`${url}/get/${key}`, { headers });
        const getData = await getResp.json();

        if (!getData.result) return null;

        try {
          const data = typeof getData.result === 'string'
            ? JSON.parse(getData.result)
            : getData.result;

          return {
            code: codeKey,
            nombre: data.nombre || '—',
            empresa: data.empresa || '—',
            plan: data.plan || 'free',
            modulos: data.modulos || ['all'],
            usos_max: data.usos_max || 0,
            usos_usados: data.usos_usados || 0,
            expira: data.expira || null,
            activo: data.activo !== false,
            vinculado: !!data.fingerprint,
            // Datos del dispositivo vinculado (OS, navegador, IP, fecha)
            // Solo se rellenan tras el primer acceso desde suite.html
            dispositivo: data.dispositivo || null
          };
        } catch (e) {
          return null;
        }
      });

      const codes = (await Promise.all(codePromises))
        .filter(Boolean) // eliminar nulls
        .sort((a, b) => a.code.localeCompare(b.code)); // ordenar alfabéticamente

      return res.status(200).json({ ok: true, codes });

    } catch (err) {
      console.error('get-codes error:', err);
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  return res.status(405).json({ ok: false, error: 'Método no permitido' });
}
