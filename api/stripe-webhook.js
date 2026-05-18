// ════════════════════════════════════════════════════════════════
// api/stripe-webhook.js — Menarguez-IA Solutions v5
// ════════════════════════════════════════════════════════════════

export const config = { api: { bodyParser: false } };

function generarCodigo(nombre) {
  const prefijo = (nombre || 'USER').substring(0, 4).toUpperCase().replace(/[^A-Z]/g, 'X');
  const parte1 = Math.random().toString(36).substring(2, 6).toUpperCase();
  const parte2 = Math.floor(Math.random() * 9000) + 1000;
  return `${prefijo}-${parte1}-${parte2}`;
}

function calcularExpiracion(dias) {
  const fecha = new Date();
  fecha.setDate(fecha.getDate() + dias);
  return fecha.toISOString().split('T')[0];
}

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function computeHMAC(secret, payload) {
  // Elimina prefijo whsec_
  const secretClean = secret.startsWith('whsec_') ? secret.slice(6) : secret;

  let keyBytes;
  // Si es hex puro (64+ chars, solo 0-9a-f) → decodifica como hex
  // Si no → decodifica como base64
  if (/^[0-9a-f]{40,}$/i.test(secretClean)) {
    keyBytes = Buffer.from(secretClean, 'hex');
  } else {
    keyBytes = Buffer.from(secretClean, 'base64');
  }

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']
  );
  const sig_buffer = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return Array.from(new Uint8Array(sig_buffer))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

async function verificarFirmaStripe(rawBody, sig) {
  try {
    const parts = sig.split(',').reduce((acc, part) => {
      const [k, ...v] = part.split('=');
      acc[k] = v.join('=');
      return acc;
    }, {});

    const timestamp = parts['t'];
    const v1 = parts['v1'];
    if (!timestamp || !v1) return false;

    const payload = `${timestamp}.${rawBody.toString()}`;

    const secretos = [
      process.env.STRIPE_WEBHOOK_SECRET,
      process.env.STRIPE_WEBHOOK_SECRET_TEST
    ].filter(Boolean);

    for (const s of secretos) {
      const computed = await computeHMAC(s, payload);
      if (computed === v1) return true;
    }

    return false;
  } catch (e) {
    console.error('Error verificando firma:', e.message);
    return false;
  }
}

const MAKE_WEBHOOK = 'https://hook.eu2.make.com/9equz6x2exk8phqz1vjyzwy75zy7z6y6';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const rawBody = await getRawBody(req);
  const sig = req.headers['stripe-signature'];

  const secretLive = process.env.STRIPE_WEBHOOK_SECRET;
  const secretTest = process.env.STRIPE_WEBHOOK_SECRET_TEST;

  if (!sig || (!secretLive && !secretTest)) {
    return res.status(400).json({ error: 'Falta firma o secreto' });
  }

  const firmaValida = await verificarFirmaStripe(rawBody, sig);
  if (!firmaValida) {
    return res.status(400).json({ error: 'Firma inválida' });
  }

  let event;
  try {
    event = JSON.parse(rawBody.toString());
  } catch (e) {
    return res.status(400).json({ error: 'JSON inválido' });
  }

  if (event.type !== 'checkout.session.completed') {
    return res.status(200).json({ received: true, skipped: true });
  }

  const session = event.data.object;
  const email  = session.customer_details?.email || '';
  const nombre = session.customer_details?.name  || email.split('@')[0] || 'Cliente';
  const importe = (session.amount_total || 0) / 100;

  let planInfo;
  if (importe >= 49) {
    planInfo = { plan: 'business', dias: 90, usos: 2000 };
  } else {
    planInfo = { plan: 'pro', dias: 30, usos: 500 };
  }

  const codigo = generarCodigo(nombre);
  const expira = calcularExpiracion(planInfo.dias);

  // Guardar en Upstash
  try {
    const codeData = {
      nombre,
      empresa: '',
      email,
      modulos: ['all'],
      plan: planInfo.plan,
      usos_max: planInfo.usos,
      usos_usados: 0,
      expira,
      activo: true,
      origen: 'stripe'
    };

    await fetch(`${process.env.KV_REST_API_URL}/set/code:${codigo}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(codeData)
    });
  } catch (e) {
    console.error('Error guardando en Upstash:', e.message);
  }

  // Enviar a Make
  try {
    await fetch(MAKE_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nombre,
        email,
        plan: planInfo.plan,
        codigo,
        expira,
        importe,
        origen: 'stripe',
        fecha: new Date().toLocaleDateString('es-ES', {
          day: '2-digit', month: '2-digit', year: 'numeric',
          timeZone: 'Europe/Madrid'
        })
      })
    });
  } catch (e) {
    console.error('Error enviando a Make:', e.message);
  }

  console.log(`✅ Stripe webhook OK — ${nombre} — ${planInfo.plan} — ${codigo}`);
  return res.status(200).json({ ok: true, codigo, plan: planInfo.plan });
}
