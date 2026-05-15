// ════════════════════════════════════════════════════════════════
// api/analyze.js — Menarguez-IA Solutions
// ════════════════════════════════════════════════════════════════
// FUNCIÓN: Proxy entre suite.html y la API de Claude (Anthropic)
// CUÁNDO SE LLAMA: Cada vez que el usuario pulsa "Analizar" en
//   cualquier módulo real (Detector, Humanizer, LinkedIn, etc.)
// CÓMO SE LLAMA: POST /api/analyze → { model, max_tokens, messages }
// QUÉ HACE:
//   1. Comprueba los límites de uso (diario global + horario por IP)
//   2. Reenvía la petición a api.anthropic.com con tu API key
//   3. Devuelve la respuesta de Claude + info de uso restante
//
// POR QUÉ EXISTE ESTE PROXY:
//   La API key de Anthropic no puede estar en el frontend (suite.html)
//   porque cualquiera podría verla en el código fuente y usarla.
//   Este archivo corre en Vercel (servidor), donde la API key está
//   segura como variable de entorno.
//
// VARIABLES DE ENTORNO NECESARIAS (Vercel → Settings → Env Variables):
//   ANTHROPIC_API_KEY: tu clave de Anthropic (sk-ant-...)
//
// PARA CAMBIAR LOS LÍMITES:
//   Edita DAILY_LIMIT y HOURLY_LIMIT_PER_IP y haz commit.
//   Vercel redespliega en ~30 segundos.
// ════════════════════════════════════════════════════════════════

// ── CONFIGURACIÓN DE LÍMITES ──────────────────────────────────
// Ajusta estos valores según tu plan de Anthropic y el uso esperado.
// DAILY_LIMIT:         Máximo de análisis por día en toda la app (todos los usuarios)
// HOURLY_LIMIT_PER_IP: Máximo de análisis por hora para cada IP individual
//                      Evita que un solo usuario agote el límite diario
const DAILY_LIMIT = 50;
const HOURLY_LIMIT_PER_IP = 10;

// ── CONTADORES EN MEMORIA ─────────────────────────────────────
// Estos contadores viven en la memoria del proceso de Vercel.
// IMPORTANTE: se resetean cada vez que Vercel hace un "cold start"
// (reinicio del servidor), lo que ocurre tras períodos de inactividad.
// Para el plan Hobby de Vercel esto es suficiente — no necesitamos
// persistencia exacta. Si quisiéramos persistencia real, usaríamos
// Upstash Redis (como hacemos con los logs de acceso).
const ipCounters = {};   // { "1.2.3.4": { count: 3, reset: 1234567890 } }
let dailyCount = 0;      // Contador global del día
let dailyReset = Date.now() + 86400000; // Timestamp de reset (ahora + 24h en ms)

export default async function handler(req, res) {

  // ── CABECERAS CORS ────────────────────────────────────────────
  // Igual que en validate-code.js: permiten llamadas desde el navegador.
  // Sin estas cabeceras, el navegador bloquearía la petición.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  // ── OBTENER IP DEL USUARIO ────────────────────────────────────
  // x-forwarded-for es la cabecera que añade Vercel con la IP real del cliente.
  // Puede contener varias IPs separadas por comas si hay proxies intermedios,
  // por eso cogemos solo la primera (la IP original del usuario).
  const now = Date.now();
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';

  // ── RESET AUTOMÁTICO DEL CONTADOR DIARIO ─────────────────────
  // Si han pasado más de 24h desde el último reset, reinicia el contador.
  // 86400000 ms = 24 horas en milisegundos (24 × 60 × 60 × 1000)
  if (now > dailyReset) {
    dailyCount = 0;
    dailyReset = now + 86400000;
  }

  // ── RESET AUTOMÁTICO DEL CONTADOR HORARIO POR IP ─────────────
  // Si la IP no tiene contador aún, o si ya han pasado 60 minutos, lo crea/resetea.
  // 3600000 ms = 1 hora en milisegundos (60 × 60 × 1000)
  if (!ipCounters[ip] || now > ipCounters[ip].reset) {
    ipCounters[ip] = { count: 0, reset: now + 3600000 };
  }

  // ── COMPROBAR LÍMITE DIARIO GLOBAL ───────────────────────────
  // Si se alcanza, devuelve HTTP 429 (Too Many Requests).
  // suite.html detecta el 429 y muestra el mensaje al usuario
  // en lugar de intentar parsear la respuesta como JSON de Claude.
  if (dailyCount >= DAILY_LIMIT) {
    return res.status(429).json({
      error: 'limite_diario',
      message: 'Límite diario de análisis alcanzado. Vuelve mañana o contacta con info@imenarguez-ia.com para acceso ilimitado.'
    });
  }

  // ── COMPROBAR LÍMITE HORARIO POR IP ──────────────────────────
  // Protege contra un único usuario que intente agotar el límite diario.
  if (ipCounters[ip].count >= HOURLY_LIMIT_PER_IP) {
    return res.status(429).json({
      error: 'limite_ip',
      message: 'Has alcanzado el límite de 10 análisis por hora. Espera un momento o contacta con nosotros para acceso Pro.'
    });
  }

  // ── COMPROBAR API KEY ─────────────────────────────────────────
  // Si la variable de entorno no está configurada en Vercel, falla aquí
  // con un error claro en lugar de un error críptico de Anthropic.
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'API key no configurada' });
  }

  try {

    // ── INCREMENTAR CONTADORES ────────────────────────────────────
    // Se incrementan ANTES de hacer la llamada a Claude para evitar
    // condiciones de carrera (dos peticiones simultáneas que superen el límite).
    // Si Claude falla, se decrementan en el bloque catch.
    dailyCount++;
    ipCounters[ip].count++;

    // ── LLAMADA A LA API DE CLAUDE ────────────────────────────────
    // Reenvía el body exactamente como lo manda suite.html.
    // El body contiene: { model, max_tokens, messages: [{role, content}] }
    // La API key va en la cabecera x-api-key (nunca en el body ni en la URL).
    // anthropic-version: versión de la API de Anthropic que usamos.
    // Extraer userCode del body ANTES de mandarlo a Claude
    // Claude no entiende ese campo y devolvería error
    const { userCode, ...claudeBody } = req.body;

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

    // ── AÑADIR INFO DE USO A LA RESPUESTA ────────────────────────
    // Añadimos _usage al objeto de respuesta de Claude para que suite.html
    // pueda mostrar cuántos análisis quedan disponibles.
    // El prefijo _ indica que es un campo añadido por nosotros, no de Claude.
    // suite.html lo usa en: $('activity').innerHTML = '📊 Análisis restantes...'
    data._usage = {
      daily_remaining: DAILY_LIMIT - dailyCount,
      hourly_remaining: HOURLY_LIMIT_PER_IP - ipCounters[ip].count
    };

    // ── INCREMENTAR USOS DEL CÓDIGO EN UPSTASH ────────────────
    // Si el usuario envió su código (userCode), incrementamos usos_usados.
    // Solo si Claude respondió OK para no contar intentos fallidos.
    // GET → incrementar → SET porque el JSON es complejo (no podemos usar INCR).
    // userCode ya extraído arriba del destructuring
    if (userCode && process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
      try {
        const kvUrl = process.env.KV_REST_API_URL;
        const kvToken = process.env.KV_REST_API_TOKEN;
        const kvHeaders = {
          Authorization: `Bearer ${kvToken}`,
          'Content-Type': 'application/json'
        };
        const getResp = await fetch(`${kvUrl}/get/code:${userCode}`, { headers: kvHeaders });
        const getData = await getResp.json();
        if (getData.result) {
          // Parseo robusto — soporta 1, 2 o 3 niveles de anidamiento JSON
          let raw = getData.result;
          // Desenvuelve arrays recursivamente
          while (Array.isArray(raw)) raw = raw[0];
          // Desenvuelve strings JSON recursivamente hasta obtener un objeto
          while (typeof raw === 'string') {
            try { raw = JSON.parse(raw); } catch(e) { break; }
          }
          const codeData = raw;
          codeData.usos_usados = (codeData.usos_usados || 0) + 1;
          await fetch(`${kvUrl}/set/code:${userCode}`, {
            method: 'POST',
            headers: kvHeaders,
            body: JSON.stringify([JSON.stringify(codeData)])
          });
          data._usage.usos_usados = codeData.usos_usados;
          data._usage.usos_max = codeData.usos_max || 0;
        }
      } catch (usosErr) {
        // Error no crítico — no interrumpimos la respuesta al usuario
        console.warn('Error incrementando usos:', usosErr.message);
      }
    }

    return res.status(200).json(data);

  } catch (err) {

    // ── REVERTIR CONTADORES EN CASO DE ERROR ──────────────────────
    // Si Claude falla (timeout, error de red, etc.), no contamos ese intento
    // para no penalizar al usuario por un error que no es suyo.
    dailyCount--;
    ipCounters[ip].count--;
    return res.status(500).json({ error: err.message });
  }
}
