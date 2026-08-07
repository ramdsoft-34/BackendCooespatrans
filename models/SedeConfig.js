const mongoose = require('mongoose');

const SEDES_VALIDAS = ['Pitalito', 'Neiva', 'Pasto'];

const sedeConfigSchema = new mongoose.Schema(
  {
    nombre: {
      type: String,
      enum: SEDES_VALIDAS,
      required: true,
      unique: true,
    },
    activa: {
      type: Boolean,
      default: true,
    },
    actualizadoPor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('SedeConfig', sedeConfigSchema);
module.exports.SEDES_VALIDAS = SEDES_VALIDAS;