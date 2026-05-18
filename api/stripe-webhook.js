// ════════════════════════════════════════════════════════════════
// api/stripe-webhook.js — Menarguez-IA Solutions
// ════════════════════════════════════════════════════════════════
// FUNCIÓN: Recibe el evento checkout.session.completed de Stripe,
//   genera código de acceso según plan y lo envía por Make/Gmail
// ════════════════════════════════════════════════════════════════

export const config = { api: { bodyParser: false } };

function generarCodigo(nombre) {
  const prefijo = nombre.substring(0, 4).toUpperCase().replace(/[^A-Z]/g, 'X');
  const parte1 = Math.random().toString(36).substring(2, 6).toUpperCase();
  const parte2 = Math.floor(Math.random() * 9000) + 1000;
  return `${prefijo}-${parte1}-${parte2}`;
}

function calcularExpiracion(dias) {
  const fecha = new Date();
  fecha.setDate(fecha.getDate() + dias);
  return fecha.toISOString().split('T')[0];
}

const PLANES = {
  'price_pro':      { plan: 'pro',      dias: 30,  usos: 500  },
  'price_business': { plan: 'business', dias: 90,  usos: 2000 }
};

const MAKE_WEBHOOK = 'https://hook.eu2.make.com/9equz6x2exk8phqz1vjyzwy75zy7z6y6';

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const rawBody = await getRawBody(req);
  const sig = req.headers['stripe-signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  // Verificar firma de Stripe
  let event;
  try {
    const header = sig.split(',').reduce((acc, part) => {
      const [k, v] = part.split('=');
      acc[k] = v;
      return acc;
    }, {});

    const timestamp = header['t'];
    const signatures = sig.split(',').filter(p => p.startsWith('v1=')).map(p => p.split('=')[1]);
    const payload = `${timestamp}.${rawBody.toString()}`;

    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret.replace('whsec_', ''));
    const key = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
    const expectedSig = Array.from(new Uint8Array(signatureBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

    if (!signatures.includes(expectedSig)) {
      return res.status(400).json({ error: 'Firma inválida' });
    }
  } catch (err) {
    return res.status(400).json({ error: 'Error verificando firma: ' + err.message });
  }

  const event = JSON.parse(rawBody.toString());

  if (event.type !== 'checkout.session.completed') {
    return res.status(200).json({ received: true });
  }

  const session = event.data.object;
  const email    = session.customer_details?.email || '';
  const nombre   = session.customer_details?.name  || email.split('@')[0] || 'Cliente';
  const priceId  = session.line_items?.data?.[0]?.price?.id || '';
  const importe  = (session.amount_total || 0) / 100;

  // Detectar plan por importe si no hay priceId
  let planInfo;
  if (PLANES[priceId]) {
    planInfo = PLANES[priceId];
  } else if (importe >= 49) {
    planInfo = { plan: 'business', dias: 90, usos: 2000 };
  } else if (importe >= 19) {
    planInfo = { plan: 'pro', dias: 30, usos: 500 };
  } else {
    planInfo = { plan: 'pro', dias: 30, usos: 500 };
  }

  const codigo = generarCodigo(nombre);
  const expira = calcularExpiracion(planInfo.dias);

  // Guardar código en Upstash
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
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
  }

  // Enviar a Make para email automático
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

  return res.status(200).json({ ok: true, codigo });
}