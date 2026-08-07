const SedeConfig = require('../models/SedeConfig');
const { SEDES_VALIDAS } = SedeConfig;

// Crea automáticamente los documentos de sedes que falten (todas activas por defecto)
const ensureDefaults = async () => {
  const existentes = await SedeConfig.find();
  const nombresExistentes = existentes.map((s) => s.nombre);
  const faltantes = SEDES_VALIDAS.filter((n) => !nombresExistentes.includes(n));
  if (faltantes.length) {
    await SedeConfig.insertMany(faltantes.map((nombre) => ({ nombre, activa: true })));
  }
  return SedeConfig.find().sort({ nombre: 1 });
};

// ── GET /api/sede-config ───────────────────────────────────────────────────
exports.getAll = async (req, res) => {
  try {
    const sedes = await ensureDefaults();
    res.json(sedes);
  } catch (err) {
    console.error('[getAll sedeConfig]', err);
    res.status(500).json({ message: 'Error al obtener configuración de sedes', error: err.message });
  }
};

// ── PATCH /api/sede-config/:nombre/toggle ──────────────────────────────────
exports.toggle = async (req, res) => {
  try {
    const { nombre } = req.params;
    if (!SEDES_VALIDAS.includes(nombre))
      return res.status(400).json({ message: 'Sede inválida' });

    await ensureDefaults();
    const doc = await SedeConfig.findOne({ nombre });
    doc.activa = !doc.activa;
    doc.actualizadoPor = req.user._id;
    await doc.save();

    res.json(doc);
  } catch (err) {
    console.error('[toggle sedeConfig]', err);
    res.status(500).json({ message: 'Error al actualizar sede', error: err.message });
  }
};