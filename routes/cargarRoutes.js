// routes/cargarRoutes.js
const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const xlsx    = require('xlsx');
const Bodega  = require('../models/Bodega');
const Cliente = require('../models/Cliente');
const { protect } = require('../controllers/authController');

const upload = multer({ storage: multer.memoryStorage() });

// ── Helpers ───────────────────────────────────────────────────────────────────
const toStr = (v) => {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  if (typeof v === 'number') return String(Math.round(v));
  return String(v).trim();
};

const toNum = (v) => {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
};

const normalizeHeader = (h) =>
  String(h ?? '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9\s#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const HEADER_MAP = {
  '# PLANILLA':      'numeroPlanilla',
  'PLANILLA':        'numeroPlanilla',
  '# FACTURA':       'nunFactura',
  'FACTURA':         'nunFactura',
  'NUM FACTURA':     'nunFactura',
  'NUMERO FACTURA':  'nunFactura',
  'NOMBRE':          'nombre',
  'APELLIDO':        'apellido',
  'CEDULA NIT':      'cedula',
  'CEDULA / NIT':    'cedula',
  'CEDULA':          'cedula',
  'NIT':             'cedula',
  'TELEFONO':        'telefono',
  'CIUDAD':          'ciudad',
  'DEPARTAMENTO':    'departamento',
  'DIRECCION':       'direccion',
  'TIPO FACTURA':    'tipoFactura',
  'VALOR ($)':       'valorARecibir',
  'VALOR':           'valorARecibir',
  'VALOR A RECIBIR': 'valorARecibir',
  'DIAS CREDITO':    'plazoDias',
  'PLAZO DIAS':      'plazoDias',
  'PLAZO':           'plazoDias',
  'FORMA DE PAGO':   'pago',
  'PAGO':            'pago',
  'PESO KG':         'pesoKg',
  'PESO (KG)':       'pesoKg',
  'PESO':            'pesoKg',
};

const CAMPOS_NUMERICOS = new Set(['valorARecibir', 'plazoDias', 'pesoKg']);
const CAMPOS_STRING    = new Set(['cedula', 'telefono']);
const TIPO_VALIDOS     = new Set(['contado', 'credito']);

// NOTA: cada ruta usa `protect` → req.user disponible. Todas las consultas y
// creaciones se filtran/estampan por owner = req.user._id (aislamiento por usuario).

// ── GET /api/cargar/bodegas ───────────────────────────────────────────────────
router.get('/bodegas', protect, async (req, res) => {
  try {
    const bodegas = await Bodega.find({ owner: req.user._id }).sort({ createdAt: -1 });
    res.json(bodegas);
  } catch (error) {
    console.error('❌ Error al obtener bodegas:', error);
    res.status(500).json({ mensaje: 'Error al obtener bodegas', error: error.message });
  }
});

// ── POST /api/cargar/bodega ───────────────────────────────────────────────────
router.post('/bodega', protect, async (req, res) => {
  try {
    const { nombre, direccion } = req.body;
    const nueva = new Bodega({ owner: req.user._id, nombre, direccion });
    await nueva.save();
    res.json(nueva);
  } catch (error) {
    console.error('❌ Error al crear bodega:', error);
    res.status(500).json({ mensaje: 'Error al crear bodega', error: error.message });
  }
});

// ── PUT /api/cargar/planilla/:bodegaId ────────────────────────────────────────
router.put('/planilla/:bodegaId', protect, async (req, res) => {
  try {
    const { bodegaId }       = req.params;
    const { numeroPlanilla } = req.body;
    const bodegaExiste = await Bodega.findOne({ _id: bodegaId, owner: req.user._id });
    if (!bodegaExiste) return res.status(404).json({ mensaje: 'La bodega no existe' });
    const inicioDelDia = new Date(); inicioDelDia.setHours(0,0,0,0);
    const finDelDia    = new Date(); finDelDia.setHours(23,59,59,999);
    const resultado = await Cliente.updateMany(
      { owner: req.user._id, bodegaId, fecha: { $gte: inicioDelDia, $lte: finDelDia }, codigoViaje: null },
      { $set: { numeroPlanilla: numeroPlanilla ? String(numeroPlanilla).trim() : null } }
    );
    res.json({ mensaje: 'Planilla actualizada', modificados: resultado.modifiedCount });
  } catch (error) {
    console.error('❌ Error al actualizar planilla:', error);
    res.status(500).json({ mensaje: 'Error al actualizar la planilla', error: error.message });
  }
});

// ── Procesa UNA hoja del Excel y devuelve { clientes, errores, numeroPlanilla } ─
// Cada hoja representa una planilla independiente. Los clientes que retorna
// llevan el numeroPlanilla de ESA hoja, sin mezclarse con otras.
function procesarHoja(sheet, nombreHoja, bodegaId) {
  const rawRows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: null });

  // Hoja vacía o sin datos suficientes → se omite silenciosamente.
  if (!rawRows || rawRows.length < 2) {
    return { clientes: [], errores: [], numeroPlanilla: null, omitida: true };
  }

  // ── Extraer numeroPlanilla de la cabecera (celda D2 / junto al label) ───────
  let numeroPlanillaGlobal = null;
  for (let i = 0; i < Math.min(rawRows.length, 5); i++) {
    const row = rawRows[i] || [];
    const labelIdx = row.findIndex(cell => {
      const n = normalizeHeader(String(cell || ''));
      return n.includes('NUMERO DE PLANILLA') || n === 'NUMERO PLANILLA' || n === 'PLANILLA';
    });
    if (labelIdx !== -1) {
      const valorCelda = row[labelIdx + 1] ?? row[3] ?? null;
      if (valorCelda !== null && valorCelda !== '') {
        numeroPlanillaGlobal = String(valorCelda).trim();
      }
      break;
    }
  }

  // ── Detectar fila de encabezados (≥2 celdas que coincidan con HEADER_MAP) ───
  let headerRowIdx = -1;
  for (let i = 0; i < Math.min(rawRows.length, 10); i++) {
    const normalized = (rawRows[i] || []).map(normalizeHeader);
    const matches    = normalized.filter(h => HEADER_MAP[h]).length;
    if (matches >= 2) { headerRowIdx = i; break; }
  }

  if (headerRowIdx === -1) {
    return {
      clientes: [], numeroPlanilla: numeroPlanillaGlobal, omitida: false,
      errores: [`Hoja "${nombreHoja}": no se encontró la fila de encabezados.`],
    };
  }

  const rawHeaders = rawRows[headerRowIdx].map(normalizeHeader);
  const colMap = {};
  rawHeaders.forEach((h, idx) => {
    const campo = HEADER_MAP[h];
    if (campo) colMap[idx] = campo;
  });

  const camposPresentes = new Set(Object.values(colMap));
  if (!camposPresentes.has('nunFactura')) {
    return { clientes: [], numeroPlanilla: numeroPlanillaGlobal, omitida: false,
      errores: [`Hoja "${nombreHoja}": falta la columna "# FACTURA".`] };
  }
  if (!camposPresentes.has('nombre')) {
    return { clientes: [], numeroPlanilla: numeroPlanillaGlobal, omitida: false,
      errores: [`Hoja "${nombreHoja}": falta la columna "NOMBRE".`] };
  }

  // ── Parsear filas de datos ──────────────────────────────────────────────────
  const dataRows        = rawRows.slice(headerRowIdx + 1);
  const errores         = [];
  const clientesValidos = [];

  dataRows.forEach((row, idx) => {
    if (!row || row.every(cell => cell === null || cell === '')) return;

    const lineNum = headerRowIdx + idx + 2;
    const doc     = {};

    Object.entries(colMap).forEach(([colIdx, campo]) => {
      const raw = row[parseInt(colIdx)];

      // Ignorar fórmulas sin evaluar (col A: =IF(B5<>"",$D$2,""))
      if (typeof raw === 'string' && raw.startsWith('=')) { doc[campo] = null; return; }

      if (CAMPOS_NUMERICOS.has(campo)) {
        doc[campo] = toNum(raw);
      } else if (CAMPOS_STRING.has(campo)) {
        doc[campo] = typeof raw === 'number' ? String(Math.round(raw)) : toStr(raw);
      } else if (campo === 'tipoFactura') {
        const val = toStr(raw)?.toLowerCase();
        doc[campo] = TIPO_VALIDOS.has(val) ? val : 'contado';
      } else {
        doc[campo] = toStr(raw);
      }
    });

    // La planilla de la hoja manda: si la col # PLANILLA vino vacía (fórmula no
    // evaluada) usamos el número leído de la cabecera de ESTA hoja.
    if (!doc.numeroPlanilla && numeroPlanillaGlobal) {
      doc.numeroPlanilla = numeroPlanillaGlobal;
    }

    if (!doc.nunFactura) { errores.push(`Hoja "${nombreHoja}", fila ${lineNum}: falta el # FACTURA.`); return; }
    if (!doc.nombre)     { errores.push(`Hoja "${nombreHoja}", fila ${lineNum}: falta el NOMBRE.`);   return; }

    clientesValidos.push({ ...doc, bodegaId });
  });

  return { clientes: clientesValidos, errores, numeroPlanilla: numeroPlanillaGlobal, omitida: false };
}

// ── POST /api/cargar/clientes ─────────────────────────────────────────────────
// Procesa TODAS las hojas del Excel. Cada hoja con al menos un número de planilla
// y un cliente válido se convierte en una planilla independiente. Los clientes de
// cada hoja quedan asociados únicamente a la planilla de esa hoja.
router.post('/clientes', protect, upload.single('file'), async (req, res) => {
  try {
    console.log('📥 Iniciando carga de clientes desde Excel...');

    if (!req.file) {
      return res.status(400).json({ mensaje: 'No se ha subido ningún archivo' });
    }

    const { bodegaId } = req.body;
    if (!bodegaId) {
      return res.status(400).json({ mensaje: 'Se requiere el ID de la bodega' });
    }

    const bodegaExiste = await Bodega.findOne({ _id: bodegaId, owner: req.user._id });
    if (!bodegaExiste) {
      return res.status(404).json({ mensaje: 'La bodega especificada no existe' });
    }

    // ── Leer Excel (TODAS las hojas) ───────────────────────────────────────────
    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });

    if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
      return res.status(400).json({ mensaje: 'El archivo Excel no contiene hojas.' });
    }

    const errores          = [];
    const clientesValidos  = [];
    const planillasCreadas = [];   // resumen por hoja procesada
    const hojasOmitidas    = [];

    for (const nombreHoja of workbook.SheetNames) {
      const sheet = workbook.Sheets[nombreHoja];
      const resultado = procesarHoja(sheet, nombreHoja, bodegaId);

      // Hoja vacía → se omite sin error.
      if (resultado.omitida) { hojasOmitidas.push(nombreHoja); continue; }

      // Requisito: la hoja debe tener número de planilla y al menos un cliente.
      if (!resultado.numeroPlanilla) {
        // Sin número de planilla → no se crea planilla desde esta hoja.
        if (resultado.clientes.length > 0 || resultado.errores.length > 0) {
          errores.push(`Hoja "${nombreHoja}": sin número de planilla (celda D2). Se omitió.`);
        }
        hojasOmitidas.push(nombreHoja);
        continue;
      }

      if (resultado.errores.length > 0) errores.push(...resultado.errores);

      if (resultado.clientes.length > 0) {
        clientesValidos.push(...resultado.clientes);
        planillasCreadas.push({ numeroPlanilla: resultado.numeroPlanilla, clientes: resultado.clientes.length });
      }
    }

    // Errores de contenido bloquean toda la carga (comportamiento previo).
    if (errores.length > 0) {
      return res.status(400).json({
        mensaje:      'Hay errores en el archivo Excel. Corrígelos y vuelve a subir.',
        errores,
        totalErrores: errores.length,
        totalValidos: clientesValidos.length,
      });
    }

    if (clientesValidos.length === 0) {
      return res.status(400).json({
        mensaje: 'El archivo no contiene planillas válidas (cada hoja necesita número de planilla y al menos un cliente).',
      });
    }

    // Estampar el propietario en cada cliente antes de insertar.
    const clientesConOwner = clientesValidos.map(c => ({ ...c, owner: req.user._id }));

    console.log(`💾 Insertando ${clientesConOwner.length} clientes de ${planillasCreadas.length} planilla(s)...`);
    const insertados = await Cliente.insertMany(clientesConOwner, { ordered: false });
    console.log(`✅ Clientes insertados: ${insertados.length}`);

    res.json({
      mensaje:           `Se importaron ${planillasCreadas.length} planilla(s) correctamente`,
      cantidadInsertada: insertados.length,
      planillas:         planillasCreadas,
      hojasOmitidas,
      clientes:          insertados,
    });

  } catch (error) {
    console.error('❌ Error al cargar clientes:', error);
    res.status(500).json({ mensaje: 'Error al cargar clientes', error: error.message });
  }
});

// ── GET /api/cargar/clientes/bodega/:id ───────────────────────────────────────
// Devuelve TODOS los clientes pendientes de asignar (codigoViaje: null) de la
// bodega, sin restricción de fecha. Una planilla no debe "desaparecer" solo por
// haberse cargado otro día: sigue pendiente hasta que se le asigne un conductor.
// Se conserva por compatibilidad con vistas que esperan la lista plana.
router.get('/clientes/bodega/:id', protect, async (req, res) => {
  try {
    const { id } = req.params;

    const clientes = await Cliente.find({
      owner:       req.user._id,
      bodegaId:    id,
      codigoViaje: null,
    }).sort({ fecha: -1 });

    res.json(clientes);
  } catch (error) {
    console.error('❌ Error al obtener clientes:', error);
    res.status(500).json({ mensaje: 'Error al obtener clientes', error: error.message });
  }
});

// ── GET /api/cargar/planillas/bodega/:id ──────────────────────────────────────
// Devuelve las planillas PENDIENTES de asignación de la bodega, agrupando los
// clientes por numeroPlanilla. Cada grupo trae sus clientes y totales básicos.
// Los clientes sin numeroPlanilla se agrupan bajo la clave especial "SIN_PLANILLA".
// Una planilla desaparece de aquí en cuanto sus clientes reciben codigoViaje
// (es decir, cuando se le asigna un conductor).
router.get('/planillas/bodega/:id', protect, async (req, res) => {
  try {
    const { id } = req.params;

    const clientes = await Cliente.find({
      owner:       req.user._id,
      bodegaId:    id,
      codigoViaje: null,
    }).sort({ fecha: -1 });

    const grupos = new Map();

    clientes.forEach((c) => {
      const clave = c.numeroPlanilla ? String(c.numeroPlanilla).trim() : '__SIN_PLANILLA__';
      if (!grupos.has(clave)) {
        grupos.set(clave, {
          numeroPlanilla: clave === '__SIN_PLANILLA__' ? null : clave,
          sinPlanilla:    clave === '__SIN_PLANILLA__',
          estado:         'pendiente',
          clientes:       [],
          totalClientes:  0,
          pesoTotal:      0,
          valorTotal:     0,
          fecha:          c.fecha,
        });
      }
      const g = grupos.get(clave);
      g.clientes.push(c);
      g.totalClientes += 1;
      g.pesoTotal  += Number(c.pesoKg)        || 0;
      g.valorTotal += Number(c.valorARecibir) || 0;
      if (c.fecha && (!g.fecha || c.fecha > g.fecha)) g.fecha = c.fecha;
    });

    // Planillas con número primero (más recientes arriba), "sin planilla" al final.
    const planillas = [...grupos.values()].sort((a, b) => {
      if (a.sinPlanilla) return 1;
      if (b.sinPlanilla) return -1;
      return new Date(b.fecha) - new Date(a.fecha);
    });

    res.json(planillas);
  } catch (error) {
    console.error('❌ Error al obtener planillas de la bodega:', error);
    res.status(500).json({ mensaje: 'Error al obtener planillas', error: error.message });
  }
});

// ── DELETE /api/cargar/planillas/bodega/:id/:numeroPlanilla ────────────────────
// Elimina una planilla PENDIENTE de una bodega: borra los clientes de esa
// planilla que aún no tienen viaje asignado (codigoViaje: null). No toca clientes
// ya asignados a un viaje, para no romper viajes existentes.
router.delete('/planillas/bodega/:id/:numeroPlanilla', protect, async (req, res) => {
  try {
    const { id, numeroPlanilla } = req.params;
    const numero = decodeURIComponent(numeroPlanilla).trim();

    const filtro = {
      owner:       req.user._id,
      bodegaId:    id,
      codigoViaje: null,
      numeroPlanilla: numero,
    };

    // Seguridad: no permitir borrar clientes que ya estén en un viaje.
    const asignados = await Cliente.countDocuments({
      owner: req.user._id, bodegaId: id, numeroPlanilla: numero, codigoViaje: { $ne: null },
    });
    if (asignados > 0) {
      return res.status(409).json({
        mensaje: 'No se puede eliminar: la planilla ya tiene clientes asignados a un viaje.',
      });
    }

    const resultado = await Cliente.deleteMany(filtro);

    if (resultado.deletedCount === 0) {
      return res.status(404).json({ mensaje: 'No se encontró una planilla pendiente con ese número.' });
    }

    res.json({
      mensaje: `Planilla ${numero} eliminada correctamente`,
      clientesEliminados: resultado.deletedCount,
    });
  } catch (error) {
    console.error('❌ Error al eliminar planilla:', error);
    res.status(500).json({ mensaje: 'Error al eliminar planilla', error: error.message });
  }
});

module.exports = router;