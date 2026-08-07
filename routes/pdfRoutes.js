const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const Viaje = require('../models/Viaje');

// Configurar almacenamiento de Multer
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = '/var/www/cooespatrans/pdfs';
    
    // Crear directorio si no existe
    try {
      await fs.mkdir(uploadDir, { recursive: true });
    } catch (err) {
      console.error('Error creando directorio:', err);
    }
    
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Nombre único: timestamp_codigoViaje_nombreOriginal
    const uniqueName = `${Date.now()}_${req.params.codigo}_${file.originalname}`;
    cb(null, uniqueName);
  }
});

// Filtro para solo aceptar PDFs
const fileFilter = (req, file, cb) => {
  if (file.mimetype === 'application/pdf') {
    cb(null, true);
  } else {
    cb(new Error('Solo se permiten archivos PDF'), false);
  }
};

// Configurar Multer
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024 // Máximo 10MB
  }
});

// 📤 SUBIR PDF A UN VIAJE
router.post('/:codigo/upload', upload.single('pdf'), async (req, res) => {
  try {
    const { codigo } = req.params;
    const { tipoDocumento, subidoPor } = req.body;

    if (!req.file) {
      return res.status(400).json({ 
        success: false,
        error: 'No se recibió ningún archivo PDF' 
      });
    }

    const viaje = await Viaje.findOne({ codigo });

    if (!viaje) {
      // Eliminar archivo si el viaje no existe
      await fs.unlink(req.file.path);
      return res.status(404).json({ 
        success: false,
        error: 'Viaje no encontrado' 
      });
    }

    // Construir URL pública del PDF
    const urlPDF = `https://app.backend.cooespatrans.com/pdfs/${req.file.filename}`;

    // Agregar PDF al array
    viaje.pdfs.push({
      nombre: req.file.originalname,
      url: urlPDF,
      rutaServidor: req.file.path,
      tipoDocumento: tipoDocumento || 'otro',
      subidoPor: subidoPor || 'Administrador',
      tamanio: req.file.size,
      fechaSubida: new Date()
    });

    await viaje.save();

    res.json({
      success: true,
      mensaje: 'PDF subido exitosamente',
      pdf: viaje.pdfs[viaje.pdfs.length - 1]
    });

  } catch (error) {
    console.error('Error al subir PDF:', error);
    
    // Eliminar archivo en caso de error
    if (req.file) {
      try {
        await fs.unlink(req.file.path);
      } catch (unlinkError) {
        console.error('Error eliminando archivo:', unlinkError);
      }
    }
    
    res.status(500).json({ 
      success: false,
      error: 'Error al subir PDF',
      mensaje: error.message 
    });
  }
});

// 📋 OBTENER TODOS LOS PDFS DE UN VIAJE
router.get('/:codigo/pdfs', async (req, res) => {
  try {
    const { codigo } = req.params;

    const viaje = await Viaje.findOne({ codigo }).select('codigo pdfs');

    if (!viaje) {
      return res.status(404).json({ 
        success: false,
        error: 'Viaje no encontrado' 
      });
    }

    res.json({
      success: true,
      codigo: viaje.codigo,
      pdfs: viaje.pdfs || [],
      cantidad: viaje.pdfs?.length || 0
    });

  } catch (error) {
    console.error('Error al obtener PDFs:', error);
    res.status(500).json({ 
      success: false,
      error: 'Error al obtener PDFs',
      mensaje: error.message 
    });
  }
});

// 🗑️ ELIMINAR UN PDF DE UN VIAJE
router.delete('/:codigo/pdfs/:pdfId', async (req, res) => {
  try {
    const { codigo, pdfId } = req.params;

    const viaje = await Viaje.findOne({ codigo });

    if (!viaje) {
      return res.status(404).json({ 
        success: false,
        error: 'Viaje no encontrado' 
      });
    }

    // Encontrar el PDF
    const pdfIndex = viaje.pdfs.findIndex(pdf => pdf._id.toString() === pdfId);

    if (pdfIndex === -1) {
      return res.status(404).json({ 
        success: false,
        error: 'PDF no encontrado' 
      });
    }

    const pdfEliminado = viaje.pdfs[pdfIndex];

    // Eliminar archivo físico del servidor
    try {
      if (pdfEliminado.rutaServidor) {
        await fs.unlink(pdfEliminado.rutaServidor);
      }
    } catch (unlinkError) {
      console.error('Error eliminando archivo del servidor:', unlinkError);
      // Continuar aunque falle la eliminación del archivo
    }

    // Eliminar del array
    viaje.pdfs.splice(pdfIndex, 1);
    await viaje.save();

    res.json({
      success: true,
      mensaje: 'PDF eliminado exitosamente',
      pdfEliminado: {
        nombre: pdfEliminado.nombre,
        rutaServidor: pdfEliminado.rutaServidor
      }
    });

  } catch (error) {
    console.error('Error al eliminar PDF:', error);
    res.status(500).json({ 
      success: false,
      error: 'Error al eliminar PDF',
      mensaje: error.message 
    });
  }
});

module.exports = router;