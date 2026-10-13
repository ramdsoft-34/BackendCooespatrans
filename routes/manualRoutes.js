// routes/manualRoutes.js
//
// DOS manuales separados por el campo `tipo` ('web' = Coordinador
// Logístico, 'app' = Conductores). Toda consulta filtra por `tipo` — nunca
// se devuelven secciones de los dos manuales mezcladas en una respuesta.
//
//   - GET  /api/manual?tipo=web|app        -> PÚBLICO, solo secciones activas
//   - GET  /api/manual/admin?tipo=web|app  -> admin, incluye inactivas
//   - Todo lo demás (crear/editar/borrar secciones y pasos, subir
//     video/imagen, reordenar) -> requiere estar logueado Y role === 'admin'.
//
// El archivo de cada paso (video o imagen) se sube con multer a
// /var/www/cooespatrans/uploads/manual/ y se guarda como ruta relativa
// "/uploads/manual/archivo.ext" — el frontend le antepone el dominio de la
// API al mostrarlo.

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const ManualSeccion = require('../models/ManualSeccion');
const { protect } = require('../controllers/authController');

const TIPOS_VALIDOS = ['web', 'app'];

function tipoValido(tipo) {
  return TIPOS_VALIDOS.includes(tipo);
}

// ─────────────────────────────────────────────
// Solo admin puede escribir. Se usa después de "protect" (que ya llena req.user).
// ─────────────────────────────────────────────
function soloAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Solo un administrador puede gestionar el manual' });
  }
  next();
}

// ─────────────────────────────────────────────
// Subida de video o imagen por paso (multer, mismo patrón que planillaRoutes.js)
// ─────────────────────────────────────────────
const uploadDir = '/var/www/cooespatrans/uploads/manual';
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `manual_${Date.now()}_${Math.round(Math.random() * 1e6)}${ext}`);
  },
});

const upload = multer({
  storage,
  // Videos cortos comprimidos para móvil: 60 MB da margen de sobra.
  limits: { fileSize: 60 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const permitidos = ['.mp4', '.mov', '.webm', '.jpg', '.jpeg', '.png', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (permitidos.includes(ext)) return cb(null, true);
    cb(new Error('Formato no permitido. Usa MP4, MOV, WEBM, JPG, PNG o WEBP'));
  },
});

const subirArchivo = (req, res, next) => {
  upload.single('archivo')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ message: 'El archivo supera el máximo permitido (60 MB).' });
    }
    return res.status(400).json({ message: err.message || 'Error al subir el archivo.' });
  });
};

const EXT_IMAGEN = ['.jpg', '.jpeg', '.png', '.webp'];

function armarCamposMedia(req) {
  if (!req.file) return {};
  const ext = path.extname(req.file.filename).toLowerCase();
  const url = `/uploads/manual/${req.file.filename}`;
  if (EXT_IMAGEN.includes(ext)) {
    return { tipoMedia: 'imagen', imagenUrl: url, videoUrl: null };
  }
  return { tipoMedia: 'video', videoUrl: url, imagenUrl: null };
}

function borrarArchivoDePaso(paso) {
  const ruta = paso.videoUrl || paso.imagenUrl;
  if (ruta) fs.unlink(path.join('/var/www/cooespatrans', ruta), () => {});
}

// ─────────────────────────────────────────────
// GET /api/manual?tipo=web|app  — PÚBLICO. Solo secciones activas de UN
// manual (tipo es obligatorio, para no mezclar nunca los dos contenidos).
// ─────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { tipo } = req.query;
    if (!tipoValido(tipo)) {
      return res.status(400).json({ success: false, message: 'tipo debe ser "web" o "app"' });
    }
    const secciones = await ManualSeccion.find({ tipo, activa: true })
      .sort({ orden: 1 })
      .lean();
    secciones.forEach((s) => {
      s.pasos = (s.pasos || []).sort((a, b) => a.orden - b.orden);
    });
    res.json({ success: true, tipo, secciones });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error al cargar el manual', error: error.message });
  }
});

// ─────────────────────────────────────────────
// GET /api/manual/admin?tipo=web|app — admin, incluye inactivas.
// ─────────────────────────────────────────────
router.get('/admin', protect, soloAdmin, async (req, res) => {
  try {
    const { tipo } = req.query;
    if (!tipoValido(tipo)) {
      return res.status(400).json({ success: false, message: 'tipo debe ser "web" o "app"' });
    }
    const secciones = await ManualSeccion.find({ tipo }).sort({ orden: 1 }).lean();
    secciones.forEach((s) => {
      s.pasos = (s.pasos || []).sort((a, b) => a.orden - b.orden);
    });
    res.json({ success: true, tipo, secciones });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error al cargar el manual', error: error.message });
  }
});

// ─────────────────────────────────────────────
// POST /api/manual/secciones — crear una sección nueva (vacía, sin pasos)
// Body JSON: { tipo, titulo, icono, descripcion, orden }
// ─────────────────────────────────────────────
router.post('/secciones', protect, soloAdmin, async (req, res) => {
  try {
    const { tipo, titulo, icono, descripcion, orden } = req.body;
    if (!tipoValido(tipo)) {
      return res.status(400).json({ success: false, message: 'tipo debe ser "web" o "app"' });
    }
    if (!titulo || !titulo.trim()) {
      return res.status(400).json({ success: false, message: 'El título es requerido' });
    }
    const seccion = await ManualSeccion.create({
      tipo,
      titulo: titulo.trim(),
      icono: icono || 'BookOpen',
      descripcion: descripcion || '',
      orden: Number.isFinite(Number(orden)) ? Number(orden) : 0,
    });
    res.status(201).json({ success: true, seccion });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error al crear la sección', error: error.message });
  }
});

// ─────────────────────────────────────────────
// PUT /api/manual/secciones/:id — editar datos generales de la sección
// ─────────────────────────────────────────────
router.put('/secciones/:id', protect, soloAdmin, async (req, res) => {
  try {
    const { titulo, icono, descripcion, orden, activa } = req.body;
    const seccion = await ManualSeccion.findById(req.params.id);
    if (!seccion) return res.status(404).json({ success: false, message: 'Sección no encontrada' });

    if (titulo !== undefined) seccion.titulo = titulo;
    if (icono !== undefined) seccion.icono = icono;
    if (descripcion !== undefined) seccion.descripcion = descripcion;
    if (orden !== undefined) seccion.orden = orden;
    if (activa !== undefined) seccion.activa = !!activa;
    // 🔒 "tipo" nunca se cambia por PUT: una sección no puede saltar de
    // manual — si se necesita, se borra y se crea de nuevo en el otro.

    await seccion.save();
    res.json({ success: true, seccion });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error al actualizar la sección', error: error.message });
  }
});

// ─────────────────────────────────────────────
// DELETE /api/manual/secciones/:id
// ─────────────────────────────────────────────
router.delete('/secciones/:id', protect, soloAdmin, async (req, res) => {
  try {
    const seccion = await ManualSeccion.findById(req.params.id);
    if (!seccion) return res.status(404).json({ success: false, message: 'Sección no encontrada' });
    (seccion.pasos || []).forEach(borrarArchivoDePaso);
    await ManualSeccion.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Sección eliminada' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error al eliminar la sección', error: error.message });
  }
});

// ─────────────────────────────────────────────
// PUT /api/manual/secciones/reordenar — nuevo orden de las secciones DE UN
// MISMO tipo (recibe { tipo, secciones:[{_id,orden}] }).
// ─────────────────────────────────────────────
router.put('/secciones/reordenar', protect, soloAdmin, async (req, res) => {
  try {
    const { tipo, secciones } = req.body;
    if (!tipoValido(tipo) || !Array.isArray(secciones)) {
      return res.status(400).json({ success: false, message: 'tipo y secciones son requeridos' });
    }
    await Promise.all(
      secciones.map((s) => ManualSeccion.findOneAndUpdate({ _id: s._id, tipo }, { orden: s.orden }))
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error al reordenar', error: error.message });
  }
});

// ─────────────────────────────────────────────
// POST /api/manual/secciones/:id/pasos — agrega un paso, con su video o
// imagen (multipart/form-data: campo "archivo" + titulo/instruccion/orden)
// ─────────────────────────────────────────────
router.post('/secciones/:id/pasos', protect, soloAdmin, subirArchivo, async (req, res) => {
  try {
    const { titulo, instruccion, orden, duracionSegundos } = req.body;
    if (!titulo || !instruccion) {
      return res.status(400).json({ success: false, message: 'Título e instrucción son requeridos' });
    }
    const seccion = await ManualSeccion.findById(req.params.id);
    if (!seccion) return res.status(404).json({ success: false, message: 'Sección no encontrada' });

    seccion.pasos.push({
      titulo,
      instruccion,
      ...armarCamposMedia(req),
      duracionSegundos: Number(duracionSegundos) || 0,
      orden: Number.isFinite(Number(orden)) ? Number(orden) : seccion.pasos.length,
    });
    await seccion.save();
    res.status(201).json({ success: true, seccion });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error al agregar el paso', error: error.message });
  }
});

// ─────────────────────────────────────────────
// PUT /api/manual/secciones/:id/pasos/:pasoId — editar un paso (con o sin
// reemplazar el video/imagen)
// ─────────────────────────────────────────────
router.put('/secciones/:id/pasos/:pasoId', protect, soloAdmin, subirArchivo, async (req, res) => {
  try {
    const { titulo, instruccion, orden, duracionSegundos } = req.body;
    const seccion = await ManualSeccion.findById(req.params.id);
    if (!seccion) return res.status(404).json({ success: false, message: 'Sección no encontrada' });

    const paso = seccion.pasos.id(req.params.pasoId);
    if (!paso) return res.status(404).json({ success: false, message: 'Paso no encontrado' });

    if (titulo !== undefined) paso.titulo = titulo;
    if (instruccion !== undefined) paso.instruccion = instruccion;
    if (orden !== undefined) paso.orden = Number(orden);
    if (duracionSegundos !== undefined) paso.duracionSegundos = Number(duracionSegundos);

    if (req.file) {
      borrarArchivoDePaso(paso); // el archivo anterior se descarta
      const campos = armarCamposMedia(req);
      paso.tipoMedia = campos.tipoMedia;
      paso.videoUrl = campos.videoUrl;
      paso.imagenUrl = campos.imagenUrl;
    }

    await seccion.save();
    res.json({ success: true, seccion });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error al actualizar el paso', error: error.message });
  }
});

// ─────────────────────────────────────────────
// PUT /api/manual/secciones/:id/pasos/reordenar — nuevo orden de los pasos
// de una sección (recibe { pasos:[{_id,orden}] })
// ─────────────────────────────────────────────
router.put('/secciones/:id/pasos/reordenar', protect, soloAdmin, async (req, res) => {
  try {
    const { pasos } = req.body;
    const seccion = await ManualSeccion.findById(req.params.id);
    if (!seccion) return res.status(404).json({ success: false, message: 'Sección no encontrada' });

    const ordenPorId = {};
    (pasos || []).forEach((p) => { ordenPorId[p._id] = p.orden; });
    seccion.pasos.forEach((p) => {
      const nuevoOrden = ordenPorId[p._id.toString()];
      if (nuevoOrden !== undefined) p.orden = nuevoOrden;
    });

    await seccion.save();
    res.json({ success: true, seccion });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error al reordenar los pasos', error: error.message });
  }
});

// ─────────────────────────────────────────────
// DELETE /api/manual/secciones/:id/pasos/:pasoId
// ─────────────────────────────────────────────
router.delete('/secciones/:id/pasos/:pasoId', protect, soloAdmin, async (req, res) => {
  try {
    const seccion = await ManualSeccion.findById(req.params.id);
    if (!seccion) return res.status(404).json({ success: false, message: 'Sección no encontrada' });

    const paso = seccion.pasos.id(req.params.pasoId);
    if (!paso) return res.status(404).json({ success: false, message: 'Paso no encontrado' });

    borrarArchivoDePaso(paso);
    // 🛡️ .pull() en vez de paso.deleteOne(): existe en TODAS las versiones
    // de Mongoose (el servidor real corre una versión vieja).
    seccion.pasos.pull(req.params.pasoId);
    await seccion.save();
    res.json({ success: true, seccion });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error al eliminar el paso', error: error.message });
  }
});

module.exports = router;
