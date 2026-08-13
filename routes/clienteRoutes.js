// routes/clienteRoutes.js
const express = require('express');
const router  = express.Router();
const Cliente = require('../models/Cliente');
const Bodega  = require('../models/Bodega');

// Montado con `protect` en server.js → req.user disponible.
//
// Reglas de acceso:
// - admin: ve/gestiona clientes de CUALQUIER bodega.
// - jefeBodega: ve/gestiona SOLO los clientes de su bodega asignada (user.bodegaId),
//   sin importar quién los creó (owner).
// - resto de roles (coordLogistico, etc.): siguen aislados por owner = req.user._id.

// Helper: arma el filtro de lectura según el rol del usuario logueado
const filtroPorRol = (req, extra = {}) => {
  if (req.user.role === 'admin') {
    return { ...extra };
  }
  if (req.user.role === 'jefeBodega') {
    if (!req.user.bodegaId) return { _id: null }; // sin bodega asignada → no ve nada
    return { ...extra, bodegaId: req.user.bodegaId };
  }
  return { ...extra, owner: req.user._id };
};

// Helper: valida que una bodega exista y sea accesible para el usuario
const bodegaAccesible = async (req, bodegaId) => {
  if (req.user.role === 'admin') {
    return Bodega.findById(bodegaId);
  }
  return Bodega.findOne({ _id: bodegaId, owner: req.user._id });
};

// ── GET / ─────────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { bodegaId, page = 1, limit = 50 } = req.query;
    const query = filtroPorRol(req, bodegaId ? { bodegaId } : {});

    const [clientes, total] = await Promise.all([
      Cliente.find(query)
        .populate('bodegaId', 'nombre direccion')
        .sort({ createdAt: -1 })
        .limit(parseInt(limit))
        .skip((parseInt(page) - 1) * parseInt(limit)),
      Cliente.countDocuments(query),
    ]);

    res.json({
      clientes,
      total,
      page:       parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit)),
    });
  } catch (error) {
    console.error('Error al obtener clientes:', error);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// ── GET /:id ──────────────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const query = filtroPorRol(req, { _id: req.params.id });
    const cliente = await Cliente.findOne(query)
      .populate('bodegaId', 'nombre direccion');
    if (!cliente) return res.status(404).json({ message: 'Cliente no encontrado' });
    res.json(cliente);
  } catch (error) {
    console.error('Error al obtener cliente:', error);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// ── POST / (carga masiva) ─────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const { clientes, bodegaId } = req.body;

    if (!clientes || !Array.isArray(clientes) || clientes.length === 0) {
      return res.status(400).json({ message: 'Se requiere un array de clientes' });
    }
    if (!bodegaId) {
      return res.status(400).json({ message: 'Se requiere el ID de la bodega' });
    }

    const bodegaExiste = await bodegaAccesible(req, bodegaId);
    if (!bodegaExiste) {
      return res.status(404).json({ message: 'La bodega especificada no existe' });
    }

    const clientesParaInsertar = clientes.map(d => ({
      owner:          bodegaExiste.owner,   // 👈 se hereda el owner de la bodega, no del usuario logueado
      bodegaId,
      nombre:         d.nombre         || null,
      nunFactura:     d.nunFactura      || null,
      numeroPlanilla: d.numeroPlanilla  || null,
      apellido:       d.apellido        || null,
      cedula:         d.cedula          || null,
      telefono:       d.telefono        || null,
      email:          d.email           || null,
      ciudad:         d.ciudad          || null,
      departamento:   d.departamento    || null,
      direccion:      d.direccion       || null,
      pago:           d.pago            || null,
      valorARecibir:  d.valorARecibir   ? Number(d.valorARecibir) : null,
      plazoDias:      d.plazoDias       ? Number(d.plazoDias)     : null,
      pesoKg:         d.pesoKg          ? Number(d.pesoKg)        : null,
      tipoFactura:    d.tipoFactura     || 'contado',
      codigoViaje:    d.codigoViaje     || null,
      estadoViaje:    d.estadoViaje     || 'pendiente',
    }));

    const clientesInsertados = await Cliente.insertMany(clientesParaInsertar);
    res.status(201).json({
      message:           `${clientesInsertados.length} clientes creados exitosamente`,
      cantidadInsertada: clientesInsertados.length,
      clientes:          clientesInsertados,
    });
  } catch (error) {
    console.error('Error al crear clientes:', error);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// ── POST /individual (formulario manual desde Bodegas.js) ────────────────────
router.post('/individual', async (req, res) => {
  try {
    const { bodegaId, ...d } = req.body;

    if (!bodegaId) {
      return res.status(400).json({ message: 'Se requiere bodegaId' });
    }

    const bodegaExiste = await bodegaAccesible(req, bodegaId);
    if (!bodegaExiste) {
      return res.status(404).json({ message: 'La bodega especificada no existe' });
    }

    if (!d.nombre || !String(d.nombre).trim()) {
      return res.status(400).json({ message: 'El nombre es obligatorio' });
    }
    if (!d.nunFactura || !String(d.nunFactura).trim()) {
      return res.status(400).json({ message: 'El número de factura es obligatorio' });
    }
    if (d.tipoFactura === 'contado' && !d.valorARecibir) {
      return res.status(400).json({ message: 'Para facturas de contado se requiere el valor a recibir' });
    }
    if (d.tipoFactura === 'credito' && !d.plazoDias) {
      return res.status(400).json({ message: 'Para facturas de crédito se requiere el plazo en días' });
    }

    const nuevoCliente = new Cliente({
      owner:         bodegaExiste.owner,   // 👈 igual aquí
      bodegaId,
      nombre:        String(d.nombre).trim(),
      nunFactura:    String(d.nunFactura).trim(),
      numeroPlanilla: d.numeroPlanilla ? String(d.numeroPlanilla).trim() : null,
      apellido:      d.apellido       || null,
      cedula:        d.cedula         || null,
      telefono:      d.telefono       || null,
      email:         d.email          || null,
      ciudad:        d.ciudad         || null,
      departamento:  d.departamento   || null,
      direccion:     d.direccion      || null,
      pago:          d.pago           || null,
      valorARecibir: d.valorARecibir  ? Number(d.valorARecibir) : null,
      plazoDias:     d.plazoDias      ? Number(d.plazoDias)     : null,
      pesoKg:        d.pesoKg         ? Number(d.pesoKg)        : null,
      tipoFactura:   d.tipoFactura    || 'contado',
      codigoViaje:   null,
      estadoViaje:   'pendiente',
    });

    const guardado = await nuevoCliente.save();
    await guardado.populate('bodegaId', 'nombre direccion');
    res.status(201).json(guardado);
  } catch (error) {
    console.error('Error al crear cliente:', error);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// ── PUT /:id ──────────────────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    const { bodegaId, ...d } = req.body;
    const updateData = {};

    if (bodegaId) {
      const bodegaExiste = await bodegaAccesible(req, bodegaId);
      if (!bodegaExiste) {
        return res.status(404).json({ message: 'La bodega especificada no existe' });
      }
      updateData.bodegaId = bodegaId;
    }

    const camposPermitidos = [
      'nombre', 'nunFactura', 'numeroPlanilla',
      'apellido', 'cedula', 'telefono', 'email',
      'ciudad', 'departamento', 'direccion', 'pago',
      'valorARecibir', 'plazoDias', 'pesoKg',
      'tipoFactura', 'codigoViaje', 'estadoViaje',
    ];

    camposPermitidos.forEach(campo => {
      if (d[campo] !== undefined) {
        if (['valorARecibir', 'plazoDias', 'pesoKg'].includes(campo) && d[campo] !== null) {
          updateData[campo] = Number(d[campo]);
        } else {
          updateData[campo] = d[campo];
        }
      }
    });

    const query = filtroPorRol(req, { _id: req.params.id });
    const clienteActualizado = await Cliente.findOneAndUpdate(
      query,
      updateData,
      { new: true, runValidators: true }
    ).populate('bodegaId', 'nombre direccion');

    if (!clienteActualizado) {
      return res.status(404).json({ message: 'Cliente no encontrado' });
    }
    res.json(clienteActualizado);
  } catch (error) {
    console.error('Error al actualizar cliente:', error);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// ── DELETE /:id ───────────────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const query = filtroPorRol(req, { _id: req.params.id });
    const clienteEliminado = await Cliente.findOneAndDelete(query);
    if (!clienteEliminado) {
      return res.status(404).json({ message: 'Cliente no encontrado' });
    }
    res.json({ message: 'Cliente eliminado exitosamente' });
  } catch (error) {
    console.error('Error al eliminar cliente:', error);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// ── DELETE /bodega/:bodegaId ──────────────────────────────────────────────────
router.delete('/bodega/:bodegaId', async (req, res) => {
  try {
    const query = filtroPorRol(req, { bodegaId: req.params.bodegaId });
    const resultado = await Cliente.deleteMany(query);
    res.json({
      message:           `${resultado.deletedCount} clientes eliminados exitosamente`,
      cantidadEliminada: resultado.deletedCount,
    });
  } catch (error) {
    console.error('Error al eliminar clientes:', error);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

module.exports = router;