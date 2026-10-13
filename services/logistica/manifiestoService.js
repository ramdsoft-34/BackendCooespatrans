// services/logistica/manifiestoService.js
// Arma los datos del PDF del manifiesto electrónico de carga (ZArmar del
// módulo RNDC_PDF). Toma el viaje de RNDC y los maestros del RNDC (vehículo,
// titular, conductor, remitente, sedes, municipios). Donde el Excel preguntaba
// con InputBox, aquí se devuelve la lista de datos faltantes para que el
// usuario los complete en el formulario de la ficha.
const R = require('../../models/Rndc');
const C = require('./calculos');
const S = require('./rndcService');

const DIR_DEF = 'PASTO';
const TEL_DEF = '9999999999';
const CIU_DEF = 'PASTO NARIÑO';

const txt = (v) => (v === null || v === undefined ? '' : String(v).trim());
const sinTildesMay = (s) => C.quitarTildes(s).toUpperCase();

// Bodega a la que regresa el vehículo en vacío (2 primeros dígitos del DANE)
const DEPTOS = {
  '05': 'ANTIOQUIA', '08': 'ATLANTICO', 11: 'BOGOTA D.C.', 13: 'BOLIVAR', 15: 'BOYACA', 17: 'CALDAS',
  18: 'CAQUETA', 19: 'CAUCA', 20: 'CESAR', 23: 'CORDOBA', 25: 'CUNDINAMARCA', 27: 'CHOCO', 41: 'HUILA',
  44: 'LA GUAJIRA', 47: 'MAGDALENA', 50: 'META', 52: 'NARIÑO', 54: 'NORTE DE SANTANDER', 63: 'QUINDIO',
  66: 'RISARALDA', 68: 'SANTANDER', 70: 'SUCRE', 73: 'TOLIMA', 76: 'VALLE DEL CAUCA', 81: 'ARAUCA',
  85: 'CASANARE', 86: 'PUTUMAYO', 88: 'SAN ANDRES', 91: 'AMAZONAS', 94: 'GUAINIA', 95: 'GUAVIARE', 97: 'VAUPES', 99: 'VICHADA',
};
function bodegaDe(cod) {
  const p = txt(cod).slice(0, 2);
  return DEPTOS[p] ? `BODEGA ${DEPTOS[p]}` : '';
}

// Texto del municipio: 1) maestro de municipios, 2) texto de la sede, 3) RNDC_DANE, 4) alterno
async function textoMunicipio(cod, textoSede, alterno, ctx) {
  if (cod) {
    const m = await R.RndcMunicipio.findOne({ codigo: cod }).lean();
    if (m && m.texto) return m.texto;
  }
  if (textoSede) return textoSede;
  if (cod) {
    const d = ctx.dane.find(x => x.codigo === cod);
    if (d) return `${sinTildesMay(d.nombreCorto)} ${sinTildesMay(d.departamento)}`;
  }
  return sinTildesMay(alterno);
}

// "Aceptado dd/mm/yyyy hh:nn" o fecha de aceptación → "aaaa/mm/dd hh:nn"
function fechaRadicacion(v) {
  if (v.fechaAceptacion) {
    const c = C.enColombia(v.fechaAceptacion);
    const p = (n) => String(n).padStart(2, '0');
    return `${c.getUTCFullYear()}/${p(c.getUTCMonth() + 1)}/${p(c.getUTCDate())} ${p(c.getUTCHours())}:${p(c.getUTCMinutes())}`;
  }
  const m = txt(v.mensaje).match(/Aceptado (\d{2})\/(\d{2})\/(\d{4}) (\d{2}:\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}` : '';
}

// Devuelve { datos, faltantes: [{campo, etiqueta}], avisos: [] }
async function armarManifiesto(viaje, ctx) {
  const cfg = ctx.config;
  const faltantes = [];
  const avisos = [];
  const d = {
    num: txt(viaje.manifiesto), rad: txt(viaje.radicadoManifiesto), remesa: txt(viaje.remesa),
    segQR: txt(viaje.seguridadQR), placa: txt(viaje.placa).toUpperCase(), tipo: 'General',
    empresa: cfg.empresaNombre, empDir: cfg.empresaDireccion, empTel: cfg.empresaTelefono,
    empCiudad: cfg.empresaCiudad, empNit: cfg.nit, prodCod: cfg.productoCodigo, prodDesc: cfg.productoDescripcion,
    fechaExp: viaje.fecha ? C.fmtFechaRndc(viaje.fecha) : '',
    fechaPago: viaje.fecha ? C.fmtFechaRndc(C.finDeMes(viaje.fecha)) : '',
    fechaRad: fechaRadicacion(viaje),
  };
  // Origen / destino
  const nitC = S.nitCliente(viaje.empresa, ctx);
  let cod1 = txt(viaje.codOrigen);
  let cod2 = txt(viaje.codDestino);
  const sedeR = S.valorFijo(ctx, 'R', 'CODSEDEREMITENTE');
  const sR = S.sedeInfo(nitC, sedeR, ctx);
  const dnum = txt(viaje.destNumero) || nitC;
  const dsede = txt(viaje.destSede);
  const sD = S.sedeInfo(dnum, dsede, ctx);
  if (!cod1) cod1 = txt(sR?.codMunicipio);
  if (!cod2) cod2 = txt(sD?.codMunicipio);
  d.origen = await textoMunicipio(cod1, sinTildesMay(sR?.municipio || ''), '', ctx);
  d.bodega = bodegaDe(cod1);
  if (nitC === S.NIT_CORBETA && cod2.slice(0, 5) === '52001') { cod2 = '52001000'; d.tipo = 'Viaje Municipal o Urbano'; }
  d.destino = await textoMunicipio(cod2, sinTildesMay(sD?.municipio || ''), viaje.destino, ctx);
  // Remitente y destinatario
  const rem = nitC ? await R.RndcRemitente.findOne({ nit: nitC }).lean() : null;
  d.remNit = nitC;
  d.remNom = txt(rem?.nombre);
  d.remDir = txt(rem?.direccion) || sinTildesMay(sR?.direccion || '');
  d.remMuni = d.origen;
  d.desNit = dnum;
  const des = dnum ? await R.RndcRemitente.findOne({ nit: dnum }).lean() : null;
  d.desNom = txt(des?.nombre);
  d.desSede = txt(sD?.nombre) || sinTildesMay(viaje.destino);
  d.desMuni = d.destino;
  // Mercancía
  Object.assign(d, { unidad: 'Kilogramos', naturaleza: 'Carga Normal', empaque: 'Varios', dueno: 'Empresa de Transporte' });
  d.cantidad = Number(viaje.pesoKg) || 0;
  // Valores
  d.flete = Number(viaje.flete) || 0;
  d.anticipo = Number(viaje.anticipo) || 0;
  d.rete = Math.round(d.flete * 0.01);
  d.ica = 0;
  d.fopat = (Number(viaje.pbv) || 0) > S.PBV_FOPAT ? Math.round(d.flete * 0.001) : 0;
  d.neto = d.flete - d.rete - d.ica - d.fopat;
  d.saldo = d.neto - d.anticipo;
  Object.assign(d, { lugarPago: d.empCiudad, carguePor: 'REMITENTE', descarguePor: 'DESTINATARIO' });
  // Vehículo
  const veh = await R.RndcVehiculo.findOne({ placa: d.placa }).lean();
  if (!veh) {
    faltantes.push({ campo: 'vehiculo', etiqueta: `Ficha del vehículo ${d.placa} (marca, configuración, peso vacío, SOAT)` });
  }
  Object.assign(d, {
    marca: txt(veh?.marca), config: txt(veh?.configuracion), pesoVacio: txt(veh?.pesoVacio),
    soatAseg: txt(veh?.soat), poliza: txt(veh?.poliza), soatVence: txt(veh?.venceSoat),
  });
  if (d.soatVence && d.fechaExp && d.soatVence < d.fechaExp) {
    avisos.push(`El SOAT guardado para la placa ${d.placa} venció el ${d.soatVence}. Actualice los datos del SOAT vigente en la ficha del vehículo.`);
  }
  // Titular
  let tit = txt(veh?.docTitular);
  if (!tit || tit === '0') tit = txt(viaje.cedTitular);
  if (!tit || tit === '0') tit = txt(viaje.cedula);
  d.titDoc = tit;
  if (tit) {
    let t = await R.RndcTitular.findOne({ doc: tit });
    if (!t) t = new R.RndcTitular({ doc: tit });
    if (!t.direccion) t.direccion = DIR_DEF;
    if (!t.telefono) t.telefono = TEL_DEF;
    if (!t.ciudad) t.ciudad = CIU_DEF;
    await t.save();
    Object.assign(d, { titular: t.nombre, titDir: t.direccion, titTel: t.telefono, titCiudad: t.ciudad });
    if (!t.nombre) faltantes.push({ campo: 'titular', etiqueta: `Nombre completo del titular ${tit}` });
  }
  // Conductor
  d.condDoc = txt(viaje.cedula);
  if (d.condDoc) {
    let c = await R.RndcConductor.findOne({ cedula: d.condDoc });
    if (!c) c = new R.RndcConductor({ cedula: d.condDoc });
    if (!c.nombre) c.nombre = txt(viaje.conductor).toUpperCase();
    if (!c.direccion) c.direccion = DIR_DEF;
    if (!c.telefono) c.telefono = TEL_DEF;
    if (!c.ciudad) c.ciudad = CIU_DEF;
    await c.save();
    Object.assign(d, { condNom: c.nombre, condDir: c.direccion, condTel: c.telefono, condLic: c.licencia, condCiudad: c.ciudad });
    if (!c.licencia) faltantes.push({ campo: 'licencia', etiqueta: `N° de licencia del conductor ${c.nombre} (${d.condDoc})` });
  }
  // Datos que el Excel reportaba como faltantes antes de continuar
  if (!d.rad) faltantes.push({ campo: 'radicado', etiqueta: 'Radicado del manifiesto (el RNDC aún no lo acepta)' });
  if (!d.config && veh) faltantes.push({ campo: 'configuracion', etiqueta: `Configuración del vehículo ${d.placa}` });
  if (!d.titular && !tit) faltantes.push({ campo: 'titular', etiqueta: 'Titular del manifiesto' });
  if (!d.condNom) faltantes.push({ campo: 'conductor', etiqueta: 'Conductor (cédula)' });
  if (!d.origen) faltantes.push({ campo: 'origen', etiqueta: 'Municipio de origen' });
  if (!d.remNom) faltantes.push({ campo: 'remitente', etiqueta: `Nombre del remitente (cliente) NIT ${nitC} tal como sale en el RNDC` });
  return { datos: d, faltantes, avisos };
}

// Clave de control de envío (igual a la hoja _PDF_ENVIADOS: empresa|manifiestos <mes>|archivo)
function claveEnvio(viaje) {
  const mes = viaje.fecha ? C.MESES[new Date(viaje.fecha).getUTCMonth()] : C.MESES[C.hoyColombia().getUTCMonth()];
  return `${txt(viaje.empresa)}|manifiestos ${mes}|${txt(viaje.manifiesto)}.pdf`.toLowerCase();
}

module.exports = { armarManifiesto, claveEnvio, bodegaDe };
