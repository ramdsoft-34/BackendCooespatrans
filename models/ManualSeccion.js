// models/ManualSeccion.js
//
// Manual de usuario interactivo — DOS manuales completamente separados,
// distinguidos por el campo `tipo`:
//   - 'web'  -> Manual del Coordinador Logístico (uso de la página web)
//   - 'app'  -> Manual de Conductores/Choferes (uso de la app móvil)
//
// Nunca se listan juntos: cada consulta (pública o de admin) filtra
// siempre por `tipo`, para que el contenido de uno no se mezcle con el
// del otro en ninguna pantalla.
//
// Cada "sección" es una categoría del manual (ej: "Crear un viaje"), y
// contiene varios "pasos" en orden. Un paso puede traer video, imagen, o
// solo texto (tipoMedia lo indica) — los pasos van embebidos porque
// siempre se leen/editan junto con su sección.

const mongoose = require('mongoose');

const pasoSchema = new mongoose.Schema({
  titulo: { type: String, required: true },        // ej: "1. Selecciona la bodega"
  instruccion: { type: String, required: true },   // texto claro y corto
  tipoMedia: { type: String, enum: ['video', 'imagen', 'ninguno'], default: 'ninguno' },
  videoUrl: { type: String, default: null },        // /uploads/manual/xxx.mp4
  imagenUrl: { type: String, default: null },       // /uploads/manual/xxx.jpg
  duracionSegundos: { type: Number, default: 0 },
  orden: { type: Number, default: 0 },
});

const manualSeccionSchema = new mongoose.Schema({
  // A qué manual pertenece — NUNCA se mezclan en una misma consulta.
  tipo: { type: String, enum: ['web', 'app'], required: true, index: true },

  titulo: { type: String, required: true },         // ej: "Crear un viaje"
  icono: { type: String, default: 'BookOpen' },      // nombre de ícono lucide-react
  descripcion: { type: String, default: '' },        // subtítulo corto de la sección
  orden: { type: Number, default: 0 },
  activa: { type: Boolean, default: true },
  pasos: { type: [pasoSchema], default: [] },
}, { timestamps: true });

manualSeccionSchema.index({ tipo: 1, orden: 1 });

module.exports = mongoose.model('ManualSeccion', manualSeccionSchema);
