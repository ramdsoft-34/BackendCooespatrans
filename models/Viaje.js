// models/Viaje.js
const mongoose = require('mongoose');

const viajeSchema = new mongoose.Schema({
  // Usuario propietario del viaje. Todas las consultas se filtran por este campo.
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },

  codigo: { type: String, required: true }, // Número de planilla (único POR usuario)

  bodega: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Bodega',
    required: true
  },

  clientes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Cliente' }],

  // ESTADOS:
  // 'pendiente'  → creado por admin, conductor asignado pero aún no aceptó
  // 'aceptado'   → conductor aceptó desde la app móvil
  // 'completado' → viaje finalizado
  // (se eliminó 'activo' — ahora el estado inicial es 'pendiente')
  estado: {
    type: String,
    enum: ['pendiente', 'aceptado', 'completado'],
    default: 'pendiente'
  },

  fecha: { type: Date, default: Date.now },

  // Conductor asignado por el admin al crear el viaje (requerido desde creación)
  choferAsignado: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Chofer',
    required: false // sigue false para no romper viajes legacy sin conductor
  },

  fechaAceptacion:  { type: Date, required: false },
  fechaCompletado:  { type: Date, required: false },

  valorFlete: {
    type: Number,
    required: true,
    min: 0,
    max: 999999999999, // evita valores absurdos que rompen el formato aguas abajo
  },

  // Anticipo entregado al conductor al momento de crear el viaje (opcional,
  // por defecto 0 si no se especifica). Se descuenta del valorFlete para
  // calcular el saldo pendiente.
  anticipo: {
    type: Number,
    default: 0,
    min: 0,
    max: 999999999999,
  },

  // 📍 NUEVO CAMPO: Ruta optimizada guardada
  rutaGuardada: {
    coordenadas: [{
      lat: { type: Number },
      lng: { type: Number }
    }],
    ordenClientes: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Cliente'
    }],
    distanciaTotal: { type: Number, default: 0 },     // en metros
    duracionEstimada: { type: Number, default: 0 },   // en segundos
    generadaEn: { type: Date, default: null }
  },

  // PDFs adjuntos al viaje
  pdfs: [{
    nombre:         String,
    url:            String,
    rutaServidor:   String,
    tipoDocumento:  String, // 'factura', 'remision', 'otro'
    fechaSubida:    { type: Date, default: Date.now },
    subidoPor:      String,
    tamanio:        Number
  }],

  // Viaje creado por la integración con Translogística del Sur para rastrearlo con Sur Track
  // (vacío en los viajes normales de Cooespatrans)
  integracion: {
    origen:     { type: String },
    referencia: { type: String },
    creado:     { type: Date },
  },
});

// Índice para consultas frecuentes de viajes por conductor
viajeSchema.index({ choferAsignado: 1, estado: 1 });
viajeSchema.index({ owner: 1, codigo: 1 }, { unique: true });
viajeSchema.index({ owner: 1, estado: 1 });
viajeSchema.index({ 'integracion.referencia': 1 }, { sparse: true });

module.exports = mongoose.model('Viaje', viajeSchema);