// models/VehiculoManifiesto.js
const mongoose = require('mongoose');

const vehiculoManifiestoSchema = new mongoose.Schema({
    placa: {
        type: String,
        required: true,
        unique: false,
        trim: true,
        uppercase: true,
    },
    nombreConductor: {
        type: String,
        required: true,
        trim: true,
        uppercase: true,
    },
    cedulaConductor: {
        type: String,
        required: true,
        trim: true,
    },
    nombreTitular: {
        type: String,
        required: true,
        trim: true,
        uppercase: true,
    },
    cedulaTitular: {
        type: String,
        required: true,
        trim: true,
    },
    capacidadToneladas: {
        type: Number,
        default: null,
        min: 0,
    },
    activo: {
        type: Boolean,
        default: true,
    },
}, { timestamps: true });

vehiculoManifiestoSchema.index({ placa: 1 });
vehiculoManifiestoSchema.index({ nombreConductor: 1 });

module.exports = mongoose.model('VehiculoManifiesto', vehiculoManifiestoSchema);