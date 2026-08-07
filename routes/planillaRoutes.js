const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const router  = express.Router();
const ctrl    = require('../controllers/planillaController');
const { protect } = require('../controllers/authController');

const uploadDir = '/var/www/cooespatrans/uploads/planillas';
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext  = path.extname(file.originalname).toLowerCase();
    const name = `planilla_${req.params.id}_${Date.now()}${ext}`;
    cb(null, name);
  },
});

const upload = multer({
  storage,
  // ✅ Límite reducido: PDFs/imágenes de planillas no deberían superar 10 MB
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['.pdf', '.jpg', '.jpeg', '.png'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) return cb(null, true);
    cb(new Error('Solo se permiten archivos PDF, JPG o PNG'));
  },
});

// ✅ Manejador de errores de multer para devolver mensaje claro al frontend
const uploadSingle = (req, res, next) => {
  upload.single('archivoPlanilla')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        message: 'El archivo supera el tamaño máximo permitido (10 MB). Comprime el archivo e intenta de nuevo.',
      });
    }
    return res.status(400).json({ message: err.message || 'Error al procesar el archivo.' });
  });
};

router.get   ('/export/excel',  protect, ctrl.exportExcel);
router.get   ('/',              protect, ctrl.getAll);
router.get   ('/:id',           protect, ctrl.getById);
router.post  ('/',              protect, ctrl.create);
router.put   ('/:id',           protect, ctrl.update);
router.patch ('/:id/archivo',   protect, uploadSingle, ctrl.uploadArchivo);
router.delete('/:id',           protect, ctrl.remove);

module.exports = router;