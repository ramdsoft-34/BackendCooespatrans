// routes/rndcRoutes.js
// ─────────────────────────────────────────────────────────────────────────────
// API del despacho al RNDC (Ministerio de Transporte): configuración,
// variables, viajes por enviar, numeración de remesas y manifiestos, envío
// SOAP (modo PRUEBA o REAL), validación de conductores, PDF de manifiestos,
// envío de PDF por correo y maestros (vehículos, titulares, conductores,
// sedes, municipios, remitentes, DANE y alias).
// Acceso: roles admin y coordLogistico. La clave del RNDC nunca se guarda.
// ─────────────────────────────────────────────────────────────────────────────
const express = require('express');
const multer = require('multer');
const JSZip = require('jszip');
const { protect } = require('../controllers/authController');
const L = require('../models/Logistica');
const R = require('../models/Rndc');
const C = require('../services/logistica/calculos');
const S = require('../services/logistica/rndcService');
const M = require('../services/logistica/manifiestoService');
const REP = require('../services/logistica/reportes');
const IMP = require('../services/logistica/importadorRndc');
const { enviarCorreo, enModoPrueba } = require('../services/logistica/correo');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 40 * 1024 * 1024 } });

const ROLES = ['admin', 'coordLogistico'];
router.use(protect, (req, res, next) => {
  if (!ROLES.includes(req.user.role)) return res.status(403).json({ success: false, message: 'No tiene permisos para el módulo RNDC' });
  next();
});

const txt = (v) => (v === null || v === undefined ? '' : String(v).trim());
const escRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const fallo = (res, e, code = 500) => res.status(code).json({ success: false, message: e.message || String(e) });
const malo = (res, message, extra = {}) => res.status(400).json({ success: false, message, ...extra });

function enviarArchivo(res, buffer, nombre, mime) {
  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(nombre)}"; filename*=UTF-8''${encodeURIComponent(nombre)}`);
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
  res.send(Buffer.from(buffer));
}

// ══════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN Y VARIABLES
// ══════════════════════════════════════════════════════════════════════════
const CAMPOS_CFG = ['url', 'usuario', 'nit', 'modo', 'prefijoRemesa', 'consecutivoRemesa', 'prefijoManifiesto',
  'consecutivoManifiesto', 'procesoRemesa', 'procesoManifiesto', 'procesoRemesasManifiesto', 'codOrigen',
  'empresaNombre', 'empresaDireccion', 'empresaTelefono', 'empresaCiudad', 'productoCodigo', 'productoDescripcion'];

router.get('/config', async (req, res) => {
  try {
    const config = await S.obtenerConfig();
    res.json({
      success: true, config,
      proximaRemesa: `${config.prefijoRemesa}${await S.proxNum(false, config)}`,
      proximoManifiesto: `${config.prefijoManifiesto}${await S.proxNum(true, config)}`,
      correoModoPrueba: enModoPrueba(),
    });
  } catch (e) { fallo(res, e); }
});

router.put('/config', async (req, res) => {
  try {
    const cfg = await R.RndcConfig.findOne({ clave: 'general' }) || new R.RndcConfig({ clave: 'general' });
    for (const k of CAMPOS_CFG) {
      if (req.body[k] === undefined) continue;
      if (k === 'modo') {
        const m = txt(req.body.modo).toUpperCase();
        if (!['PRUEBA', 'REAL'].includes(m)) return malo(res, 'El modo debe ser PRUEBA o REAL.');
        cfg.modo = m;
      } else if (k.startsWith('consecutivo')) {
        const n = Number(C.soloDigitos(req.body[k]));
        if (!n) return malo(res, 'El consecutivo debe ser un número mayor que cero.');
        cfg[k] = n;
      } else cfg[k] = txt(req.body[k]);
    }
    if (!txt(cfg.nit)) return malo(res, 'Falta el NIT de la empresa de transporte.');
    await cfg.save();
    res.json({ success: true, config: cfg });
  } catch (e) { fallo(res, e); }
});

router.get('/variables', async (req, res) => {
  try {
    const variables = await R.RndcVariable.find().sort({ proceso: -1, orden: 1 });
    res.json({ success: true, variables });
  } catch (e) { fallo(res, e); }
});

// Reemplaza la tabla de variables (edición en bloque de RNDC_FIJOS)
router.put('/variables', async (req, res) => {
  try {
    const lista = Array.isArray(req.body.variables) ? req.body.variables : [];
    const vistos = new Set();
    for (const v of lista) {
      const k = `${txt(v.proceso).toUpperCase()}|${txt(v.variable).toUpperCase()}`;
      if (!['R', 'M'].includes(txt(v.proceso).toUpperCase()) || !txt(v.variable)) return malo(res, 'Cada variable necesita proceso (R o M) y nombre.');
      if (vistos.has(k)) return malo(res, `La variable ${v.variable} está repetida en el proceso ${v.proceso}.`);
      vistos.add(k);
    }
    await R.RndcVariable.deleteMany({});
    await R.RndcVariable.insertMany(lista.map((v, i) => ({
      proceso: txt(v.proceso).toUpperCase(), variable: txt(v.variable).toUpperCase(), valor: String(v.valor ?? ''), nota: txt(v.nota), orden: i,
    })));
    res.json({ success: true, variables: await R.RndcVariable.find().sort({ proceso: -1, orden: 1 }) });
  } catch (e) { fallo(res, e); }
});

// RNDC_ActualizarModelo: carga las variables del manifiesto modelo M10062798
router.post('/variables/modelo', async (req, res) => {
  try {
    await R.RndcVariable.deleteMany({});
    await R.RndcVariable.insertMany(IMP.VARIABLES_MODELO.map((l, i) => {
      const [proceso, variable, valor, nota] = l.split('|');
      return { proceso, variable, valor, nota: nota || '', orden: i };
    }));
    res.json({ success: true, message: 'Modelo cargado en las variables del RNDC.' });
  } catch (e) { fallo(res, e); }
});

// ══════════════════════════════════════════════════════════════════════════
// VIAJES RNDC
// ══════════════════════════════════════════════════════════════════════════
// Viajes de la bitácora de una fecha que aún no están en RNDC (SV_Llenar)
router.get('/bitacora-disponibles', async (req, res) => {
  try {
    const fecha = C.parseFecha(req.query.fecha) || C.hoyColombia();
    const viajes = await L.ViajeBitacora.find({ archivado: false, fecha }).sort({ numero: 1 }).lean();
    const ya = new Set((await R.RndcViaje.find({ nReg: { $in: viajes.map(v => v.numero) } }).select('nReg').lean()).map(x => x.nReg));
    const disponibles = viajes.filter(v => !ya.has(v.numero));
    res.json({ success: true, fecha, viajes: disponibles, ocultos: viajes.length - disponibles.length });
  } catch (e) { fallo(res, e); }
});

// RNDC_TraerViajes: copia los viajes elegidos de la bitácora y completa los datos
router.post('/viajes/traer', async (req, res) => {
  try {
    const numeros = (Array.isArray(req.body.numeros) ? req.body.numeros : []).map(Number).filter(Boolean);
    if (!numeros.length) return malo(res, 'Marque al menos un viaje para pasar al RNDC.');
    const ctx = await S.cargarContexto();
    const stats = S.nuevasEstadisticas();
    const bit = await L.ViajeBitacora.find({ archivado: false, numero: { $in: numeros } }).sort({ numero: 1 }).lean();
    let n = 0; let sinCed = 0; const sinDane = [];
    for (const b of bit) {
      if (await R.RndcViaje.exists({ nReg: b.numero })) continue;
      const v = {
        nReg: b.numero, viajeBitacora: b._id, empresa: b.empresa, conductor: b.conductor, placa: b.placa, fecha: b.fecha,
        destino: b.destino, flete: b.flete, anticipo: b.anticipo, pesoKg: b.pesoKg, recomendaciones: txt(b.observaciones),
        codOrigen: S.origenDane(ctx), codDestino: S.codigoDane(b.destino, ctx),
      };
      if (!v.codDestino && !sinDane.includes(b.destino)) sinDane.push(b.destino);
      S.completarFila(v, ctx, stats, b);
      if (!S.cedtxt(v.cedula)) sinCed += 1;
      await R.RndcViaje.create(v);
      n += 1;
    }
    res.json({
      success: true, agregados: n,
      resumen: [`${n} viaje(s) agregados al RNDC.`, ...S.resumenCompletar(stats), `Sin cédula de conductor: ${sinCed}.`,
        `Destinos sin código DANE: ${sinDane.length}${sinDane.length ? ` (${sinDane.slice(0, 8).join(', ')})` : ''}`,
        ...(sinDane.length ? ['Agregue su alias en Maestros RNDC > Alias y use "Completar datos".'] : [])],
    });
  } catch (e) { fallo(res, e); }
});

function vistaViaje(v, ctx) {
  const o = v.toObject ? v.toObject() : { ...v };
  o.saldo = (Number(o.flete) || 0) - (Number(o.anticipo) || 0);
  o.nitCliente = S.nitCliente(o.empresa, ctx);
  o.avisos = S.avisosViaje(o);
  let tit = txt(o.cedTitular);
  if (!tit || tit === '0') tit = txt(o.cedula);
  o.titularEfectivo = tit;
  return o;
}

router.get('/viajes', async (req, res) => {
  try {
    const filtro = {};
    if (req.query.estado === 'pendientes') filtro.estadoManifiesto = { $ne: 'OK' };
    if (req.query.estado === 'aceptados') filtro.estadoManifiesto = 'OK';
    const fecha = C.parseFecha(req.query.fecha);
    if (fecha) filtro.fecha = fecha;
    if (txt(req.query.empresa)) filtro.empresa = new RegExp(`^${escRegex(txt(req.query.empresa))}$`, 'i');
    if (txt(req.query.q)) {
      const re = new RegExp(escRegex(txt(req.query.q)), 'i');
      filtro.$or = [{ placa: re }, { conductor: re }, { manifiesto: re }, { remesa: re }, { destino: re }, { cedula: re }];
    }
    const [ctx, viajes] = await Promise.all([S.cargarContexto(), R.RndcViaje.find(filtro).sort({ fecha: -1, nReg: 1 }).limit(1000)]);
    res.json({ success: true, viajes: viajes.map(v => vistaViaje(v, ctx)), modo: ctx.config.modo });
  } catch (e) { fallo(res, e); }
});

// EV_Guardar (corrección del viaje) y edición de los datos complementarios
const EDITABLES = ['cedula', 'cedTitular', 'destSede', 'destTipo', 'destNumero', 'codOrigen', 'codDestino', 'recomendaciones', 'conductor', 'empresa', 'destino'];
router.put('/viajes/:id', async (req, res) => {
  try {
    const v = await R.RndcViaje.findById(req.params.id);
    if (!v) return fallo(res, new Error('Viaje no encontrado'), 404);
    if (v.estadoManifiesto === 'OK') return malo(res, 'Este manifiesto ya fue aceptado por el RNDC; no se puede modificar.');
    for (const k of EDITABLES) if (req.body[k] !== undefined) v[k] = txt(req.body[k]);
    const num = (x) => {
      const s = String(x ?? '').replace(/[^0-9,]/g, '').replace(',', '.');
      return s === '' ? null : Number(s);
    };
    if (req.body.flete !== undefined && num(req.body.flete) !== null) v.flete = num(req.body.flete);
    if (req.body.anticipo !== undefined && num(req.body.anticipo) !== null) v.anticipo = num(req.body.anticipo);
    if (req.body.pesoKg !== undefined) v.pesoKg = num(req.body.pesoKg);
    if (req.body.pbv !== undefined) v.pbv = num(req.body.pbv);
    if (req.body.recomendaciones !== undefined) v.recomendaciones = String(req.body.recomendaciones || '').slice(0, 500);
    await v.save();
    const ctx = await S.cargarContexto();
    res.json({ success: true, viaje: vistaViaje(v, ctx), message: 'Corrección guardada.' });
  } catch (e) { fallo(res, e); }
});

router.delete('/viajes/:id', async (req, res) => {
  try {
    const v = await R.RndcViaje.findById(req.params.id);
    if (!v) return fallo(res, new Error('Viaje no encontrado'), 404);
    if (v.estadoManifiesto === 'OK' || v.estadoRemesa === 'OK') return malo(res, 'No se puede quitar un viaje con remesa o manifiesto aceptado por el RNDC.');
    await v.deleteOne();
    res.json({ success: true });
  } catch (e) { fallo(res, e); }
});

// RNDC_CompletarCedulas: completa los viajes pendientes con las bases (y pesos de la bitácora)
router.post('/viajes/completar', async (req, res) => {
  try {
    const ctx = await S.cargarContexto();
    const stats = S.nuevasEstadisticas();
    const viajes = await R.RndcViaje.find({ estadoManifiesto: { $ne: 'OK' } });
    let np = 0;
    for (const v of viajes) {
      const b = await L.ViajeBitacora.findOne({ numero: v.nReg, ...(v.viajeBitacora ? { _id: v.viajeBitacora } : {}) }).lean();
      if ((v.pesoKg === null || v.pesoKg === undefined) && b) { v.pesoKg = b.pesoKg; np += 1; }
      const o = v.toObject();
      S.completarFila(o, ctx, stats, b);
      for (const k of ['empresa', 'cedula', 'cedTitular', 'pbv', 'codOrigen', 'codDestino', 'destTipo', 'destNumero', 'destSede']) v[k] = o[k];
      await v.save();
    }
    res.json({ success: true, resumen: [`Pesos copiados de la bitácora: ${np}`, ...S.resumenCompletar(stats)] });
  } catch (e) { fallo(res, e); }
});

// ── Numeración (EV_Numerar) ────────────────────────────────────────────────
// Al primer viaje marcado le da el consecutivo indicado y a cada siguiente el anterior + 1.
// Los que ya tienen número (envío anterior) conservan el suyo.
async function numerar(ids, remIni, manIni, cfg) {
  const viajes = await R.RndcViaje.find({ _id: { $in: ids } });
  const orden = ids.map(id => viajes.find(v => String(v._id) === String(id))).filter(Boolean);
  let nr = S.parseNum(remIni, cfg.prefijoRemesa) || await S.proxNum(false, cfg);
  let nm = S.parseNum(manIni, cfg.prefijoManifiesto) || await S.proxNum(true, cfg);
  return orden.map(v => {
    const remesa = v.remesa || `${cfg.prefijoRemesa}${nr++}`;
    const manifiesto = v.manifiesto || `${cfg.prefijoManifiesto}${nm++}`;
    return { viaje: v, remesa, manifiesto };
  });
}

// EV_Duplicado: los números asignados no pueden estar usados en otro viaje
async function duplicado(asignaciones) {
  for (const a of asignaciones) {
    if (!a.viaje.manifiesto) {
      const o = await R.RndcViaje.findOne({ manifiesto: a.manifiesto, _id: { $ne: a.viaje._id } }).lean();
      if (o) return `El manifiesto ${a.manifiesto} ya está usado en el registro ${o.nReg}.`;
    }
    if (!a.viaje.remesa) {
      const o = await R.RndcViaje.findOne({ remesa: a.remesa, _id: { $ne: a.viaje._id } }).lean();
      if (o) return `La remesa ${a.remesa} ya está usada en el registro ${o.nReg}.`;
    }
  }
  const nums = asignaciones.flatMap(a => [a.remesa, a.manifiesto]);
  if (new Set(nums).size !== nums.length) return 'Hay números repetidos en la selección.';
  return '';
}

router.post('/numerar', async (req, res) => {
  try {
    const cfg = await S.obtenerConfig();
    const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
    const asig = await numerar(ids, req.body.remesaInicial, req.body.manifiestoInicial, cfg);
    const viajes = await R.RndcViaje.find({ _id: { $in: ids } }).lean();
    const tot = viajes.reduce((t, v) => ({ flete: t.flete + (v.flete || 0), anticipo: t.anticipo + (v.anticipo || 0) }), { flete: 0, anticipo: 0 });
    res.json({
      success: true,
      asignaciones: asig.map(a => ({ _id: a.viaje._id, remesa: a.remesa, manifiesto: a.manifiesto })),
      duplicado: await duplicado(asig),
      totales: { ...tot, saldo: tot.flete - tot.anticipo, viajes: viajes.length },
    });
  } catch (e) { fallo(res, e); }
});

// Vista previa de lo que se enviaría al Ministerio (remesa y manifiesto)
router.get('/viajes/:id/vista-previa', async (req, res) => {
  try {
    const v = await R.RndcViaje.findById(req.params.id).lean();
    if (!v) return fallo(res, new Error('Viaje no encontrado'), 404);
    const ctx = await S.cargarContexto();
    const numR = txt(req.query.remesa) || v.remesa || `${ctx.config.prefijoRemesa}${await S.proxNum(false, ctx.config)}`;
    const numM = txt(req.query.manifiesto) || v.manifiesto || `${ctx.config.prefijoManifiesto}${await S.proxNum(true, ctx.config)}`;
    const copia = { ...v };
    const r = S.variablesDe('R', copia, ctx, numR, numM);
    const m = S.variablesDe('M', copia, ctx, numR, numM);
    res.json({ success: true, remesa: r.campos, manifiesto: m.campos, faltantes: [...r.faltantes, ...m.faltantes] });
  } catch (e) { fallo(res, e); }
});

// ── Envío al RNDC (RNDC_Enviar) ─────────────────────────────────────────────
router.post('/enviar', async (req, res) => {
  try {
    const ctx = await S.cargarContexto();
    const cfg = ctx.config;
    const esReal = cfg.modo === 'REAL';
    const url = txt(cfg.url); const usuario = txt(cfg.usuario); const nit = txt(cfg.nit);
    if (!nit) return malo(res, 'Falta el NIT en la configuración del RNDC.');
    if (esReal && (!url || !usuario)) return malo(res, 'Para enviar en modo REAL complete la URL y el usuario en la configuración del RNDC.');
    const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
    if (!ids.length) return malo(res, 'Marque al menos un viaje para enviar.');
    const asig = (await numerar(ids, req.body.remesaInicial, req.body.manifiestoInicial, cfg)).filter(a => a.viaje.estadoManifiesto !== 'OK');
    if (!asig.length) return malo(res, 'No hay viajes pendientes en la selección.');
    const dup = await duplicado(asig);
    if (dup) return malo(res, `${dup} Cambie el consecutivo.`);
    // RNDC_ConductoresListos: avisa si algún conductor no concuerda con el RNDC
    if (!req.body.confirmarConductores && ctx.fichasCond.length) {
      const dudosos = asig.map(a => ({ a, ev: S.evaluarConductor(a.viaje.conductor, a.viaje.cedula, ctx) }))
        .filter(x => S.esDudoso(x.ev.estado))
        .map(x => ({ nReg: x.a.viaje.nReg, conductor: x.a.viaje.conductor, cedula: x.a.viaje.cedula, estado: x.ev.estado }));
      if (dudosos.length) {
        return res.status(409).json({ success: false, requiereConfirmacion: 'conductores', dudosos,
          message: `Hay ${dudosos.length} viaje(s) cuyo conductor no concuerda con el RNDC. Use "Validar conductores" para ver el detalle. ¿Quiere enviar de todos modos?` });
      }
    }
    let clave = String(req.body.clave || '');
    if (esReal && !clave) return malo(res, 'Escriba la CLAVE RNDC para enviar.');
    if (!esReal) clave = '*****';

    const r = { okRemesas: 0, okManifiestos: 0, errores: 0, simulados: 0, detalle: [] };
    for (const { viaje: v, remesa: numR, manifiesto: numM } of asig) {
      if (esReal) {
        // Los números elegidos quedan guardados y el contador sube (SubirContador)
        if (!v.remesa) { v.remesa = numR; const d = S.digitosTrasPrefijo(numR, cfg.prefijoRemesa); if (d !== null && d + 1 > cfg.consecutivoRemesa) cfg.consecutivoRemesa = d + 1; }
        if (!v.manifiesto) { v.manifiesto = numM; const d = S.digitosTrasPrefijo(numM, cfg.prefijoManifiesto); if (d !== null && d + 1 > cfg.consecutivoManifiesto) cfg.consecutivoManifiesto = d + 1; }
        await R.RndcConfig.updateOne({ clave: 'general' }, { consecutivoRemesa: cfg.consecutivoRemesa, consecutivoManifiesto: cfg.consecutivoManifiesto });
      }
      const o = v.toObject();
      const vr = S.variablesDe('R', o, ctx, numR, numM);
      const xmlR = S.armarXML(usuario, clave, cfg.procesoRemesa, vr.xml);
      const vm = S.variablesDe('M', o, ctx, numR, numM);
      const xmlM = S.armarXML(usuario, clave, cfg.procesoManifiesto, vm.xml + S.bloqueRemesas(numR, cfg.procesoRemesasManifiesto));
      if (o.destSede && !v.destSede) v.destSede = o.destSede;
      const falt = [...vr.faltantes, ...vm.faltantes];
      if (!esReal) {
        v.estadoRemesa = 'PRUEBA'; v.estadoManifiesto = 'PRUEBA';
        v.mensaje = `${falt.length ? `FALTAN DATOS: ${falt.join(' ')} | ` : ''}REMESA ${numR}: ${S.ocultarClave(xmlR)}  ||  MANIFIESTO ${numM}: ${S.ocultarClave(xmlM)}`;
        r.simulados += 1;
        r.detalle.push({ nReg: v.nReg, placa: v.placa, estado: 'PRUEBA', remesa: numR, manifiesto: numM, faltantes: falt });
      } else if (falt.length) {
        v.estadoManifiesto = 'FALTAN DATOS';
        v.mensaje = `No se envió. Faltan: ${falt.join(' ')}`;
        r.errores += 1;
        r.detalle.push({ nReg: v.nReg, placa: v.placa, estado: 'FALTAN DATOS', faltantes: falt });
      } else {
        const meta = { viaje: v._id, usuario: req.user.username };
        if (v.estadoRemesa !== 'OK') {
          const resp = await S.enviarSOAP(url, xmlR, { ...meta, proceso: 'remesa' });
          const it = S.interpretar(resp);
          if (it.ok) { v.estadoRemesa = 'OK'; v.radicadoRemesa = it.radicado; r.okRemesas += 1; await v.save(); } else {
            v.estadoRemesa = 'ERROR'; v.mensaje = `REMESA: ${it.mensaje}`; v.estadoManifiesto = 'NO ENVIADO'; r.errores += 1;
          }
        }
        if (v.estadoRemesa === 'OK') {
          const resp = await S.enviarSOAP(url, xmlM, { ...meta, proceso: 'manifiesto' });
          const it = S.interpretar(resp);
          if (it.ok) {
            v.estadoManifiesto = 'OK'; v.radicadoManifiesto = it.radicado; v.seguridadQR = it.qr;
            v.fechaAceptacion = new Date(); v.mensaje = `Aceptado ${C.fmtFechaHoraAhora()}`; r.okManifiestos += 1;
          } else { v.estadoManifiesto = 'ERROR'; v.mensaje = `MANIFIESTO: ${it.mensaje}`; r.errores += 1; }
        }
        r.detalle.push({ nReg: v.nReg, placa: v.placa, estado: v.estadoManifiesto, remesa: v.remesa, manifiesto: v.manifiesto, mensaje: v.mensaje });
      }
      await v.save();
    }
    clave = '';
    res.json({
      success: true, modo: cfg.modo, ...r,
      message: esReal
        ? `Terminado. Remesas aceptadas: ${r.okRemesas}. Manifiestos aceptados: ${r.okManifiestos}. Con error: ${r.errores}.`
        : `MODO PRUEBA: ${r.simulados} viaje(s) simulados. No se envió nada. El XML quedó en el mensaje de cada viaje.`,
    });
  } catch (e) { fallo(res, e); }
});

router.get('/log', async (req, res) => {
  try {
    const log = await R.RndcLog.find().sort({ fecha: -1 }).limit(Number(req.query.limit) || 200);
    res.json({ success: true, log });
  } catch (e) { fallo(res, e); }
});

// ══════════════════════════════════════════════════════════════════════════
// VALIDACIÓN DE CONDUCTORES (RNDC_Conductores)
// ══════════════════════════════════════════════════════════════════════════
router.get('/validar-conductores', async (req, res) => {
  try {
    const ctx = await S.cargarContexto();
    if (!ctx.fichasCond.length) return malo(res, 'No hay maestro de conductores del RNDC cargado (Maestros RNDC > Conductores).');
    const viajes = await R.RndcViaje.find().sort({ nReg: 1 }).lean();
    const filas = viajes.map(v => ({
      _id: v._id, nReg: v.nReg, empresa: v.empresa, placa: v.placa, conductor: v.conductor, cedula: S.cedtxt(v.cedula),
      estadoManifiesto: v.estadoManifiesto, ...S.evaluarConductor(v.conductor, v.cedula, ctx),
    }));
    res.json({ success: true, filas });
  } catch (e) { fallo(res, e); }
});

// Reemplaza el nombre mal escrito por el nombre oficial del RNDC (estado ESCRITURA)
router.post('/validar-conductores/corregir', async (req, res) => {
  try {
    const ctx = await S.cargarContexto();
    const viajes = await R.RndcViaje.find({ estadoManifiesto: { $ne: 'OK' } });
    let n = 0;
    for (const v of viajes) {
      const ev = S.evaluarConductor(v.conductor, v.cedula, ctx);
      if (ev.estado === 'ESCRITURA' && ev.oficial) { v.conductor = C.nombrePropio(ev.oficial); await v.save(); n += 1; }
    }
    res.json({ success: true, corregidos: n, message: `Nombres corregidos: ${n}.` });
  } catch (e) { fallo(res, e); }
});

// Revisa la base de conductores (_CONDUCTORES) contra el maestro del RNDC
router.get('/validar-base', async (req, res) => {
  try {
    const ctx = await S.cargarContexto();
    if (!ctx.fichasCond.length) return malo(res, 'No hay maestro de conductores del RNDC cargado (Maestros RNDC > Conductores).');
    const filas = ctx.flota.filter(c => c.activo !== false).map(c => ({
      _id: c._id, conductor: c.nombre, placa: c.placa, cedula: S.cedtxt(c.cedula), ...S.evaluarConductor(c.nombre, c.cedula, ctx),
    }));
    res.json({ success: true, filas });
  } catch (e) { fallo(res, e); }
});

// Completa las cédulas que faltan y que dan una sola persona en el RNDC
router.post('/validar-base/completar', async (req, res) => {
  try {
    const ctx = await S.cargarContexto();
    const ids = Array.isArray(req.body.ids) ? req.body.ids.map(String) : null;
    let n = 0;
    for (const c of ctx.flota) {
      if (ids && !ids.includes(String(c._id))) continue;
      const ev = S.evaluarConductor(c.nombre, c.cedula, ctx);
      if (ev.estado === 'SIN CEDULA - UNICA' && ev.cedulaSugerida) {
        await L.ConductorFlota.updateOne({ _id: c._id }, { cedula: ev.cedulaSugerida });
        n += 1;
      }
    }
    res.json({ success: true, completadas: n, message: `Cédulas completadas: ${n}.` });
  } catch (e) { fallo(res, e); }
});

// ══════════════════════════════════════════════════════════════════════════
// PDF DE MANIFIESTOS
// ══════════════════════════════════════════════════════════════════════════
async function viajeAceptado(id) {
  const v = await R.RndcViaje.findById(id).lean();
  if (!v) return { error: 'Viaje no encontrado', code: 404 };
  if (v.estadoManifiesto !== 'OK') {
    return { error: `El manifiesto ${v.manifiesto || ''} no figura como ACEPTADO por el RNDC (estado: ${v.estadoManifiesto || 'sin enviar'}). El PDF solo se genera de manifiestos aceptados.`, code: 400 };
  }
  return { v };
}

router.get('/viajes/:id/manifiesto', async (req, res) => {
  try {
    const { v, error, code } = await viajeAceptado(req.params.id);
    if (error) return fallo(res, new Error(error), code);
    const ctx = await S.cargarContexto();
    const r = await M.armarManifiesto(v, ctx);
    res.json({ success: true, ...r, qr: REP.textoQR(r.datos) });
  } catch (e) { fallo(res, e); }
});

router.get('/viajes/:id/manifiesto.pdf', async (req, res) => {
  try {
    const { v, error, code } = await viajeAceptado(req.params.id);
    if (error) return fallo(res, new Error(error), code);
    const ctx = await S.cargarContexto();
    const { datos } = await M.armarManifiesto(v, ctx);
    enviarArchivo(res, await REP.manifiestoPdf(datos), `${v.manifiesto}.pdf`, 'application/pdf');
  } catch (e) { fallo(res, e); }
});

// Buscar un manifiesto por número (RNDC_ManifiestoPDF)
router.get('/manifiestos/buscar', async (req, res) => {
  try {
    let num = txt(req.query.numero).toUpperCase();
    if (!num) return malo(res, 'Escriba el número del manifiesto.');
    if (!num.startsWith('M')) num = `M${num}`;
    const v = await R.RndcViaje.findOne({ manifiesto: num }).lean();
    if (!v) return fallo(res, new Error(`No se encuentra el manifiesto ${num}.`), 404);
    res.json({ success: true, viaje: v });
  } catch (e) { fallo(res, e); }
});

// RNDC_ManifiestosPDF_Todos: ZIP con el PDF de todos los manifiestos aceptados (o los elegidos)
router.get('/manifiestos/zip', async (req, res) => {
  try {
    const filtro = { estadoManifiesto: 'OK' };
    if (txt(req.query.ids)) filtro._id = { $in: txt(req.query.ids).split(',') };
    const fecha = C.parseFecha(req.query.fecha);
    if (fecha) filtro.fecha = fecha;
    const viajes = await R.RndcViaje.find(filtro).sort({ manifiesto: 1 }).lean();
    if (!viajes.length) return fallo(res, new Error('No hay manifiestos aceptados por el RNDC para generar.'), 404);
    const ctx = await S.cargarContexto();
    const zip = new JSZip();
    for (const v of viajes) {
      const { datos } = await M.armarManifiesto(v, ctx);
      const mes = v.fecha ? C.MESES[new Date(v.fecha).getUTCMonth()] : '';
      const carpeta = `${C.limpiarNombreArchivo(v.empresa || 'SIN EMPRESA')}/Manifiestos ${mes.charAt(0).toUpperCase()}${mes.slice(1)}`;
      zip.file(`${carpeta}/${v.manifiesto}.pdf`, await REP.manifiestoPdf(datos));
    }
    const buf = await zip.generateAsync({ type: 'nodebuffer' });
    enviarArchivo(res, buf, `MANIFIESTOS_${C.fmtFecha(C.hoyColombia()).replace(/\//g, '-')}.zip`, 'application/zip');
  } catch (e) { fallo(res, e); }
});

// ── Envío de los PDF por correo (RNDC_Correo) ───────────────────────────────
const MAX_ADJ = 12;
const MAX_BYTES = 15000000;

async function pdfPendientes() {
  const viajes = await R.RndcViaje.find({ estadoManifiesto: 'OK', manifiesto: { $ne: '' } }).sort({ empresa: 1, manifiesto: 1 }).lean();
  const enviados = new Set((await L.ManifiestoPdfEnvio.find().select('clave').lean()).map(e => e.clave));
  return viajes.map(v => ({ v, clave: M.claveEnvio(v) })).filter(x => !enviados.has(x.clave));
}

router.get('/manifiestos/pdf-pendientes', async (req, res) => {
  try {
    const pend = await pdfPendientes();
    const empresas = await L.EmpresaLogistica.find().lean();
    const grupos = new Map();
    for (const { v } of pend) {
      if (!grupos.has(v.empresa)) {
        const e = empresas.find(x => x.clave === L.claveDe(v.empresa));
        grupos.set(v.empresa, { empresa: v.empresa, correos: (e?.correos || []).join(', '), manifiestos: [] });
      }
      grupos.get(v.empresa).manifiestos.push({ _id: v._id, manifiesto: v.manifiesto, placa: v.placa, fecha: v.fecha });
    }
    res.json({ success: true, total: pend.length, empresas: [...grupos.values()], modoPrueba: enModoPrueba() });
  } catch (e) { fallo(res, e); }
});

// accion: 'enviar' (manda un correo por empresa en lotes) | 'marcar' (solo marcar como enviados)
router.post('/manifiestos/pdf-enviar', async (req, res) => {
  try {
    const accion = req.body.accion === 'marcar' ? 'marcar' : 'enviar';
    const soloEmpresas = Array.isArray(req.body.empresas) && req.body.empresas.length ? req.body.empresas.map(L.claveDe) : null;
    const pend = (await pdfPendientes()).filter(x => !soloEmpresas || soloEmpresas.includes(L.claveDe(x.v.empresa)));
    if (!pend.length) return res.json({ success: true, enviados: 0, message: 'No hay PDF de manifiestos pendientes por enviar.' });
    const anotar = (x, estado) => L.ManifiestoPdfEnvio.updateOne({ clave: x.clave },
      { clave: x.clave, empresa: x.v.empresa, archivo: `${x.v.manifiesto}.pdf`, manifiesto: x.v.manifiesto, fecha: new Date(), estado }, { upsert: true });
    if (accion === 'marcar') {
      for (const x of pend) await anotar(x, 'Marcado sin enviar');
      return res.json({ success: true, marcados: pend.length, message: `${pend.length} PDF marcados como ya enviados (no se mandó ningún correo).` });
    }
    const ctx = await S.cargarContexto();
    const empresas = await L.EmpresaLogistica.find().lean();
    const cfgL = await L.ConfigLogistica.findOne({ clave: 'general' }).lean();
    const r = { enviados: 0, empresasError: [], empresasSinCorreo: [], simulado: enModoPrueba() };
    const porEmpresa = new Map();
    pend.forEach(x => { if (!porEmpresa.has(x.v.empresa)) porEmpresa.set(x.v.empresa, []); porEmpresa.get(x.v.empresa).push(x); });
    for (const [empresa, lista] of porEmpresa) {
      const e = empresas.find(x => x.clave === L.claveDe(empresa));
      const correos = e?.correos || [];
      if (!correos.length) { r.empresasSinCorreo.push(empresa); continue; }
      const razon = txt(e.razonSocial) || empresa.toUpperCase();
      const documento = `MANIFIESTOS ${empresa.toUpperCase()}`;
      let lote = []; let bytes = 0;
      const enviarLote = async () => {
        if (!lote.length) return;
        const asunto = `${documento} - ${razon} - ${C.fmtFecha(C.hoyColombia())}`;
        const env = await enviarCorreo({ para: correos, asunto, texto: `${documento}\n\n${lote.map(l => l.x.v.manifiesto).join('\n')}\n`,
          adjuntos: lote.map(l => ({ filename: `${l.x.v.manifiesto}.pdf`, content: l.pdf })), nombreRemitente: cfgL?.remitenteNombre || 'COOESPATRANS' });
        await L.RegistroEnvio.create({ empresa, documento, tipo: 'pdf-manifiestos', correos: correos.join(', '), adjuntos: lote.map(l => `${l.x.v.manifiesto}.pdf`),
          estado: env.ok ? (env.simulado ? 'simulado' : 'enviado') : 'error', detalle: env.error || '', usuario: req.user.username });
        if (env.ok) { for (const l of lote) await anotar(l.x, 'Enviado'); r.enviados += lote.length; } else if (!r.empresasError.includes(empresa)) r.empresasError.push(`${empresa}: ${env.error}`);
        lote = []; bytes = 0;
      };
      for (const x of lista) {
        const { datos } = await M.armarManifiesto(x.v, ctx);
        const pdf = await REP.manifiestoPdf(datos);
        if (lote.length && (lote.length >= MAX_ADJ || bytes + pdf.length > MAX_BYTES)) await enviarLote();
        lote.push({ x, pdf }); bytes += pdf.length;
      }
      await enviarLote();
    }
    res.json({ success: true, ...r, message: `PDF enviados: ${r.enviados}. Empresas con error: ${r.empresasError.length}. Empresas sin correos configurados: ${r.empresasSinCorreo.length}.` });
  } catch (e) { fallo(res, e); }
});

router.get('/manifiestos/pdf-enviados', async (req, res) => {
  try {
    res.json({ success: true, registros: await L.ManifiestoPdfEnvio.find().sort({ fecha: -1 }).limit(500) });
  } catch (e) { fallo(res, e); }
});

// ══════════════════════════════════════════════════════════════════════════
// MAESTROS DEL RNDC (RNDC_FICHAS, RNDC_SEDES, RNDC_DANE, RNDC_ALIAS)
// ══════════════════════════════════════════════════════════════════════════
const MAESTROS = {
  vehiculos:   { modelo: R.RndcVehiculo,  clave: 'placa',  busca: ['placa', 'marca', 'docTitular'], orden: { placa: 1 } },
  titulares:   { modelo: R.RndcTitular,   clave: 'doc',    busca: ['doc', 'nombre'], orden: { nombre: 1 } },
  conductores: { modelo: R.RndcConductor, clave: 'cedula', busca: ['cedula', 'nombre', 'licencia'], orden: { nombre: 1 } },
  municipios:  { modelo: R.RndcMunicipio, clave: 'codigo', busca: ['codigo', 'texto'], orden: { codigo: 1 } },
  remitentes:  { modelo: R.RndcRemitente, clave: 'nit',    busca: ['nit', 'nombre'], orden: { nombre: 1 } },
  sedes:       { modelo: R.RndcSede,      clave: null,     busca: ['idTercero', 'nombre', 'municipio'], orden: { idTercero: 1, codigo: 1 } },
  alias:       { modelo: R.RndcAlias,     clave: 'clave',  busca: ['clave', 'municipio'], orden: { clave: 1 } },
  dane:        { modelo: R.RndcDane,      clave: 'codigo', busca: ['codigo', 'municipio', 'departamento'], orden: { departamento: 1, municipio: 1 }, soloLectura: true },
};
function maestro(req, res) {
  const m = MAESTROS[req.params.tipo];
  if (!m) { malo(res, 'Maestro no válido.'); return null; }
  return m;
}

router.get('/maestros/:tipo', async (req, res) => {
  try {
    const m = maestro(req, res); if (!m) return;
    const filtro = {};
    const q = txt(req.query.q);
    if (q) {
      const re = new RegExp(escRegex(q), 'i');
      filtro.$or = m.busca.map(k => ({ [k]: re }));
    }
    const limite = Math.min(Number(req.query.limit) || 100, 500);
    const pagina = Math.max(Number(req.query.page) || 1, 1);
    const [items, total] = await Promise.all([
      m.modelo.find(filtro).sort(m.orden).skip((pagina - 1) * limite).limit(limite),
      m.modelo.countDocuments(filtro),
    ]);
    res.json({ success: true, items, total, paginas: Math.ceil(total / limite), pagina });
  } catch (e) { fallo(res, e); }
});

function limpiarMaestro(tipo, body) {
  const d = { ...body };
  delete d._id; delete d.createdAt; delete d.updatedAt; delete d.__v;
  Object.keys(d).forEach(k => { if (typeof d[k] === 'string') d[k] = d[k].trim(); });
  if (tipo === 'vehiculos') { d.placa = S.placaKey(d.placa); d.pbv = d.pbv === '' || d.pbv === null || d.pbv === undefined ? null : Number(C.soloDigitos(d.pbv)) || null; }
  if (tipo === 'sedes') { d.codigo = Number(d.codigo); d.preferida = d.preferida === true || d.preferida === 'true' || String(d.preferida).toUpperCase() === 'SI'; }
  if (tipo === 'alias') { d.clave = txt(d.clave).toUpperCase(); d.municipio = txt(d.municipio).toUpperCase(); }
  return d;
}

router.post('/maestros/:tipo', async (req, res) => {
  try {
    const m = maestro(req, res); if (!m) return;
    if (m.soloLectura) return malo(res, 'Este maestro se carga importando el archivo DIVIPOLA.');
    const d = limpiarMaestro(req.params.tipo, req.body);
    if (m.clave && !txt(d[m.clave])) return malo(res, 'Falta el dato clave del registro.');
    if (req.params.tipo === 'sedes' && (!txt(d.idTercero) || !d.codigo)) return malo(res, 'La sede necesita ID del tercero y código.');
    const item = await m.modelo.create(d);
    res.status(201).json({ success: true, item });
  } catch (e) {
    if (e.code === 11000) return res.status(409).json({ success: false, message: 'Ya existe un registro con esa clave.' });
    fallo(res, e);
  }
});

router.put('/maestros/:tipo/:id', async (req, res) => {
  try {
    const m = maestro(req, res); if (!m) return;
    if (m.soloLectura) return malo(res, 'Este maestro se carga importando el archivo DIVIPOLA.');
    const item = await m.modelo.findByIdAndUpdate(req.params.id, limpiarMaestro(req.params.tipo, req.body), { new: true, runValidators: true });
    if (!item) return fallo(res, new Error('Registro no encontrado'), 404);
    res.json({ success: true, item });
  } catch (e) {
    if (e.code === 11000) return res.status(409).json({ success: false, message: 'Ya existe un registro con esa clave.' });
    fallo(res, e);
  }
});

router.delete('/maestros/:tipo/:id', async (req, res) => {
  try {
    const m = maestro(req, res); if (!m) return;
    if (m.soloLectura) return malo(res, 'Este maestro se carga importando el archivo DIVIPOLA.');
    await m.modelo.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (e) { fallo(res, e); }
});

// Importaciones de los archivos descargados del RNDC y del DANE
router.post('/importar/:tipo', upload.single('archivo'), async (req, res) => {
  try {
    if (!req.file) return malo(res, 'Selecciona el archivo de Excel.');
    const fn = { vehiculos: IMP.importarVehiculos, terceros: IMP.importarTerceros, dane: IMP.importarDane }[req.params.tipo];
    if (!fn) return malo(res, 'Tipo de importación no válido.');
    const resultado = await fn(req.file.buffer);
    res.json({ success: true, resultado });
  } catch (e) { fallo(res, e, 400); }
});

module.exports = router;
