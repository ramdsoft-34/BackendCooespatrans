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

const novedadSchema = new mongoose.Schema(
  {
    planilla: { type: String, trim: true, unique: true, sparse: true },
    descripcion: { type: String, trim: true, default: '' },
    valor: { type: Number, default: 0 },
  },
  { _id: false }
);

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

    // ── Datos Mula ───────────────────────────────────────────────────────────
    planilla: { type: String, trim: true },
    placaMula: { type: String, trim: true },
    nombreConductorMula: { type: String, trim: true },
    nroFacturaMula: { type: String, trim: true },
    novedadesAverias: { type: String, trim: true },
    valorAverias: { type: Number, default: 0 },
    novedades: { type: [novedadSchema], default: [] },

    // ── Datos Vehículo y Ruta ────────────────────────────────────────────────
    conductorRuta: { type: String, trim: true },
    placaTrasbordo: { type: String, trim: true },
    planillaTrasbordo: { type: String, trim: true },
    tipoViaje: {
      type: String,
      enum: ['Urbano', 'URBANO', 'Correría', 'CORRERÍA', 'CORRERIA', ''],
      default: ''
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
    fechaLegalizacion: { type: Date },
    fechaLegalizacionReal: { type: Date },
    estadoLegalizacion: { type: String, trim: true },
    nroFacturaCorbeta: { type: String, trim: true },
    valorFacturaCorbeta: { type: Number, default: 0 },
    observaciones: { type: String, trim: true },
    novedadesLegalizacion: { type: [novedadSchema], default: [] },

    // ── Pago Corbeta ─────────────────────────────────────────────────────────
    nroFacturaPago: { type: String, trim: true },
    fechaPago: { type: Date },
    valorPagado: { type: Number, default: 0 },
    utilidad: { type: Number, default: 0 },   // calculado: flete + ajusteAutorizado
    observacionesCruze: { type: String, trim: true },
    // ── Credito, contado  ──────────────────────────────────────────────────────────────────
    credito: { type: Number, default: 0 },
    contado: { type: Number, default: 0 },

    // ── Archivo adjunto ──────────────────────────────────────────────────────
    archivoPlanilla: { type: String, trim: true },
  },
  { timestamps: true }
);

// ── Pre-save ─────────────────────────────────────────────────────────────────
planillaCorbetaSchema.pre('save', function (next) {

  // 1. plazoMaximo ← tipoViaje
  if (
    this.tipoViaje === 'Urbano' ||
    this.tipoViaje === 'URBANO'
  ) {
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

  // 5. utilidad = valorPagado − (flete + ajusteAutorizado)
  this.utilidad = parseFloat(
    ((this.valorPagado || 0) - base).toFixed(2)
  );

  next();
});

module.exports = mongoose.model('PlanillaCorbeta', planillaCorbetaSchema);
module.exports.EMPRESAS = EMPRESAS;