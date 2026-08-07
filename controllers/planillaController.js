const path = require('path');
const fs = require('fs');
const PlanillaCorbeta = require('../models/PlanillaCorbeta');
const SedeConfig = require('../models/SedeConfig');
const EMPRESAS = PlanillaCorbeta.EMPRESAS;

// ── Campos bloqueables ────────────────────────────────────────────────────────
const LOCKABLE_FIELDS = [
  'planilla', 'empresa', 'placaMula', 'nombreConductorMula', 'nroFacturaMula',
  'novedadesAverias', 'valorAverias',
  'conductorRuta', 'placaTrasbordo', 'planillaTrasbordo',
  'tipoViaje', 'nroManifiesto',
  'fechaSalidaRuta', 'ruta',
  'flete', 'anticipo', 'ajusteAutorizado',
  'fechaLegalizacion',
  'fechaLegalizacionReal',
  'estadoLegalizacion',
  'nroFacturaCorbeta', 'valorFacturaCorbeta', 'observaciones',
  'nroFacturaPago', 'fechaPago', 'valorPagado', 'observacionesCruze',
  'credito', 'contado',
];

const MONEY_FIELDS = new Set([
  'flete', 'anticipo', 'ajusteAutorizado', 'valorAverias', 'valorPagado',
  'valorFacturaCorbeta',
  'credito', 'contado',
]);

const CALCULATED_FIELDS = new Set([
  'plazoMaximo', 'limiteEntrega', 'alertaLegalizacion',
  'retencion', 'saldoPagar', 'utilidad',
]);

// ── Helpers ───────────────────────────────────────────────────────────────────
const hasValue = (v) => v !== null && v !== undefined && v !== '' && v !== 0;

const parseMoney = (v) => {
  if (v === undefined || v === null || v === '') return 0;
  if (typeof v === 'number') return v;
  return parseFloat(String(v).replace(/\./g, '').replace(',', '.')) || 0;
};

const pickLockable = (body) => {
  const fields = {};
  LOCKABLE_FIELDS.forEach((f) => {
    if (body[f] === undefined) return;
    fields[f] = MONEY_FIELDS.has(f) ? parseMoney(body[f]) : body[f];
  });
  return fields;
};

const parseNovedades = (arr) =>
  (Array.isArray(arr) ? arr : []).map((n) => ({
    planilla: n.planilla || '',
    descripcion: n.descripcion || '',
    valor: parseMoney(n.valor),
  }));

// ── Helpers de roles ──────────────────────────────────────────────────────────
// Acceso global: puede ver/filtrar todas las sedes
const isGlobal = (role) => role === 'admin' || role === 'user' || role === 'adminSede' || role === 'coordLogistico';

// Acceso privilegiado: puede crear/editar/eliminar sin restricción de campos bloqueados
// admin y adminSede tienen estos permisos (adminSede solo dentro de su sede)
const isPrivileged = (role) => role === 'admin' || role === 'user' || role === 'adminSede' || role === 'coordLogistico';

// Puede eliminar registros
const canDelete = (role) => role === 'admin' || role === 'user' || role === 'adminSede' || role === 'coordLogistico';

// Resuelve la sede a filtrar según el rol del usuario
const resolveSede = (user, querySede) => {
  if (isGlobal(user.role)) return querySede || null;   // admin/user: opcional por query
  return user.sedeNombre || null;                       // sede/adminSede: siempre su sede
};

// ── GET /api/planillas ────────────────────────────────────────────────────────
exports.getAll = async (req, res) => {
  try {
    const filter = {};

    if (isGlobal(req.user.role)) {
      // admin / user: excluir sedes desactivadas de la vista consolidada
      const sedesInactivas = (await SedeConfig.find({ activa: false })).map((s) => s.nombre);

      if (req.query.sede) {
        if (sedesInactivas.includes(req.query.sede)) {
          return res.json([]); // esa sede está oculta en este momento
        }
        filter.sede = req.query.sede;
      } else if (sedesInactivas.length) {
        filter.sede = { $nin: sedesInactivas };
      }
    } else {
      // sede / adminSede: solo ven su propia sede (sin cambios, no afectado por el switch)
      if (!req.user.sedeNombre)
        return res.status(403).json({
          message: 'Tu cuenta no tiene una sede asignada. Contacta al administrador.',
        });
      filter.sede = req.user.sedeNombre;
    }

    const planillas = await PlanillaCorbeta.find(filter)
      .sort({ createdAt: -1 })
      .populate('createdBy', 'username email');

    res.json(planillas);
  } catch (err) {
    console.error('[getAll planillas]', err);
    res.status(500).json({ message: 'Error al obtener planillas', error: err.message });
  }
};

// ── GET /api/planillas/:id ────────────────────────────────────────────────────
exports.getById = async (req, res) => {
  try {
    const doc = await PlanillaCorbeta.findById(req.params.id)
      .populate('createdBy', 'username email');

    if (!doc) return res.status(404).json({ message: 'Planilla no encontrada' });

    // Solo admin/user pueden ver planillas de cualquier sede
    if (!isGlobal(req.user.role) && doc.sede !== req.user.sedeNombre)
      return res.status(403).json({ message: 'Sin acceso' });

    res.json(doc);
  } catch (err) {
    console.error('[getById planilla]', err);
    res.status(500).json({ message: 'Error', error: err.message });
  }
};

// ── POST /api/planillas ───────────────────────────────────────────────────────
exports.create = async (req, res) => {
  try {
    let sede;

    if (isGlobal(req.user.role)) {
      // admin / user: pueden especificar cualquier sede en el body
      sede = req.body.sede || null;
    } else {
      // sede / adminSede: solo pueden crear en su propia sede
      sede = req.user.sedeNombre;
    }

    if (!sede)
      return res.status(400).json({ message: 'No se puede determinar la sede del registro' });

    const fields = pickLockable(req.body);

    // ── Validar empresa obligatoria ──────────────────────────────────────
    if (!fields.empresa || !EMPRESAS.includes(fields.empresa)) {
      return res.status(400).json({
        message: 'Debes seleccionar una empresa válida para la planilla.',
      });
    }
    // ───────────────────────────────────────────────────────────────────

    // novedades (mula)
    if (Array.isArray(req.body.novedades)) {
      fields.novedades = parseNovedades(req.body.novedades);
    }

    // novedadesLegalizacion
    if (Array.isArray(req.body.novedadesLegalizacion)) {
      fields.novedadesLegalizacion = parseNovedades(
        req.body.novedadesLegalizacion.slice(0, 5)
      );
    }

    const lockedFields = LOCKABLE_FIELDS.filter(
      (f) => fields[f] !== undefined && hasValue(fields[f])
    );

    // ── Validar planilla única ──────────────────────────────────────────
    if (fields.planilla) {
      const existe = await PlanillaCorbeta.findOne({
        planilla: fields.planilla.trim().toUpperCase()
      });
      if (existe) {
        return res.status(400).json({
          message: `La planilla "${fields.planilla}" ya existe. No se permiten duplicados.`
        });
      }
    }
    // ───────────────────────────────────────────────────────────────────

    const doc = new PlanillaCorbeta({
      sede,
      userEmail: req.user.email,
      createdBy: req.user._id,
      lockedFields,
      ...fields,
    });

    await doc.save();
    res.status(201).json(doc);
  } catch (err) {
    console.error('[create planilla]', err);
    res.status(400).json({ message: 'Error al crear planilla', error: err.message });
  }
};

// ── PUT /api/planillas/:id ────────────────────────────────────────────────────
exports.update = async (req, res) => {
  try {
    const doc = await PlanillaCorbeta.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'Planilla no encontrada' });

    // Verificar acceso a la sede
    if (!isGlobal(req.user.role) && doc.sede !== req.user.sedeNombre)
      return res.status(403).json({ message: 'Sin acceso' });

    const incoming = pickLockable(req.body);

    // ── Validar empresa obligatoria al editar ────────────────────────────
    if (incoming.empresa !== undefined && (!incoming.empresa || !EMPRESAS.includes(incoming.empresa))) {
      return res.status(400).json({
        message: 'Debes seleccionar una empresa válida para la planilla.',
      });
    }
    // ───────────────────────────────────────────────────────────────────

    // ── Validar planilla única al editar ───────────────────────────────
    if (incoming.planilla && incoming.planilla !== doc.planilla) {
      const existe = await PlanillaCorbeta.findOne({
        planilla: incoming.planilla.trim().toUpperCase(),
        _id: { $ne: doc._id }
      });
      if (existe) {
        return res.status(400).json({
          message: `La planilla "${incoming.planilla}" ya existe. No se permiten duplicados.`
        });
      }
    }
    // ───────────────────────────────────────────────────────────────────

    LOCKABLE_FIELDS.forEach((f) => {
      if (incoming[f] === undefined) return;

      // adminSede, admin y user pueden sobreescribir campos bloqueados
      // El rol 'sede' respeta el bloqueo
      if (req.user.role === 'sede' && doc.lockedFields.includes(f)) return;

      doc[f] = incoming[f];
      if (hasValue(incoming[f]) && !doc.lockedFields.includes(f)) {
        doc.lockedFields.push(f);
      }
    });

    // novedades (mula): siempre reemplazables
    if (Array.isArray(req.body.novedades)) {
      doc.novedades = parseNovedades(req.body.novedades);
    }

    // novedadesLegalizacion: siempre reemplazables, máx. 5
    if (Array.isArray(req.body.novedadesLegalizacion)) {
      doc.novedadesLegalizacion = parseNovedades(
        req.body.novedadesLegalizacion.slice(0, 5)
      );
    }

    await doc.save();
    res.json(doc);
  } catch (err) {
    console.error('[update planilla]', err);
    res.status(400).json({ message: 'Error al actualizar', error: err.message });
  }
};

// ── PATCH /api/planillas/:id/archivo ─────────────────────────────────────────
exports.uploadArchivo = async (req, res) => {
  try {
    const doc = await PlanillaCorbeta.findById(req.params.id);

    if (!doc)
      return res.status(404).json({ message: 'Planilla no encontrada. Recarga la página e intenta de nuevo.' });

    if (!isGlobal(req.user.role) && doc.sede !== req.user.sedeNombre)
      return res.status(403).json({ message: 'No tienes permiso para modificar esta planilla.' });

    if (!req.file)
      return res.status(400).json({ message: 'No se recibió ningún archivo. Selecciona un PDF, JPG o PNG e intenta de nuevo.' });

    // Eliminar archivo anterior si existe
    if (doc.archivoPlanilla) {
      const oldPath = path.join('/var/www/cooespatrans', doc.archivoPlanilla);
      if (fs.existsSync(oldPath)) {
        try {
          fs.unlinkSync(oldPath);
        } catch (unlinkErr) {
          // No es crítico — continuar aunque no se pueda eliminar el archivo anterior
          console.warn('[uploadArchivo] No se pudo eliminar archivo anterior:', unlinkErr.message);
        }
      }
    }

    doc.archivoPlanilla = `/uploads/planillas/${req.file.filename}`;
    await doc.save();

    res.json({
      archivoPlanilla: doc.archivoPlanilla,
      message: 'Archivo adjuntado correctamente.',
    });
  } catch (err) {
    console.error('[uploadArchivo planilla]', err);

    // ✅ Mensajes específicos según el tipo de error
    if (err.name === 'CastError')
      return res.status(400).json({ message: 'ID de planilla inválido.' });

    if (err.name === 'MongoNetworkError' || err.message?.includes('ECONNREFUSED'))
      return res.status(503).json({ message: 'Error de conexión con la base de datos. Intenta en unos segundos.' });

    res.status(500).json({ message: 'Error inesperado al subir el archivo. Intenta de nuevo.', error: err.message });
  }
};

// ── DELETE /api/planillas/:id ─────────────────────────────────────────────────
exports.remove = async (req, res) => {
  try {
    if (!canDelete(req.user.role))
      return res.status(403).json({ message: 'No tienes permiso para eliminar registros' });

    const doc = await PlanillaCorbeta.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'Planilla no encontrada' });


    await PlanillaCorbeta.findByIdAndDelete(req.params.id);
    res.json({ message: 'Eliminada' });
  } catch (err) {
    console.error('[remove planilla]', err);
    res.status(500).json({ message: 'Error', error: err.message });
  }
};

// ── GET /api/planillas/export/excel ───────────────────────────────────────────
exports.exportExcel = async (req, res) => {
  try {
    const ExcelJS = require('exceljs');
    const { desde, hasta, sede } = req.query;

    // ── 1. Filtro de acceso ──────────────────────────────────────────────────
    const filter = {};

    if (isGlobal(req.user.role)) {
      const sedesInactivas = (await SedeConfig.find({ activa: false })).map((s) => s.nombre);
      if (sede) {
        if (sedesInactivas.includes(sede)) {
          return res.status(403).json({ message: 'Esta sede está desactivada actualmente.' });
        }
        filter.sede = sede;
      } else if (sedesInactivas.length) {
        filter.sede = { $nin: sedesInactivas };
      }
    } else {
      if (!req.user.sedeNombre)
        return res.status(403).json({ message: 'Tu cuenta no tiene una sede asignada.' });
      filter.sede = req.user.sedeNombre;
    }

    if (desde || hasta) {
      filter.fechaSalidaRuta = {};
      if (desde) filter.fechaSalidaRuta.$gte = new Date(`${desde}T00:00:00.000Z`);
      if (hasta) filter.fechaSalidaRuta.$lte = new Date(`${hasta}T23:59:59.999Z`);
    }

    const planillas = await PlanillaCorbeta.find(filter).sort({ fechaSalidaRuta: 1 }).lean();

    // ── 2. Helper de fecha ───────────────────────────────────────────────────
    const fmt = (d) => {
      if (!d) return '—';
      const dt = new Date(d);
      if (isNaN(dt)) return '—';
      return dt.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' });
    };

    // ── 3. Paleta de colores ─────────────────────────────────────────────────
    const C = {
      headerBg: 'FF1E3A5F',
      headerFont: 'FFFFFFFF',

      groupNum: 'FF1E3A5F',
      groupMula: 'FF2563EB',
      groupRuta: 'FFB45309',
      groupFinanzas: 'FF991B1B',
      groupSaldo: 'FFDC2626',
      groupLegalAlert: 'FF7C2D12',
      groupLegal: 'FF78350F',
      groupPago: 'FF14532D',
      groupFont: 'FFFFFFFF',

      rowOdd: 'FFFFFFFF',
      rowEven: 'FFF0F6FF',

      moneyFont: 'FF065F46',

      alertaOk: 'FFD1FAE5', alertaOkFont: 'FF065F46',
      alertaVenc: 'FFFEE2E2', alertaVencFont: 'FFB91C1C',
      alertaAmb: 'FFFEF3C7', alertaAmbFont: 'FF92400E',

      saldoPos: 'FF065F46',
      saldoNeg: 'FFB91C1C',

      totalBg: 'FF1E3A5F',
      totalFont: 'FFFFFFFF',

      border: 'FFCBD5E1',
      borderStrong: 'FF64748B',
    };

    // ── 4. Workbook ──────────────────────────────────────────────────────────
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Cooespatrans';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Planillas', {
      pageSetup: {
        orientation: 'landscape',
        fitToPage: true,
        fitToWidth: 1,
        margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 },
      },
    });

    // ── 5. Fila 1 — Título del reporte ───────────────────────────────────────
    const TOTAL_COLS = 36;
    sheet.mergeCells(1, 1, 1, TOTAL_COLS);
    const titleCell = sheet.getCell('A1');
    const periodoLabel =
      desde && hasta
        ? `Período: ${fmt(desde + 'T12:00:00')} — ${fmt(hasta + 'T12:00:00')}`
        : 'Todos los registros';
    const sedeLabel = sede ? ` · Sede: ${sede}` : '';
    titleCell.value = `COOESPATRANS · REPORTE DE PLANILLAS   |   ${periodoLabel}${sedeLabel}`;
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.headerBg } };
    titleCell.font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' }, name: 'Calibri' };
    titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
    titleCell.border = { bottom: { style: 'medium', color: { argb: 'FF3B82F6' } } };
    sheet.getRow(1).height = 34;

    // ── 6. Fila 2 — Encabezados de GRUPO ────────────────────────────────────
    const groups = [
      { label: '#', col: 1, span: 1, color: C.groupNum },
      { label: 'DATOS DE LA MULA', col: 2, span: 7, color: C.groupMula },
      { label: 'DATOS DE VEHÍCULO DE RUTA', col: 9, span: 7, color: C.groupRuta },
      { label: 'FLETE / ANTICIPO / AJUSTE', col: 16, span: 4, color: C.groupFinanzas },
      { label: 'SALDO A PAGAR', col: 20, span: 2, color: C.groupSaldo },
      { label: 'ALERTA LEGALIZACIÓN', col: 22, span: 1, color: C.groupLegalAlert },
      { label: 'LEGALIZACIÓN', col: 23, span: 6, color: C.groupLegal },
      { label: 'PAGO CORBETA', col: 29, span: 6, color: C.groupPago },
      { label: 'REGISTRO', col: 35, span: 1, color: C.groupNum },
    ];

    sheet.getRow(2).height = 22;
    groups.forEach(({ label, col, span, color }) => {
      if (span > 1) sheet.mergeCells(2, col, 2, col + span - 1);
      const cell = sheet.getCell(2, col);
      cell.value = label;
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
      cell.font = { bold: true, size: 9, color: { argb: C.groupFont }, name: 'Calibri' };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = {
        left: { style: 'thin', color: { argb: 'FF00000033' } },
        right: { style: 'thin', color: { argb: 'FF00000033' } },
        bottom: { style: 'medium', color: { argb: C.borderStrong } },
      };
    });

    // ── 7. Fila 3 — Sub-encabezados de columna ───────────────────────────────
    sheet.columns = [
      { key: 'num', width: 5 },
      { key: 'planilla', width: 13 },
      { key: 'sede', width: 11 },
      { key: 'placaMula', width: 13 },
      { key: 'nombreConductorMula', width: 22 },
      { key: 'nroFacturaMula', width: 15 },
      { key: 'novedadesAverias', width: 26 },
      { key: 'valorAverias', width: 14 },
      { key: 'conductorRuta', width: 22 },
      { key: 'placaTrasbordo', width: 13 },
      { key: 'planillaTrasbordo', width: 14 },
      { key: 'tipoViaje', width: 13 },
      { key: 'nroManifiesto', width: 15 },
      { key: 'fechaSalidaRuta', width: 13 },
      { key: 'ruta', width: 26 },
      { key: 'flete', width: 14 },
      { key: 'anticipo', width: 14 },
      { key: 'ajusteAutorizado', width: 13 },
      { key: 'plazoMaximo', width: 10 },
      { key: 'retencion', width: 14 },
      { key: 'saldoPagar', width: 15 },
      { key: 'alertaLegalizacion', width: 18 },
      { key: 'fechaLegalizacion', width: 14 },
      { key: 'fechaLegalizacionReal', width: 13 },
      { key: 'estadoLegalizacion', width: 14 },
      { key: 'nroFacturaCorbeta', width: 16 },
      { key: 'observaciones', width: 28 },
      { key: 'limiteEntrega', width: 13 },
      { key: 'nroFacturaPago', width: 15 },
      { key: 'fechaPago', width: 14 },
      { key: 'valorPagado', width: 14 },
      { key: 'utilidad', width: 13 },
      { key: 'observacionesCruze', width: 26 },
      { key: 'credito', width: 14 },
      { key: 'contado', width: 14 },
      { key: 'userEmail', width: 24 },
    ];

    const subHeaders = [
      '#',
      'Planilla', 'Sede', 'Placa Mula',
      'Conductor Mula', 'N° Factura',
      'Novedades / Averías', 'Valor Averías',
      'Conductor Ruta', 'Placa Trasbordo',
      'Planilla Trasbordo', 'Tipo Viaje',
      'N° Manifiesto', 'Fecha Salida', 'Ruta',
      'Flete ($)', 'Anticipo ($)',
      'Ajuste ($)', 'Días',
      'Retención ($)', 'Saldo Pagar ($)',
      'Alerta',
      'F. Legalización', 'F. Leg. Real',
      'Estado', 'N° Fact. Corbeta',
      'Observaciones', 'Fecha Límite',
      'N° Fact. Pago', 'Fecha de Pago', 'Valor Pagado ($)',
      'Utilidad ($)', 'Obs. Cruze',
      'Crédito ($)', 'Contado ($)',
      'Creado por',
    ];

    const colGroupColor = [
      C.groupNum,
      ...Array(7).fill(C.groupMula),
      ...Array(7).fill(C.groupRuta),
      ...Array(4).fill(C.groupFinanzas),
      ...Array(2).fill(C.groupSaldo),
      C.groupLegalAlert,
      ...Array(6).fill(C.groupLegal),
      ...Array(6).fill(C.groupPago),
      C.groupNum,
    ];

    const subHeaderRow = sheet.getRow(3);
    subHeaderRow.height = 32;
    subHeaders.forEach((h, i) => {
      const cell = subHeaderRow.getCell(i + 1);
      cell.value = h;
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colGroupColor[i] } };
      cell.font = { bold: true, size: 9, color: { argb: 'FFFFFFFF' }, name: 'Calibri' };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFFFFFFF44' } },
        left: { style: 'thin', color: { argb: C.border } },
        right: { style: 'thin', color: { argb: C.border } },
        bottom: { style: 'medium', color: { argb: C.borderStrong } },
      };
    });

    // ── 8. Columnas con formato de dinero ────────────────────────────────────
    const MONEY_KEYS = new Set([
      'flete', 'anticipo', 'ajusteAutorizado', 'retencion', 'saldoPagar',
      'valorAverias', 'valorPagado', 'utilidad',
      'credito', 'contado',
    ]);

    // ── 9. Filas de datos ────────────────────────────────────────────────────
    planillas.forEach((p, i) => {
      const isEven = i % 2 === 0;
      const bgArgb = isEven ? C.rowOdd : C.rowEven;

      const row = sheet.addRow({
        num: i + 1,
        planilla: p.planilla || '—',
        sede: p.sede || '—',
        placaMula: p.placaMula || '—',
        nombreConductorMula: p.nombreConductorMula || '—',
        nroFacturaMula: p.nroFacturaMula || '—',
        novedadesAverias: p.novedadesAverias || '—',
        valorAverias: p.valorAverias ?? 0,
        conductorRuta: p.conductorRuta || '—',
        placaTrasbordo: p.placaTrasbordo || '—',
        planillaTrasbordo: p.planillaTrasbordo || '—',
        tipoViaje: p.tipoViaje || '—',
        nroManifiesto: p.nroManifiesto || '—',
        fechaSalidaRuta: fmt(p.fechaSalidaRuta),
        ruta: p.ruta || '—',
        flete: p.flete ?? 0,
        anticipo: p.anticipo ?? 0,
        ajusteAutorizado: p.ajusteAutorizado ?? 0,
        plazoMaximo: p.plazoMaximo != null ? p.plazoMaximo : '—',
        retencion: p.retencion ?? 0,
        saldoPagar: p.saldoPagar ?? 0,
        alertaLegalizacion: p.alertaLegalizacion || 'En plazo ✓',
        fechaLegalizacion: fmt(p.fechaLegalizacion),
        fechaLegalizacionReal: fmt(p.fechaLegalizacionReal),
        estadoLegalizacion: p.estadoLegalizacion || '_',
        nroFacturaCorbeta: p.nroFacturaCorbeta || '—',
        observaciones: p.observaciones || '—',
        limiteEntrega: fmt(p.limiteEntrega),
        nroFacturaPago: p.nroFacturaPago || '—',
        fechaPago: fmt(p.fechaPago),
        valorPagado: p.valorPagado ?? 0,
        utilidad: p.utilidad ?? 0,
        observacionesCruze: p.observacionesCruze || '—',
        credito: p.credito ?? 0,
        contado: p.contado ?? 0,
        userEmail: p.userEmail || '—',
      });

      row.height = 20;

      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        const colKey = sheet.columns[colNumber - 1]?.key;
        const isMoneyCol = MONEY_KEYS.has(colKey);

        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgArgb } };
        cell.alignment = {
          vertical: 'middle',
          horizontal: isMoneyCol ? 'right' : 'center',
          wrapText: ['novedadesAverias', 'ruta', 'observaciones', 'observacionesCruze'].includes(colKey),
        };
        cell.border = {
          top: { style: 'hair', color: { argb: C.border } },
          left: { style: 'hair', color: { argb: C.border } },
          right: { style: 'hair', color: { argb: C.border } },
          bottom: { style: 'hair', color: { argb: C.border } },
        };

        if (isMoneyCol) {
          cell.numFmt = '"$"#,##0';
          cell.font = { bold: true, size: 10, color: { argb: C.moneyFont }, name: 'Calibri' };
        } else {
          cell.font = { size: 10, name: 'Calibri' };
        }

        if (colKey === 'alertaLegalizacion') {
          const val = String(cell.value || '');
          const isLeg = val.includes('Legalizado');
          const isVenc = val.toLowerCase().includes('vencida');
          cell.fill = {
            type: 'pattern', pattern: 'solid',
            fgColor: { argb: isLeg ? C.alertaOk : isVenc ? C.alertaVenc : C.alertaAmb },
          };
          cell.font = {
            bold: true, size: 10, name: 'Calibri',
            color: { argb: isLeg ? C.alertaOkFont : isVenc ? C.alertaVencFont : C.alertaAmbFont },
          };
        }

        if (colKey === 'saldoPagar') {
          cell.font = {
            bold: true, size: 10, name: 'Calibri',
            color: { argb: (p.saldoPagar ?? 0) > 0 ? C.saldoPos : C.saldoNeg },
          };
        }

        if (colKey === 'num') {
          cell.font = { size: 9, color: { argb: 'FF9CA3AF' }, name: 'Calibri' };
        }
      });
    });

    // ── 10. Separador antes de totales ───────────────────────────────────────
    const sepRow = sheet.addRow(Array(TOTAL_COLS).fill(''));
    sepRow.height = 4;
    sepRow.eachCell({ includeEmpty: true }, (cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.borderStrong } };
    });

    // ── 11. Fila de TOTALES ───────────────────────────────────────────────────
    const sum = (key) => planillas.reduce((s, p) => s + (p[key] || 0), 0);

    const totalRow = sheet.addRow({
      num: '',
      planilla: `▶  TOTAL  ·  ${planillas.length} registro${planillas.length !== 1 ? 's' : ''}`,
      sede: '', placaMula: '', nombreConductorMula: '', nroFacturaMula: '',
      novedadesAverias: '',
      valorAverias: sum('valorAverias'),
      conductorRuta: '', placaTrasbordo: '', planillaTrasbordo: '',
      tipoViaje: '', nroManifiesto: '', fechaSalidaRuta: '', ruta: '',
      flete: sum('flete'),
      anticipo: sum('anticipo'),
      ajusteAutorizado: sum('ajusteAutorizado'),
      plazoMaximo: '',
      retencion: sum('retencion'),
      saldoPagar: sum('saldoPagar'),
      alertaLegalizacion: '', fechaLegalizacion: '', fechaLegalizacionReal: '',
      estadoLegalizacion: '', nroFacturaCorbeta: '', observaciones: '', limiteEntrega: '',
      nroFacturaPago: '',
      fechaPago: '',
      valorPagado: sum('valorPagado'),
      utilidad: sum('utilidad'),
      observacionesCruze: '',
      credito: sum('credito'),
      contado: sum('contado'),
      userEmail: '',
    });

    totalRow.height = 28;
    totalRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const colKey = sheet.columns[colNumber - 1]?.key;
      const isMoneyCol = MONEY_KEYS.has(colKey);

      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.totalBg } };
      cell.font = { bold: true, size: 11, name: 'Calibri', color: { argb: C.totalFont } };
      cell.alignment = {
        vertical: 'middle',
        horizontal: isMoneyCol ? 'right' : colNumber === 2 ? 'left' : 'center',
      };
      cell.border = {
        top: { style: 'medium', color: { argb: 'FF3B82F6' } },
        bottom: { style: 'medium', color: { argb: 'FF3B82F6' } },
        left: { style: 'hair', color: { argb: 'FF3B82F688' } },
        right: { style: 'hair', color: { argb: 'FF3B82F688' } },
      };
      if (isMoneyCol) cell.numFmt = '"$"#,##0';
    });

    // ── 12. Fila de firma / generado ─────────────────────────────────────────
    sheet.addRow([]);
    const infoRow = sheet.addRow([
      `Generado el ${new Date().toLocaleDateString('es-CO', {
        day: '2-digit', month: 'long', year: 'numeric',
      })}  ·  Sistema de Planillas Cooespatrans`,
    ]);
    sheet.mergeCells(infoRow.number, 1, infoRow.number, TOTAL_COLS);
    const infoCell = infoRow.getCell(1);
    infoCell.font = { italic: true, size: 9, color: { argb: 'FF9CA3AF' }, name: 'Calibri' };
    infoCell.alignment = { horizontal: 'right', vertical: 'middle' };
    infoRow.height = 18;

    // ── 13. Freeze + autofilter ───────────────────────────────────────────────
    sheet.views = [{ state: 'frozen', xSplit: 0, ySplit: 3, topLeftCell: 'A4' }];
    sheet.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: TOTAL_COLS } };

    // ── 14. Enviar respuesta ──────────────────────────────────────────────────
    const label = desde && hasta ? `${desde}_al_${hasta}` : 'todos';
    const filename = `planillas_${label}.xlsx`;

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await workbook.xlsx.write(res);
    res.end();

  } catch (err) {
    console.error('[exportExcel planillas]', err);
    res.status(500).json({ message: 'Error al exportar a Excel', error: err.message });
  }
};