// ════════════════════════════════════════════════════════════════
// api/validate-code.js v2 — Menarguez-IA Solutions
// ════════════════════════════════════════════════════════════════
// FUNCIÓN: Valida un código de acceso contra Upstash Redis
//          + vincula el código a un dispositivo (fingerprint)
//
// NOVEDADES v2:
//   - Recibe fingerprint del dispositivo desde suite.html
//   - Primera vez: guarda el fingerprint en Upstash
//   - Siguientes veces: compara el fingerprint con el guardado
//   - Si no coincide → acceso denegado (otro dispositivo)
//
// CÓMO SE LLAMA: POST /api/validate-code
//   Body: { code: "NACHO-2026", fingerprint: "a3f8c2d1" }
//
// CÓMO CREAR UN CÓDIGO EN UPSTASH (CLI):
//   SET code:NOMBRE-2026 '{"nombre":"Juan","empresa":"ACME",
//     "modulos":["all"],"plan":"pro","usos_max":500,
//     "usos_usados":0,"expira":"2026-12-31","activo":true}'
//
//   El campo "fingerprint" NO se añade manualmente — se guarda
//   automáticamente la primera vez que el usuario entra.
//
// PARA RESETEAR EL DISPOSITIVO VINCULADO (si el usuario cambia de PC):
//   En Upstash CLI:
//   SET code:NOMBRE-2026 '{"nombre":"Juan",...,"fingerprint":null}'
//   O simplemente borra el campo fingerprint del JSON.
//
// CAMPOS DEL CÓDIGO:
//   - nombre, empresa, modulos, plan, usos_max, usos_usados, expira, activo
//   - fingerprint: se añade automáticamente tras el primer acceso
// ════════════════════════════════════════════════════════════════

export default async function handler(req, res) {

  // ── CABECERAS CORS ────────────────────────────────────────────
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  // ── EXTRAER CÓDIGO Y FINGERPRINT ──────────────────────────────
  // fingerprint: huella del dispositivo generada en suite.html
  // con navigator.userAgent, screen.width/height, timezone, etc.
  const { code, fingerprint } = req.body;

  if (!code || typeof code !== 'string') {
    return res.status(400).json({ valid: false, error: 'Código requerido' });
  }

  // Normalizar código: sin espacios y en mayúsculas
  const cleanCode = code.trim().toUpperCase();

  // ── VERIFICAR VARIABLES DE ENTORNO ────────────────────────────
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    return res.status(500).json({ valid: false, error: 'Configuración incompleta' });
  }

  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;

  try {

    // ── CONSULTAR UPSTASH REDIS ───────────────────────────────────
    // Clave en Redis: "code:NACHO-2026"
    const upstashResp = await fetch(`${url}/get/code:${cleanCode}`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    const upstashData = await upstashResp.json();

    if (!upstashData.result) {
      return res.status(200).json({ valid: false, error: 'Código no encontrado' });
    }

    // ── PARSEAR DATOS DEL CÓDIGO ──────────────────────────────────
    let codeData;
    try {
      const raw = upstashData.result;
      codeData = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (e) {
      return res.status(200).json({ valid: false, error: 'Error al leer el código' });
    }

    // ── VALIDACIÓN 1: CÓDIGO ACTIVO ───────────────────────────────
    if (!codeData.activo) {
      return res.status(200).json({
        valid: false,
        error: 'Código desactivado. Contacta con info@imenarguez-ia.com'
      });
    }

    // ── VALIDACIÓN 2: FECHA DE EXPIRACIÓN ─────────────────────────
    if (codeData.expira) {
      const expDate = new Date(codeData.expira);
      if (new Date() > expDate) {
        return res.status(200).json({
          valid: false,
          error: 'Código expirado. Contacta con info@imenarguez-ia.com'
        });
      }
    }

    // ── VALIDACIÓN 3: LÍMITE DE USOS ─────────────────────────────
    // usos_max: 0 = sin límite
    const usosUsados = codeData.usos_usados || 0;
    const usosMax = codeData.usos_max || 0;
    if (usosMax > 0 && usosUsados >= usosMax) {
      return res.status(200).json({
        valid: false,
        error: `Límite de ${usosMax} análisis alcanzado. Contacta con info@imenarguez-ia.com`
      });
    }

    // ── VALIDACIÓN 4: FINGERPRINT DE DISPOSITIVO ──────────────────
    // Solo se comprueba si el cliente ha enviado un fingerprint.
    // Esto permite compatibilidad con versiones antiguas de suite.html
    // que no enviaban fingerprint.
    if (fingerprint) {

      if (!codeData.fingerprint) {
        // ── PRIMERA VEZ: guardar fingerprint ─────────────────────
        // El código no tiene fingerprint aún → es el primer acceso.
        // Guardamos el fingerprint del dispositivo actual en Upstash
        // para que los accesos futuros se comparen contra este.
        codeData.fingerprint = fingerprint;

        await fetch(`${url}/set/code:${cleanCode}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          // Guardamos el objeto completo actualizado con el fingerprint
          body: JSON.stringify([JSON.stringify(codeData)])
        });

      } else if (codeData.fingerprint !== fingerprint) {
        // ── DISPOSITIVO NO COINCIDE: bloquear ─────────────────────
        // El código ya tiene un fingerprint registrado y no coincide
        // con el del dispositivo actual → posible uso compartido.
        // Para desbloquear, el admin debe borrar el fingerprint en Upstash:
        // SET code:NOMBRE-2026 '{"nombre":"...",...,"fingerprint":null}'
        return res.status(200).json({
          valid: false,
          error: 'Este código está vinculado a otro dispositivo. Contacta con info@imenarguez-ia.com'
        });
      }
      // Si fingerprint === codeData.fingerprint → mismo dispositivo ✅
    }

    // ── RESPUESTA OK ──────────────────────────────────────────────
    // Devuelve los datos del usuario para configurar la sesión en suite.html
    return res.status(200).json({
      valid: true,
      nombre: codeData.nombre || 'Usuario',
      empresa: codeData.empresa || '',
      modulos: codeData.modulos || ['all'],
      plan: codeData.plan || 'free',
      usos_usados: usosUsados,
      usos_max: usosMax,
      usos_restantes: usosMax > 0 ? usosMax - usosUsados : null,
      expira: codeData.expira || null
    });

  } catch (err) {
    // Error inesperado — se loguea en Vercel → Functions → Logs
    console.error('validate-code error:', err);
    return res.status(500).json({ valid: false, error: 'Error del servidor: ' + err.message });
  }
}
