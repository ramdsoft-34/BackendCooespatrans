// models/NotificacionEnviada.js — NUEVO (backend web)
// Registra cada notificación "sin señal" enviada desde el panel, para
// trazabilidad (quién la envió, a qué viaje/chofer, y el resultado).
const mongoose = require('mongoose');

const notificacionEnviadaSchema = new mongoose.Schema({
  tipo:        { type: String, default: 'sin_senal' },
  viajeId:     { type: String, index: true },
  codigoViaje: { type: String },
  choferId:    { type: String, index: true },
  choferNombre:{ type: String },

  // Resultado del envío
  enviada:     { type: Boolean, default: false },
  motivo:      { type: String },   // sin_token | token_invalido | error_envio | ok
  fcmMessageId:{ type: String },   // ID que devuelve FCM cuando se envía

  // Quién la disparó (del token JWT del usuario del panel)
  enviadaPor:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  emailEmisor: { type: String },

  fecha:       { type: Date, default: Date.now, index: true },
});

module.exports = mongoose.model('NotificacionEnviada', notificacionEnviadaSchema);
