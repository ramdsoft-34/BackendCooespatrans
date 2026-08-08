const mongoose = require('mongoose');

const EMPRESAS = [
  'CORBETA',
  'DISTRIBUIDORA DULCES Y DULCES',
  'NUTRISUR',
  'DSIERRA SAS',
  'DISTRIBUIDORA CARLOS VEINTIMILLA',
  'SURTIVENTAS',
  'ALPINA',
];

const planillaCorbetaSchema = new mongoose.Schema(
  {
    // ── Metadatos ────────────────────────────────────────────────────────────
    sede: {
      type: String,
      enum: ['Pitalito', 'Pasto', 'Neiva'],
      required: true,
    },
    userEmail: { type: String, required: true, trim: true, lowercase: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    lockedFields: { type: [String], default: [] },

    // ── Empresa asociada ─────────────────────────────────────────────────────
    empresa: {
      type: String,
      enum: EMPRESAS,
      required: [true, 'La planilla debe estar asociada a una empresa'],
    },

    // ── Datos principales ────────────────────────────────────────────────────
    planilla: { type: String, trim: true },

    // ── Datos Vehículo y Ruta ────────────────────────────────────────────────
    conductorRuta: { type: String, trim: true },
    placaTrasbordo: { type: String, trim: true },
    tipoViaje: {
      type: String,
      enum: ['Urbano', 'URBANO', 'Correría', 'CORRERÍA', 'CORRERIA', ''],
      default: '',
    },
    nroManifiesto: { type: String, trim: true },

    // ── Ruta y Fechas ────────────────────────────────────────────────────────
    fechaSalidaRuta: { type: Date },
    ruta: { type: String, trim: true },

    // ── Calculados por el servidor ───────────────────────────────────────────
    plazoMaximo: { type: Number },
    limiteEntrega: { type: Date },
    alertaLegalizacion: { type: String, trim: true },
    retencion: { type: Number, default: 0 },
    saldoPagar: { type: Number, default: 0 },

    // ── Financiero ───────────────────────────────────────────────────────────
    flete: { type: Number, default: 0 },
    anticipo: { type: Number, default: 0 },
    ajusteAutorizado: { type: Number, default: 0 },

    // ── Legalización ─────────────────────────────────────────────────────────
    fechaLegalizacionReal: { type: Date },
    estadoLegalizacion: { type: String, trim: true },

    // ── Archivo adjunto ──────────────────────────────────────────────────────
    archivoPlanilla: { type: String, trim: true },
  },
  { timestamps: true }
);
planillaCorbetaSchema.pre('save', function (next) {

  // 0. Generar un valor único para 'planilla' si viene vacío
  //    (el índice único planilla_1 sigue vivo, así evitamos duplicados)
  if (!this.planilla || String(this.planilla).trim() === '') {
    this.planilla = `AUTO-${this._id}`;
  }

  // 1. plazoMaximo ← tipoViaje
  if (this.tipoViaje === 'Urbano' || this.tipoViaje === 'URBANO') {
    this.plazoMaximo = 2;
  } else if (
    this.tipoViaje === 'Correría' ||
    this.tipoViaje === 'CORRERÍA' ||
    this.tipoViaje === 'CORRERIA'
  ) {
    this.plazoMaximo = 4;
  }

  // ... resto del pre-save igual ...

  next();
});
// ── Pre-save ─────────────────────────────────────────────────────────────────
planillaCorbetaSchema.pre('save', function (next) {

  // 1. plazoMaximo ← tipoViaje
  if (this.tipoViaje === 'Urbano' || this.tipoViaje === 'URBANO') {
    this.plazoMaximo = 2;
  } else if (
    this.tipoViaje === 'Correría' ||
    this.tipoViaje === 'CORRERÍA' ||
    this.tipoViaje === 'CORRERIA'
  ) {
    this.plazoMaximo = 4;
  }

  // 2. limiteEntrega y alertaLegalizacion
  if (this.fechaLegalizacionReal) {
    this.alertaLegalizacion = 'Legalizado ✓';
  } else if (this.fechaSalidaRuta && this.plazoMaximo) {
    const fs = new Date(this.fechaSalidaRuta);
    const y = fs.getUTCFullYear();
    const m = fs.getUTCMonth();
    const d = fs.getUTCDate();

    const limite = new Date(Date.UTC(y, m, d + this.plazoMaximo));
    this.limiteEntrega = limite;

    const hoy = new Date();
    const hoyUTC = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate()));
    const diffDias = Math.ceil((hoyUTC - limite) / (1000 * 60 * 60 * 24));

    this.alertaLegalizacion = diffDias > 0
      ? `Vencida hace ${diffDias} día${diffDias !== 1 ? 's' : ''}`
      : '';
  }

  // 3. retencion = 1% de (flete + ajusteAutorizado)
  const base = (this.flete || 0) + (this.ajusteAutorizado || 0);
  this.retencion = parseFloat((base * 0.01).toFixed(2));

  // 4. saldoPagar = base - anticipo - retencion
  this.saldoPagar = parseFloat(
    (base - (this.anticipo || 0) - this.retencion).toFixed(2)
  );

  next();
});

module.exports = mongoose.model('PlanillaCorbeta', planillaCorbetaSchema);
module.exports.EMPRESAS = EMPRESAS;