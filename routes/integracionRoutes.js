// routes/integracionRoutes.js
// Puerta de integración con Translogística del Sur (servidor a servidor).
// Solo lectura de conductores/vehículos de Sur Track y del rastreo, más crear o
// finalizar el viaje "espejo" que el conductor ve en la app para iniciar el rastreo.
// No cambia ninguna ruta existente. Se protege con la clave INTEGRACION_CLAVE del .env;
// sin esa clave configurada, toda la integración responde 503.
const express = require('express');
const crypto = require('crypto');
const mongoose = require('mongoose');
const Viaje = require('../models/Viaje');
const { enviarNotificacionViajeAsignado } = require('../services/notificacionService');

const router = express.Router();
// Express 4 no captura errores de funciones async: se envuelven para responder 500 sin tumbar el proceso
const seguro = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch((e) => {
  console.error('[integracion]', e.message);
  if (!res.headersSent) res.status(500).json({ mensaje: 'Error en la integración' });
});

// ── Autenticación por clave compartida (comparación en tiempo constante) ──
router.use((req, res, next) => {
  const esperada = String(process.env.INTEGRACION_CLAVE || '');
  if (esperada.length < 32) return res.status(503).json({ mensaje: 'Integración no configurada' });
  const recibida = String(req.get('x-integracion-clave') || '');
  const a = crypto.createHash('sha256').update(esperada).digest();
  const b = crypto.createHash('sha256').update(recibida).digest();
  if (!crypto.timingSafeEqual(a, b)) return res.status(401).json({ mensaje: 'Clave de integración inválida' });
  next();
});

const db = () => mongoose.connection.db;
const oid = (v) => (mongoose.isValidObjectId(v) ? new mongoose.Types.ObjectId(String(v)) : null);
const placaNorm = (p) => String(p || '').toUpperCase().replace(/[\s-]/g, '');
const cedulaNorm = (c) => String(c || '').replace(/\D/g, '');
const ACTIVOS = ['pendiente', 'aceptado'];
const palabras = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
  .split(/[^A-Z0-9]+/).filter(w => w.length > 3 && !['NARINO', 'PASTO', 'S.A.S', 'LTDA'].includes(w));
// Bodega del usuario de la integración cuyo nombre comparte una palabra con la empresa cliente
async function bodegaDeEmpresa(owner, empresa) {
  const buscadas = palabras(empresa);
  if (!owner || !buscadas.length) return null;
  const bodegas = await db().collection('bodegas').find({ owner }, { projection: { nombre: 1 } }).toArray();
  return bodegas.find(b => palabras(b.nombre).some(w => buscadas.includes(w)))?._id || null;
}

const presentarChofer = (c) => ({
  choferId: String(c._id), nombre: c.nombre || '', cedula: cedulaNorm(c.cedula), telefono: c.telefono || '',
  placa: placaNorm(c.vehiculo?.placa), capacidad: c.vehiculo?.capacidad || null,
  soat: c.vehiculo?.soat || '', tecnomecanico: c.vehiculo?.tecnomecanico || '', licenciaVencimiento: c.licenciaVencimiento || '',
});

// GET /api/integracion/vehiculos → conductores de Sur Track con su vehículo (sin contraseñas ni tokens)
router.get('/vehiculos', seguro(async (_req, res) => {
  const lista = await db().collection('chofers')
    .find({}, { projection: { nombre: 1, cedula: 1, telefono: 1, vehiculo: 1, licenciaVencimiento: 1 } }).toArray();
  res.json(lista.map(presentarChofer));
}));

// GET /api/integracion/viajes?desde=AAAA-MM-DD → viajes recientes con su conductor (para enlazarlos)
router.get('/viajes', seguro(async (req, res) => {
  const desde = new Date(req.query.desde || Date.now() - 7 * 86400000);
  const viajes = await Viaje.find({ fecha: { $gte: desde } })
    .select('codigo estado fecha fechaAceptacion fechaCompletado choferAsignado integracion').sort({ fecha: -1 }).limit(500).lean();
  const choferes = new Map((await db().collection('chofers')
    .find({ _id: { $in: viajes.map(v => v.choferAsignado).filter(Boolean) } }, { projection: { nombre: 1, cedula: 1, vehiculo: 1 } }).toArray())
    .map(c => [String(c._id), presentarChofer(c)]));
  res.json(viajes.map(v => ({ viajeId: String(v._id), codigo: v.codigo, estado: v.estado, fecha: v.fecha,
    fechaAceptacion: v.fechaAceptacion || null, fechaCompletado: v.fechaCompletado || null,
    chofer: choferes.get(String(v.choferAsignado)) || null, referenciaExterna: v.integracion?.referencia || null })));
}));

// GET /api/integracion/rastreo/activos → última posición de cada viaje que se está rastreando
router.get('/rastreo/activos', seguro(async (_req, res) => {
  const ubic = await db().collection('ubicacions').find({ activo: true }).sort({ ultimaActualizacion: -1 }).limit(1000).toArray();
  res.json(ubic.map(u => ({ viajeId: u.viajeId, codigo: u.codigoViaje || '', choferId: u.choferId || null, chofer: u.choferNombre || '',
    lat: u.latitud, lng: u.longitud, velocidad: u.velocidad || 0, rumbo: u.heading || 0, precision: u.precision || 0,
    hora: u.ultimaActualizacion || u.timestamp })));
}));

// GET /api/integracion/rastreo/:viajeId?desde=ISO → estado y recorrido del viaje (máx. 5000 puntos por consulta)
router.get('/rastreo/:viajeId', seguro(async (req, res) => {
  const viajeId = String(req.params.viajeId);
  if (!oid(viajeId)) return res.status(400).json({ mensaje: 'Viaje inválido' });
  const desde = req.query.desde ? new Date(req.query.desde) : new Date(0);
  const [viaje, ultima, puntos] = await Promise.all([
    Viaje.findById(viajeId).select('codigo estado fecha fechaAceptacion fechaCompletado').lean(),
    db().collection('ubicacions').findOne({ viajeId }, { sort: { ultimaActualizacion: -1 } }),
    db().collection('puntorecorridos').find({ viajeId, timestamp: { $gt: desde } }).sort({ timestamp: 1 }).limit(5000).toArray(),
  ]);
  if (!viaje) return res.status(404).json({ mensaje: 'Viaje no encontrado' });
  res.json({
    viaje: { viajeId, codigo: viaje.codigo, estado: viaje.estado, fechaAceptacion: viaje.fechaAceptacion || null, fechaCompletado: viaje.fechaCompletado || null },
    ultima: ultima ? { lat: ultima.latitud, lng: ultima.longitud, velocidad: ultima.velocidad || 0, rumbo: ultima.heading || 0,
      hora: ultima.ultimaActualizacion || ultima.timestamp, activo: !!ultima.activo } : null,
    puntos: puntos.map(p => ({ lat: p.latitud, lng: p.longitud, velocidad: p.velocidad || 0, rumbo: p.heading || 0, hora: p.timestamp, nuevoSegmento: !!p.nuevoSegmento })),
  });
}));

// POST /api/integracion/viajes → crea el viaje que el conductor verá en Sur Track para iniciar el rastreo.
// Body: { referencia, codigo, placa?, cedula?, valorFlete, anticipo?, empresa? }. La bodega se elige por el nombre
// de la empresa (p. ej. «Corbeta» → CORBETA PASTO); si no coincide ninguna, se usa INTEGRACION_BODEGA_ID. Si ya existe uno con la misma referencia, lo devuelve.
router.post('/viajes', seguro(async (req, res) => {
  const owner = oid(process.env.INTEGRACION_OWNER_ID);
  const bodega = (await bodegaDeEmpresa(owner, req.body?.empresa)) || oid(process.env.INTEGRACION_BODEGA_ID);
  if (!owner || !bodega) return res.status(503).json({ mensaje: 'Falta configurar el usuario y la bodega de la integración' });
  const { referencia, codigo, placa, cedula } = req.body || {};
  const valorFlete = Number(req.body?.valorFlete) || 0;
  const anticipo = Math.min(Number(req.body?.anticipo) || 0, valorFlete);
  if (!referencia || !codigo) return res.status(400).json({ mensaje: 'Faltan la referencia o el código del viaje' });
  if (valorFlete <= 0) return res.status(400).json({ mensaje: 'El valor del flete debe ser mayor a 0' });

  const previo = await Viaje.findOne({ 'integracion.referencia': String(referencia) }).lean();
  if (previo) return res.json({ viajeId: String(previo._id), codigo: previo.codigo, estado: previo.estado, existente: true });

  // Conductor por cédula y, si no, por placa
  const cols = db().collection('chofers');
  const ced = cedulaNorm(cedula);
  let chofer = ced ? await cols.findOne({ cedula: { $in: [ced, String(cedula || '').trim()] } }) : null;
  if (!chofer && placa) chofer = await cols.findOne({ 'vehiculo.placa': placaNorm(placa) });
  if (!chofer) return res.status(404).json({ mensaje: 'El conductor o la placa no están registrados en Sur Track' });

  const activo = await Viaje.findOne({ choferAsignado: chofer._id, estado: { $in: ACTIVOS } }).select('codigo').lean();
  if (activo) return res.status(409).json({ mensaje: 'El conductor ya tiene un viaje activo en Sur Track', codigoViaje: activo.codigo });

  const cod = String(codigo).trim().slice(0, 40);
  if (await Viaje.exists({ owner, codigo: cod })) return res.status(409).json({ mensaje: 'Ya existe un viaje con ese código' });
  const viaje = await Viaje.create({ owner, codigo: cod, bodega, clientes: [], estado: 'pendiente', valorFlete, anticipo,
    choferAsignado: chofer._id, integracion: { origen: 'translogistica', referencia: String(referencia), creado: new Date() } });

  try {
    await enviarNotificacionViajeAsignado(chofer.fcmToken || null, { _id: viaje._id, codigo: viaje.codigo, cantidadClientes: 0 });
  } catch { /* la notificación no bloquea la creación */ }

  res.status(201).json({ viajeId: String(viaje._id), codigo: viaje.codigo, estado: viaje.estado, chofer: presentarChofer(chofer) });
}));

// POST /api/integracion/viajes/:viajeId/finalizar → deja de rastrear: si no se había aceptado se elimina,
// si ya estaba en curso se marca completado. Solo afecta viajes creados por la integración.
router.post('/viajes/:viajeId/finalizar', seguro(async (req, res) => {
  const id = oid(req.params.viajeId);
  if (!id) return res.status(400).json({ mensaje: 'Viaje inválido' });
  const viaje = await Viaje.findOne({ _id: id, 'integracion.origen': 'translogistica' });
  if (!viaje) return res.status(404).json({ mensaje: 'Viaje de integración no encontrado' });
  if (viaje.estado === 'pendiente') {
    await viaje.deleteOne();
    return res.json({ viajeId: String(id), estado: 'eliminado' });
  }
  if (viaje.estado !== 'completado') {
    viaje.estado = 'completado';
    viaje.fechaCompletado = new Date();
    await viaje.save();
  }
  await db().collection('ubicacions').updateMany({ viajeId: String(id), activo: true }, { $set: { activo: false, fechaDetenido: new Date() } });
  res.json({ viajeId: String(id), estado: viaje.estado });
}));

module.exports = router;
