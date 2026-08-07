//models/Bodega.js

const mongoose = require('mongoose');

const BodegaSchema = new mongoose.Schema({
  // Usuario propietario: cada bodega pertenece al usuario que la creó.
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  nombre: { type: String, required: true },
  direccion: { type: String, required: true },
}, { timestamps: true });

// Un mismo usuario no puede repetir el nombre de bodega, pero dos usuarios sí.
BodegaSchema.index({ owner: 1, nombre: 1 }, { unique: true });

module.exports = mongoose.model('Bodega', BodegaSchema);
