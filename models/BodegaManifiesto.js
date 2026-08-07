const mongoose = require('mongoose');

const bodegaManifiestoSchema = new mongoose.Schema({
  nombre: {
    type: String,
    required: true,
    trim: true,
    uppercase: true,
    unique: true,
  },
  nit: {
    type: String,
    trim: true,
    default: '',
  },
  activa: {
    type: Boolean,
    default: true,
  },
}, { timestamps: true });

module.exports = mongoose.model('BodegaManifiesto', bodegaManifiestoSchema);