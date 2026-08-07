// routes/clienteRoutes.js
const express = require('express');
const router  = express.Router();
const Cliente = require('../models/Cliente');
const Bodega  = require('../models/Bodega');

// Montado con `protect` en server.js → req.user disponible.
// Todo se filtra/estampa por owner = req.user._id (aislamiento por usuario).

// ── GET / ─────────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { bodegaId, page = 1, limit = 50 } = req.query;
    const query = { owner: req.user._id };
    if (bodegaId) query.bodegaId = bodegaId;

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
    const cliente = await Cliente.findOne({ _id: req.params.id, owner: req.user._id })
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

    const bodegaExiste = await Bodega.findOne({ _id: bodegaId, owner: req.user._id });
    if (!bodegaExiste) {
      return res.status(404).json({ message: 'La bodega especificada no existe' });
    }

    const clientesParaInsertar = clientes.map(d => ({
      owner:          req.user._id,
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
// El cliente creado manualmente se asocia a la planilla (numeroPlanilla) en la
// que el admin se encuentra posicionado dentro de la bodega. Si no se envía,
// queda sin planilla (null).
router.post('/individual', async (req, res) => {
  try {
    const { bodegaId, ...d } = req.body;

    if (!bodegaId) {
      return res.status(400).json({ message: 'Se requiere bodegaId' });
    }

    const bodegaExiste = await Bodega.findOne({ _id: bodegaId, owner: req.user._id });
    if (!bodegaExiste) {
      return res.status(404).json({ message: 'La bodega especificada no existe' });
    }

    // ── Validaciones obligatorias ────────────────────────────────────────────
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
      owner:         req.user._id,
      bodegaId,
      nombre:        String(d.nombre).trim(),
      nunFactura:    String(d.nunFactura).trim(),
      // Se asocia a la planilla en la que se encuentra el admin (si aplica).
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
      // Si se cambia de bodega, la nueva debe pertenecer al usuario.
      const bodegaExiste = await Bodega.findOne({ _id: bodegaId, owner: req.user._id });
      if (!bodegaExiste) {
        return res.status(404).json({ message: 'La bodega especificada no existe' });
      }
      updateData.bodegaId = bodegaId;
    }

    const camposPermitidos = [
      'nombre', 'nunFactura', 'numeroPlanilla',   // ← numeroPlanilla editable
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

    const clienteActualizado = await Cliente.findOneAndUpdate(
      { _id: req.params.id, owner: req.user._id },
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
    const clienteEliminado = await Cliente.findOneAndDelete({
      _id: req.params.id, owner: req.user._id
    });
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
    const resultado = await Cliente.deleteMany({
      bodegaId: req.params.bodegaId, owner: req.user._id
    });
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
