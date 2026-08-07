const admin = require('firebase-admin');
const path = require('path');

// Inicializar Firebase Admin solo una vez
if (!admin.apps.length) {
  const serviceAccount = require(path.join(__dirname, '../serviceAccountKey.json'));
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
  console.log('✅ Firebase Admin inicializado');
}

// ─────────────────────────────────────────────────────────────
// Enviar notificación de viaje asignado a un conductor
// ─────────────────────────────────────────────────────────────
const enviarNotificacionViajeAsignado = async (fcmToken, viaje) => {
  if (!fcmToken) {
    console.warn('[FCM] ⚠️ Sin FCM token para el conductor — notificación omitida');
    return null;
  }

  try {
    const mensaje = {
      token: fcmToken,
      notification: {
        title: '🚛 Nuevo viaje asignado',
        body: `Planilla ${viaje.codigo} — ${viaje.cantidadClientes || 0} clientes`,
      },
      data: {
        tipo: 'viaje_asignado',
        codigo: String(viaje.codigo),
        viajeId: String(viaje._id),
      },
      android: {
        priority: 'high',
        notification: {
          channelId: 'viajes_channel',
          priority: 'high',
          defaultSound: true,
          defaultVibrateTimings: true,
          icon: 'ic_launcher',
        },
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
          },
        },
      },
    };

    const resultado = await admin.messaging().send(mensaje);
    console.log(`[FCM] ✅ Notificación enviada al conductor — ID: ${resultado}`);
    return resultado;
  } catch (error) {
    // Token inválido o expirado — no es un error crítico
    if (
      error.code === 'messaging/registration-token-not-registered' ||
      error.code === 'messaging/invalid-registration-token'
    ) {
      console.warn(`[FCM] ⚠️ Token FCM inválido o expirado para el conductor`);
    } else {
      console.error('[FCM] ❌ Error enviando notificación:', error.message);
    }
    return null;
  }
};

// ─────────────────────────────────────────────────────────────
// Enviar notificación de "pérdida de conexión" a un conductor
// Devuelve { ok: true, id } si se envió, o { ok: false, motivo } si no.
// ─────────────────────────────────────────────────────────────
const enviarNotificacionSinSenal = async (fcmToken, { codigoViaje, choferNombre } = {}) => {
  if (!fcmToken) {
    // El backend decide qué responder; aquí solo informamos el motivo.
    return { ok: false, motivo: 'sin_token' };
  }

  try {
    const mensaje = {
      token: fcmToken,
      notification: {
        title: '📡 Se perdió tu conexión',
        body: 'Abre SurTrack para restablecer la comunicación y actualizar tu ubicación.',
      },
      data: {
        tipo: 'sin_senal',
        codigo: String(codigoViaje || ''),
      },
      android: {
        priority: 'high',
        notification: {
          channelId: 'viajes_channel', // reutiliza el canal ya creado en la app
          priority: 'high',
          defaultSound: true,
          defaultVibrateTimings: true,
          icon: 'ic_launcher',
        },
      },
      apns: {
        payload: { aps: { sound: 'default', badge: 1 } },
      },
    };

    const id = await admin.messaging().send(mensaje);
    console.log(`[FCM] ✅ Notificación "sin señal" enviada — ID: ${id}`);
    return { ok: true, id };
  } catch (error) {
    if (
      error.code === 'messaging/registration-token-not-registered' ||
      error.code === 'messaging/invalid-registration-token'
    ) {
      console.warn('[FCM] ⚠️ Token FCM inválido o expirado (sin señal)');
      return { ok: false, motivo: 'token_invalido' };
    }
    console.error('[FCM] ❌ Error enviando notificación (sin señal):', error.message);
    return { ok: false, motivo: 'error_envio', detalle: error.message };
  }
};

module.exports = {
  enviarNotificacionViajeAsignado,
  enviarNotificacionSinSenal,
};