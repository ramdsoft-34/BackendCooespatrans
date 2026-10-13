// services/logistica/correo.js
// Envío de correos del módulo de logística (equivale a EnviarCorreoSMTP del
// Excel: Gmail SMTP, puerto 465 con SSL y, si falla, 587 con STARTTLS).
// Usa la misma cuenta y la misma contraseña de aplicación que routes/emailRoutes.js.
//
// LOGISTICA_CORREO_PRUEBA=true en el .env → no envía nada (solo simula y
// registra). Útil en ambientes locales para no escribir a los clientes reales.
const nodemailer = require('nodemailer');

const REMITENTE = process.env.LOGISTICA_CORREO_REMITENTE || 'ricardomelo.cooespatrans@gmail.com';

const enModoPrueba = () => String(process.env.LOGISTICA_CORREO_PRUEBA || '').toLowerCase() === 'true';

function transporte(puerto) {
  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: puerto,
    secure: puerto === 465,
    auth: { user: REMITENTE, pass: String(process.env.GMAIL_APP_PASSWORD || '').replace(/\s/g, '') },
    connectionTimeout: 30000,
  });
}

// Separa "a@x.com, b@y.com; c@z.com" en una lista limpia.
function listaCorreos(texto) {
  const arr = Array.isArray(texto) ? texto : String(texto || '').split(/[,;\n]/);
  return arr.map(s => String(s).trim()).filter(s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
}

// adjuntos: [{ filename, content (Buffer) }]
// Devuelve { ok, simulado, error }
async function enviarCorreo({ para, asunto, texto, adjuntos = [], nombreRemitente = 'COOESPATRANS' }) {
  const destinatarios = listaCorreos(para);
  if (!destinatarios.length) return { ok: false, error: 'No hay correos de destino válidos' };
  if (enModoPrueba()) {
    console.log(`[logistica/correo] MODO PRUEBA - no se envía: "${asunto}" → ${destinatarios.join(', ')} (${adjuntos.length} adjuntos)`);
    return { ok: true, simulado: true };
  }
  if (!process.env.GMAIL_APP_PASSWORD) {
    return { ok: false, error: 'Falta configurar la contraseña de aplicación de Gmail (GMAIL_APP_PASSWORD) en el servidor.' };
  }
  const mensaje = {
    from: `"${nombreRemitente}" <${REMITENTE}>`,
    to: destinatarios.join(', '),
    subject: asunto,
    text: texto,
    attachments: adjuntos,
  };
  const errores = [];
  for (const puerto of [465, 587]) {
    try {
      await transporte(puerto).sendMail(mensaje);
      return { ok: true, simulado: false };
    } catch (e) {
      errores.push(`Puerto ${puerto}: ${e.message}`);
    }
  }
  return { ok: false, error: errores.join(' | ') };
}

module.exports = { enviarCorreo, listaCorreos, enModoPrueba, REMITENTE };
