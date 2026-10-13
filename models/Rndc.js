// models/Rndc.js
// ─────────────────────────────────────────────────────────────────────────────
// Modelos del despacho RNDC (Registro Nacional de Despachos de Carga):
//   RndcConfig    → hoja RNDC_CONFIG (+ datos de empresa/producto de RNDC_FICHAS)
//   RndcVariable  → hoja RNDC_FIJOS (variables enviadas en remesa y manifiesto)
//   RndcViaje     → hoja RNDC_VIAJES (viajes por enviar / enviados)
//   RndcLog       → hoja RNDC_LOG (lo enviado al RNDC, sin la clave, y la respuesta)
//   RndcVehiculo / RndcTitular / RndcConductor / RndcMunicipio / RndcRemitente
//                 → bloques de la hoja RNDC_FICHAS (maestros del RNDC)
//   RndcSede      → hoja RNDC_SEDES (sedes de cada tercero)
//   RndcDane      → hoja RNDC_DANE (códigos DIVIPOLA)
//   RndcAlias     → hoja RNDC_ALIAS (destinos que no son municipios)
// ─────────────────────────────────────────────────────────────────────────────
const mongoose = require('mongoose');

const { Schema } = mongoose;

const configSchema = new Schema({
  clave:            { type: String, default: 'general', unique: true },
  url:              { type: String, default: 'http://rndcws2.mintransporte.gov.co:8080/soap/IBPMServices' },
  usuario:          { type: String, default: '' },
  nit:              { type: String, default: '9001099592' },
  modo:             { type: String, enum: ['PRUEBA', 'REAL'], default: 'PRUEBA' },
  prefijoRemesa:    { type: String, default: 'R100' },
  consecutivoRemesa:{ type: Number, default: 62801 },      // PRÓXIMO consecutivo remesa
  prefijoManifiesto:{ type: String, default: 'M100' },
  consecutivoManifiesto: { type: Number, default: 62801 }, // PRÓXIMO consecutivo manifiesto
  procesoRemesa:    { type: String, default: '3' },
  procesoManifiesto:{ type: String, default: '4' },
  procesoRemesasManifiesto: { type: String, default: '43' },
  codOrigen:        { type: String, default: '52001033' }, // DIVIPOLA de origen por defecto
  // Datos para el PDF del manifiesto (RNDC_FICHAS filas 2 y 3)
  empresaNombre:    { type: String, default: 'COOPERATIVA DE TRANSPORTES ESPANA' },
  empresaDireccion: { type: String, default: 'CRA 67-CASA 4 B/TERRAZAS BRICEÑO' },
  empresaTelefono:  { type: String, default: '3006173837' },
  empresaCiudad:    { type: String, default: 'PASTO NARINO' },
  productoCodigo:   { type: String, default: '009980' },
  productoDescripcion: { type: String, default: 'Víveres abarrotes y electrodomésticos' },
}, { timestamps: true });

const variableSchema = new Schema({
  proceso:  { type: String, enum: ['R', 'M'], required: true },
  variable: { type: String, required: true, trim: true, uppercase: true },
  valor:    { type: String, default: '' },
  nota:     { type: String, default: '' },
  orden:    { type: Number, default: 0 },
}, { timestamps: true });
variableSchema.index({ proceso: 1, variable: 1 }, { unique: true });

const viajeSchema = new Schema({
  nReg:        { type: Number, required: true },            // N° de registro en BITÁCORA
  viajeBitacora: { type: Schema.Types.ObjectId, ref: 'ViajeBitacora', default: null },
  empresa:     { type: String, trim: true, default: '' },
  conductor:   { type: String, trim: true, default: '' },
  placa:       { type: String, trim: true, uppercase: true, default: '' },
  fecha:       { type: Date, default: null },
  destino:     { type: String, trim: true, default: '' },
  flete:       { type: Number, default: 0 },
  anticipo:    { type: Number, default: 0 },
  cedula:      { type: String, trim: true, default: '' },
  codOrigen:   { type: String, trim: true, default: '' },
  codDestino:  { type: String, trim: true, default: '' },
  remesa:      { type: String, trim: true, uppercase: true, default: '' },
  manifiesto:  { type: String, trim: true, uppercase: true, default: '' },
  estadoRemesa:     { type: String, default: '' },  // '' | PRUEBA | OK | ERROR
  radicadoRemesa:   { type: String, default: '' },
  estadoManifiesto: { type: String, default: '' },  // '' | PRUEBA | OK | ERROR | NO ENVIADO | FALTAN DATOS
  radicadoManifiesto: { type: String, default: '' },
  mensaje:     { type: String, default: '' },
  pesoKg:      { type: Number, default: null },
  cedTitular:  { type: String, trim: true, default: '' },
  pbv:         { type: Number, default: null },
  destTipo:    { type: String, trim: true, default: '' },
  destNumero:  { type: String, trim: true, default: '' },
  destSede:    { type: String, trim: true, default: '' },
  seguridadQR: { type: String, default: '' },
  recomendaciones: { type: String, default: '' },
  fechaAceptacion: { type: Date, default: null },
}, { timestamps: true });
viajeSchema.index({ nReg: 1 }, { unique: true });
viajeSchema.index({ manifiesto: 1 });
viajeSchema.index({ remesa: 1 });

const logSchema = new Schema({
  fecha:    { type: Date, default: Date.now },
  url:      { type: String, default: '' },
  sobre:    { type: Number, default: 1 },    // 1 = escapado, 2 = CDATA
  enviado:  { type: String, default: '' },   // XML sin la clave
  respuesta:{ type: String, default: '' },
  viaje:    { type: Schema.Types.ObjectId, ref: 'RndcViaje', default: null },
  proceso:  { type: String, default: '' },
  usuario:  { type: String, default: '' },
}, { timestamps: true });

const vehiculoSchema = new Schema({
  placa:      { type: String, required: true, unique: true, trim: true, uppercase: true },
  marca:      { type: String, default: '' },
  configuracion: { type: String, default: '' },
  pesoVacio:  { type: String, default: '' },
  soat:       { type: String, default: '' },   // NIT y nombre aseguradora
  poliza:     { type: String, default: '' },
  venceSoat:  { type: String, default: '' },   // aaaa/mm/dd
  docTitular: { type: String, default: '' },
  pbv:        { type: Number, default: null },
}, { timestamps: true });

const titularSchema = new Schema({
  doc:       { type: String, required: true, unique: true, trim: true },
  nombre:    { type: String, default: '' },
  direccion: { type: String, default: '' },
  telefono:  { type: String, default: '' },
  ciudad:    { type: String, default: '' },
}, { timestamps: true });

const conductorSchema = new Schema({
  cedula:    { type: String, required: true, unique: true, trim: true },
  nombre:    { type: String, default: '' },
  direccion: { type: String, default: '' },
  telefono:  { type: String, default: '' },
  licencia:  { type: String, default: '' },
  ciudad:    { type: String, default: '' },
}, { timestamps: true });
conductorSchema.index({ nombre: 1 });

const municipioSchema = new Schema({
  codigo: { type: String, required: true, unique: true, trim: true },
  texto:  { type: String, default: '' },
}, { timestamps: true });

const remitenteSchema = new Schema({
  nit:       { type: String, required: true, unique: true, trim: true },
  nombre:    { type: String, default: '' },
  direccion: { type: String, default: '' }, // dirección de cargue
}, { timestamps: true });

const sedeSchema = new Schema({
  idTercero:    { type: String, required: true, trim: true },
  nombre:       { type: String, default: '' },
  codigo:       { type: Number, required: true },
  preferida:    { type: Boolean, default: false },
  codMunicipio: { type: String, default: '' },
  municipio:    { type: String, default: '' },
  direccion:    { type: String, default: '' },
}, { timestamps: true });
sedeSchema.index({ idTercero: 1, codigo: 1 }, { unique: true });

const daneSchema = new Schema({
  codDepto:     { type: String, default: '' },
  departamento: { type: String, default: '' },
  codMunicipio: { type: String, default: '' },
  municipio:    { type: String, default: '' },
  codigo:       { type: String, required: true, unique: true }, // código RNDC (8)
  nombreNormalizado: { type: String, default: '' },
  nombreCorto:  { type: String, default: '' },
}, { timestamps: true });

const aliasSchema = new Schema({
  clave:     { type: String, required: true, unique: true, trim: true, uppercase: true },
  municipio: { type: String, required: true, trim: true, uppercase: true },
}, { timestamps: true });

const modelo = (nombre, schema) => mongoose.models[nombre] || mongoose.model(nombre, schema);

module.exports = {
  RndcConfig:    modelo('RndcConfig', configSchema),
  RndcVariable:  modelo('RndcVariable', variableSchema),
  RndcViaje:     modelo('RndcViaje', viajeSchema),
  RndcLog:       modelo('RndcLog', logSchema),
  RndcVehiculo:  modelo('RndcVehiculo', vehiculoSchema),
  RndcTitular:   modelo('RndcTitular', titularSchema),
  RndcConductor: modelo('RndcConductor', conductorSchema),
  RndcMunicipio: modelo('RndcMunicipio', municipioSchema),
  RndcRemitente: modelo('RndcRemitente', remitenteSchema),
  RndcSede:      modelo('RndcSede', sedeSchema),
  RndcDane:      modelo('RndcDane', daneSchema),
  RndcAlias:     modelo('RndcAlias', aliasSchema),
};
