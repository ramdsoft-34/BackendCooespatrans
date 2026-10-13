// models/Logistica.js
// ─────────────────────────────────────────────────────────────────────────────
// Modelos del módulo de Logística (traslado de la plantilla
// "PLANTILLA_DE_VIAJES_FORMULARIO.xlsm"):
//   EmpresaLogistica  → hojas Empresas + CORREOS (NIT, correos, razón social)
//   TarifaFlete       → hoja Fletes (tarifas por empresa y destino)
//   ConductorFlota    → hoja _CONDUCTORES (conductores, vehículos y tenedores)
//   ViajeBitacora     → hoja BITACORA + hojas por empresa (registro de viajes)
//   RelacionCargue    → hoja RELACION (relación de fletes para facturación)
//   ConfigLogistica   → panel de RELACION (empresa / periodo) y ajustes
//   PeriodoLogistica  → "NUEVO PERIODO" (respaldo de los registros archivados)
//   RegistroEnvio     → hoja REGISTRO_ENVIOS (correos enviados)
//   ManifiestoPdfEnvio→ hoja _PDF_ENVIADOS (PDF de manifiestos ya enviados)
// Todos los datos son globales de la operación (no se filtran por owner).
// ─────────────────────────────────────────────────────────────────────────────
const mongoose = require('mongoose');

const { Schema } = mongoose;

// Clave normalizada (minúsculas, sin espacios dobles) para unicidad sin
// distinguir mayúsculas, igual que las comparaciones UCase/LCase del Excel.
const claveDe = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();

// ── Empresas (clientes) ─────────────────────────────────────────────────────
const empresaSchema = new Schema({
  nombre:      { type: String, required: true, trim: true },
  clave:       { type: String, required: true, unique: true },
  token:       { type: String, trim: true, default: '' },
  nit:         { type: String, trim: true, default: '' },
  razonSocial: { type: String, trim: true, default: '' }, // "A quién va dirigido (Señores:)"
  correos:     { type: [String], default: [] },           // destinatarios separados
  logo:        { type: String, trim: true, default: '' }, // clave de logo en assets/logos
  activa:      { type: Boolean, default: true },
}, { timestamps: true });

empresaSchema.pre('validate', function (next) {
  this.clave = claveDe(this.nombre);
  if (!this.token) this.token = String(this.nombre || '').trim().replace(/ /g, '_');
  next();
});

// ── Tarifas por destino ─────────────────────────────────────────────────────
const tarifaSchema = new Schema({
  empresa:          { type: String, required: true, trim: true },
  destino:          { type: String, required: true, trim: true },
  clave:            { type: String, required: true, unique: true }, // empresa|destino
  tarifaCliente:    { type: Number, required: true, min: 0 },   // C: Tarifa Cliente (x viaje/día)
  tarifaAuxiliar:   { type: Number, default: 0, min: 0 },       // D: Tarifa Auxiliar
  fleteConductor:   { type: Number, required: true, min: 0 },   // E: Flete Conductor
  auxiliarPagado:   { type: Number, default: 0, min: 0 },       // F: Auxiliar Pagado
  anticipoHabitual: { type: Number, default: null, min: 0 },    // H: Anticipo Habitual
}, { timestamps: true });

tarifaSchema.pre('validate', function (next) {
  this.clave = `${claveDe(this.empresa)}|${claveDe(this.destino)}`;
  next();
});
tarifaSchema.index({ empresa: 1, destino: 1 });

// ── Conductores / vehículos / tenedores ─────────────────────────────────────
const conductorSchema = new Schema({
  nombre:           { type: String, required: true, trim: true },  // A Conductor
  placa:            { type: String, required: true, trim: true, uppercase: true, unique: true }, // B
  cedula:           { type: String, trim: true, default: '' },     // C
  venceTecnomecanica: { type: Date, default: null },               // D Fecha Runt
  venceSoat:        { type: Date, default: null },                 // E Fecha Soat
  venceLicencia:    { type: Date, default: null },                 // F Fecha Licencia
  celular:          { type: String, trim: true, default: '' },     // G
  fechaNacimiento:  { type: Date, default: null },                 // H
  numeroLicencia:   { type: String, trim: true, default: '' },     // I
  ccTenedor:        { type: String, trim: true, default: '' },     // J
  nombreTenedor:    { type: String, trim: true, default: '' },     // K
  pbv:              { type: Number, default: null },               // L Peso bruto vehicular
  pesoVacio:        { type: Number, default: null },               // M
  categoriaLicencia:{ type: String, trim: true, default: '' },     // N
  direccion:        { type: String, trim: true, default: '' },     // O
  departamento:     { type: String, trim: true, default: '' },     // P
  ciudad:           { type: String, trim: true, default: '' },     // Q
  cuenta:           { type: String, trim: true, default: '' },     // R
  tipoCuenta:       { type: String, trim: true, default: '' },     // S Ahorros / Corriente
  entidad:          { type: String, trim: true, default: '' },     // T Número entidad
  celTenedor:       { type: String, trim: true, default: '' },     // U
  dirTenedor:       { type: String, trim: true, default: '' },     // V
  deptoTenedor:     { type: String, trim: true, default: '' },     // W
  ciudadTenedor:    { type: String, trim: true, default: '' },     // X
  activo:           { type: Boolean, default: true },
}, { timestamps: true });

conductorSchema.index({ nombre: 1 });
conductorSchema.index({ cedula: 1 });

// ── Bitácora de viajes ──────────────────────────────────────────────────────
const viajeSchema = new Schema({
  numero:        { type: Number, required: true },              // A N° (consecutivo)
  empresa:       { type: String, required: true, trim: true },  // B
  manifiesto:    { type: String, trim: true, default: '' },     // C
  conductor:     { type: String, required: true, trim: true },  // D (Nombre Propio)
  placa:         { type: String, required: true, trim: true, uppercase: true }, // E
  fecha:         { type: Date, required: true },                // F (fecha del registro)
  destino:       { type: String, required: true, trim: true },  // G
  pesoKg:        { type: Number, default: 0 },                  // H
  tarifa:        { type: Number, default: 0 },                  // I
  flete:         { type: Number, default: 0 },                  // J
  anticipo:      { type: Number, default: 0 },                  // K
  auxiliar:      { type: Number, default: 0 },                  // L
  reportado:     { type: String, default: '' },                 // M "Reportado dd/mm/yyyy hh:nn"
  correoEnviado: { type: String, default: '' },                 // N "Enviado dd/mm/yyyy hh:nn"
  observaciones: { type: String, trim: true, default: '' },     // O
  enviarManifiesto:  { type: Boolean, default: false },         // P "Enviar (X)"
  manifiestoEnviado: { type: String, default: '' },             // Q "Enviado dd/mm/yyyy hh:nn"
  archivado:     { type: Boolean, default: false },             // true tras "Nuevo periodo"
  periodo:       { type: Schema.Types.ObjectId, ref: 'PeriodoLogistica', default: null },
  creadoPor:     { type: Schema.Types.ObjectId, ref: 'User', default: null },
  actualizadoPor:{ type: Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

viajeSchema.index({ archivado: 1, numero: 1 });
viajeSchema.index({ archivado: 1, fecha: 1 });
viajeSchema.index({ empresa: 1 });

// ── Relación de fletes (facturación) ────────────────────────────────────────
const relacionSchema = new Schema({
  empresa:   { type: String, required: true, trim: true },              // B
  placa:     { type: String, required: true, trim: true, uppercase: true }, // D
  planilla:  { type: String, trim: true, default: '' },                 // E N° Planilla
  destino:   { type: String, required: true, trim: true },              // F
  fecha:     { type: Date, required: true },                            // G
  cantidad:  { type: Number, required: true, min: 0 },                  // H (viajes/días)
  auxiliar:  { type: String, enum: ['Sí', 'No'], required: true },      // J Sí/No
  facturado: { type: String, enum: ['Sí', 'No', ''], default: '' },     // S Sí/No
  archivado: { type: Boolean, default: false },                         // "Limpiar" del panel
  periodoArchivo: { type: String, default: '' },
  creadoPor: { type: Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

relacionSchema.index({ archivado: 1, empresa: 1, placa: 1, fecha: 1 });

// ── Configuración / panel ───────────────────────────────────────────────────
const configSchema = new Schema({
  clave:            { type: String, default: 'general', unique: true },
  relacionEmpresa:  { type: String, default: '' },  // RELACION!D7
  relacionPeriodo:  { type: String, default: '' },  // RELACION!K7
  folioDias:        { type: Number, default: 0 },   // COOESPATRANS!K2 (folio = hoy + K2)
  remitenteNombre:  { type: String, default: 'COOESPATRANS' }, // _CONFIG_CORREO!B3
}, { timestamps: true });

// ── Periodos cerrados ("NUEVO PERIODO") ─────────────────────────────────────
const periodoSchema = new Schema({
  nombre:     { type: String, required: true, trim: true },
  fechaCierre:{ type: Date, default: Date.now },
  totalViajes:{ type: Number, default: 0 },
  totales:    { type: Object, default: {} },
  cerradoPor: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  cerradoPorNombre: { type: String, default: '' },
}, { timestamps: true });

// ── Registro de envíos de correo ────────────────────────────────────────────
const registroEnvioSchema = new Schema({
  empresa:   { type: String, trim: true, default: '' },
  documento: { type: String, trim: true, default: '' },  // NOMBRE DEL DOCUMENTO / asunto
  tipo:      { type: String, trim: true, default: '' },  // manifiestos | salida | pdf-manifiestos
  correos:   { type: String, trim: true, default: '' },
  adjuntos:  { type: [String], default: [] },
  estado:    { type: String, enum: ['enviado', 'simulado', 'error'], default: 'enviado' },
  detalle:   { type: String, default: '' },
  fecha:     { type: Date, default: Date.now },
  usuario:   { type: String, default: '' },
}, { timestamps: true });

// ── PDF de manifiestos ya enviados (o marcados sin enviar) ─────────────────
const pdfEnvioSchema = new Schema({
  clave:    { type: String, required: true, unique: true }, // empresa|mes|archivo (minúsculas)
  empresa:  { type: String, trim: true, default: '' },
  archivo:  { type: String, trim: true, default: '' },
  manifiesto: { type: String, trim: true, default: '' },
  fecha:    { type: Date, default: Date.now },
  estado:   { type: String, default: 'Enviado' },           // Enviado | Marcado sin enviar
}, { timestamps: true });

const modelo = (nombre, schema) => mongoose.models[nombre] || mongoose.model(nombre, schema);

module.exports = {
  claveDe,
  EmpresaLogistica:   modelo('EmpresaLogistica', empresaSchema),
  TarifaFlete:        modelo('TarifaFlete', tarifaSchema),
  ConductorFlota:     modelo('ConductorFlota', conductorSchema),
  ViajeBitacora:      modelo('ViajeBitacora', viajeSchema),
  RelacionCargue:     modelo('RelacionCargue', relacionSchema),
  ConfigLogistica:    modelo('ConfigLogistica', configSchema),
  PeriodoLogistica:   modelo('PeriodoLogistica', periodoSchema),
  RegistroEnvio:      modelo('RegistroEnvio', registroEnvioSchema),
  ManifiestoPdfEnvio: modelo('ManifiestoPdfEnvio', pdfEnvioSchema),
};
