// models/Cliente.js
const mongoose = require('mongoose');

const ClienteSchema = new mongoose.Schema({

  // ── PROPIETARIO ──────────────────────────────────────────
  // Usuario dueño del registro. Todos los clientes se filtran por este campo.
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },

  // ── OBLIGATORIOS ─────────────────────────────────────────
  nombre: {
    type: String,
    required: [true, 'El nombre es obligatorio']
  },
  nunFactura: {
    type: String,
    required: [true, 'El número de factura es obligatorio']
  },
  bodegaId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Bodega',
    required: true
  },

  // ── NUEVO: número de planilla (viene del Excel, columna # PLANILLA) ────────
  numeroPlanilla: {
    type: String,
    default: null
  },

  // ── OPCIONALES ────────────────────────────────────────────
  apellido:     { type: String, default: null },
  cedula:       { type: String, default: null },
  telefono:     { type: String, default: null },
  email:        { type: String, default: null },
  ciudad:       { type: String, default: null },
  departamento: { type: String, default: null },
  direccion:    { type: String, default: null },
  pago:         { type: String, default: null },
  valorARecibir:{ type: Number, default: null },
  plazoDias:    { type: Number, default: null },
  tipoFactura: {
    type:    String,
    enum:    ['contado', 'credito'],
    default: 'contado'
  },

  // ── NUEVO: peso en kg (Nutrisurde, Dsierra, Surtilima) ────
  pesoKg: {
    type:    Number,
    default: null
  },

  // ── GENERADOS POR EL SISTEMA ──────────────────────────────
  fecha: {
    type:    Date,
    default: Date.now
  },
  codigoViaje: {
    type:    String,
    default: null
  },
  estadoViaje: {
    type:    String,
    enum:    ['pendiente', 'asignado', 'en_ruta', 'entregado'],
    default: 'pendiente'
  }
});

ClienteSchema.index({ owner: 1, bodegaId: 1, estadoViaje: 1 });
ClienteSchema.index({ owner: 1 });
ClienteSchema.index({ nunFactura: 1 });
ClienteSchema.index({ numeroPlanilla: 1 });
ClienteSchema.index({ codigoViaje: 1 });

module.exports = mongoose.model('Cliente', ClienteSchema);