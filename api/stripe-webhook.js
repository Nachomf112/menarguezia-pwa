// ════════════════════════════════════════════════════════════════
// api/stripe-webhook.js — Menarguez-IA Solutions v4
// ════════════════════════════════════════════════════════════════

import Stripe from 'stripe';

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

const MAKE_WEBHOOK = 'https://hook.eu2.make.com/9equz6x2exk8phqz1vjyzwy75zy7z6y6';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const rawBody = await getRawBody(req);
  const sig = req.headers['stripe-signature'];

  const secretos = [
    process.env.STRIPE_WEBHOOK_SECRET,
    process.env.STRIPE_WEBHOOK_SECRET_TEST
  ].filter(Boolean);

  if (!sig || secretos.length === 0) {
    return res.status(400).json({ error: 'Falta firma o secreto' });
  }

  // Verificar firma con librería oficial de Stripe
  const stripe = new Stripe('sk_test_dummy', { apiVersion: '2025-11-17.clover' });
  let event = null;
  for (const secret of secretos) {
    try {
      event = stripe.webhooks.constructEvent(rawBody, sig, secret);
      break;
    } catch (e) {
      // Intenta con el siguiente secreto
    }
  }

  if (!event) {
    return res.status(400).json({ error: 'Firma inválida' });
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
