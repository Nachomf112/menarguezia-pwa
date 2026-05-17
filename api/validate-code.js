// ════════════════════════════════════════════════════════════════
// api/validate-code.js v3 — Menarguez-IA Solutions
// ════════════════════════════════════════════════════════════════
// NOVEDADES v3:
//   - Captura OS, navegador, IP y fecha del primer acceso
//   - Guarda esos datos en Upstash junto al fingerprint
//   - El admin los muestra en la columna Dispositivo
//
// BODY: { code: "NACHO-2026", fingerprint: "a3f8c2d1", userAgent: "..." }
// ════════════════════════════════════════════════════════════════

// ── PARSEAR USER AGENT ────────────────────────────────────────
// Extrae OS y navegador del user-agent string del navegador.
// No es 100% exacto pero sí suficiente para identificar el equipo.
function parseUserAgent(ua) {
  if (!ua) return { os: 'Desconocido', browser: 'Desconocido' };

  // Sistema operativo
  let os = 'Desconocido';
  if (/Windows NT 10/.test(ua))       os = 'Windows 10/11';
  else if (/Windows NT 6/.test(ua))   os = 'Windows 7/8';
  else if (/Mac OS X/.test(ua))       os = 'macOS';
  else if (/Android/.test(ua))        os = 'Android';
  else if (/iPhone|iPad/.test(ua))    os = 'iOS';
  else if (/Linux/.test(ua))          os = 'Linux';

  // Navegador (orden importante: Edge antes que Chrome, Chrome antes que Safari)
  let browser = 'Desconocido';
  if (/Edg\//.test(ua))               browser = 'Edge';
  else if (/OPR\/|Opera/.test(ua))    browser = 'Opera';
  else if (/Firefox\//.test(ua))      browser = 'Firefox';
  else if (/Chrome\//.test(ua))       browser = 'Chrome';
  else if (/Safari\//.test(ua))       browser = 'Safari';

  // Versión del navegador
  const vMatch = ua.match(/(Chrome|Firefox|Safari|Edge|OPR)\/(\d+)/);
  if (vMatch) browser += ' ' + vMatch[2];

  return { os, browser };
}

export default async function handler(req, res) {

  // ── CORS ──────────────────────────────────────────────────────
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  // ── EXTRAER DATOS ─────────────────────────────────────────────
  // userAgent: enviado desde suite.html (navigator.userAgent)
  // fingerprint: hash del dispositivo generado en suite.html
  const { code, fingerprint, userAgent } = req.body;

  if (!code || typeof code !== 'string') {
    return res.status(400).json({ valid: false, error: 'Código requerido' });
  }

  const cleanCode = code.trim().toUpperCase();

  // IP real del cliente (Vercel añade x-forwarded-for)
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'N/A';

  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    return res.status(500).json({ valid: false, error: 'Configuración incompleta' });
  }

  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  };

  try {

    // ── LEER CÓDIGO DE UPSTASH ────────────────────────────────
    const upstashResp = await fetch(`${url}/get/code:${cleanCode}`, { headers });
    const upstashData = await upstashResp.json();

    // LOG TEMPORAL: ver exactamente qué devuelve Upstash
    console.log('UPSTASH RESULT TYPE:', typeof upstashData.result);
    console.log('UPSTASH RESULT:', JSON.stringify(upstashData.result).substring(0, 200));
    console.log('UPSTASH FULL:', JSON.stringify(upstashData).substring(0, 300));

    if (!upstashData.result) {
      return res.status(200).json({ valid: false, error: 'Código no encontrado' });
    }

    let codeData;
    try {
      // Parseo universal — maneja todos los formatos posibles de Upstash:
      // 1. Objeto nativo:  { nombre: "Nacho", ... }          → guardado sin comillas desde CLI
      // 2. String JSON:    '{"nombre":"Nacho",...}'           → guardado con JSON.stringify
      // 3. Array de str:   ['{"nombre":"Nacho",...}']         → guardado con [JSON.stringify()]
      let raw = upstashData.result;
      if (Array.isArray(raw)) raw = raw[0];
      if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch(e) {} }
      if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch(e) {} }
      // Si raw es objeto plano de Upstash (tipo "[object Object]"), ya está listo
      codeData = (raw && typeof raw === 'object') ? raw : null;
      if (!codeData) {
        return res.status(200).json({ valid: false, error: 'Error al leer el código' });
      }
    } catch (e) {
      return res.status(200).json({ valid: false, error: 'Error al leer el código' });
    }

    // ── VALIDACIÓN 1: ACTIVO ──────────────────────────────────
    console.log('codeData keys:', Object.keys(codeData || {}));
    console.log('codeData.activo:', codeData && codeData.activo);
    console.log('codeData.nombre:', codeData && codeData.nombre);
    if (!codeData.activo) {
      return res.status(200).json({
        valid: false,
        error: 'Código desactivado. Contacta con info@imenarguez-ia.com'
      });
    }

    // ── VALIDACIÓN 2: EXPIRACIÓN ──────────────────────────────
    if (codeData.expira) {
      if (new Date() > new Date(codeData.expira)) {
        return res.status(200).json({
          valid: false,
          error: 'Código expirado. Contacta con info@imenarguez-ia.com'
        });
      }
    }

    // ── VALIDACIÓN 3: LÍMITE DE USOS ─────────────────────────
    const usosUsados = codeData.usos_usados || 0;
    const usosMax = codeData.usos_max || 0;
    if (usosMax > 0 && usosUsados >= usosMax) {
      return res.status(200).json({
  valid: false,
  error: `Has agotado tus ${usosMax} análisis del plan Free. Actualiza a Pro por 19€/mes para continuar.`,
  upgrade: true,
  stripeUrl: 'https://buy.stripe.com/cNi7sM06o0rF9UE9MjcjS00'
});
    }

    // ── VALIDACIÓN 4: FINGERPRINT + CAPTURA DE DISPOSITIVO ────
    // Si el cliente envía fingerprint, lo usamos para vincular/verificar.
    // En el primer acceso guardamos también: OS, navegador, IP y fecha.
    if (fingerprint) {
      const { os, browser } = parseUserAgent(userAgent || req.headers['user-agent'] || '');
      const now = new Date();
      const fechaAcceso = now.toLocaleDateString('es-ES', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        timeZone: 'Europe/Madrid'
      });
      const horaAcceso = now.toLocaleTimeString('es-ES', {
        hour: '2-digit', minute: '2-digit',
        timeZone: 'Europe/Madrid'
      });

      if (!codeData.fingerprint) {
        // ── PRIMER ACCESO: vincular dispositivo ───────────────
        // Guardamos todos los datos del dispositivo para que el admin
        // pueda mostrarlos en la tabla de códigos.
        codeData.fingerprint = fingerprint;
        codeData.dispositivo = {
          os,
          browser,
          ip,
          fecha: fechaAcceso,
          hora: horaAcceso
        };

        await fetch(`${url}/set/code:${cleanCode}`, {
          method: 'POST',
          headers,
          // Guardamos como objeto nativo (igual que CLI sin comillas)
          // NO usar JSON.stringify(codeData) porque crea formato string que rompe el parseo
          body: JSON.stringify(codeData)
        });

      } else if (codeData.fingerprint !== fingerprint) {
        // ── DISPOSITIVO DIFERENTE: bloquear ───────────────────
        // El código ya está vinculado a otro dispositivo.
        // El admin puede resetear el fingerprint desde el panel.
        const dispositivoRegistrado = codeData.dispositivo
          ? `${codeData.dispositivo.os} · ${codeData.dispositivo.browser} (${codeData.dispositivo.ip})`
          : 'otro dispositivo';

        return res.status(200).json({
          valid: false,
          error: `Este código está vinculado a ${dispositivoRegistrado}. Contacta con info@imenarguez-ia.com`
        });
      }
      // Si fingerprint coincide → mismo dispositivo, acceso OK ✅
    }

    // ── RESPUESTA OK ──────────────────────────────────────────
    return res.status(200).json({
      valid: true,
      code: cleanCode,        // el código normalizado para usarlo en analyze.js
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
    console.error('validate-code error:', err);
    return res.status(500).json({ valid: false, error: 'Error del servidor: ' + err.message });
  }
}
