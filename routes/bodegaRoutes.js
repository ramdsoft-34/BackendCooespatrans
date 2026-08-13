//routes/bodegaRoutes.js
const express = require('express');
const router = express.Router();
const Bodega = require('../models/Bodega');

// NOTA: este router se monta con `protect` en server.js, por lo que
// req.user siempre está disponible. Todas las consultas se filtran por
// el propietario (owner = req.user._id) para aislar la información de cada usuario.

router.get('/con-clientes', async (req, res) => {
  try {
    const { fecha } = req.query;
    if (!fecha) {
      return res.status(400).json({ message: 'Debe proporcionar una fecha en formato YYYY-MM-DD' });
    }

    const inicioDelDia = new Date(`${fecha}T00:00:00.000Z`);
    const finDelDia = new Date(`${fecha}T23:59:59.999Z`);

    const Cliente = require('../models/Cliente');
    const clientes = await Cliente.find({
      owner: req.user._id,
      fecha: { $gte: inicioDelDia, $lte: finDelDia }
    }).populate('bodegaId', 'nombre direccion');

    const bodegasConClientes = {};
    clientes.forEach(cliente => {
      if (cliente.bodegaId) {
        const bodegaId = cliente.bodegaId._id.toString();
        if (!bodegasConClientes[bodegaId]) {
          bodegasConClientes[bodegaId] = { bodega: cliente.bodegaId, clientes: [] };
        }
        bodegasConClientes[bodegaId].clientes.push(cliente);
      }
    });

    res.json(Object.values(bodegasConClientes));
  } catch (error) {
    console.error('Error al obtener bodegas con clientes:', error);
    res.status(500).json({ message: 'Error del servidor', error: error.message });
  }
});

// POST - crear bodega (asociada al usuario)
router.post('/', async (req, res) => {
  try {
    const { nombre, direccion } = req.body;
    if (!nombre || !direccion) {
      return res.status(400).json({ message: 'Nombre y dirección son requeridos' });
    }

    const bodegaExistente = await Bodega.findOne({
      owner: req.user._id,
      nombre: { $regex: new RegExp(`^${nombre}$`, 'i') }
    });
    if (bodegaExistente) {
      return res.status(400).json({ message: 'Ya existe una bodega con ese nombre' });
    }

    const nuevaBodega = new Bodega({
      owner: req.user._id,
      nombre: nombre.trim(),
      direccion: direccion.trim()
    });
    const bodegaGuardada = await nuevaBodega.save();
    res.status(201).json(bodegaGuardada);
  } catch (error) {
    console.error('Error al crear bodega:', error);
    res.status(500).json({ message: 'Error del servidor', error: error.message });
  }
});

// GET - bodegas: el admin ve TODAS, el resto solo las suyas
router.get('/', async (req, res) => {
  try {
    const filtro = req.user.role === 'admin' ? {} : { owner: req.user._id };
    const bodegas = await Bodega.find(filtro).sort({ createdAt: -1 });
    res.json(bodegas);
  } catch (error) {
    console.error('Error al obtener bodegas:', error);
    res.status(500).json({ message: 'Error del servidor', error: error.message });
  }
});

// GET - una bodega por ID (el admin puede ver cualquiera)
router.get('/:id', async (req, res) => {
  try {
    const filtro = req.user.role === 'admin'
      ? { _id: req.params.id }
      : { _id: req.params.id, owner: req.user._id };
    const bodega = await Bodega.findOne(filtro);
    if (!bodega) return res.status(404).json({ message: 'Bodega no encontrada' });
    res.json(bodega);
  } catch (error) {
    console.error('Error al obtener bodega:', error);
    res.status(500).json({ message: 'Error del servidor', error: error.message });
  }
});

// PUT - actualizar bodega (el admin puede editar cualquiera)
router.put('/:id', async (req, res) => {
  try {
    const { nombre, direccion } = req.body;
    if (!nombre || !direccion) {
      return res.status(400).json({ message: 'Nombre y dirección son requeridos' });
    }

    const filtro = req.user.role === 'admin'
      ? { _id: req.params.id }
      : { _id: req.params.id, owner: req.user._id };

    const bodegaActualizada = await Bodega.findOneAndUpdate(
      filtro,
      { nombre: nombre.trim(), direccion: direccion.trim() },
      { new: true, runValidators: true }
    );
    if (!bodegaActualizada) return res.status(404).json({ message: 'Bodega no encontrada' });
    res.json(bodegaActualizada);
  } catch (error) {
    console.error('Error al actualizar bodega:', error);
    res.status(500).json({ message: 'Error del servidor', error: error.message });
  }
});

// DELETE - eliminar bodega (el admin puede eliminar cualquiera)
router.delete('/:id', async (req, res) => {
  try {
    const filtro = req.user.role === 'admin'
      ? { _id: req.params.id }
      : { _id: req.params.id, owner: req.user._id };

    const bodega = await Bodega.findOne(filtro);
    if (!bodega) return res.status(404).json({ message: 'Bodega no encontrada' });

    const Cliente = require('../models/Cliente');
    const clientesAsociados = await Cliente.countDocuments({ bodegaId: req.params.id });
    if (clientesAsociados > 0) {
      return res.status(400).json({
        message: `No se puede eliminar la bodega. Tiene ${clientesAsociados} cliente(s) asociado(s).`
      });
    }

    await Bodega.deleteOne(filtro);
    res.json({ message: 'Bodega eliminada exitosamente' });
  } catch (error) {
    console.error('Error al eliminar bodega:', error);
    res.status(500).json({ message: 'Error del servidor', error: error.message });
  }
});

module.exports = router;
