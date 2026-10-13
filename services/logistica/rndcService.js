// services/logistica/rndcService.js
// ─────────────────────────────────────────────────────────────────────────────
// Lógica del despacho al RNDC trasladada de los módulos VBA RNDC_Despacho,
// RNDC_EnvForm y RNDC_Conductores:
//   - completar cada viaje con cédula, titular, PBV, códigos DANE y sede
//   - armar las variables de remesa (R) y manifiesto (M) desde RNDC_FIJOS
//   - armar el XML, el sobre SOAP, enviar, reintentar y registrar el log
//   - consecutivos de remesa y manifiesto
//   - validar el conductor (nombre / cédula) contra el maestro del RNDC
// ─────────────────────────────────────────────────────────────────────────────
const axios = require('axios');
const { EmpresaLogistica, ConductorFlota } = require('../../models/Logistica');
const R = require('../../models/Rndc');
const { normTxt, fmtFecha, finDeMes, soloDigitos } = require('./calculos');

const NIT_CORBETA = '8909009431';
const PBV_FOPAT = 10500;

// ── Utilidades de texto ─────────────────────────────────────────────────────
const txt = (v) => (v === null || v === undefined ? '' : String(v).trim());
const tieneDato = (s) => { const t = txt(s); return t !== '' && t !== '0'; };
const placaKey = (p) => txt(p).replace(/\s/g, '').toUpperCase();

// cedtxt: quita puntos, espacios y comas; "0" = vacío
function cedtxt(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? String(Math.round(v)) : '';
  const s = txt(v).replace(/[.\s,]/g, '');
  return s === '0' ? '' : s;
}

// QuitarTildes de RNDC_Despacho (también convierte Ñ→N, como el VBA)
function quitarTildesRndc(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

const escXml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// NumTxt: número con hasta 2 decimales y punto decimal; texto tal cual.
function numTxt(v) {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number' || (/^-?\d+(\.\d+)?$/.test(String(v).trim()))) {
    const n = Math.round(Number(v) * 100) / 100;
    return String(n);
  }
  return txt(v);
}

// "Palabras parecidas": iguales o con el mismo comienzo (tolera Sanches/Sanchez)
function palabraIgual(a, b) {
  if (a === b) return true;
  const m = Math.min(a.length, b.length);
  return m >= 5 && a.slice(0, m - 1) === b.slice(0, m - 1);
}

// ── Contexto (maestros en memoria para una operación) ───────────────────────
async function cargarContexto() {
  const [config, variables, empresas, flota, vehiculos, titulares, conductores, sedes, dane, alias] =
    await Promise.all([
      obtenerConfig(),
      R.RndcVariable.find().sort({ orden: 1, _id: 1 }).lean(),
      EmpresaLogistica.find().lean(),
      ConductorFlota.find().lean(),
      R.RndcVehiculo.find().lean(),
      R.RndcTitular.find().lean(),
      R.RndcConductor.find().lean(),
      R.RndcSede.find().lean(),
      R.RndcDane.find().lean(),
      R.RndcAlias.find().lean(),
    ]);
  const ctx = {
    config, variables, empresas, flota, sedes, dane, alias,
    vehiculos: new Map(vehiculos.map(v => [placaKey(v.placa), v])),
    titulares: new Map(titulares.map(t => [txt(t.doc), t])),
    fichasCond: conductores
      .map(c => ({ ced: cedtxt(c.cedula), orig: txt(c.nombre), nom: ` ${normTxt(c.nombre)} ` }))
      .filter(c => c.ced && c.orig),
  };
  ctx.fichasIdx = new Map();
  ctx.fichasCond.forEach((c, i) => { if (!ctx.fichasIdx.has(c.ced)) ctx.fichasIdx.set(c.ced, i); });
  return ctx;
}

async function obtenerConfig() {
  let cfg = await R.RndcConfig.findOne({ clave: 'general' });
  if (!cfg) cfg = await R.RndcConfig.create({ clave: 'general' });
  return cfg.toObject();
}

// NIT del cliente (hoja Empresas columna NIT, sin dígito de verificación)
function nitCliente(empresa, ctx) {
  const e = ctx.empresas.find(x => txt(x.nombre).toUpperCase() === txt(empresa).toUpperCase());
  if (!e) return '';
  let t = txt(e.nit);
  if (t.includes('-')) t = t.slice(0, t.indexOf('-'));
  return t.replace(/[.\s,]/g, '');
}

const origenDane = (ctx) => txt(ctx.config.codOrigen) || '52001000';

// Variable fija configurada (p. ej. CODSEDEREMITENTE del proceso R)
function valorFijo(ctx, proceso, variable) {
  const v = ctx.variables.find(x => x.proceso === proceso && x.variable === variable);
  return v ? txt(v.valor) : '';
}

// ── Códigos DANE ────────────────────────────────────────────────────────────
// Código DIVIPOLA (8 dígitos) del municipio de un destino. Primero los alias
// (gana el que aparece más a la derecha del destino, y si empatan el más largo),
// luego Nariño (52), Putumayo (86), Cauca (19) y por último todo el país.
function codigoPorNombre(ctx, nombre) {
  for (const pR of ['52', '86', '19', '']) {
    const f = ctx.dane.find(d => (!pR || d.codDepto === pR) && (d.nombreNormalizado === nombre || d.nombreCorto === nombre));
    if (f) return f.codigo;
  }
  for (const pR of ['52', '86', '19', '']) {
    const f = ctx.dane.find(d => (!pR || d.codDepto === pR) && ` ${d.nombreNormalizado} `.includes(` ${nombre} `));
    if (f) return f.codigo;
  }
  return '';
}

function codigoDane(destino, ctx) {
  const t = ` ${normTxt(destino)} `;
  if (!t.trim() || !ctx.dane.length) return '';
  let bp = 0; let bl = 0; let bt = '';
  for (const a of ctx.alias) {
    const k = normTxt(a.clave);
    if (!k || !txt(a.municipio)) continue;
    const pos = t.lastIndexOf(` ${k} `) + 1;
    if (pos > 0 && (pos > bp || (pos === bp && k.length > bl))) { bp = pos; bl = k.length; bt = normTxt(a.municipio); }
  }
  if (bp > 0) {
    const c = codigoPorNombre(ctx, bt);
    if (c) return c;
  }
  for (const pR of ['52', '86', '19', '']) {
    bp = 0; bl = 0; let cand = '';
    for (const d of ctx.dane) {
      if (pR && d.codDepto !== pR) continue;
      for (const k of [d.nombreNormalizado, d.nombreCorto]) {
        if (!k) continue;
        const pos = t.lastIndexOf(` ${k} `) + 1;
        if (pos > 0 && (pos > bp || (pos === bp && k.length > bl))) { bp = pos; bl = k.length; cand = d.codigo; }
      }
    }
    if (cand) return cand;
  }
  return '';
}

// ── Sedes ───────────────────────────────────────────────────────────────────
// Sede del destinatario según el DESTINO del viaje: nombre igual (la PREFERIDA,
// o la de código mayor); si no, nombre parecido (la preferida o la única).
function sedeDe(idDest, destino, ctx) {
  const nd = normTxt(destino);
  if (!nd || !idDest) return '';
  let mejorEx = 0; let prefEx = 0; let mejorPa = 0; let nPa = 0; let prefPa = 0;
  for (const s of ctx.sedes) {
    if (txt(s.idTercero) !== idDest) continue;
    const cod = Number(s.codigo) || 0;
    const nn = normTxt(s.nombre);
    if (cod <= 0 || !nn) continue;
    if (nn === nd) {
      if (cod > mejorEx) mejorEx = cod;
      if (s.preferida) prefEx = cod;
    } else if (nn.length >= 4 && (nn.includes(nd) || nd.includes(nn))) {
      nPa += 1; mejorPa = cod;
      if (s.preferida) prefPa = cod;
    }
  }
  if (prefEx > 0) return String(prefEx);
  if (mejorEx > 0) return String(mejorEx);
  if (prefPa > 0) return String(prefPa);
  if (nPa === 1) return String(mejorPa);
  return '';
}

// Sede por municipio cuando el nombre del destino no coincide con una sola sede
function sedeDeMuni(idDest, codMuni, ctx) {
  if (!idDest || !codMuni) return '';
  let n = 0; let c1 = ''; let pref = '';
  for (const s of ctx.sedes) {
    if (txt(s.idTercero) === idDest && txt(s.codMunicipio) === codMuni && s.codigo) {
      n += 1; c1 = String(s.codigo);
      if (s.preferida) pref = String(s.codigo);
    }
  }
  if (pref) return pref;
  return n === 1 ? c1 : '';
}

function sedeInfo(idT, cod, ctx) {
  if (!idT || !cod) return null;
  return ctx.sedes.find(s => txt(s.idTercero) === idT && String(s.codigo) === String(cod)) || null;
}
const muniDeSede = (idDest, cod, ctx) => txt(sedeInfo(idDest, cod, ctx)?.codMunicipio);

// ── Urbano de Corbeta ───────────────────────────────────────────────────────
function destinoUrbano(destino) {
  const t = txt(destino).toUpperCase();
  return t.includes('ALKOSTO') || t.includes('ALCOSTO') || t.includes('URBANO') || t.includes('PASTO CLIENTE') || t === 'PASTO';
}
const esUrbanoCorbeta = (nit, cod2) => nit === NIT_CORBETA && txt(cod2).slice(0, 5) === '52001';

// Origen del manifiesto = municipio de la sede del REMITENTE (error MAN353).
// Si la fila trae otro código escrito a mano, se respeta.
function origenManifiesto(nit, codFila, ctx) {
  if (codFila && codFila !== origenDane(ctx)) return codFila;
  const sedeR = valorFijo(ctx, 'R', 'CODSEDEREMITENTE');
  if (!sedeR || !nit) return codFila;
  const s = sedeInfo(nit, sedeR, ctx);
  return s && txt(s.codMunicipio) ? txt(s.codMunicipio) : codFila;
}

// ── Cédulas ─────────────────────────────────────────────────────────────────
// Cédula en la base de conductores (_CONDUCTORES): primero por nombre, luego por placa.
function cedulaDe(nombre, placa, ctx) {
  const n = quitarTildesRndc(txt(nombre)).toUpperCase();
  const p = placaKey(placa);
  for (const pasada of [1, 2]) {
    for (const c of ctx.flota) {
      const ced = cedtxt(c.cedula);
      if (!ced) continue;
      if (pasada === 1 && n && quitarTildesRndc(txt(c.nombre)).toUpperCase() === n) return ced;
      if (pasada === 2 && p && placaKey(c.placa) === p) return ced;
    }
  }
  return '';
}

// Cédula buscando el nombre en el maestro de conductores del RNDC (resultado único)
function cedulaDeFichas(nombre, titular, ctx, stats) {
  const t = normTxt(nombre).split(' ').filter(Boolean);
  if (t.length < 2 || !ctx.fichasCond.length) return '';
  const nt = t.length;
  let ced = ''; let cedEx = ''; let n = 0; let ne = 0; const lista = new Set();
  for (const f of ctx.fichasCond) {
    const w = f.nom.trim().split(' ');
    let ok = true;
    for (const tj of t) {
      if (tj.length < 2) continue;
      if (!f.nom.includes(` ${tj} `) && !w.some(wk => palabraIgual(tj, wk))) { ok = false; break; }
    }
    if (!ok) continue;
    if (ced !== f.ced) n += 1;
    ced = f.ced;
    lista.add(f.ced);
    if (w.length === nt) {
      if (cedEx !== f.ced) ne += 1;
      cedEx = f.ced;
    }
  }
  if (n === 1) return ced;
  if (ne === 1) return cedEx;
  if (titular && lista.has(titular)) return titular; // el conductor es el propietario
  if (n > 1 && stats) stats.ambiguos.push(nombre);
  return '';
}

// PBV del vehículo: maestro del RNDC; si no, la base de conductores (por placa)
function pbvVehiculo(placa, ctx) {
  const v = ctx.vehiculos.get(placaKey(placa));
  let pbv = v ? Number(v.pbv) || 0 : 0;
  if (pbv <= 0) {
    const c = ctx.flota.find(x => placaKey(x.placa) === placaKey(placa) && Number(x.pbv) > 0);
    if (c) pbv = Number(c.pbv);
  }
  return pbv;
}

// ── Completar una fila de RNDC_VIAJES ───────────────────────────────────────
function nuevasEstadisticas() {
  return { cedulas: 0, titulares: 0, pbv: 0, sedes: 0, empresas: 0, destinatarios: 0, ambiguos: [], sinVehiculo: [] };
}

// viaje: objeto plano (se modifica). viajeBitacora: registro de BITÁCORA (opcional)
function completarFila(viaje, ctx, stats = nuevasEstadisticas(), viajeBitacora = null) {
  // 0. empresa (cliente): si no es un cliente conocido se trae de BITÁCORA
  if (!nitCliente(viaje.empresa, ctx) && viajeBitacora && nitCliente(viajeBitacora.empresa, ctx)) {
    viaje.empresa = viajeBitacora.empresa; stats.empresas += 1;
  }
  const veh = ctx.vehiculos.get(placaKey(viaje.placa));
  const tvh = veh ? txt(veh.docTitular) : '';
  // 1. cédula del conductor
  let ced = txt(viaje.cedula);
  if (!tieneDato(ced)) {
    let c = cedulaDe(viaje.conductor, viaje.placa, ctx);
    if (!tieneDato(c)) c = '';
    if (!c) c = cedulaDeFichas(viaje.conductor, tvh, ctx, stats);
    if (c) { viaje.cedula = c; stats.cedulas += 1; } else if (ced === '0') viaje.cedula = '';
    ced = txt(viaje.cedula);
  }
  // 2. titular del vehículo
  let tit = txt(viaje.cedTitular);
  if (veh) {
    const c = txt(veh.docTitular);
    if (tieneDato(c) && (!tieneDato(tit) || tit === ced) && tit !== c) { viaje.cedTitular = c; stats.titulares += 1; }
  } else if (txt(viaje.placa) && !stats.sinVehiculo.includes(viaje.placa)) {
    stats.sinVehiculo.push(viaje.placa);
  }
  // PBV KG (nunca el peso vacío)
  if (!tieneDato(viaje.pbv)) {
    const pv = pbvVehiculo(viaje.placa, ctx);
    if (pv > 0) { viaje.pbv = pv; stats.pbv += 1; }
  }
  tit = txt(viaje.cedTitular);
  if (!tieneDato(tit) && tieneDato(ced)) viaje.cedTitular = ced;
  else if (tit === '0') viaje.cedTitular = '';
  // 3. códigos DANE
  if (!txt(viaje.codOrigen)) viaje.codOrigen = origenDane(ctx);
  if (!txt(viaje.codDestino)) viaje.codDestino = codigoDane(viaje.destino, ctx);
  const nit = nitCliente(viaje.empresa, ctx);
  const urb = nit === NIT_CORBETA && destinoUrbano(viaje.destino);
  if (urb) viaje.codDestino = '52001000';
  // 4. destinatario
  if (!txt(viaje.destTipo)) { viaje.destTipo = 'N'; stats.destinatarios += 1; }
  if (!txt(viaje.destNumero) && nit) viaje.destNumero = nit;
  if (!txt(viaje.destSede)) {
    const idD = txt(viaje.destNumero);
    let ds = sedeDe(idD, viaje.destino, ctx);
    if (!ds && urb) ds = txt(viaje.destino).toUpperCase().includes('CLIENTE') ? '132' : '78'; // BODEGA ALKOSTO PASTO
    if (!ds) ds = sedeDeMuni(idD, txt(viaje.codDestino), ctx);
    if (ds) { viaje.destSede = ds; stats.sedes += 1; }
  }
  return viaje;
}

function resumenCompletar(stats) {
  const l = [
    `Cédulas de conductor completadas: ${stats.cedulas}`,
    `Titulares tomados del maestro del RNDC: ${stats.titulares}`,
    `PBV tomado del maestro del RNDC: ${stats.pbv}`,
    `Sedes de destinatario encontradas: ${stats.sedes}`,
    `Empresas traídas de la bitácora: ${stats.empresas}`,
    `Destinatario tipo N asignado: ${stats.destinatarios}`,
  ];
  if (stats.sinVehiculo.length) l.push(`Placas que no están en el maestro de vehículos: ${stats.sinVehiculo.join(' ')}`);
  if (stats.ambiguos.length) l.push(`Conductores con varios candidatos (llenar a mano): ${stats.ambiguos.join(', ')}`);
  return l;
}

// ── Variables de remesa / manifiesto ────────────────────────────────────────
// Devuelve { xml, campos: [{variable, valor, falta}], faltantes: [] }.
// Puede completar destSede en el viaje (igual que el VBA).
function variablesDe(proceso, viaje, ctx, numR, numM) {
  const cfg = ctx.config;
  const nit = txt(cfg.nit);
  const nitC = nitCliente(viaje.empresa, ctx);
  let xml = '';
  const campos = [];
  const faltantes = [];
  for (const fila of ctx.variables.filter(x => x.proceso === proceso && txt(x.variable))) {
    const nom = txt(fila.variable).toUpperCase();
    let v = String(fila.valor ?? '');
    let usaToken = v.includes('{');
    if (nom === 'OBSERVACIONES') usaToken = false; // opcional
    const rep = (tok, val) => { v = v.split(tok).join(val ?? ''); };
    rep('{NIT}', nit);
    rep('{REMESA}', numR);
    rep('{MANIFIESTO}', numM);
    rep('{PLACA}', txt(viaje.placa).toUpperCase());
    rep('{CONDUCTOR}', txt(viaje.conductor));
    let ced = txt(viaje.cedula);
    if (!ced) ced = cedulaDe(viaje.conductor, viaje.placa, ctx);
    rep('{CED}', ced);
    rep('{NIT_CLIENTE}', nitC);
    let cod1 = txt(viaje.codOrigen) || origenDane(ctx);
    cod1 = origenManifiesto(nitC, cod1, ctx);
    let cod2 = txt(viaje.codDestino) || codigoDane(viaje.destino, ctx);
    if (esUrbanoCorbeta(nitC, cod2)) cod2 = '52001000';
    rep('{COD_ORIGEN}', cod1);
    rep('{FLETE}', numTxt(viaje.flete));
    rep('{ANTICIPO}', numTxt(viaje.anticipo));
    rep('{FECHA}', viaje.fecha ? fmtFecha(viaje.fecha) : '');
    rep('{PESO}', numTxt(viaje.pesoKg));
    let tit = txt(viaje.cedTitular);
    if (!tit || tit === '0') tit = ced;
    rep('{TITULAR}', tit);
    rep('{RETEFUENTE}', numTxt(Math.round((Number(viaje.flete) || 0) * 0.01)));
    // FOPAT (0,1 % del flete) solo si el PBV supera 10.500 kg; PBV vacío = dato faltante
    const pbv = numTxt(viaje.pbv);
    let fop = '';
    if (pbv === '') fop = '';
    else if (Number(pbv) > PBV_FOPAT) fop = numTxt(Math.round((Number(viaje.flete) || 0) * 0.001));
    else fop = '0';
    rep('{FOPAT}', fop);
    // Destinatario de la remesa (vacío = NIT del cliente)
    const dtipo = txt(viaje.destTipo).toUpperCase() || 'N';
    const dnum = txt(viaje.destNumero) || nitC;
    rep('{DEST_TIPO}', dtipo);
    rep('{DEST_ID}', dnum);
    let dsede = txt(viaje.destSede);
    if (!dsede) {
      dsede = sedeDe(dnum, viaje.destino, ctx);
      if (dsede) viaje.destSede = dsede;
    }
    rep('{DEST_SEDE}', dsede);
    if (!txt(viaje.codDestino)) {
      const m = muniDeSede(dnum, dsede, ctx);
      if (m) cod2 = m;
    }
    if (esUrbanoCorbeta(nitC, cod2)) cod2 = '52001000';
    // Tipo de manifiesto: G = General, U = Municipal o Urbano
    if (proceso === 'M' && nom === 'CODOPERACIONTRANSPORTE' && esUrbanoCorbeta(nitC, cod2)) v = 'U';
    rep('{COD_DESTINO}', cod2);
    rep('{FECHA_PAGO}', viaje.fecha ? fmtFecha(finDeMes(viaje.fecha)) : '');
    let rec = txt(viaje.recomendaciones).replace(/\r?\n|\r/g, ' ');
    if (rec.length > 500) rec = rec.slice(0, 500);
    rep('{OBSERVACIONES}', rec);
    v = v.trim();
    if (v) {
      xml += etiqueta(nom, v);
      campos.push({ variable: nom, valor: v, falta: false });
    } else if (usaToken) {
      faltantes.push(nom);
      campos.push({ variable: nom, valor: '', falta: true });
    }
  }
  return { xml, campos, faltantes };
}

const etiqueta = (nombre, valor) => `<${nombre}>${escXml(quitarTildesRndc(valor))}</${nombre}>`;

const bloqueRemesas = (numR, procesoRem) =>
  `<REMESASMAN procesoid="${procesoRem}"><REMESA>${etiqueta('CONSECUTIVOREMESA', numR)}</REMESA></REMESASMAN>`;

function armarXML(usuario, clave, proceso, vars) {
  return "<?xml version='1.0' encoding='ISO-8859-1' ?><root>" +
    `<acceso><username>${escXml(usuario)}</username><password>${escXml(clave)}</password></acceso>` +
    `<solicitud><tipo>1</tipo><procesoid>${proceso}</procesoid></solicitud>` +
    `<variables>${vars}</variables></root>`;
}

// Oculta la clave de un XML antes de guardarlo o mostrarlo
function ocultarClave(xml) {
  return String(xml).replace(/<password>[\s\S]*?<\/password>/i, '<password>*****</password>');
}

// ── SOAP ────────────────────────────────────────────────────────────────────
// modo 1 = contenido escapado; modo 2 = contenido en CDATA
function sobreSOAP(xmlInterno, modo) {
  const cuerpo = modo === 1
    ? xmlInterno.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    : `<![CDATA[${xmlInterno}]]>`;
  return '<?xml version="1.0" encoding="utf-8"?>' +
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"' +
    ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"' +
    ' xmlns:xsd="http://www.w3.org/2001/XMLSchema"' +
    ' xmlns:urn="urn:BPMServicesIntf-IBPMServices">' +
    '<soapenv:Header/><soapenv:Body><urn:AtenderMensajeRNDC soapenv:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">' +
    `<Request xsi:type="xsd:string">${cuerpo}</Request>` +
    '</urn:AtenderMensajeRNDC></soapenv:Body></soapenv:Envelope>';
}

async function postSOAP(url, sobre) {
  try {
    const r = await axios.post(url, sobre, {
      timeout: 90000,
      responseType: 'text',
      transformResponse: [d => d],
      validateStatus: () => true,
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        SOAPAction: '"urn:BPMServicesIntf-IBPMServices#AtenderMensajeRNDC"',
      },
    });
    return `HTTP ${r.status} ${r.data}`;
  } catch (e) {
    return `ERROR_CONEXION: ${e.message}`;
  }
}

// Envía; si el RNDC responde RNDC72 (no entendió el contenido) reintenta con el
// otro formato de sobre. Deja registro (sin la clave) en RndcLog.
async function enviarSOAP(url, xmlInterno, meta = {}) {
  let resp = '';
  for (const modo of [1, 2]) {
    resp = await postSOAP(url, sobreSOAP(xmlInterno, modo));
    await R.RndcLog.create({
      url, sobre: modo, enviado: ocultarClave(xmlInterno).slice(0, 6000), respuesta: String(resp).slice(0, 6000), ...meta,
    }).catch(() => {});
    if (!resp.includes('RNDC72')) break;
  }
  return resp;
}

function entreEtiquetas(t, tag) {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i');
  const m = String(t).match(re);
  return m ? m[1].trim() : '';
}

// true si el RNDC aceptó (devuelve radicado). Si no, el mensaje de error.
function interpretar(resp) {
  const r = String(resp).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  const radicado = entreEtiquetas(r, 'ingresoid');
  const qr = entreEtiquetas(r, 'seguridadqr');
  if (radicado) return { ok: true, radicado, qr, mensaje: '' };
  return { ok: false, radicado: '', qr: '', mensaje: entreEtiquetas(r, 'ErrorMSG') || r.slice(0, 1000) };
}

// ── Consecutivos ────────────────────────────────────────────────────────────
function digitosTrasPrefijo(valor, pref) {
  const v = txt(valor).toUpperCase();
  const p = txt(pref).toUpperCase();
  if (!v || !v.startsWith(p)) return null;
  const m = v.slice(p.length).match(/^\d+/);
  return m ? Number(m[0]) : null;
}

// Próximo número (parte consecutiva): el mayor entre el contador de la
// configuración y (el mayor ya usado en los viajes RNDC + 1).
async function proxNum(manif, cfg) {
  const pref = manif ? cfg.prefijoManifiesto : cfg.prefijoRemesa;
  let n = Number(manif ? cfg.consecutivoManifiesto : cfg.consecutivoRemesa) || 1;
  const campo = manif ? 'manifiesto' : 'remesa';
  const usados = await R.RndcViaje.find({ [campo]: { $ne: '' } }).select(campo).lean();
  let m = 0;
  for (const u of usados) {
    const d = digitosTrasPrefijo(u[campo], pref);
    if (d !== null && d > m) m = d;
  }
  if (m >= n) n = m + 1;
  return n;
}

// "62856" o "M10062856" → 62856 (parte consecutiva)
function parseNum(texto, pref) {
  let d = soloDigitos(texto);
  const pd = soloDigitos(pref);
  if (pd && d.length > pd.length + 3 && d.startsWith(pd)) d = d.slice(pd.length);
  return Number(d) || 0;
}

// ── Validación de conductores contra el maestro del RNDC ───────────────────
function coincide(t, f, exacto) {
  const w = f.nom.trim().split(' ');
  let usadas = 0;
  for (const tj of t) {
    if (tj.length < 2) continue;
    usadas += 1;
    if (!f.nom.includes(` ${tj} `)) {
      if (exacto) return false;
      if (!w.some(wk => palabraIgual(tj, wk))) return false;
    }
  }
  return usadas > 0;
}
const palabras = (t) => t.filter(x => x.length >= 2).length;

function candidatos(t, ctx) {
  const res = { n: 0, lista: [], cedUnica: '' };
  if (palabras(t) < 2) return res;
  for (const f of ctx.fichasCond) {
    if (coincide(t, f, false)) {
      res.n += 1;
      if (res.n <= 5) res.lista.push(`${f.ced} ${f.orig}`);
      res.cedUnica = f.ced;
    }
  }
  if (res.n !== 1) res.cedUnica = '';
  return res;
}

// Estados: OK | ESCRITURA | NO CONCUERDA | CED NO REGISTRADA |
//          SIN CEDULA - UNICA | SIN CEDULA - VARIAS | SIN CEDULA - NO ESTA
function evaluarConductor(nombre, cedula, ctx) {
  const t = normTxt(nombre).split(' ').filter(Boolean);
  const ced = cedtxt(cedula);
  const out = { estado: '', oficial: '', sugerencia: '', cedulaSugerida: '' };
  const lst = (c) => c.lista.join(' | ') + (c.n > 5 ? ` | ... (${c.n} en total)` : '');
  if (ced) {
    const idx = ctx.fichasIdx.get(ced);
    if (idx !== undefined) {
      const f = ctx.fichasCond[idx];
      out.oficial = f.orig;
      if (coincide(t, f, true)) out.estado = 'OK';
      else if (coincide(t, f, false)) { out.estado = 'ESCRITURA'; out.sugerencia = `Nombre oficial: ${f.orig}`; }
      else {
        out.estado = 'NO CONCUERDA';
        const c = candidatos(t, ctx);
        out.sugerencia = c.n > 0
          ? `La cédula ${ced} es de otra persona. Con ese nombre: ${lst(c)}`
          : `La cédula ${ced} es de otra persona y no hay nadie con ese nombre en el RNDC`;
        out.cedulaSugerida = c.cedUnica;
      }
    } else {
      out.estado = 'CED NO REGISTRADA';
      const c = candidatos(t, ctx);
      out.sugerencia = c.n > 0 ? `Cédula no está en el RNDC. Con ese nombre: ${lst(c)}`
        : 'Cédula no está en el RNDC (revise dígitos) y el nombre no da coincidencia';
      out.cedulaSugerida = c.cedUnica;
    }
  } else {
    const c = candidatos(t, ctx);
    if (c.n === 1) {
      out.estado = 'SIN CEDULA - UNICA';
      out.cedulaSugerida = c.cedUnica;
      out.sugerencia = lst(c);
      out.oficial = ctx.fichasCond[ctx.fichasIdx.get(c.cedUnica)]?.orig || '';
    } else if (c.n > 1) {
      out.estado = 'SIN CEDULA - VARIAS';
      out.sugerencia = lst(c);
    } else {
      out.estado = 'SIN CEDULA - NO ESTA';
      out.sugerencia = palabras(t) < 2 ? 'Nombre incompleto: escriba nombre y apellido' : 'No está en el maestro del RNDC';
    }
  }
  return out;
}
const esDudoso = (estado) => estado !== 'OK' && estado !== 'ESCRITURA';

// ── Avisos del formulario de envío (EV_Avisos) ─────────────────────────────
function avisosViaje(v) {
  const m = [];
  const c = txt(v.cedula);
  if (!c || c === '0') m.push('sin cédula');
  else if (c.length < 5 || c.length > 10) m.push('cédula rara');
  if (!txt(v.codOrigen)) m.push('sin DANE origen');
  if (!txt(v.codDestino)) m.push('sin DANE destino');
  if (!txt(v.destSede)) m.push('sin sede');
  if (!(Number(v.flete) > 0)) m.push('flete en 0');
  if (v.pesoKg === null || v.pesoKg === undefined || v.pesoKg === '') m.push('sin peso');
  return m;
}

module.exports = {
  NIT_CORBETA, PBV_FOPAT,
  cargarContexto, obtenerConfig, nitCliente, origenDane, codigoDane, sedeDe, sedeDeMuni, sedeInfo, muniDeSede,
  destinoUrbano, esUrbanoCorbeta, origenManifiesto, cedulaDe, cedulaDeFichas, pbvVehiculo,
  nuevasEstadisticas, completarFila, resumenCompletar, variablesDe, bloqueRemesas, armarXML, ocultarClave,
  sobreSOAP, enviarSOAP, interpretar, proxNum, parseNum, digitosTrasPrefijo,
  evaluarConductor, esDudoso, avisosViaje, cedtxt, numTxt, quitarTildesRndc, placaKey, valorFijo,
};
