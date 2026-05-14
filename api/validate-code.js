// api/validate-code.js — Menarguez-IA Solutions
// Valida códigos de acceso contra Upstash Redis
// Subir como: api/validate-code.js

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const { code } = req.body;

  if (!code || typeof code !== 'string') {
    return res.status(400).json({ valid: false, error: 'Código requerido' });
  }

  const cleanCode = code.trim().toUpperCase();

  // Verificar variables de entorno
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    return res.status(500).json({ valid: false, error: 'Configuración incompleta' });
  }

  try {
    // Leer código de Upstash
    const upstashUrl = `${process.env.KV_REST_API_URL}/get/code:${cleanCode}`;
    const upstashResp = await fetch(upstashUrl, {
      headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` }
    });

    const upstashData = await upstashResp.json();

    if (!upstashData.result) {
      return res.status(200).json({ valid: false, error: 'Código no encontrado' });
    }

    // Parsear datos del código
    let codeData;
    try {
      const raw = upstashData.result;
      codeData = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (e) {
      return res.status(200).json({ valid: false, error: 'Error al leer el código' });
    }

    // Verificar si está activo
    if (!codeData.activo) {
      return res.status(200).json({ valid: false, error: 'Código desactivado. Contacta con info@imenarguez-ia.com' });
    }

    // Verificar expiración
    if (codeData.expira) {
      const expDate = new Date(codeData.expira);
      if (new Date() > expDate) {
        return res.status(200).json({ valid: false, error: 'Código expirado. Contacta con info@imenarguez-ia.com' });
      }
    }

    // Verificar usos máximos
    const usosUsados = codeData.usos_usados || 0;
    const usosMax = codeData.usos_max || 0;
    if (usosMax > 0 && usosUsados >= usosMax) {
      return res.status(200).json({
        valid: false,
        error: `Límite de ${usosMax} análisis alcanzado. Contacta con info@imenarguez-ia.com`
      });
    }

    // ✅ Código válido — devolver datos del usuario
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
    console.error('validate-code error:', err);
    return res.status(500).json({ valid: false, error: 'Error del servidor: ' + err.message });
  }
}
