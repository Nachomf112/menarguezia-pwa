// ════════════════════════════════════════════════════════════════
// api/tally-webhook.js — Menarguez-IA Solutions
// ════════════════════════════════════════════════════════════════
// FUNCIÓN: Recibe el webhook de Tally, procesa los datos y:
//   1. Genera código único + fecha expiración según plan
//   2. Crea el código en Upstash Redis
//   3. Manda datos limpios a Make para Google Sheets + Gmail
//
// CONFIGURAR EN TALLY:
//   Integrations → Webhooks → URL: https://app.menarguez-ia.com/api/tally-webhook
// ════════════════════════════════════════════════════════════════

// ── DÍAS DE ACCESO POR PLAN ───────────────────────────────────
const DIAS_POR_PLAN = {
  'Free': 7,
  'Pro': 30,
  'Business': 90,
  'Enterprise': 365
};

// ── USOS MÁXIMOS POR PLAN ────────────────────────────────────
const USOS_POR_PLAN = {
  'Free': 10,
  'Pro': 500,
  'Business': 2000,
  'Enterprise': 0  // sin límite
};

// ── GENERAR CÓDIGO ÚNICO ──────────────────────────────────────
function generarCodigo(nombre) {
  const prefijo = nombre.substring(0, 4).toUpperCase().replace(/[^A-Z]/g, 'X');
  const fecha = new Date().toLocaleDateString('es-ES', {
    day: '2-digit', month: '2-digit', timeZone: 'Europe/Madrid'
  }).replace('/', '');
  const aleatorio = Math.floor(Math.random() * 9000) + 1000;
  return `${prefijo}-${fecha}-${aleatorio}`;
}

// ── CALCULAR FECHA EXPIRACIÓN ─────────────────────────────────
function calcularExpiracion(plan) {
  const dias = DIAS_POR_PLAN[plan] || 7;
  const fecha = new Date();
  fecha.setDate(fecha.getDate() + dias);
  return fecha.toISOString().split('T')[0]; // YYYY-MM-DD
}

// ── EXTRAER CAMPO POR LABEL ───────────────────────────────────
// Busca en el array fields[] el campo con el label indicado
// FIX v2: MULTIPLE_CHOICE manda IDs en value[], no objetos con .text
// Hay que cruzar con campo.options para obtener el texto real
function extraerCampo(fields, label) {
  const campo = fields.find(f => f.label === label);
  if (!campo) return '';

  if (campo.type === 'MULTIPLE_CHOICE' && Array.isArray(campo.value)) {
    // campo.value contiene IDs (strings), no objetos
    // Cruzamos con campo.options para obtener el texto legible
    const seleccionadoId = campo.value[0];
    if (!seleccionadoId) return '';

    if (Array.isArray(campo.options)) {
      const opcion = campo.options.find(o => o.id === seleccionadoId);
      if (opcion?.text) return opcion.text;
    }

    // Fallback: si no hay options o no matchea, devolver el ID tal cual
    // (mejor que vacío para debug)
    return seleccionadoId;
  }

  return campo.value || '';
}

export default async function handler(req, res) {

  // ── CORS ──────────────────────────────────────────────────────
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const body = req.body;

    // Tally envía los datos en body.data.fields
    const fields = body?.data?.fields || [];

    if (!fields.length) {
      return res.status(400).json({ error: 'No fields received' });
    }

    // ── EXTRAER DATOS DEL FORMULARIO ──────────────────────────
    const nombre   = extraerCampo(fields, 'Nombre completo');
    const empresa  = extraerCampo(fields, 'Empresa');
    const email    = extraerCampo(fields, 'Email de contacto');
    const telefono = extraerCampo(fields, 'Teléfono');
    const plan     = extraerCampo(fields, 'Plan que te interesa');
    const caso     = extraerCampo(fields, 'Cuéntanos tu caso de uso');

    // ── GENERAR CÓDIGO Y EXPIRACIÓN ───────────────────────────
    const codigo  = generarCodigo(nombre);
    const expira  = calcularExpiracion(plan);
    const usosMax = USOS_POR_PLAN[plan] ?? 10;

    // ── CREAR CÓDIGO EN UPSTASH ───────────────────────────────
    if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
      const codeData = {
        nombre,
        empresa,
        email,
        modulos: ['all'],
        plan: plan.toLowerCase(),
        usos_max: usosMax,
        usos_usados: 0,
        expira,
        activo: true
      };

      await fetch(`${process.env.KV_REST_API_URL}/set/code:${codigo}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(codeData)
      });
    }

    // ── MANDAR DATOS LIMPIOS A MAKE ───────────────────────────
    // Make recibe campos simples (no arrays) → mapeo perfecto
    const makeWebhook = 'https://hook.eu2.make.com/9equz6x2exk8phqz1vjyzwy75zy7z6y6';

    await fetch(makeWebhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nombre,
        empresa,
        email,
        telefono,
        plan,
        caso,
        codigo,
        expira,
        fecha: new Date().toLocaleDateString('es-ES', {
          day: '2-digit', month: '2-digit', year: 'numeric',
          timeZone: 'Europe/Madrid'
        })
      })
    });

    return res.status(200).json({ ok: true, codigo, expira });

  } catch (err) {
    console.error('tally-webhook error:', err);
    return res.status(500).json({ error: err.message });
  }
}
