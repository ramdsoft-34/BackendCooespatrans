  // models/ReporteManifiesto.js
  const mongoose = require('mongoose');

  const reporteManifiestoSchema = new mongoose.Schema({
    // ── Sesión / Bodega ───────────────────────────────────────
    bodegaNombre: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },

    // ── Numeración ────────────────────────────────────────────
    numeroRemesa: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    numeroManifiesto: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    secuencia: {
      type: Number,
      required: true,
    },

    // ── Datos del vehículo ────────────────────────────────────
    placa: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    nombreConductor: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    cedulaConductor: {
      type: String,
      required: true,
      trim: true,
    },
    nombreTitular: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    cedulaTitular: {
      type: String,
      required: true,
      trim: true,
    },
    destino: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    valorFlete: {
      type: Number,
      required: true,
      min: 0,
    },
    valorAnticipo: {
      type: Number,
      default: 0,
      min: 0,
    },
    ajuste: {
      type: Number,
      default: 0,
    },

    // ── Estado del reporte ────────────────────────────────────
    // 'pendiente' → registrado por admin, nadie lo ha tomado
    // 'en_proceso' → tomado por un userManifiesto
    // 'completado' → marcado como terminado
    estado: {
      type: String,
      enum: ['pendiente', 'en_proceso', 'completado'],
      default: 'pendiente',
    },

    // ── Bloqueo / asignación ──────────────────────────────────
    tomadoPor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    tomadoPorNombre: {
      type: String,
      default: null,
    },
    fechaTomado: {
      type: Date,
      default: null,
    },
    fechaCompletado: {
      type: Date,
      default: null,
    },

    // ── Quién lo registró ─────────────────────────────────────
    creadoPor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    creadoPorNombre: {
      type: String,
      default: null,
    },

  }, { timestamps: true });

  // Índice de unicidad: remesa y manifiesto únicos globalmente
  reporteManifiestoSchema.index({ numeroRemesa: 1 }, { unique: true });
  reporteManifiestoSchema.index({ numeroManifiesto: 1 }, { unique: true });
  reporteManifiestoSchema.index({ estado: 1 });
  reporteManifiestoSchema.index({ tomadoPor: 1 });
  reporteManifiestoSchema.index({ secuencia: 1 });

  module.exports = mongoose.model('ReporteManifiesto', reporteManifiestoSchema);