// routes/logisticaRoutes.js
// ─────────────────────────────────────────────────────────────────────────────
// API del módulo de Logística (Coordinador Logístico). Traslada a la web los
// procesos de la plantilla de viajes: bitácora, hojas por empresa, reporte de
// WhatsApp, correo de salida, nuevo periodo, relación de fletes (facturación,
// pagos y utilidad), empresas, tarifas, conductores y envío de manifiestos.
// Acceso: roles admin y coordLogistico.
// ─────────────────────────────────────────────────────────────────────────────
const express = require('express');
const multer = require('multer');
const { protect } = require('../controllers/authController');
const L = require('../models/Logistica');
const R = require('../models/Rndc');
const C = require('../services/logistica/calculos');
const REP = require('../services/logistica/reportes');
const S = require('../services/logistica/rndcService');
const M = require('../services/logistica/manifiestoService');
const { enviarCorreo, listaCorreos, enModoPrueba } = require('../services/logistica/correo');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 40 } });

const ROLES = ['admin', 'coordLogistico'];
function soloLogistica(req, res, next) {
  if (!req.user || !ROLES.includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'No tiene permisos para el módulo de logística' });
  }
  next();
}
router.use(protect, soloLogistica);

const txt = (v) => (v === null || v === undefined ? '' : String(v).trim());
const escRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const exacto = (s) => new RegExp(`^${escRegex(txt(s))}$`, 'i');
const fallo = (res, e, code = 500) => res.status(code).json({ success: false, message: e.message || String(e) });
const malo = (res, message, extra = {}) => res.status(400).json({ success: false, message, ...extra });

function enviarArchivo(res, buffer, nombre, tipo) {
  const mime = tipo === 'pdf' ? 'application/pdf'
    : tipo === 'zip' ? 'application/zip'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(nombre)}"; filename*=UTF-8''${encodeURIComponent(nombre)}`);
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
  res.send(Buffer.from(buffer));
}

async function obtenerConfig() {
  let c = await L.ConfigLogistica.findOne({ clave: 'general' });
  if (!c) c = await L.ConfigLogistica.create({ clave: 'general' });
  return c;
}

// ══════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN
// ══════════════════════════════════════════════════════════════════════════
router.get('/config', async (req, res) => {
  try {
    const config = await obtenerConfig();
    res.json({ success: true, config, logos: REP.LOGOS_DISPONIBLES(), correoModoPrueba: enModoPrueba() });
  } catch (e) { fallo(res, e); }
});

router.put('/config', async (req, res) => {
  try {
    const c = await obtenerConfig();
    ['relacionEmpresa', 'relacionPeriodo', 'remitenteNombre'].forEach(k => { if (req.body[k] !== undefined) c[k] = txt(req.body[k]); });
    if (req.body.folioDias !== undefined) c.folioDias = Number(req.body.folioDias) || 0;
    await c.save();
    res.json({ success: true, config: c });
  } catch (e) { fallo(res, e); }
});

// ══════════════════════════════════════════════════════════════════════════
// EMPRESAS (hojas Empresas + CORREOS)
// ══════════════════════════════════════════════════════════════════════════
router.get('/empresas', async (req, res) => {
  try {
    const filtro = req.query.todas === 'true' ? {} : { activa: true };
    const empresas = await L.EmpresaLogistica.find(filtro).sort({ nombre: 1 });
    res.json({ success: true, empresas });
  } catch (e) { fallo(res, e); }
});

function datosEmpresa(body) {
  return {
    nombre: txt(body.nombre),
    nit: txt(body.nit),
    razonSocial: txt(body.razonSocial),
    correos: listaCorreos(body.correos),
    logo: txt(body.logo),
  };
}

router.post('/empresas', async (req, res) => {
  try {
    const d = datosEmpresa(req.body);
    if (!d.nombre) return malo(res, 'Por favor ingresa el nombre de la empresa.');
    if (!d.nit) return malo(res, 'Por favor ingresa el NIT de la empresa.');
    const existe = await L.EmpresaLogistica.findOne({ clave: L.claveDe(d.nombre) });
    if (existe) {
      if (!existe.activa) {
        Object.assign(existe, d, { activa: true });
        await existe.save();
        return res.json({ success: true, empresa: existe, reactivada: true });
      }
      return res.status(409).json({ success: false, message: 'Ya existe una empresa registrada con ese nombre.' });
    }
    const empresa = await L.EmpresaLogistica.create(d);
    res.status(201).json({ success: true, empresa });
  } catch (e) { fallo(res, e); }
});

router.put('/empresas/:id', async (req, res) => {
  try {
    const emp = await L.EmpresaLogistica.findById(req.params.id);
    if (!emp) return fallo(res, new Error('Empresa no encontrada'), 404);
    const d = datosEmpresa({ ...emp.toObject(), ...req.body, correos: req.body.correos ?? emp.correos });
    if (!d.nombre) return malo(res, 'Por favor ingresa el nombre de la empresa.');
    if (!d.nit) return malo(res, 'Por favor ingresa el NIT de la empresa.');
    const otra = await L.EmpresaLogistica.findOne({ clave: L.claveDe(d.nombre), _id: { $ne: emp._id } });
    if (otra) return res.status(409).json({ success: false, message: 'Ya existe una empresa registrada con ese nombre.' });
    const anterior = emp.nombre;
    Object.assign(emp, d);
    await emp.save();
    // Si cambió el nombre, se actualizan las referencias por nombre (como la columna Empresa del Excel)
    if (anterior !== emp.nombre) {
      await Promise.all([
        L.TarifaFlete.updateMany({ empresa: exacto(anterior) }, { empresa: emp.nombre }),
        L.ViajeBitacora.updateMany({ empresa: exacto(anterior) }, { empresa: emp.nombre }),
        L.RelacionCargue.updateMany({ empresa: exacto(anterior) }, { empresa: emp.nombre }),
        R.RndcViaje.updateMany({ empresa: exacto(anterior) }, { empresa: emp.nombre }),
      ]);
      const tarifas = await L.TarifaFlete.find({ empresa: emp.nombre });
      for (const t of tarifas) await t.save(); // recalcula la clave empresa|destino
    }
    res.json({ success: true, empresa: emp });
  } catch (e) { fallo(res, e); }
});

router.delete('/empresas/:id', async (req, res) => {
  try {
    await L.EmpresaLogistica.findByIdAndUpdate(req.params.id, { activa: false });
    res.json({ success: true });
  } catch (e) { fallo(res, e); }
});

// ══════════════════════════════════════════════════════════════════════════
// TARIFAS Y DESTINOS (hoja Fletes)
// ══════════════════════════════════════════════════════════════════════════
router.get('/tarifas', async (req, res) => {
  try {
    const filtro = {};
    if (txt(req.query.empresa)) filtro.empresa = exacto(req.query.empresa);
    if (txt(req.query.q)) filtro.destino = new RegExp(escRegex(txt(req.query.q)), 'i');
    const tarifas = await L.TarifaFlete.find(filtro).sort({ empresa: 1, destino: 1 });
    res.json({ success: true, tarifas });
  } catch (e) { fallo(res, e); }
});

// Datos de la tarifa de un destino (autollenado al elegir destino)
router.get('/tarifas/buscar', async (req, res) => {
  try {
    const clave = `${L.claveDe(req.query.empresa)}|${L.claveDe(req.query.destino)}`;
    const tarifa = await L.TarifaFlete.findOne({ clave });
    res.json({ success: true, tarifa, pesoKg: C.pesoPorDestino(req.query.destino) });
  } catch (e) { fallo(res, e); }
});

// EsNumero / EsNumeroOVacio del formulario de tarifas
function leerTarifa(body) {
  const num = (v) => {
    if (v === null || v === undefined || txt(v) === '') return { vacio: true, valor: 0 };
    const limpio = typeof v === 'number' ? v : Number(txt(v).replace(/[$\s.]/g, '').replace(',', '.'));
    return { vacio: false, valor: limpio, ok: Number.isFinite(limpio) && limpio >= 0 };
  };
  const tc = num(body.tarifaCliente); const ta = num(body.tarifaAuxiliar);
  const fc = num(body.fleteConductor); const ap = num(body.auxiliarPagado); const ah = num(body.anticipoHabitual);
  if (tc.vacio || !tc.ok || fc.vacio || !fc.ok || (!ta.vacio && !ta.ok) || (!ap.vacio && !ap.ok) || (!ah.vacio && !ah.ok)) {
    return { error: 'Las tarifas deben ser números (Tarifa cliente y Flete conductor son obligatorios).' };
  }
  return {
    empresa: txt(body.empresa), destino: txt(body.destino),
    tarifaCliente: tc.valor, tarifaAuxiliar: ta.valor, fleteConductor: fc.valor, auxiliarPagado: ap.valor,
    anticipoHabitual: ah.vacio ? null : ah.valor,
  };
}

// "Guardar": si el destino ya existe para la empresa lo actualiza, si no lo crea
router.post('/tarifas', async (req, res) => {
  try {
    if (!txt(req.body.empresa)) return malo(res, 'Selecciona una Empresa.');
    if (!txt(req.body.destino)) return malo(res, 'Escribe o selecciona un Destino.');
    const d = leerTarifa(req.body);
    if (d.error) return malo(res, d.error);
    const clave = `${L.claveDe(d.empresa)}|${L.claveDe(d.destino)}`;
    let t = await L.TarifaFlete.findOne({ clave });
    const creada = !t;
    if (!t) t = new L.TarifaFlete(d); else Object.assign(t, d);
    await t.save();
    res.status(creada ? 201 : 200).json({ success: true, tarifa: t, creada });
  } catch (e) { fallo(res, e); }
});

// "Modificar": cambia el destino seleccionado (puede cambiar su nombre)
router.put('/tarifas/:id', async (req, res) => {
  try {
    const t = await L.TarifaFlete.findById(req.params.id);
    if (!t) return fallo(res, new Error('Primero selecciona un destino de la lista para editarlo.'), 404);
    if (!txt(req.body.empresa)) return malo(res, 'Selecciona una Empresa.');
    if (!txt(req.body.destino)) return malo(res, 'Escribe o selecciona un Destino.');
    const d = leerTarifa(req.body);
    if (d.error) return malo(res, d.error);
    const clave = `${L.claveDe(d.empresa)}|${L.claveDe(d.destino)}`;
    const otra = await L.TarifaFlete.findOne({ clave, _id: { $ne: t._id } });
    if (otra) return res.status(409).json({ success: false, message: 'Ya existe ese destino para la empresa.' });
    Object.assign(t, d);
    await t.save();
    res.json({ success: true, tarifa: t });
  } catch (e) { fallo(res, e); }
});

router.delete('/tarifas/:id', async (req, res) => {
  try {
    await L.TarifaFlete.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (e) { fallo(res, e); }
});

// ══════════════════════════════════════════════════════════════════════════
// CONDUCTORES Y VEHÍCULOS (hoja _CONDUCTORES)
// ══════════════════════════════════════════════════════════════════════════
router.get('/conductores', async (req, res) => {
  try {
    const filtro = req.query.todos === 'true' ? {} : { activo: true };
    const q = txt(req.query.q);
    if (q) {
      const re = new RegExp(escRegex(q), 'i');
      filtro.$or = [{ nombre: re }, { placa: re }, { cedula: re }];
    }
    const conductores = await L.ConductorFlota.find(filtro).sort({ nombre: 1 }).limit(Number(req.query.limit) || 2000);
    res.json({ success: true, conductores });
  } catch (e) { fallo(res, e); }
});

// BuscarPlacaPorConductor + NombreCompletoConductor: nombre exacto, o parcial si coincide con UN solo conductor
router.get('/conductores/resolver', async (req, res) => {
  try {
    const nb = txt(req.query.nombre).toLowerCase();
    if (!nb) return res.json({ success: true, nombre: '', placa: '' });
    const todos = await L.ConductorFlota.find({ activo: true }).select('nombre placa').lean();
    const ex = todos.find(c => txt(c.nombre).toLowerCase() === nb);
    if (ex) return res.json({ success: true, nombre: ex.nombre, placa: ex.placa });
    const parciales = todos.filter(c => txt(c.nombre).toLowerCase().includes(nb));
    if (parciales.length === 1) return res.json({ success: true, nombre: parciales[0].nombre, placa: parciales[0].placa });
    res.json({ success: true, nombre: '', placa: '', coincidencias: parciales.length });
  } catch (e) { fallo(res, e); }
});

// AutoCedula: si la cédula ya existe con otra placa copia los datos del conductor;
// si no, toma el nombre del maestro del RNDC.
router.get('/conductores/por-cedula', async (req, res) => {
  try {
    const ced = txt(req.query.cedula);
    if (!ced) return res.json({ success: true });
    const c = await L.ConductorFlota.findOne({ cedula: ced }).lean();
    if (c) {
      return res.json({
        success: true, origen: 'base',
        mensaje: 'Esa cédula ya está registrada con otra placa: se copiaron los datos del conductor.',
        datos: { nombre: c.nombre, fechaNacimiento: c.fechaNacimiento, numeroLicencia: c.numeroLicencia, venceLicencia: c.venceLicencia, celular: c.celular },
      });
    }
    const f = await R.RndcConductor.findOne({ cedula: ced }).lean();
    if (f && f.nombre) {
      return res.json({ success: true, origen: 'rndc', mensaje: 'Nombre tomado del maestro del RNDC. Verifíquelo.', datos: { nombre: C.nombrePropio(f.nombre) } });
    }
    res.json({ success: true });
  } catch (e) { fallo(res, e); }
});

// AutoTenedor: CC y nombre del tenedor (titular) de la placa en el maestro del RNDC + contacto
router.get('/conductores/tenedor', async (req, res) => {
  try {
    const pl = S.placaKey(req.query.placa);
    if (!pl) return res.json({ success: true });
    const veh = await R.RndcVehiculo.findOne({ placa: pl }).lean();
    const cc = txt(veh?.docTitular);
    if (!cc || cc === '0') return res.json({ success: true });
    const t = await R.RndcTitular.findOne({ doc: cc }).lean();
    const datos = { ccTenedor: cc, nombreTenedor: t?.nombre ? C.nombrePropio(t.nombre) : '' };
    if (t) {
      datos.dirTenedor = txt(t.direccion);
      const tel = C.soloDigitos(t.telefono);
      if (tel && !['0', '00', '9999999999'].includes(tel)) datos.celTenedor = tel;
      // "CIUDAD DEPARTAMENTO" → departamento y ciudad del DANE
      const ciu = C.normTxt(t.ciudad);
      if (ciu) {
        const deptos = await R.RndcDane.distinct('departamento');
        for (const dep of deptos) {
          const dn = C.normTxt(dep);
          if (dn && ciu.length > dn.length && ciu.endsWith(` ${dn}`)) {
            const resto = ciu.slice(0, ciu.length - dn.length).trim();
            const m = await R.RndcDane.findOne({ departamento: dep, nombreNormalizado: resto }).lean();
            if (m) { datos.deptoTenedor = m.departamento; datos.ciudadTenedor = m.municipio; break; }
          }
        }
      }
    }
    res.json({ success: true, datos, mensaje: `Tenedor tomado del maestro del RNDC para la placa ${pl}.` });
  } catch (e) { fallo(res, e); }
});

router.get('/departamentos', async (req, res) => {
  try {
    const deps = (await R.RndcDane.distinct('departamento')).filter(Boolean).sort();
    res.json({ success: true, departamentos: deps });
  } catch (e) { fallo(res, e); }
});
router.get('/ciudades', async (req, res) => {
  try {
    const ciudades = (await R.RndcDane.find({ departamento: txt(req.query.departamento) }).distinct('municipio')).sort();
    res.json({ success: true, ciudades });
  } catch (e) { fallo(res, e); }
});

// Validar del formulario de conductores
function leerConductor(body) {
  const errores = [];
  const nombre = C.nombrePropio(body.nombre);
  const placa = txt(body.placa).replace(/\s/g, '').toUpperCase();
  const cedula = txt(body.cedula);
  if (!nombre) errores.push('Escriba el nombre completo del conductor.');
  if (!placa) errores.push('Escriba la placa del vehículo.');
  const fechas = {};
  for (const [k, et] of [['fechaNacimiento', 'Fecha de Nacimiento'], ['venceLicencia', 'Fecha Vence licencia'],
    ['venceSoat', 'Vence SOAT'], ['venceTecnomecanica', 'Vence Revisión Tecnomecánica']]) {
    const v = body[k];
    if (v === undefined || v === null || txt(v) === '') { fechas[k] = null; continue; }
    const f = C.parseFecha(v);
    if (!f) errores.push(`La fecha de '${et}' no es válida. Escríbala como dd/mm/aaaa.`);
    fechas[k] = f;
  }
  const num = (v, et) => {
    if (v === undefined || v === null || txt(v) === '') return null;
    const d = C.soloDigitos(v);
    if (!d) { errores.push(`${et} debe ser un número en kilos.`); return null; }
    return Number(d);
  };
  const pbv = num(body.pbv, 'El PBV');
  const pesoVacio = num(body.pesoVacio, 'El peso vacío');
  const cedulaRara = !!cedula && (C.soloDigitos(cedula) !== cedula || cedula.length < 5 || cedula.length > 11);
  return {
    errores, cedulaRara,
    datos: {
      nombre, placa, cedula, ...fechas, pbv, pesoVacio,
      celular: C.soloDigitos(body.celular), numeroLicencia: txt(body.numeroLicencia),
      ccTenedor: txt(body.ccTenedor), nombreTenedor: C.nombrePropio(body.nombreTenedor),
      categoriaLicencia: txt(body.categoriaLicencia).toUpperCase(), direccion: txt(body.direccion),
      departamento: txt(body.departamento), ciudad: txt(body.ciudad), cuenta: txt(body.cuenta),
      tipoCuenta: txt(body.tipoCuenta), entidad: txt(body.entidad), celTenedor: C.soloDigitos(body.celTenedor),
      dirTenedor: txt(body.dirTenedor), deptoTenedor: txt(body.deptoTenedor), ciudadTenedor: txt(body.ciudadTenedor),
    },
  };
}

// SincronizarFichas + SincronizarTitular: lo guardado también actualiza el maestro del RNDC
async function sincronizarFichas(d) {
  const up = (s) => C.quitarTildes(s, true).toUpperCase().trim();
  const ced = txt(d.cedula).replace(/\s/g, '');
  if (ced) {
    let c = await R.RndcConductor.findOne({ cedula: ced });
    if (!c) c = new R.RndcConductor({ cedula: ced, nombre: up(d.nombre) });
    else if (!c.nombre && d.nombre) c.nombre = up(d.nombre);
    if (d.direccion) c.direccion = up(d.direccion);
    if (d.celular) c.telefono = d.celular;
    if (d.numeroLicencia) {
      let pre = d.categoriaLicencia;
      if (!pre && c.licencia.includes('-')) pre = c.licencia.slice(0, c.licencia.indexOf('-'));
      if (pre) c.licencia = `${pre}-${d.numeroLicencia}`;
    }
    if (d.ciudad && d.departamento) c.ciudad = C.quitarTildes(`${d.ciudad} ${d.departamento}`).toUpperCase();
    await c.save();
  }
  if (d.placa) {
    let v = await R.RndcVehiculo.findOne({ placa: d.placa });
    if (!v) v = new R.RndcVehiculo({ placa: d.placa });
    if (d.pesoVacio) v.pesoVacio = String(d.pesoVacio);
    if (d.venceSoat) v.venceSoat = C.fmtFechaRndc(d.venceSoat);
    if (d.ccTenedor) v.docTitular = d.ccTenedor;
    if (d.pbv) v.pbv = d.pbv;
    await v.save();
  }
  const cc = txt(d.ccTenedor).replace(/\s/g, '');
  if (cc && d.nombreTenedor) {
    let t = await R.RndcTitular.findOne({ doc: cc });
    if (!t) t = new R.RndcTitular({ doc: cc, nombre: up(d.nombreTenedor) });
    else if (!t.nombre) t.nombre = up(d.nombreTenedor);
    if (d.dirTenedor) t.direccion = up(d.dirTenedor);
    if (d.celTenedor) t.telefono = d.celTenedor;
    if (d.ciudadTenedor && d.deptoTenedor) t.ciudad = C.quitarTildes(`${d.ciudadTenedor} ${d.deptoTenedor}`).toUpperCase();
    await t.save();
  }
}

async function guardarConductor(req, res, existente) {
  const { errores, cedulaRara, datos } = leerConductor(req.body);
  if (errores.length) return malo(res, errores[0], { errores });
  if (cedulaRara && !req.body.confirmarCedula) {
    return res.status(422).json({
      success: false, requiereConfirmacion: 'cedula',
      message: `La cédula '${datos.cedula}' parece rara (solo números, entre 5 y 11 dígitos). ¿Desea guardarla de todas formas?`,
    });
  }
  const dup = await L.ConductorFlota.findOne({ placa: datos.placa, ...(existente ? { _id: { $ne: existente._id } } : {}) });
  if (dup) return res.status(409).json({ success: false, message: `Ya existe otro conductor registrado con la placa ${datos.placa}.` });
  let c = existente;
  if (c) Object.assign(c, datos, { activo: true }); else c = new L.ConductorFlota(datos);
  await c.save();
  await sincronizarFichas(datos);
  res.status(existente ? 200 : 201).json({ success: true, conductor: c });
}

router.post('/conductores', async (req, res) => {
  try { await guardarConductor(req, res, null); } catch (e) { fallo(res, e); }
});
router.put('/conductores/:id', async (req, res) => {
  try {
    const c = await L.ConductorFlota.findById(req.params.id);
    if (!c) return fallo(res, new Error('Conductor no encontrado'), 404);
    await guardarConductor(req, res, c);
  } catch (e) { fallo(res, e); }
});
router.delete('/conductores/:id', async (req, res) => {
  try {
    await L.ConductorFlota.findByIdAndUpdate(req.params.id, { activo: false });
    res.json({ success: true });
  } catch (e) { fallo(res, e); }
});

// ══════════════════════════════════════════════════════════════════════════
// BITÁCORA DE VIAJES
// ══════════════════════════════════════════════════════════════════════════
function conCalculos(v) {
  const o = v.toObject ? v.toObject() : { ...v };
  o.saldo = C.saldoViaje(o);
  o.utilidad = C.utilidadViaje(o);
  return o;
}

function filtroViajes(q) {
  const f = {};
  if (q.periodo) f.periodo = q.periodo; else f.archivado = false;
  if (txt(q.empresa)) f.empresa = exacto(q.empresa);
  if (txt(q.conductor)) f.conductor = new RegExp(escRegex(txt(q.conductor)), 'i');
  if (txt(q.q)) {
    const re = new RegExp(escRegex(txt(q.q)), 'i');
    f.$or = [{ empresa: re }, { conductor: re }, { placa: re }, { destino: re }, { manifiesto: re }, { observaciones: re }];
  }
  const desde = C.parseFecha(q.desde); const hasta = C.parseFecha(q.hasta);
  if (desde || hasta) f.fecha = { ...(desde ? { $gte: desde } : {}), ...(hasta ? { $lte: hasta } : {}) };
  if (q.reportado === 'no') f.reportado = '';
  if (q.reportado === 'si') f.reportado = { $ne: '' };
  return f;
}

function totalesViajes(viajes) {
  return viajes.reduce((t, v) => ({
    viajes: t.viajes + 1,
    tarifa: t.tarifa + (v.tarifa || 0), flete: t.flete + (v.flete || 0), anticipo: t.anticipo + (v.anticipo || 0),
    auxiliar: t.auxiliar + (v.auxiliar || 0), saldo: t.saldo + (v.saldo || 0), utilidad: t.utilidad + (v.utilidad || 0),
    pesoKg: t.pesoKg + (v.pesoKg || 0),
  }), { viajes: 0, tarifa: 0, flete: 0, anticipo: 0, auxiliar: 0, saldo: 0, utilidad: 0, pesoKg: 0 });
}

async function siguienteNumero() {
  const ult = await L.ViajeBitacora.findOne({ archivado: false }).sort({ numero: -1 }).select('numero').lean();
  return ult ? ult.numero + 1 : 1;
}

router.get('/viajes', async (req, res) => {
  try {
    const viajes = (await L.ViajeBitacora.find(filtroViajes(req.query)).sort({ numero: 1 })).map(conCalculos);
    res.json({ success: true, viajes, totales: totalesViajes(viajes), siguienteNumero: await siguienteNumero(), hoy: C.hoyColombia() });
  } catch (e) { fallo(res, e); }
});

router.get('/viajes/siguiente-numero', async (req, res) => {
  try { res.json({ success: true, numero: await siguienteNumero(), fecha: C.hoyColombia() }); } catch (e) { fallo(res, e); }
});

// Resumen por empresa (equivale a las hojas por empresa con su total de utilidad)
router.get('/viajes/resumen-empresas', async (req, res) => {
  try {
    const viajes = (await L.ViajeBitacora.find(filtroViajes({ ...req.query, empresa: '' }))).map(conCalculos);
    const mapa = new Map();
    viajes.forEach(v => {
      const k = v.empresa;
      if (!mapa.has(k)) mapa.set(k, []);
      mapa.get(k).push(v);
    });
    const empresas = [...mapa.entries()].map(([empresa, lista]) => ({ empresa, ...totalesViajes(lista) }))
      .sort((a, b) => a.empresa.localeCompare(b.empresa));
    res.json({ success: true, empresas, totales: totalesViajes(viajes) });
  } catch (e) { fallo(res, e); }
});

// Validación y normalización del formulario de registro (frmRegistro)
async function leerViaje(body) {
  const empresa = txt(body.empresa);
  const conductorTxt = txt(body.conductor);
  const destino = txt(body.destino);
  if (!empresa || !conductorTxt || !destino) return { error: 'Por favor completa al menos Empresa, Conductor y Destino.' };
  // Nombre completo del conductor si el texto coincide con uno solo
  const flota = await L.ConductorFlota.find({ activo: true }).select('nombre placa').lean();
  const nb = conductorTxt.toLowerCase();
  let cond = flota.find(c => txt(c.nombre).toLowerCase() === nb);
  if (!cond) {
    const parciales = flota.filter(c => txt(c.nombre).toLowerCase().includes(nb));
    if (parciales.length === 1) [cond] = parciales;
  }
  let placa = txt(body.placa);
  if (!placa && cond) placa = cond.placa;
  if (!placa) return { error: 'No se encontró la placa para este conductor. Por favor ingrésala manualmente en el campo Placa.', campo: 'placa' };
  return {
    datos: {
      empresa,
      manifiesto: txt(body.manifiesto),
      conductor: C.convertirNombre(cond ? cond.nombre : conductorTxt),
      placa: placa.toUpperCase(),
      destino: C.convertirDestino(destino),
      pesoKg: Number(String(body.pesoKg ?? '').replace(/[^0-9.]/g, '')) || 0,
      tarifa: C.valorNumerico(body.tarifa),
      flete: C.valorNumerico(body.flete),
      anticipo: C.valorNumerico(body.anticipo),
      auxiliar: C.valorNumerico(body.auxiliar),
      observaciones: txt(body.observaciones),
      ...(body.enviarManifiesto !== undefined ? { enviarManifiesto: !!body.enviarManifiesto } : {}),
    },
  };
}

router.post('/viajes', async (req, res) => {
  try {
    const r = await leerViaje(req.body);
    if (r.error) return malo(res, r.error, { campo: r.campo });
    const fecha = C.parseFecha(req.body.fecha) || C.hoyColombia();
    let viaje;
    for (let intento = 0; intento < 3; intento += 1) {
      const numero = await siguienteNumero();
      const choque = await L.ViajeBitacora.findOne({ archivado: false, numero });
      if (choque) continue;
      viaje = await L.ViajeBitacora.create({ ...r.datos, numero, fecha, creadoPor: req.user._id });
      break;
    }
    if (!viaje) return fallo(res, new Error('No se pudo asignar el número de registro, intente de nuevo.'), 409);
    res.status(201).json({ success: true, viaje: conCalculos(viaje), message: `Registro N° ${viaje.numero} guardado correctamente.` });
  } catch (e) { fallo(res, e); }
});

// Edición: conserva el N° de registro y la fecha (igual que el formulario del Excel)
router.put('/viajes/:id', async (req, res) => {
  try {
    const v = await L.ViajeBitacora.findById(req.params.id);
    if (!v) return fallo(res, new Error('No se pudo ubicar el viaje original para editar. Por favor búscalo de nuevo.'), 404);
    const r = await leerViaje(req.body);
    if (r.error) return malo(res, r.error, { campo: r.campo });
    Object.assign(v, r.datos, { actualizadoPor: req.user._id });
    await v.save();
    res.json({ success: true, viaje: conCalculos(v), message: `Viaje N° ${v.numero} actualizado correctamente.` });
  } catch (e) { fallo(res, e); }
});

router.delete('/viajes/:id', async (req, res) => {
  try {
    const v = await L.ViajeBitacora.findByIdAndDelete(req.params.id);
    if (!v) return fallo(res, new Error('No se pudo ubicar el viaje.'), 404);
    res.json({ success: true, message: `Viaje N° ${v.numero} eliminado correctamente.` });
  } catch (e) { fallo(res, e); }
});

// Marca / desmarca "Enviar (X)" del manifiesto
router.patch('/viajes/enviar-manifiesto', async (req, res) => {
  try {
    const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
    await L.ViajeBitacora.updateMany({ _id: { $in: ids } }, { enviarManifiesto: !!req.body.valor });
    res.json({ success: true });
  } catch (e) { fallo(res, e); }
});

// ── Reporte de WhatsApp ─────────────────────────────────────────────────────
router.get('/viajes/whatsapp', async (req, res) => {
  try {
    const fecha = C.parseFecha(req.query.fecha);
    if (!fecha) return malo(res, 'Fecha inválida.');
    const viajes = await L.ViajeBitacora.find({ archivado: false, fecha, reportado: '' }).sort({ numero: 1 }).lean();
    if (!viajes.length) {
      return res.json({ success: true, mensajes: [], message: `No hay vehículos nuevos por reportar para la fecha ${C.fmtFecha(fecha)}. (Los que ya fueron reportados no se repiten).` });
    }
    const saludo = C.saludoPorHora();
    const grupos = new Map();
    viajes.forEach(v => {
      const emp = txt(v.empresa);
      let linea = `${txt(v.conductor)}. ${txt(v.destino)}. Flete ${C.fmtMiles(v.flete)}. Anticipo ${C.fmtMiles(v.anticipo)}\nPlaca ${txt(v.placa)}`;
      if (txt(v.observaciones)) linea += `\n${txt(v.observaciones)}`;
      if (!grupos.has(emp)) grupos.set(emp, { lineas: [], ids: [] });
      grupos.get(emp).lineas.push(linea);
      grupos.get(emp).ids.push(v._id);
    });
    const mensajes = [...grupos.entries()].map(([empresa, g]) => ({
      empresa, ids: g.ids, viajes: g.ids.length,
      texto: `${saludo},\n\nReporte de vehiculos - ${C.fmtFecha(fecha)}\n\n${empresa}\n\n${g.lineas.join('\n\n')}\n`,
    }));
    res.json({ success: true, mensajes });
  } catch (e) { fallo(res, e); }
});

router.post('/viajes/whatsapp/marcar', async (req, res) => {
  try {
    const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
    const marca = `Reportado ${C.fmtFechaHoraAhora()}`;
    const r = await L.ViajeBitacora.updateMany({ _id: { $in: ids }, reportado: '' }, { reportado: marca });
    res.json({ success: true, marcados: r.modifiedCount, marca });
  } catch (e) { fallo(res, e); }
});

// ── Correo de salida (Corbeta) ──────────────────────────────────────────────
function correoSalida(v, empresaDoc, fecha, saludo) {
  const placa = txt(v.placa);
  const conductor = C.nombrePropio(v.conductor);
  const destino = C.nombrePropio(v.destino);
  const razon = txt(empresaDoc?.razonSocial) || txt(v.empresa).toUpperCase();
  const asunto = `Autorizacion de Salida  ${placa}  ${conductor}`;
  const cuerpo = `${saludo},\n\nSeñores:\n${razon}\n\nFecha: ${C.fechaLarga(fecha)}\n\n` +
    'Por medio del presente, la Cooperativa de Transportes España "COOESPATRANS" solicita autorizacion para la salida del siguiente vehiculo:\n\n' +
    `  - Placa:      ${placa}\n  - Conductor:  ${conductor}\n  - Destino:    ${destino}\n\n` +
    `El vehiculo realizara la salida de ${txt(v.empresa)} hasta Parqueadero Privado y mañana continuara con destino a ${destino}; bajo la responsabilidad de COOESPATRANS.\n\n` +
    'Agradecemos su atencion y quedamos atentos a cualquier novedad.\n\nCordialmente,\nCOOESPATRANS';
  return { asunto, cuerpo };
}

async function pendientesSalida(fecha) {
  return L.ViajeBitacora.find({ archivado: false, fecha, correoEnviado: '', empresa: /^\s*corbeta\s*$/i }).sort({ numero: 1 });
}

router.get('/viajes/correo-salida', async (req, res) => {
  try {
    const fecha = C.parseFecha(req.query.fecha);
    if (!fecha) return malo(res, 'Fecha inválida.');
    const viajes = await pendientesSalida(fecha);
    const empresas = await L.EmpresaLogistica.find().lean();
    const saludo = C.saludoPorHora();
    const correos = viajes.map(v => {
      const emp = empresas.find(e => e.clave === L.claveDe(v.empresa));
      return { _id: v._id, numero: v.numero, placa: v.placa, conductor: v.conductor, destino: v.destino, empresa: v.empresa,
        para: (emp?.correos || []).join(', '), ...correoSalida(v, emp, fecha, saludo) };
    });
    res.json({ success: true, correos, modoPrueba: enModoPrueba() });
  } catch (e) { fallo(res, e); }
});

router.post('/viajes/correo-salida', async (req, res) => {
  try {
    const fecha = C.parseFecha(req.body.fecha);
    if (!fecha) return malo(res, 'Fecha inválida.');
    const viajes = await pendientesSalida(fecha);
    const empresas = await L.EmpresaLogistica.find().lean();
    const saludo = C.saludoPorHora();
    const r = { enviados: 0, fallidos: 0, sinConfig: [], errores: [], simulado: enModoPrueba() };
    const cfg = await obtenerConfig();
    for (const v of viajes) {
      const emp = empresas.find(e => e.clave === L.claveDe(v.empresa));
      const para = emp?.correos || [];
      if (!para.length) { if (!r.sinConfig.includes(v.empresa)) r.sinConfig.push(v.empresa); continue; }
      const { asunto, cuerpo } = correoSalida(v, emp, fecha, saludo);
      const env = await enviarCorreo({ para, asunto, texto: cuerpo, nombreRemitente: cfg.remitenteNombre });
      await L.RegistroEnvio.create({ empresa: v.empresa, documento: asunto, tipo: 'salida', correos: para.join(', '),
        estado: env.ok ? (env.simulado ? 'simulado' : 'enviado') : 'error', detalle: env.error || '', usuario: req.user.username });
      if (env.ok) {
        v.correoEnviado = `Enviado ${C.fmtFechaHoraAhora()}`;
        await v.save();
        r.enviados += 1;
      } else {
        r.fallidos += 1;
        r.errores.push(`No se pudo enviar el correo para la placa ${v.placa} (${v.empresa}): ${env.error}`);
      }
    }
    if (!r.enviados && !r.fallidos && !r.sinConfig.length) {
      r.message = `No hay vehículos nuevos por enviar correo de salida para la fecha ${C.fmtFecha(fecha)}.`;
    }
    res.json({ success: true, ...r });
  } catch (e) { fallo(res, e); }
});

// ── Exportar bitácora / hoja por empresa ────────────────────────────────────
router.get('/viajes/exportar', async (req, res) => {
  try {
    const formato = req.query.formato === 'pdf' ? 'pdf' : 'xlsx';
    const empresa = txt(req.query.empresa);
    const viajes = (await L.ViajeBitacora.find(filtroViajes(req.query)).sort({ numero: 1 })).map(conCalculos);
    const hoy = C.fmtFecha(C.hoyColombia()).replace(/\//g, '-');
    let buffer;
    let nombre;
    if (empresa) {
      nombre = `${C.limpiarNombreArchivo(empresa)}_${hoy}.${formato}`;
      buffer = formato === 'pdf'
        ? await REP.bitacoraPdf({ viajes })
        : await REP.bitacoraExcel({ viajes, titulo: empresa, incluirControl: false, incluirCalculos: true });
    } else {
      nombre = `BITACORA_${hoy}.${formato}`;
      buffer = formato === 'pdf'
        ? await REP.bitacoraPdf({ viajes, columnasCompletas: true })
        : await REP.bitacoraExcel({ viajes, titulo: 'BITACORA' });
    }
    enviarArchivo(res, buffer, nombre, formato);
  } catch (e) { fallo(res, e); }
});

// Hojas de todas las empresas de una vez (GenerarExcelTodasEmpresasAhora): ZIP
// con la carpeta de cada empresa, como las carpetas <Empresa>\Reportes del Excel
router.get('/viajes/exportar-empresas', async (req, res) => {
  try {
    const formato = req.query.formato === 'pdf' ? 'pdf' : 'xlsx';
    const viajes = (await L.ViajeBitacora.find(filtroViajes({ ...req.query, empresa: '' })).sort({ numero: 1 })).map(conCalculos);
    const empresas = [...new Set(viajes.map(v => v.empresa))].sort();
    if (!empresas.length) return fallo(res, new Error('No hay viajes registrados para exportar.'), 404);
    const JSZip = require('jszip');
    const zip = new JSZip();
    const hoy = C.fmtFecha(C.hoyColombia()).replace(/\//g, '-');
    for (const emp of empresas) {
      const lista = viajes.filter(v => v.empresa === emp);
      const nombre = C.limpiarNombreArchivo(emp);
      const buf = formato === 'pdf' ? await REP.bitacoraPdf({ viajes: lista })
        : await REP.bitacoraExcel({ viajes: lista, titulo: emp, incluirControl: false, incluirCalculos: true });
      zip.file(`${nombre}/Reportes/${nombre}_${hoy}.${formato}`, buf);
    }
    enviarArchivo(res, await zip.generateAsync({ type: 'nodebuffer' }), `EMPRESAS_${hoy}.zip`, 'zip');
  } catch (e) { fallo(res, e); }
});

// Planilla en blanco para imprimir (hoja COOESPATRANS, folio = hoy + días)
router.get('/planilla-blanco', async (req, res) => {
  try {
    const cfg = await obtenerConfig();
    const dias = req.query.dias !== undefined ? Number(req.query.dias) || 0 : cfg.folioDias;
    const folio = new Date(C.hoyColombia().getTime() + dias * 86400000);
    const buffer = await REP.planillaBlancoPdf({ folio });
    enviarArchivo(res, buffer, `PLANILLA_BITACORA_${C.fmtFecha(folio).replace(/\//g, '-')}.pdf`, 'pdf');
  } catch (e) { fallo(res, e); }
});

// ── Nuevo periodo ───────────────────────────────────────────────────────────
router.get('/periodos', async (req, res) => {
  try {
    const periodos = await L.PeriodoLogistica.find().sort({ fechaCierre: -1 });
    res.json({ success: true, periodos });
  } catch (e) { fallo(res, e); }
});

// Archiva (no borra) los registros actuales de la bitácora y las hojas por empresa.
// Equivale al respaldo + borrado del Excel: la numeración vuelve a empezar en 1.
router.post('/periodos/cerrar', async (req, res) => {
  try {
    const viajes = (await L.ViajeBitacora.find({ archivado: false })).map(conCalculos);
    if (!viajes.length) return malo(res, 'No hay registros en la bitácora para cerrar el periodo.');
    const nombre = txt(req.body.nombre) || `Periodo cerrado el ${C.fmtFechaHoraAhora()}`;
    const periodo = await L.PeriodoLogistica.create({
      nombre, totalViajes: viajes.length, totales: totalesViajes(viajes),
      cerradoPor: req.user._id, cerradoPorNombre: req.user.username,
    });
    await L.ViajeBitacora.updateMany({ archivado: false }, { archivado: true, periodo: periodo._id });
    res.json({ success: true, periodo, message: `Nuevo periodo iniciado. Se archivaron ${viajes.length} registros (respaldo: "${nombre}").` });
  } catch (e) { fallo(res, e); }
});

// ══════════════════════════════════════════════════════════════════════════
// RELACIÓN DE FLETES
// ══════════════════════════════════════════════════════════════════════════
async function filasRelacion(filtro) {
  const [filas, tarifas, flota] = await Promise.all([
    L.RelacionCargue.find(filtro).sort({ empresa: 1, fecha: 1, createdAt: 1 }).lean(),
    L.TarifaFlete.find().lean(),
    L.ConductorFlota.find().select('nombre placa').lean(),
  ]);
  const mapaT = new Map(tarifas.map(t => [t.clave, t]));
  const mapaC = new Map(flota.map(c => [txt(c.placa).toUpperCase(), c.nombre]));
  return filas.map((f, i) => ({
    ...f,
    n: i + 1,
    ...C.calcularRelacion(f, mapaT.get(`${L.claveDe(f.empresa)}|${L.claveDe(f.destino)}`) || null, mapaC.get(f.placa) || ''),
  }));
}

function totalesRelacion(filas) {
  const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const t = filas.reduce((a, f) => ({
    viajes: a.viajes + 1, cantidad: a.cantidad + n(f.cantidad), total: a.total + n(f.total),
    totalFlete: a.totalFlete + n(f.totalFlete), totalAuxiliarPagado: a.totalAuxiliarPagado + n(f.totalAuxiliarPagado),
    utilidad: a.utilidad + n(f.utilidad), facturados: a.facturados + (f.facturado === 'Sí' ? 1 : 0),
  }), { viajes: 0, cantidad: 0, total: 0, totalFlete: 0, totalAuxiliarPagado: 0, utilidad: 0, facturados: 0 });
  t.utilidadPct = t.total ? t.utilidad / t.total : 0;
  return t;
}

router.get('/relacion', async (req, res) => {
  try {
    const filtro = { archivado: req.query.archivados === 'true' };
    if (txt(req.query.empresa)) filtro.empresa = exacto(req.query.empresa);
    if (req.query.facturado === 'si') filtro.facturado = 'Sí';
    if (req.query.facturado === 'no') filtro.facturado = { $ne: 'Sí' };
    const filas = await filasRelacion(filtro);
    res.json({ success: true, filas, totales: totalesRelacion(filas), config: await obtenerConfig() });
  } catch (e) { fallo(res, e); }
});

function leerRelacion(body) {
  if (!txt(body.empresa)) return { error: 'Selecciona la Empresa.' };
  if (!txt(body.placa)) return { error: 'Selecciona o escribe la Placa.' };
  if (!txt(body.destino)) return { error: 'Selecciona el Destino.' };
  const fecha = C.parseFecha(body.fecha);
  if (!fecha) return { error: 'Selecciona una Fecha válida.' };
  const cantidad = Number(String(body.cantidad ?? '').replace(',', '.'));
  if (!Number.isFinite(cantidad) || cantidad <= 0) return { error: 'Ingresa una Cantidad válida (mayor a cero).' };
  if (!['Sí', 'No'].includes(body.auxiliar)) return { error: 'Indica si lleva Auxiliar (Sí/No).' };
  const facturado = ['Sí', 'No'].includes(body.facturado) ? body.facturado : '';
  return { datos: { empresa: txt(body.empresa), placa: txt(body.placa).toUpperCase(), planilla: txt(body.planilla), destino: txt(body.destino), fecha, cantidad, auxiliar: body.auxiliar, facturado } };
}

router.post('/relacion', async (req, res) => {
  try {
    const r = leerRelacion(req.body);
    if (r.error) return malo(res, r.error);
    const fila = await L.RelacionCargue.create({ ...r.datos, creadoPor: req.user._id });
    // El formulario deja la empresa en el panel (RELACION!D7)
    const cfg = await obtenerConfig();
    cfg.relacionEmpresa = r.datos.empresa;
    await cfg.save();
    res.status(201).json({ success: true, fila, message: 'Cargue registrado correctamente.' });
  } catch (e) { fallo(res, e); }
});

router.put('/relacion/:id', async (req, res) => {
  try {
    const f = await L.RelacionCargue.findById(req.params.id);
    if (!f) return fallo(res, new Error('Cargue no encontrado'), 404);
    const r = leerRelacion({ ...f.toObject(), ...req.body });
    if (r.error) return malo(res, r.error);
    Object.assign(f, r.datos);
    await f.save();
    res.json({ success: true, fila: f });
  } catch (e) { fallo(res, e); }
});

router.delete('/relacion/:id', async (req, res) => {
  try {
    await L.RelacionCargue.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (e) { fallo(res, e); }
});

router.patch('/relacion/facturado', async (req, res) => {
  try {
    const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
    const valor = ['Sí', 'No', ''].includes(req.body.valor) ? req.body.valor : 'Sí';
    const r = await L.RelacionCargue.updateMany({ _id: { $in: ids } }, { facturado: valor });
    res.json({ success: true, actualizados: r.modifiedCount });
  } catch (e) { fallo(res, e); }
});

// "Limpiar": deja la tabla lista para una relación nueva (los cargues se archivan, no se pierden)
router.post('/relacion/limpiar', async (req, res) => {
  try {
    const cfg = await obtenerConfig();
    const etiqueta = `${cfg.relacionPeriodo || 'Sin periodo'} (archivado ${C.fmtFechaHoraAhora()})`;
    const r = await L.RelacionCargue.updateMany({ archivado: false }, { archivado: true, periodoArchivo: etiqueta });
    cfg.relacionEmpresa = ''; cfg.relacionPeriodo = '';
    await cfg.save();
    res.json({ success: true, archivados: r.modifiedCount, message: 'Listo, la tabla quedó en blanco y lista para una nueva relación.' });
  } catch (e) { fallo(res, e); }
});

// ValidarPanelExportacion + filas de la empresa
async function prepararExportRelacion(q) {
  const empresa = txt(q.empresa);
  const periodo = txt(q.periodo);
  if (!empresa) return { error: 'Selecciona primero la empresa.' };
  if (!periodo) return { error: 'Escribe el periodo (ej: 1-15 de septiembre de 2026).' };
  const filtro = { archivado: false, empresa: exacto(empresa), placa: { $ne: '' } };
  if (q.soloPendientes === 'true') filtro.facturado = { $ne: 'Sí' };
  const filas = await filasRelacion(filtro);
  const emp = await L.EmpresaLogistica.findOne({ clave: L.claveDe(empresa) }).lean();
  return { empresa, periodo, filas, logoClave: emp?.logo };
}

const nombreArchivo = (partes) => partes.map(p => C.limpiarNombreArchivo(p).replace(/ /g, '_')).join('_').toUpperCase();

router.get('/relacion/exportar', async (req, res) => {
  try {
    const p = await prepararExportRelacion(req.query);
    if (p.error) return malo(res, p.error);
    const tipo = ['pagos', 'utilidad'].includes(req.query.tipo) ? req.query.tipo : 'relacion';
    const formato = req.query.formato === 'pdf' ? 'pdf' : 'xlsx';
    if (!p.filas.length) {
      const msg = tipo === 'pagos' ? `No hay viajes de ${p.empresa} para generar la relación de pago.`
        : tipo === 'utilidad' ? `No hay viajes pendientes para ${p.empresa}.` : `No hay viajes pendientes de facturar para ${p.empresa}.`;
      return res.status(404).json({ success: false, message: msg });
    }
    const mes = C.numeroMes(p.periodo);
    let r; let nombre;
    if (tipo === 'relacion') {
      r = formato === 'pdf' ? await REP.relacionPdf(p) : await REP.relacionExcel(p);
      nombre = `${mes}_${nombreArchivo(['RELACION_DE_FLETES', p.empresa, p.periodo])}`;
    } else if (tipo === 'pagos') {
      r = formato === 'pdf' ? await REP.pagoPdf(p) : await REP.pagoExcel(p);
      nombre = `${mes}_${nombreArchivo(['PAGOS_RELACION_DEL', p.periodo, p.empresa])}`;
    } else {
      r = formato === 'pdf' ? await REP.utilidadPdf(p) : await REP.utilidadExcel(p);
      nombre = `${mes}_${nombreArchivo(['INFORME_UTILIDAD', p.empresa, p.periodo])}`;
    }
    // Opcional: dejar marcados como facturados los viajes exportados
    if (tipo === 'relacion' && req.query.marcarFacturado === 'true') {
      await L.RelacionCargue.updateMany({ _id: { $in: p.filas.map(f => f._id) } }, { facturado: 'Sí' });
    }
    enviarArchivo(res, r.buffer, `${nombre}.${formato}`, formato);
  } catch (e) { fallo(res, e); }
});

// Datos del informe de utilidad para mostrarlo en pantalla (tabla, gráficas y texto)
router.get('/relacion/utilidad', async (req, res) => {
  try {
    const p = await prepararExportRelacion(req.query);
    if (p.error) return malo(res, p.error);
    const { viajes, tot } = REP.datosUtilidad(p.filas);
    res.json({
      success: true, empresa: p.empresa, periodo: p.periodo,
      viajes: viajes.map(v => ({ _id: v._id, nLocal: v.nLocal, transportador: v.transportador, placa: v.placa, planilla: v.planilla,
        destino: v.destino, fecha: v.fecha, cantidad: v.cantidad, total: v._total, pagado: v._pagado, utilidad: v._util, pct: v._pct })),
      totales: tot, narrativa: REP.narrativaUtilidad(p.empresa, p.periodo, viajes.length, tot),
    });
  } catch (e) { fallo(res, e); }
});

// ══════════════════════════════════════════════════════════════════════════
// ENVÍO DE MANIFIESTOS POR CORREO (frmEnviarManifiestos / modManifiestos)
// ══════════════════════════════════════════════════════════════════════════
// PDF del manifiesto generado a partir del viaje RNDC aceptado
async function pdfDeManifiesto(numero, ctx) {
  const v = await R.RndcViaje.findOne({ manifiesto: txt(numero).toUpperCase() }).lean();
  if (!v || v.estadoManifiesto !== 'OK') return null;
  const { datos } = await M.armarManifiesto(v, ctx);
  return { filename: `${v.manifiesto}.pdf`, content: await REP.manifiestoPdf(datos), viaje: v };
}

router.get('/manifiestos/pendientes', async (req, res) => {
  try {
    const filtro = { archivado: false, enviarManifiesto: true, manifiestoEnviado: '' };
    if (txt(req.query.empresa)) filtro.empresa = exacto(req.query.empresa);
    const viajes = await L.ViajeBitacora.find(filtro).sort({ numero: 1 }).lean();
    const nums = viajes.map(v => txt(v.manifiesto).toUpperCase()).filter(Boolean);
    const rndc = await R.RndcViaje.find({ manifiesto: { $in: nums } }).select('manifiesto estadoManifiesto').lean();
    const lista = viajes.map(v => {
      const r = rndc.find(x => x.manifiesto === txt(v.manifiesto).toUpperCase());
      let problema = '';
      if (!txt(v.manifiesto)) problema = 'No tiene número de manifiesto en la columna MANIFIESTO.';
      else if (!r || r.estadoManifiesto !== 'OK') problema = `No se encontró el PDF del manifiesto ${v.manifiesto} (no está aceptado en el RNDC).`;
      return { _id: v._id, numero: v.numero, empresa: v.empresa, manifiesto: v.manifiesto, placa: v.placa, conductor: v.conductor, problema };
    });
    res.json({ success: true, viajes: lista });
  } catch (e) { fallo(res, e); }
});

router.post('/manifiestos/enviar', upload.array('archivos', 40), async (req, res) => {
  try {
    const empresa = txt(req.body.empresa);
    if (!empresa) return malo(res, 'Selecciona una empresa.');
    const emp = await L.EmpresaLogistica.findOne({ clave: L.claveDe(empresa) }).lean();
    const correos = emp?.correos || [];
    if (!correos.length) return malo(res, 'Esta empresa no tiene correos configurados. Agrégalos en Maestros > Empresas y vuelve a intentar.');
    const razon = txt(emp.razonSocial) || empresa.toUpperCase();
    const documento = txt(req.body.documento) || `MANIFIESTOS ${empresa.toUpperCase()}`;
    const cfg = await obtenerConfig();
    let adjuntos = []; let filasBit = []; const faltantes = [];
    if (req.files && req.files.length) {
      adjuntos = req.files.map(f => ({ filename: f.originalname, content: f.buffer }));
    } else {
      const viajes = await L.ViajeBitacora.find({ archivado: false, empresa: exacto(empresa), enviarManifiesto: true, manifiestoEnviado: '' });
      const ctx = await S.cargarContexto();
      for (const v of viajes) {
        if (!txt(v.manifiesto)) { faltantes.push(`Registro ${v.numero}: no tiene número de manifiesto.`); continue; }
        const pdf = await pdfDeManifiesto(v.manifiesto, ctx);
        if (!pdf) { faltantes.push(`Manifiesto ${v.manifiesto} (registro ${v.numero}): no se encontró el PDF.`); continue; }
        adjuntos.push({ filename: pdf.filename, content: pdf.content });
        filasBit.push(v);
      }
      if (!adjuntos.length) {
        return malo(res, `No se encontraron manifiestos pendientes y con PDF disponible para ${empresa}.`, { faltantes });
      }
    }
    const nums = adjuntos.map(a => a.filename.replace(/\.[^.]+$/, ''));
    const asunto = `${documento} - ${razon} - ${C.fmtFecha(C.hoyColombia())}`;
    const env = await enviarCorreo({ para: correos, asunto, texto: `${documento}\n\n${nums.join('\n')}\n`, adjuntos, nombreRemitente: cfg.remitenteNombre });
    await L.RegistroEnvio.create({ empresa, documento, tipo: 'manifiestos', correos: correos.join(', '), adjuntos: adjuntos.map(a => a.filename),
      estado: env.ok ? (env.simulado ? 'simulado' : 'enviado') : 'error', detalle: env.error || '', usuario: req.user.username });
    if (!env.ok) return res.status(502).json({ success: false, message: `Falló el envío del correo de ${empresa}: ${env.error}` });
    const marca = `Enviado ${C.fmtFechaHoraAhora()}`;
    for (const v of filasBit) { v.manifiestoEnviado = marca; await v.save(); }
    res.json({ success: true, enviados: adjuntos.length, faltantes, simulado: !!env.simulado, message: `Manifiestos de ${empresa} enviados correctamente.` });
  } catch (e) { fallo(res, e); }
});

router.get('/registro-envios', async (req, res) => {
  try {
    const filtro = {};
    if (txt(req.query.empresa)) filtro.empresa = exacto(req.query.empresa);
    if (txt(req.query.tipo)) filtro.tipo = txt(req.query.tipo);
    const registros = await L.RegistroEnvio.find(filtro).sort({ fecha: -1 }).limit(500);
    res.json({ success: true, registros });
  } catch (e) { fallo(res, e); }
});

// ══════════════════════════════════════════════════════════════════════════
// IMPORTAR LA PLANTILLA DE EXCEL (carga los datos sin sobrescribir lo existente)
// ══════════════════════════════════════════════════════════════════════════
router.post('/importar', upload.single('archivo'), async (req, res) => {
  try {
    if (!req.file) return malo(res, 'Selecciona el archivo de Excel (.xlsm o .xlsx).');
    const { importarPlantilla } = require('../services/logistica/importador');
    const resultado = await importarPlantilla(req.file.buffer, { usuario: req.user });
    res.json({ success: true, resultado });
  } catch (e) { fallo(res, e); }
});

module.exports = router;
