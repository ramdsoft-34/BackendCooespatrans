// services/logistica/importador.js
// ─────────────────────────────────────────────────────────────────────────────
// Carga en la base de datos la información de la plantilla
// "PLANTILLA_DE_VIAJES_FORMULARIO.xlsm" (todas sus hojas de datos).
// Es seguro ejecutarlo varias veces: nunca borra ni sobrescribe lo que ya
// existe; solo agrega lo que falta y completa campos vacíos.
// ─────────────────────────────────────────────────────────────────────────────
const XLSX = require('xlsx');
const L = require('../../models/Logistica');
const R = require('../../models/Rndc');
const C = require('./calculos');

const txt = (v) => (v === null || v === undefined ? '' : String(v).trim());
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : (txt(v) && Number.isFinite(Number(txt(v))) ? Number(txt(v)) : null));
const entero = (v) => (typeof v === 'number' ? String(Math.round(v)) : txt(v));

// Serial de Excel → fecha (medianoche UTC). Acepta también textos dd/mm/aaaa o aaaa/mm/dd.
function fechaExcel(v) {
  if (typeof v === 'number' && v > 0) return new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000);
  const s = txt(v).replace(/^(\d{4})\/(\d{2})\/(\d{2})$/, '$1-$2-$3');
  return C.parseFecha(s);
}
// Serial con hora (hora de Colombia) → instante UTC
function fechaHoraExcel(v) {
  if (typeof v === 'number' && v > 0) return new Date(Date.UTC(1899, 11, 30) + v * 86400000 + 5 * 3600000);
  const m = txt(v).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] + 5, +m[5], +(m[6] || 0)));
  const d = txt(v).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?: (\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (d) return new Date(Date.UTC(+d[3], +d[2] - 1, +d[1], (+d[4] || 0) + 5, +d[5] || 0, +d[6] || 0));
  return fechaExcel(v);
}

function hoja(wb, nombre) {
  const ws = wb.Sheets[nombre];
  return ws ? XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }) : [];
}

const LOGO_POR_EMPRESA = {
  alpina: 'alpina', surtiventas: 'surtiventas', 'surtiventas mocoa': 'surtiventas', 'nutrisur pasto': 'nutrisur',
  'nutrisur popayan': 'nutrisur', 'casa andina': 'casaandina', corbeta: 'corbeta', 'dulces & dulces': 'dulces',
};

// Inserta ignorando duplicados de índice único
async function insertarVarios(modelo, docs) {
  if (!docs.length) return 0;
  try {
    const r = await modelo.insertMany(docs, { ordered: false });
    return r.length;
  } catch (e) {
    if (e.code === 11000 || e.writeErrors) return e.insertedDocs?.length ?? (e.result?.insertedCount || 0);
    throw e;
  }
}

async function importarPlantilla(buffer, { usuario = null } = {}) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false, bookVBA: false });
  const res = {};

  // ── Empresas + CORREOS ────────────────────────────────────────────────────
  const correos = new Map(hoja(wb, 'CORREOS').slice(1).filter(f => txt(f[0])).map(f => [L.claveDe(f[0]), f]));
  let nE = 0; let uE = 0;
  for (const f of hoja(wb, 'Empresas').slice(1)) {
    const nombre = txt(f[0]);
    if (!nombre) continue;
    const co = correos.get(L.claveDe(nombre));
    const datos = {
      nombre, token: txt(f[1]), nit: entero(f[2]), razonSocial: txt(co?.[2]),
      correos: co ? String(co[1] || '').split(/[,;]/).map(s => s.trim()).filter(Boolean) : [],
      logo: LOGO_POR_EMPRESA[L.claveDe(nombre)] || '',
    };
    const e = await L.EmpresaLogistica.findOne({ clave: L.claveDe(nombre) });
    if (!e) { await L.EmpresaLogistica.create(datos); nE += 1; continue; }
    let cambio = false;
    for (const k of ['token', 'nit', 'razonSocial', 'logo']) if (!e[k] && datos[k]) { e[k] = datos[k]; cambio = true; }
    if (!e.correos.length && datos.correos.length) { e.correos = datos.correos; cambio = true; }
    if (cambio) { await e.save(); uE += 1; }
  }
  // Empresas que solo están en CORREOS
  for (const [clave, f] of correos) {
    if (!(await L.EmpresaLogistica.exists({ clave }))) {
      await L.EmpresaLogistica.create({ nombre: txt(f[0]), razonSocial: txt(f[2]), correos: String(f[1] || '').split(/[,;]/).map(s => s.trim()).filter(Boolean), logo: LOGO_POR_EMPRESA[clave] || '' });
      nE += 1;
    }
  }
  res.empresas = { nuevas: nE, completadas: uE };

  // ── Tarifas (Fletes) ──────────────────────────────────────────────────────
  const tarifas = [];
  const claves = new Set((await L.TarifaFlete.find().select('clave').lean()).map(t => t.clave));
  for (const f of hoja(wb, 'Fletes').slice(1)) {
    const empresa = txt(f[0]); const destino = txt(f[1]);
    if (!empresa || !destino) continue;
    const clave = `${L.claveDe(empresa)}|${L.claveDe(destino)}`;
    if (claves.has(clave)) continue;
    claves.add(clave);
    tarifas.push({ empresa, destino, clave, tarifaCliente: num(f[2]) || 0, tarifaAuxiliar: num(f[3]) || 0,
      fleteConductor: num(f[4]) || 0, auxiliarPagado: num(f[5]) || 0, anticipoHabitual: num(f[7]) });
  }
  res.tarifas = { nuevas: await insertarVarios(L.TarifaFlete, tarifas) };

  // ── Conductores (_CONDUCTORES) ───────────────────────────────────────────
  const placas = new Set((await L.ConductorFlota.find().select('placa').lean()).map(c => c.placa));
  const conds = [];
  for (const f of hoja(wb, '_CONDUCTORES').slice(1)) {
    const nombre = txt(f[0]); const placa = txt(f[1]).replace(/\s/g, '').toUpperCase();
    if (!nombre || !placa || placas.has(placa)) continue;
    placas.add(placa);
    conds.push({
      nombre, placa, cedula: entero(f[2]), venceTecnomecanica: fechaExcel(f[3]), venceSoat: fechaExcel(f[4]),
      venceLicencia: fechaExcel(f[5]), celular: entero(f[6]), fechaNacimiento: fechaExcel(f[7]), numeroLicencia: entero(f[8]),
      ccTenedor: entero(f[9]), nombreTenedor: txt(f[10]), pbv: num(f[11]), pesoVacio: num(f[12]), categoriaLicencia: txt(f[13]),
      direccion: txt(f[14]), departamento: txt(f[15]), ciudad: txt(f[16]), cuenta: entero(f[17]), tipoCuenta: txt(f[18]),
      entidad: entero(f[19]), celTenedor: entero(f[20]), dirTenedor: txt(f[21]), deptoTenedor: txt(f[22]), ciudadTenedor: txt(f[23]),
    });
  }
  res.conductores = { nuevos: await insertarVarios(L.ConductorFlota, conds) };

  // ── Bitácora ─────────────────────────────────────────────────────────────
  let nB = 0;
  for (const f of hoja(wb, 'BITACORA').slice(2)) {
    const numero = num(f[0]);
    if (!numero || !txt(f[1])) continue;
    const fecha = fechaExcel(f[5]) || C.hoyColombia();
    const placa = txt(f[4]).toUpperCase();
    if (await L.ViajeBitacora.exists({ archivado: false, numero, placa, fecha })) continue;
    await L.ViajeBitacora.create({
      numero, empresa: txt(f[1]), manifiesto: txt(f[2]), conductor: txt(f[3]) || '(sin nombre)', placa: placa || 'SIN-PLACA', fecha,
      destino: txt(f[6]) || '(sin destino)', pesoKg: num(f[7]) || 0, tarifa: num(f[8]) || 0, flete: num(f[9]) || 0,
      anticipo: num(f[10]) || 0, auxiliar: num(f[11]) || 0, reportado: txt(f[12]), correoEnviado: txt(f[13]),
      observaciones: txt(f[14]), enviarManifiesto: txt(f[15]).toUpperCase() === 'X', manifiestoEnviado: txt(f[16]),
      creadoPor: usuario?._id || null,
    });
    nB += 1;
  }
  res.bitacora = { nuevos: nB };

  // ── Relación de fletes ───────────────────────────────────────────────────
  const rel = hoja(wb, 'RELACION');
  const conteo = new Map();
  const filasRel = [];
  for (const f of rel.slice(10)) {
    const placa = txt(f[3]).toUpperCase();
    if (!placa || !txt(f[1])) continue;
    const fecha = fechaExcel(f[6]);
    if (!fecha) continue;
    const auxiliar = txt(f[9]) === 'No' ? 'No' : 'Sí';
    const facturado = ['Sí', 'No'].includes(txt(f[18])) ? txt(f[18]) : '';
    const d = { empresa: txt(f[1]), placa, planilla: txt(f[4]), destino: txt(f[5]), fecha, cantidad: num(f[7]) || 1, auxiliar, facturado };
    const clave = JSON.stringify([d.empresa, d.placa, d.planilla, d.destino, +d.fecha, d.cantidad]);
    conteo.set(clave, (conteo.get(clave) || 0) + 1);
    filasRel.push({ d, clave });
  }
  let nR = 0;
  const yaContadas = new Map();
  for (const { d, clave } of filasRel) {
    const enExcel = conteo.get(clave);
    if (!yaContadas.has(clave)) {
      yaContadas.set(clave, await L.RelacionCargue.countDocuments({ archivado: false, empresa: d.empresa, placa: d.placa, planilla: d.planilla, destino: d.destino, fecha: d.fecha, cantidad: d.cantidad }));
    }
    if (yaContadas.get(clave) >= enExcel) continue;
    await L.RelacionCargue.create({ ...d, creadoPor: usuario?._id || null });
    yaContadas.set(clave, yaContadas.get(clave) + 1);
    nR += 1;
  }
  const cfg = await L.ConfigLogistica.findOne({ clave: 'general' }) || new L.ConfigLogistica({ clave: 'general' });
  if (!cfg.relacionEmpresa && txt(rel[6]?.[3])) cfg.relacionEmpresa = txt(rel[6][3]);
  if (!cfg.relacionPeriodo && txt(rel[6]?.[10])) cfg.relacionPeriodo = txt(rel[6][10]);
  const cfgCorreo = hoja(wb, '_CONFIG_CORREO');
  if (txt(cfgCorreo[2]?.[1])) cfg.remitenteNombre = cfg.remitenteNombre || txt(cfgCorreo[2][1]);
  const coo = hoja(wb, 'COOESPATRANS');
  if (!cfg.folioDias && num(coo[1]?.[10])) cfg.folioDias = num(coo[1][10]);
  await cfg.save();
  res.relacion = { nuevos: nR };

  // ── RNDC: configuración ─────────────────────────────────────────────────
  const rc = hoja(wb, 'RNDC_CONFIG');
  const fic = hoja(wb, 'RNDC_FICHAS');
  if (rc.length) {
    const val = (fila) => txt(rc[fila - 1]?.[1]);
    let c = await R.RndcConfig.findOne({ clave: 'general' });
    const nueva = !c;
    if (!c) c = new R.RndcConfig({ clave: 'general' });
    const def = new R.RndcConfig();
    const poner = (k, v) => { if (v !== '' && (nueva || !c[k] || c[k] === def[k])) c[k] = v; };
    poner('url', val(3)); poner('usuario', val(4)); poner('nit', entero(rc[4]?.[1]));
    poner('modo', ['PRUEBA', 'REAL'].includes(val(6).toUpperCase()) ? val(6).toUpperCase() : '');
    poner('prefijoRemesa', val(7)); poner('prefijoManifiesto', val(9));
    poner('procesoRemesa', val(11)); poner('procesoManifiesto', val(12)); poner('procesoRemesasManifiesto', val(13)); poner('codOrigen', val(14));
    // Consecutivos: nunca se retroceden
    c.consecutivoRemesa = Math.max(Number(c.consecutivoRemesa) || 0, num(rc[7]?.[1]) || 0) || def.consecutivoRemesa;
    c.consecutivoManifiesto = Math.max(Number(c.consecutivoManifiesto) || 0, num(rc[9]?.[1]) || 0) || def.consecutivoManifiesto;
    if (fic.length) {
      poner('empresaNombre', txt(fic[1]?.[1])); poner('empresaDireccion', txt(fic[1]?.[4]));
      poner('empresaTelefono', entero(fic[1]?.[7])); poner('empresaCiudad', txt(fic[1]?.[10]));
      poner('productoCodigo', txt(fic[2]?.[1])); poner('productoDescripcion', txt(fic[2]?.[4]));
    }
    await c.save();
    res.rndcConfig = nueva ? 'creada' : 'completada';
  }

  // ── RNDC: variables (RNDC_FIJOS) ────────────────────────────────────────
  const vars = hoja(wb, 'RNDC_FIJOS').slice(3)
    .filter(f => ['R', 'M'].includes(txt(f[0]).toUpperCase()) && txt(f[1]))
    .map((f, i) => ({ proceso: txt(f[0]).toUpperCase(), variable: txt(f[1]).toUpperCase(), valor: txt(f[2]), nota: txt(f[3]), orden: i }));
  const existentesVar = new Set((await R.RndcVariable.find().lean()).map(v => `${v.proceso}|${v.variable}`));
  res.variables = { nuevas: await insertarVarios(R.RndcVariable, vars.filter(v => !existentesVar.has(`${v.proceso}|${v.variable}`))) };

  // ── RNDC: maestros (RNDC_FICHAS) ────────────────────────────────────────
  const veh = []; const tit = []; const con = []; const mun = []; const rem = [];
  for (const f of fic.slice(5)) {
    if (txt(f[0])) veh.push({ placa: txt(f[0]).replace(/\s/g, '').toUpperCase(), marca: txt(f[1]), configuracion: entero(f[2]), pesoVacio: entero(f[3]), soat: txt(f[4]), poliza: entero(f[5]), venceSoat: txt(f[6]), docTitular: entero(f[7]), pbv: num(f[8]) });
    if (txt(f[9])) tit.push({ doc: entero(f[9]), nombre: txt(f[10]), direccion: txt(f[11]), telefono: entero(f[12]), ciudad: txt(f[13]) });
    if (txt(f[15])) con.push({ cedula: entero(f[15]), nombre: txt(f[16]), direccion: txt(f[17]), telefono: entero(f[18]), licencia: txt(f[19]), ciudad: txt(f[20]) });
    if (txt(f[22])) mun.push({ codigo: entero(f[22]), texto: txt(f[23]) });
    if (txt(f[25])) rem.push({ nit: entero(f[25]), nombre: txt(f[26]), direccion: txt(f[27]) });
  }
  const filtrarNuevos = async (modelo, docs, k) => {
    const ya = new Set((await modelo.find().select(k).lean()).map(x => x[k]));
    const vistos = new Set();
    return docs.filter(d => d[k] && !ya.has(d[k]) && !vistos.has(d[k]) && vistos.add(d[k]));
  };
  res.maestrosRndc = {
    vehiculos: await insertarVarios(R.RndcVehiculo, await filtrarNuevos(R.RndcVehiculo, veh, 'placa')),
    titulares: await insertarVarios(R.RndcTitular, await filtrarNuevos(R.RndcTitular, tit, 'doc')),
    conductores: await insertarVarios(R.RndcConductor, await filtrarNuevos(R.RndcConductor, con, 'cedula')),
    municipios: await insertarVarios(R.RndcMunicipio, await filtrarNuevos(R.RndcMunicipio, mun, 'codigo')),
    remitentes: await insertarVarios(R.RndcRemitente, await filtrarNuevos(R.RndcRemitente, rem, 'nit')),
  };

  // ── RNDC: sedes, DANE y alias ───────────────────────────────────────────
  const sedesEx = new Set((await R.RndcSede.find().select('idTercero codigo').lean()).map(s => `${s.idTercero}|${s.codigo}`));
  const sedes = [];
  for (const f of hoja(wb, 'RNDC_SEDES').slice(1)) {
    const id = entero(f[0]); const cod = num(f[2]);
    if (!id || !cod || sedesEx.has(`${id}|${cod}`)) continue;
    sedesEx.add(`${id}|${cod}`);
    sedes.push({ idTercero: id, nombre: txt(f[1]), codigo: cod, preferida: txt(f[3]).toUpperCase() === 'SI', codMunicipio: entero(f[4]), municipio: txt(f[5]), direccion: txt(f[6]) });
  }
  const dane = hoja(wb, 'RNDC_DANE').slice(1).filter(f => txt(f[4]))
    .map(f => ({ codDepto: txt(f[0]), departamento: txt(f[1]), codMunicipio: txt(f[2]), municipio: txt(f[3]), codigo: txt(f[4]), nombreNormalizado: txt(f[5]), nombreCorto: txt(f[6]) }));
  const alias = hoja(wb, 'RNDC_ALIAS').slice(1).filter(f => txt(f[0]) && txt(f[1]))
    .map(f => ({ clave: txt(f[0]).toUpperCase(), municipio: txt(f[1]).toUpperCase() }));
  res.sedes = { nuevas: await insertarVarios(R.RndcSede, sedes) };
  res.dane = { nuevos: await insertarVarios(R.RndcDane, await filtrarNuevos(R.RndcDane, dane, 'codigo')) };
  res.alias = { nuevos: await insertarVarios(R.RndcAlias, await filtrarNuevos(R.RndcAlias, alias, 'clave')) };

  // ── RNDC: viajes ────────────────────────────────────────────────────────
  let nV = 0;
  for (const f of hoja(wb, 'RNDC_VIAJES').slice(4)) {
    const nReg = num(f[0]);
    if (!nReg || await R.RndcViaje.exists({ nReg })) continue;
    const bit = await L.ViajeBitacora.findOne({ numero: nReg, archivado: false }).select('_id').lean();
    const m = txt(f[17]).match(/Aceptado (\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})/);
    await R.RndcViaje.create({
      nReg, viajeBitacora: bit?._id || null, empresa: txt(f[1]), conductor: txt(f[2]), placa: txt(f[3]).toUpperCase(),
      fecha: fechaExcel(f[4]), destino: txt(f[5]), flete: num(f[6]) || 0, anticipo: num(f[7]) || 0, cedula: entero(f[8]),
      codOrigen: entero(f[9]), codDestino: entero(f[10]), remesa: txt(f[11]), manifiesto: txt(f[12]),
      estadoRemesa: txt(f[13]), radicadoRemesa: entero(f[14]), estadoManifiesto: txt(f[15]), radicadoManifiesto: entero(f[16]),
      mensaje: txt(f[17]), pesoKg: num(f[18]), cedTitular: entero(f[19]), pbv: num(f[20]), destTipo: txt(f[21]),
      destNumero: entero(f[22]), destSede: entero(f[23]), seguridadQR: txt(f[24]), recomendaciones: txt(f[25]),
      fechaAceptacion: m ? new Date(Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4] + 5, +m[5])) : null,
    });
    nV += 1;
  }
  res.rndcViajes = { nuevos: nV };

  // ── RNDC: log ───────────────────────────────────────────────────────────
  let nL = 0;
  for (const f of hoja(wb, 'RNDC_LOG').slice(1)) {
    if (!txt(f[0])) continue;
    const fecha = fechaHoraExcel(f[0]);
    if (!fecha || await R.RndcLog.exists({ fecha, url: txt(f[1]), sobre: num(f[2]) || 1 })) continue;
    await R.RndcLog.create({ fecha, url: txt(f[1]), sobre: num(f[2]) || 1, enviado: txt(f[3]).replace(/^'/, ''), respuesta: txt(f[4]).replace(/^'/, '') });
    nL += 1;
  }
  res.rndcLog = { nuevos: nL };

  // ── PDF de manifiestos enviados y registro de envíos ────────────────────
  const pdfs = hoja(wb, '_PDF_ENVIADOS').slice(1).filter(f => txt(f[0])).map(f => ({
    clave: txt(f[0]).toLowerCase(), empresa: txt(f[1]), archivo: txt(f[2]), manifiesto: txt(f[2]).replace(/\.pdf$/i, '').toUpperCase(),
    fecha: fechaHoraExcel(f[3]) || new Date(), estado: txt(f[4]) || 'Enviado',
  }));
  res.pdfEnviados = { nuevos: await insertarVarios(L.ManifiestoPdfEnvio, await filtrarNuevos(L.ManifiestoPdfEnvio, pdfs, 'clave')) };
  let nRE = 0;
  for (const f of hoja(wb, 'REGISTRO_ENVIOS').slice(1)) {
    if (!txt(f[0])) continue;
    const fecha = fechaHoraExcel(f[3]) || new Date();
    if (await L.RegistroEnvio.exists({ empresa: txt(f[0]), documento: txt(f[1]), fecha })) continue;
    await L.RegistroEnvio.create({ empresa: txt(f[0]), documento: txt(f[1]), tipo: 'manifiestos', correos: txt(f[2]), fecha, estado: 'enviado', detalle: 'Importado de la plantilla de Excel' });
    nRE += 1;
  }
  res.registroEnvios = { nuevos: nRE };
  return res;
}

module.exports = { importarPlantilla };
