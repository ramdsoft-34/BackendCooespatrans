// routes/viajeRoutes.js
const express = require('express');
const router = express.Router();
const Viaje = require('../models/Viaje');
const Cliente = require('../models/Cliente');
const mongoose = require('mongoose');
const { generarRutaParaViaje } = require('../services/rutaService');
const Bodega = require('../models/Bodega');
const { enviarNotificacionViajeAsignado } = require('../services/notificacionService'); // 🆕 Paso 12
const { protect } = require('../controllers/authController');

// ─────────────────────────────────────────────────────────────
// FUNCIÓN AUXILIAR: buscar información del chofer
// ─────────────────────────────────────────────────────────────
const buscarChoferInfo = async (choferId) => {
  if (!choferId) return null;
  try {
    const db = mongoose.connection.db;
    const colecciones = ['choferes', 'chofers', 'drivers', 'Chofer', 'Choferes'];
    for (const nombre of colecciones) {
      const col = db.collection(nombre);
      const chofer = await col.findOne({ _id: choferId });
      if (chofer) {
        return {
          _id: chofer._id,
          nombre: chofer.nombre || chofer.name || chofer.fullName || 'Sin nombre',
          telefono: chofer.telefono || chofer.phone || chofer.tel || 'Sin teléfono',
          placa: chofer.placa || chofer.vehiclePlate || chofer.plate || chofer.vehiculo?.placa || 'Sin placa',
          email: chofer.email || chofer.correo || 'Sin email'
        };
      }
    }
    return null;
  } catch {
    return null;
  }
};

// ─────────────────────────────────────────────────────────────
// GET /api/choferes/disponibles
// ─────────────────────────────────────────────────────────────
router.get('/choferes/disponibles', async (req, res) => {
  try {
    const db = mongoose.connection.db;
    const colecciones = ['choferes', 'chofers', 'drivers', 'Chofer', 'Choferes'];
    let choferes = [];
    for (const nombre of colecciones) {
      try {
        const col = db.collection(nombre);
        const count = await col.countDocuments();
        if (count > 0) {
          choferes = await col.find({}).toArray();
          break;
        }
      } catch { }
    }

    const viajesActivos = await Viaje.find({
      estado: { $in: ['pendiente', 'aceptado'] },
      choferAsignado: { $ne: null }
    }).select('choferAsignado estado codigo');

    const choferesEnViaje = new Map();
    viajesActivos.forEach(v => {
      choferesEnViaje.set(v.choferAsignado.toString(), {
        viajeId: v._id,
        codigoViaje: v.codigo,
        estadoViaje: v.estado
      });
    });

    const resultado = choferes.map(c => {
      const idStr = c._id.toString();
      const enViaje = choferesEnViaje.get(idStr);
      return {
        _id: c._id,
        nombre: c.nombre || c.name || c.fullName || 'Sin nombre',
        telefono: c.telefono || c.phone || '',
        placa: c.placa || c.vehiclePlate || c.vehiculo?.placa || '',
        email: c.email || c.correo || '',
        activo: c.activo !== false,
        disponible: !enViaje,
        viajeActual: enViaje || null
      };
    });

    res.json({ success: true, choferes: resultado });
  } catch (error) {
    console.error('Error al obtener choferes disponibles:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/viajes/crear
// ─────────────────────────────────────────────────────────────
router.post('/crear', protect, async (req, res) => {
  try {
    const { bodegaId, clientes: clienteIds, valorFlete, anticipo, numeroPlanilla, choferId } = req.body;

    // Mismo tope que en el panel (Bodegas.js): evita valores absurdos que
    // luego rompen el formato en cascada en la app y en el reporte PDF.
    const MAX_VALOR_FLETE = 999999999999;

    if (!numeroPlanilla || numeroPlanilla.trim() === '')
      return res.status(400).json({ mensaje: 'El número de planilla es requerido' });
    if (!valorFlete || valorFlete <= 0)
      return res.status(400).json({ mensaje: 'El valor del flete debe ser mayor a 0' });
    if (Number(valorFlete) > MAX_VALOR_FLETE)
      return res.status(400).json({ mensaje: 'El valor del flete es demasiado grande' });
    const anticipoNumerico = anticipo !== undefined && anticipo !== null && anticipo !== ''
      ? Number(anticipo)
      : 0;
    if (Number.isNaN(anticipoNumerico) || anticipoNumerico < 0)
      return res.status(400).json({ mensaje: 'El anticipo debe ser un valor válido mayor o igual a 0' });
    if (anticipoNumerico > Number(valorFlete))
      return res.status(400).json({ mensaje: 'El anticipo no puede ser mayor al valor del flete' });
    if (!choferId)
      return res.status(400).json({ mensaje: 'Debes asignar un conductor al viaje' });

    const viajeExistenteConductor = await Viaje.findOne({
      choferAsignado: choferId,
      estado: { $in: ['pendiente', 'aceptado'] }
    });
    if (viajeExistenteConductor)
      return res.status(400).json({
        mensaje: 'Este conductor ya tiene un viaje activo',
        codigoViaje: viajeExistenteConductor.codigo
      });

    const viajeExistente = await Viaje.findOne({ owner: req.user._id, codigo: numeroPlanilla.trim() });
    if (viajeExistente)
      return res.status(400).json({
        mensaje: 'Ya existe un viaje con este número de planilla',
        codigo: numeroPlanilla.trim()
      });

    // ── Generar ruta ──────────────────────────────────────────
    let rutaGuardada = null;

    console.log('\n[viajeRoutes] ══════════════════════════════════════');
    console.log(`[viajeRoutes] Creando viaje: código="${numeroPlanilla}", bodegaId=${bodegaId}, choferId=${choferId}`);
    console.log(`[viajeRoutes] clienteIds recibidos (${clienteIds?.length}):`, clienteIds);

    try {
      // ── Validar inputs antes de buscar en DB ─────────────────
      if (!bodegaId) {
        console.error('[viajeRoutes] ❌ bodegaId no fue enviado en el body');
        throw new Error('bodegaId es requerido para generar la ruta');
      }
      if (!clienteIds || clienteIds.length === 0) {
        console.error('[viajeRoutes] ❌ clienteIds vacío o no enviado');
        throw new Error('clienteIds es requerido para generar la ruta');
      }

      // ── Buscar bodega ─────────────────────────────────────────
      console.log('[viajeRoutes] Buscando bodega en DB...');
      const bodega = await Bodega.findOne({ _id: bodegaId, owner: req.user._id });

      if (!bodega) {
        console.error(`[viajeRoutes] ❌ Bodega no encontrada con ID: ${bodegaId}`);
        throw new Error(`Bodega con ID ${bodegaId} no existe en la base de datos`);
      }
      console.log(`[viajeRoutes] ✅ Bodega encontrada: "${bodega.nombre}" | dirección: "${bodega.direccion}"`);
      console.log('[viajeRoutes]    Campos de bodega:', Object.keys(bodega.toObject()));

      if (!bodega.direccion) {
        console.error(`[viajeRoutes] ❌ Bodega "${bodega.nombre}" existe pero NO tiene campo "direccion"`);
        throw new Error(`La bodega "${bodega.nombre}" no tiene dirección registrada`);
      }

      // ── Buscar clientes ───────────────────────────────────────
      console.log('[viajeRoutes] Buscando clientes en DB...');
      const clientes = await Cliente.find({ _id: { $in: clienteIds }, owner: req.user._id })
        .select('_id nombre apellido direccion telefono');

      console.log(`[viajeRoutes] Clientes encontrados en DB: ${clientes.length}/${clienteIds.length}`);

      if (clientes.length === 0) {
        console.error('[viajeRoutes] ❌ Ningún cliente encontrado para los IDs proporcionados');
        throw new Error('No se encontraron clientes con los IDs proporcionados');
      }

      // Mostrar detalle de cada cliente
      clientes.forEach((c, i) => {
        const tieneDir = !!c.direccion;
        const logFn = tieneDir ? console.log : console.warn;
        logFn(
          `[viajeRoutes]   Cliente ${i + 1}: "${c.nombre} ${c.apellido || ''}" | ` +
          `dir: "${c.direccion || 'SIN DIRECCIÓN'}" | ` +
          `campos: ${Object.keys(c.toObject()).join(', ')}`
        );
      });

      const sinDireccion = clientes.filter(c => !c.direccion);
      if (sinDireccion.length > 0) {
        console.warn(
          `[viajeRoutes] ⚠️  ${sinDireccion.length} cliente(s) sin dirección (se omitirán del cálculo):`,
          sinDireccion.map(c => ({ _id: c._id, nombre: c.nombre }))
        );
      }
      if (sinDireccion.length === clientes.length) {
        console.error('[viajeRoutes] ❌ TODOS los clientes están sin dirección — imposible calcular ruta');
        throw new Error('Ningún cliente tiene dirección registrada');
      }

      // ── Llamar al servicio de ruta ────────────────────────────
      console.log('[viajeRoutes] Llamando a generarRutaParaViaje...');
      const ruta = await generarRutaParaViaje(bodega, clientes);

      if (!ruta) {
        console.error('[viajeRoutes] ❌ generarRutaParaViaje retornó null — ver logs de rutaService arriba');
        throw new Error('El servicio de rutas retornó null (ver logs de rutaService)');
      }

      // ── Validar resultado de la ruta ──────────────────────────
      console.log('[viajeRoutes] Validando resultado de la ruta...');

      if (!ruta.coordenadas || ruta.coordenadas.length === 0) {
        console.error('[viajeRoutes] ❌ La ruta retornada no tiene coordenadas');
        throw new Error('Ruta inválida: sin coordenadas');
      }

      rutaGuardada = {
        coordenadas:      ruta.coordenadas,
        ordenClientes:    ruta.ordenClientes,
        distanciaTotal:   ruta.distanciaTotal,
        duracionEstimada: ruta.duracionEstimada,
        generadaEn:       new Date(),
      };

      console.log(
        `[viajeRoutes] ✅ rutaGuardada lista para persistir: ` +
        `${rutaGuardada.coordenadas.length} coords, ` +
        `${(rutaGuardada.distanciaTotal / 1000).toFixed(2)} km, ` +
        `~${Math.round(rutaGuardada.duracionEstimada / 60)} min`
      );

    } catch (rutaError) {
      // Error completo con stack para facilitar el debug
      console.error('[viajeRoutes] ❌ ERROR en bloque de generación de ruta:');
      console.error('[viajeRoutes]    Mensaje:', rutaError.message);
      console.error('[viajeRoutes]    Stack:', rutaError.stack);
      console.warn('[viajeRoutes] ⚠️  El viaje se creará SIN ruta guardada');
      // rutaGuardada permanece null → viaje se crea igual
    }

    // ── Crear el viaje ────────────────────────────────────────
    console.log(`[viajeRoutes] Guardando viaje en DB (rutaGuardada: ${rutaGuardada ? 'SÍ' : 'NO (null)'})`);

    const nuevoViaje = new Viaje({
      owner:         req.user._id,
      codigo:        numeroPlanilla.trim(),
      bodega:        bodegaId,
      clientes:      clienteIds,
      estado:        'pendiente',
      valorFlete:    Number(valorFlete),
      anticipo:      anticipoNumerico,
      choferAsignado: choferId,
      rutaGuardada,
    });

    await nuevoViaje.save();

    // ── 🆕 Enviar notificación FCM al conductor (Paso 12) ─────
    try {
      // Buscar el FCM token del conductor en la colección de choferes
      const db = mongoose.connection.db;
      const colecciones = ['choferes', 'chofers', 'drivers', 'Chofer', 'Choferes'];
      let fcmToken = null;

      for (const nombre of colecciones) {
        const col = db.collection(nombre);
        const chofer = await col.findOne({ _id: new mongoose.Types.ObjectId(choferId) });
        if (chofer) {
          fcmToken = chofer.fcmToken || null;
          break;
        }
      }

      await enviarNotificacionViajeAsignado(fcmToken, {
        _id: nuevoViaje._id,
        codigo: nuevoViaje.codigo,
        cantidadClientes: clienteIds?.length || 0,
      });
    } catch (fcmError) {
      // Error de notificación no debe bloquear la creación del viaje
      console.warn('[viajeRoutes] ⚠️ Error al enviar notificación FCM:', fcmError.message);
    }
    // ──────────────────────────────────────────────────────────

    // Confirmar que se guardó con ruta
    const viajeGuardado = await Viaje.findOne({ owner: req.user._id, codigo: numeroPlanilla.trim() })
      .select('codigo rutaGuardada');
    const tieneRuta = !!(viajeGuardado?.rutaGuardada?.coordenadas?.length);
    console.log(
      `[viajeRoutes] Viaje "${numeroPlanilla}" guardado en DB — ` +
      `rutaGuardada en DB: ${tieneRuta ? `✅ SÍ (${viajeGuardado.rutaGuardada.coordenadas.length} coords)` : '❌ NO'}`
    );
    console.log('[viajeRoutes] ══════════════════════════════════════\n');

    await Cliente.updateMany(
      { _id: { $in: clienteIds }, owner: req.user._id },
      { codigoViaje: numeroPlanilla.trim(), estadoViaje: 'asignado' }
    );

    res.json({
      mensaje: 'Viaje creado exitosamente',
      codigo:  numeroPlanilla.trim(),
      viaje:   nuevoViaje,
      rutaGenerada: !!rutaGuardada,
    });

  } catch (error) {
    console.error('[viajeRoutes] ❌ Error general al crear viaje:', error);
    res.status(500).json({ mensaje: 'Error al crear viaje', error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/viajes/ruta/:codigo
// ─────────────────────────────────────────────────────────────
router.get('/ruta/:codigo', protect, async (req, res) => {
  try {
    const viaje = await Viaje.findOne({ owner: req.user._id, codigo: req.params.codigo })
      .select('codigo rutaGuardada estado');

    if (!viaje)
      return res.status(404).json({ success: false, mensaje: 'Viaje no encontrado' });

    if (!viaje.rutaGuardada || !viaje.rutaGuardada.coordenadas?.length)
      return res.json({ success: true, rutaDisponible: false, mensaje: 'Sin ruta guardada' });

    res.json({
      success: true,
      rutaDisponible: true,
      codigo: viaje.codigo,
      estado: viaje.estado,
      ruta: {
        coordenadas:      viaje.rutaGuardada.coordenadas,
        ordenClientes:    viaje.rutaGuardada.ordenClientes,
        distanciaTotal:   viaje.rutaGuardada.distanciaTotal,
        duracionEstimada: viaje.rutaGuardada.duracionEstimada,
        generadaEn:       viaje.rutaGuardada.generadaEn,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/viajes/regenerar-ruta/:codigo
// ─────────────────────────────────────────────────────────────
router.post('/regenerar-ruta/:codigo', protect, async (req, res) => {
  const codigo = req.params.codigo;
  console.log(`\n[viajeRoutes] ══ regenerar-ruta: "${codigo}" ══`);

  try {
    const viaje = await Viaje.findOne({ owner: req.user._id, codigo })
      .populate('bodega', 'nombre direccion')
      .populate('clientes', '_id nombre apellido direccion');

    if (!viaje) {
      console.error(`[viajeRoutes] ❌ Viaje "${codigo}" no encontrado`);
      return res.status(404).json({ success: false, mensaje: 'Viaje no encontrado' });
    }

    console.log(`[viajeRoutes] Bodega: "${viaje.bodega?.nombre}" | dir: "${viaje.bodega?.direccion}"`);
    console.log(`[viajeRoutes] Clientes (${viaje.clientes?.length}):`,
      viaje.clientes?.map(c => ({ _id: c._id, nombre: c.nombre, direccion: c.direccion }))
    );

    if (!viaje.bodega?.direccion) {
      console.error('[viajeRoutes] ❌ Bodega sin dirección');
      return res.status(422).json({ success: false, mensaje: 'La bodega no tiene dirección registrada' });
    }

    const ruta = await generarRutaParaViaje(viaje.bodega, viaje.clientes);

    if (!ruta) {
      console.error('[viajeRoutes] ❌ generarRutaParaViaje retornó null');
      return res.status(422).json({ success: false, mensaje: 'No se pudo calcular la ruta (ver logs del servidor)' });
    }

    viaje.rutaGuardada = {
      coordenadas:      ruta.coordenadas,
      ordenClientes:    ruta.ordenClientes,
      distanciaTotal:   ruta.distanciaTotal,
      duracionEstimada: ruta.duracionEstimada,
      generadaEn:       new Date(),
    };
    await viaje.save();

    console.log(`[viajeRoutes] ✅ Ruta regenerada y guardada: ${ruta.coordenadas.length} coords`);
    console.log('[viajeRoutes] ══════════════════════════════════════\n');

    res.json({
      success: true,
      mensaje: 'Ruta regenerada exitosamente',
      ruta: viaje.rutaGuardada,
    });
  } catch (error) {
    console.error('[viajeRoutes] ❌ Error en regenerar-ruta:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────
// PUT /api/viajes/cambiar-conductor/:codigo
// ─────────────────────────────────────────────────────────────
router.put('/cambiar-conductor/:codigo', protect, async (req, res) => {
  try {
    const { codigo } = req.params;
    const { choferId } = req.body;

    if (!choferId) {
      return res.status(400).json({ error: 'choferId es requerido' });
    }

    const viaje = await Viaje.findOne({ owner: req.user._id, codigo });
    if (!viaje) {
      return res.status(404).json({ error: 'Viaje no encontrado' });
    }
    if (viaje.estado !== 'pendiente') {
      return res.status(400).json({
        error: 'No se puede cambiar el conductor: el viaje ya fue aceptado'
      });
    }

    const viajeExistenteConductor = await Viaje.findOne({
      choferAsignado: choferId,
      estado: { $in: ['pendiente', 'aceptado'] },
      codigo: { $ne: codigo }
    });
    if (viajeExistenteConductor) {
      return res.status(400).json({
        error: 'Este conductor ya tiene un viaje activo',
        codigoViaje: viajeExistenteConductor.codigo
      });
    }

    viaje.choferAsignado = choferId;
    await viaje.save();

    const choferInfo = await buscarChoferInfo(choferId);

    res.json({
      success: true,
      mensaje: 'Conductor actualizado correctamente',
      choferInfo
    });
  } catch (error) {
    console.error('Error al cambiar conductor:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/viajes/asignados/:choferId
// ─────────────────────────────────────────────────────────────
router.get('/asignados/:choferId', async (req, res) => {
  try {
    const { choferId } = req.params;

    const viajes = await Viaje.find({
      choferAsignado: choferId,
      estado: 'pendiente'
    })
      .populate('bodega', 'nombre direccion ciudad telefono')
      .populate('clientes')
      .sort({ fecha: -1 });

    const resultado = viajes.map(v => ({
      _id: v._id,
      codigo: v.codigo,
      estado: v.estado,
      fecha: v.fecha,
      valorFlete: v.valorFlete,
      anticipo: v.anticipo || 0,
      bodega: v.bodega,
      clientes: v.clientes,
      cantidadClientes: v.clientes?.length || 0,
      rutaGuardada: v.rutaGuardada?.coordenadas?.length > 0 ? {
        coordenadas:      v.rutaGuardada.coordenadas,
        ordenClientes:    v.rutaGuardada.ordenClientes,
        distanciaTotal:   v.rutaGuardada.distanciaTotal,
        duracionEstimada: v.rutaGuardada.duracionEstimada,
      } : null,
    }));

    res.json({ success: true, viajes: resultado });
  } catch (error) {
    console.error('Error al obtener viajes asignados:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/viajes/buscar/:codigo
// ─────────────────────────────────────────────────────────────
router.get('/buscar/:codigo', async (req, res) => {
  try {
    const viaje = await Viaje.findOne({ codigo: req.params.codigo })
      .populate('bodega')
      .populate('clientes');
    if (!viaje) return res.status(404).json({ mensaje: 'Número de planilla no encontrado' });
    if (viaje.choferAsignado) {
      const info = await buscarChoferInfo(viaje.choferAsignado);
      if (info) viaje._doc.choferInfo = info;
    }
    res.json(viaje);
  } catch (error) {
    console.error('[buscar viaje]', error);
    res.status(500).json({ mensaje: 'Error al buscar viaje' });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/viajes/
// ─────────────────────────────────────────────────────────────
router.get('/', protect, async (req, res) => {
  try {
    let filtro = {};

    if (req.user.role === 'jefeBodega') {
      // Ve los viajes de SU bodega, sin importar quién los creó
      if (!req.user.bodegaId) {
        return res.json([]); // no tiene bodega asignada
      }
      filtro = { bodega: req.user.bodegaId };
    } else if (req.user.role === 'admin') {
      // El admin ve todos los viajes
      filtro = {};
    } else {
      // Coordinador, sede, etc. siguen viendo solo lo suyo
      filtro = { owner: req.user._id };
    }

    const viajes = await Viaje.find(filtro)
      .populate('bodega', 'nombre direccion')
      .populate('clientes')
      .sort({ fecha: -1 });

    const viajesConChofer = await Promise.all(viajes.map(async v => {
      const obj = v.toObject();
      if (v.choferAsignado) {
        const info = await buscarChoferInfo(v.choferAsignado);
        if (info) obj.choferInfo = info;
      }
      return obj;
    }));

    res.json(viajesConChofer);
  } catch {
    res.status(500).json({ mensaje: 'Error al obtener viajes' });
  }
});

// ─────────────────────────────────────────────────────────────
// PUT /api/viajes/aceptar/:codigo
// ─────────────────────────────────────────────────────────────
router.put('/aceptar/:codigo', async (req, res) => {
  try {
    const { codigo } = req.params;
    const { choferId } = req.body;

    if (!choferId) return res.status(400).json({ error: 'choferId es requerido' });

    const viaje = await Viaje.findOneAndUpdate(
      { codigo, estado: 'pendiente', choferAsignado: choferId },
      { estado: 'aceptado', fechaAceptacion: new Date() },
      { new: true }
    ).populate('bodega').populate('clientes');

    if (!viaje) {
      return res.status(404).json({
        error: 'Viaje no encontrado, ya fue aceptado, o no te corresponde'
      });
    }

    const choferInfo = await buscarChoferInfo(choferId);
    res.json({ message: 'Viaje aceptado correctamente', viaje, choferInfo });
  } catch {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─────────────────────────────────────────────────────────────
// PUT /api/viajes/completar/:codigo
// ─────────────────────────────────────────────────────────────
router.put('/completar/:codigo', async (req, res) => {
  try {
    const { codigo } = req.params;
    const { estado } = req.body;
    if (estado !== 'completado') return res.status(400).json({ error: 'Estado inválido' });
    const viaje = await Viaje.findOneAndUpdate(
      { codigo, estado: { $in: ['aceptado', 'pendiente'] } },
      { estado: 'completado', fechaCompletado: new Date() },
      { new: true }
    ).populate('bodega').populate('clientes');
    if (!viaje) return res.status(404).json({ error: 'Viaje no encontrado o no puede completarse' });
    await Cliente.updateMany({ owner: viaje.owner, codigoViaje: codigo }, { estadoViaje: 'entregado' });
    const choferInfo = viaje.choferAsignado
      ? await buscarChoferInfo(viaje.choferAsignado)
      : null;
    res.json({ message: 'Viaje completado correctamente', viaje, choferInfo });
  } catch (error) {
    console.error('[completar viaje]', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─────────────────────────────────────────────────────────────
// PUT /api/viajes/estado/:codigo
// ─────────────────────────────────────────────────────────────
router.put('/estado/:codigo', protect, async (req, res) => {
  try {
    const { codigo } = req.params;
    const { estado } = req.body;

    const viaje = await Viaje.findOneAndUpdate(
      { owner: req.user._id, codigo }, { estado }, { new: true }
    ).populate('bodega').populate('clientes');

    if (!viaje) return res.status(404).json({ mensaje: 'Viaje no encontrado' });

    if (estado === 'completado') {
      await Cliente.updateMany({ owner: req.user._id, codigoViaje: codigo }, { estadoViaje: 'entregado' });
    }
    res.json({ mensaje: 'Estado actualizado', viaje });
  } catch {
    res.status(500).json({ mensaje: 'Error al actualizar estado' });
  }
});

// ─────────────────────────────────────────────────────────────
// DELETE /api/viajes/:codigo
// ─────────────────────────────────────────────────────────────
router.delete('/:codigo', protect, async (req, res) => {
  try {
    const { codigo } = req.params;
    await Cliente.updateMany({ owner: req.user._id, codigoViaje: codigo }, { codigoViaje: null, estadoViaje: 'pendiente' });
    await Viaje.deleteOne({ owner: req.user._id, codigo });
    res.json({ mensaje: 'Viaje cancelado y clientes liberados' });
  } catch {
    res.status(500).json({ mensaje: 'Error al cancelar viaje' });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/viajes/historial/:choferId
// ─────────────────────────────────────────────────────────────
router.get('/historial/:choferId', async (req, res) => {
  try {
    const { choferId } = req.params;
    const { estado, limite = 50, pagina = 1 } = req.query;

    const filtro = { choferAsignado: choferId };
    if (estado && estado !== 'todos') filtro.estado = estado;

    const skip = (parseInt(pagina) - 1) * parseInt(limite);
    const viajes = await Viaje.find(filtro)
      .populate('bodega', 'nombre direccion ciudad telefono')
      .populate('clientes')
      .sort({ fecha: -1 })
      .limit(parseInt(limite))
      .skip(skip);

    const totalViajes = await Viaje.countDocuments(filtro);
    const choferInfo = await buscarChoferInfo(choferId);

    const completados = await Viaje.find({ choferAsignado: choferId, estado: 'completado' }).select('valorFlete');
    const totalGanado = completados.reduce((s, v) => s + (v.valorFlete || 0), 0);

    const estadisticas = {
      total: totalViajes,
      completados: completados.length,
      enProgreso: await Viaje.countDocuments({ choferAsignado: choferId, estado: 'aceptado' }),
      pendientes:  await Viaje.countDocuments({ choferAsignado: choferId, estado: 'pendiente' }),
      totalGanado
    };

    res.json({
      success: true,
      choferInfo,
      estadisticas,
      viajes: viajes.map(v => ({
        _id: v._id,
        codigo: v.codigo,
        estado: v.estado,
        fecha: v.fecha,
        fechaAceptacion: v.fechaAceptacion,
        fechaCompletado: v.fechaCompletado,
        valorFlete: v.valorFlete,
        anticipo: v.anticipo || 0,
        bodega: {
          nombre:    v.bodega?.nombre    || 'Sin bodega',
          direccion: v.bodega?.direccion || 'Sin dirección',
          ciudad:    v.bodega?.ciudad    || 'Sin ciudad',
          telefono:  v.bodega?.telefono  || 'Sin teléfono'
        },
        cantidadClientes: v.clientes?.length || 0,
        clientes: v.clientes || []
      })),
      paginacion: {
        paginaActual:  parseInt(pagina),
        totalPaginas:  Math.ceil(totalViajes / parseInt(limite)),
        limite:        parseInt(limite),
        total:         totalViajes
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/viajes/historial/detalle/:viajeId
// ─────────────────────────────────────────────────────────────
router.get('/historial/detalle/:viajeId', async (req, res) => {
  try {
    const viaje = await Viaje.findById(req.params.viajeId).populate('bodega').populate('clientes');
    if (!viaje) return res.status(404).json({ success: false, mensaje: 'Viaje no encontrado' });

    const choferInfo = viaje.choferAsignado ? await buscarChoferInfo(viaje.choferAsignado) : null;

    const clientesStats = {
      total:        viaje.clientes?.length || 0,
      entregados:   viaje.clientes?.filter(c => c.estadoEntrega === 'completa').length || 0,
      parciales:    viaje.clientes?.filter(c => c.estadoEntrega === 'parcial').length || 0,
      devoluciones: viaje.clientes?.filter(c => c.estadoEntrega === 'devolucion').length || 0,
      pendientes:   viaje.clientes?.filter(c => c.estadoEntrega === 'pendiente').length || 0
    };

    res.json({ success: true, viaje, choferInfo, clientesStats });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/viajes/debug/choferes
// ─────────────────────────────────────────────────────────────
router.get('/debug/choferes', async (req, res) => {
  try {
    const db = mongoose.connection.db;
    const collections = await db.listCollections().toArray();
    const posibles = ['choferes', 'chofers', 'drivers', 'Chofer', 'Choferes'];
    let choferes = [], coleccionEncontrada = null;
    for (const n of posibles) {
      const col = db.collection(n);
      const count = await col.countDocuments();
      if (count > 0) { coleccionEncontrada = n; choferes = await col.find().limit(3).toArray(); break; }
    }
    res.json({
      coleccionesDisponibles: collections.map(c => c.name),
      coleccionChoferes: coleccionEncontrada,
      ejemploChoferes: choferes.map(c => ({ _id: c._id, campos: Object.keys(c) }))
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;