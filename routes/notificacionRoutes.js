// routes/notificacionRoutes.js — NUEVO (backend web)
// Endpoint para que el panel envíe manualmente la notificación "sin señal"
// al conductor. Reutiliza el notificacionService y registra el envío.
const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

const NotificacionEnviada = require('../models/NotificacionEnviada');
const { enviarNotificacionSinSenal } = require('../services/notificacionService');

// Busca el fcmToken del chofer en las posibles colecciones (mismo patrón que viajeRoutes)
async function buscarChoferPorId(choferId) {
  const db = mongoose.connection.db;
  const colecciones = ['choferes', 'chofers', 'drivers', 'Chofer', 'Choferes'];
  for (const nombre of colecciones) {
    try {
      const col = db.collection(nombre);
      const chofer = await col.findOne({ _id: new mongoose.Types.ObjectId(choferId) });
      if (chofer) return chofer;
    } catch (_) { /* colección inexistente o id inválido: seguir */ }
  }
  return null;
}

// POST /api/notificaciones/sin-senal
// body: { choferId, viajeId?, codigoViaje?, choferNombre? }
// Va protegido en server.js (requiere token del panel).
router.post('/sin-senal', async (req, res) => {
  const { choferId, viajeId, codigoViaje, choferNombre } = req.body;

  if (!choferId) {
    return res.status(400).json({ success: false, message: 'choferId es requerido' });
  }

  // Datos del emisor (del middleware protect → req.user)
  const enviadaPor = req.user?._id;
  const emailEmisor = req.user?.email;

  // Función interna para registrar el intento sin repetir código
  const registrar = async (enviada, motivo, fcmMessageId) => {
    try {
      await NotificacionEnviada.create({
        tipo: 'sin_senal', viajeId, codigoViaje,
        choferId, choferNombre,
        enviada, motivo, fcmMessageId,
        enviadaPor, emailEmisor,
      });
    } catch (e) {
      console.warn('[notificaciones] No se pudo registrar el envío:', e.message);
    }
  };

  try {
    const chofer = await buscarChoferPorId(choferId);

    // Caso: no existe el chofer
    if (!chofer) {
      await registrar(false, 'chofer_no_encontrado');
      return res.status(404).json({ success: false, message: 'Conductor no encontrado' });
    }

    const fcmToken = chofer.fcmToken || null;
    const nombre = choferNombre || chofer.nombre;

    // Caso: sin token válido → error controlado (no 500)
    if (!fcmToken) {
      await registrar(false, 'sin_token');
      return res.status(409).json({
        success: false,
        message: 'El dispositivo del conductor no tiene una sesión activa para recibir notificaciones (sin token).',
        motivo: 'sin_token',
      });
    }

    // Enviar
    const resultado = await enviarNotificacionSinSenal(fcmToken, {
      codigoViaje, choferNombre: nombre,
    });

    if (resultado.ok) {
      await registrar(true, 'ok', resultado.id);
      return res.json({ success: true, message: 'Notificación enviada al conductor', id: resultado.id });
    }

    // Token inválido/expirado u otro error de envío
    await registrar(false, resultado.motivo);
    const msg = resultado.motivo === 'token_invalido'
      ? 'El token del dispositivo expiró. El conductor debe abrir la app para renovarlo.'
      : 'No se pudo enviar la notificación en este momento.';
    return res.status(502).json({ success: false, message: msg, motivo: resultado.motivo });

  } catch (error) {
    console.error('[notificaciones] Error inesperado:', error);
    await registrar(false, 'error_servidor');
    return res.status(500).json({ success: false, message: 'Error interno del servidor' });
  }
});

// (Opcional) GET /api/notificaciones/historial/:viajeId — ver envíos de un viaje
router.get('/historial/:viajeId', async (req, res) => {
  try {
    const items = await NotificacionEnviada.find({ viajeId: req.params.viajeId })
      .sort({ fecha: -1 }).limit(50).lean();
    res.json({ success: true, items });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error al consultar historial' });
  }
});

module.exports = router;
