// services/logistica/reportes.js
// ─────────────────────────────────────────────────────────────────────────────
// Archivos que generaba la plantilla de viajes, ahora generados por el servidor:
//   - Bitácora completa y hoja por empresa (Excel y PDF, hoja carta horizontal)
//   - Relación de cargues para facturación (Excel y PDF)
//   - Relación de pago a conductores (Excel y PDF)
//   - Informe comparativo de utilidad con gráficas y texto (Excel y PDF)
//   - Planilla en blanco "BITÁCORA DE VIAJES COOESPATRANS" para imprimir
//   - Manifiesto electrónico de carga con código QR (PDF)
// Membrete: logo COOESPATRANS a la izquierda y logo del cliente (o
// MINTRANSPORTE) a la derecha, textos azul marino (31,78,120).
// ─────────────────────────────────────────────────────────────────────────────
const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const C = require('./calculos');

const AZUL = '#1F4E78';
const AZUL_ARGB = 'FF1F4E78';
const CEBRA = '#E8F1FA';
const TOTAL_BG = '#BDD7EE';
const BORDE = '#BDD7EE';
const LOGOS_DIR = path.join(__dirname, '..', '..', 'assets', 'logos');

// ── Logos ───────────────────────────────────────────────────────────────────
const LOGO_POR_EMPRESA = {
  alpina: 'alpina', surtiventas: 'surtiventas', 'surtiventas mocoa': 'surtiventas',
  'nutrisur pasto': 'nutrisur', 'nutrisur popayan': 'nutrisur', 'casa andina': 'casaandina',
  corbeta: 'corbeta', 'dulces & dulces': 'dulces',
};
function rutaLogo(clave) {
  if (!clave) return null;
  for (const ext of ['.png', '.jpg', '.jpeg']) {
    const p = path.join(LOGOS_DIR, clave + ext);
    if (fs.existsSync(p)) return p;
  }
  return null;
}
function logoEmpresa(empresa, claveConfigurada) {
  return rutaLogo(claveConfigurada) || rutaLogo(LOGO_POR_EMPRESA[String(empresa || '').trim().toLowerCase()]);
}
const LOGOS_DISPONIBLES = () => fs.existsSync(LOGOS_DIR)
  ? fs.readdirSync(LOGOS_DIR).map(f => f.replace(/\.(png|jpe?g)$/i, '')).filter(f => !['cooespatrans', 'mintransporte'].includes(f))
  : [];

// ── Utilidades ──────────────────────────────────────────────────────────────
const esNum = (v) => typeof v === 'number' && Number.isFinite(v);
const pesos = (v) => (esNum(v) ? C.fmtPesos(v) : (v ?? ''));
const pct = (v) => (esNum(v) ? `${(v * 100).toFixed(1)}%` : '');

function pdfABuffer(doc) {
  return new Promise((resolve, reject) => {
    const partes = [];
    doc.on('data', d => partes.push(d));
    doc.on('end', () => resolve(Buffer.concat(partes)));
    doc.on('error', reject);
    doc.end();
  });
}

// Ordena por placa y por fecha dentro de cada placa (agrupación por conductor)
function ordenarPorPlaca(filas) {
  return [...filas].sort((a, b) => {
    if (a.placa !== b.placa) return a.placa < b.placa ? -1 : 1;
    return new Date(a.fecha || 0) - new Date(b.fecha || 0);
  });
}

// ══════════════════════════════════════════════════════════════════════════
// PDF: membrete y tablas
// ══════════════════════════════════════════════════════════════════════════
function nuevoPdf(layout = 'portrait', margin = 34) {
  return new PDFDocument({ size: 'LETTER', layout, margin, bufferPages: true });
}

function imagenAjustada(doc, ruta, x, y, maxW, maxH, alinearDerecha = false) {
  if (!ruta) return;
  try {
    const img = doc.openImage(ruta);
    const k = Math.min(maxW / img.width, maxH / img.height);
    const w = img.width * k; const h = img.height * k;
    doc.image(img, alinearDerecha ? x + maxW - w : x, y + (maxH - h) / 2, { width: w, height: h });
  } catch { /* logo ilegible: se omite */ }
}

// Membrete de los informes de RELACION (fondo blanco, logos y texto azul)
function membreteRelacion(doc, { titulo, linea2 = 'TRANSPORTE DE CARGA SEGURO, CONFIABLE Y OPORTUNO', logoDerecha }) {
  const x0 = doc.page.margins.left;
  const ancho = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const y0 = doc.page.margins.top;
  doc.moveTo(x0, y0).lineTo(x0 + ancho, y0).lineWidth(0.6).strokeColor(AZUL).stroke();
  doc.moveTo(x0, y0 + 2).lineTo(x0 + ancho, y0 + 2).stroke();
  imagenAjustada(doc, rutaLogo('cooespatrans'), x0 + 4, y0 + 6, 110, 46);
  imagenAjustada(doc, logoDerecha, x0 + ancho - 114, y0 + 6, 110, 46, true);
  doc.fillColor(AZUL).font('Helvetica-Bold').fontSize(13)
    .text('COOPERATIVA DE TRANSPORTES ESPAÑA', x0 + 110, y0 + 10, { width: ancho - 220, align: 'center' })
    .text('"COOESPATRANS"', { width: ancho - 220, align: 'center' });
  doc.font('Helvetica-Oblique').fontSize(9)
    .text('NIT 900.109.959-2', { width: ancho - 220, align: 'center' })
    .text(linea2, { width: ancho - 220, align: 'center' });
  const yT = y0 + 72;
  doc.font('Helvetica-Bold').fontSize(12).fillColor(AZUL).text(titulo, x0, yT, { width: ancho, align: 'center' });
  const yL = doc.y + 4;
  doc.moveTo(x0, yL).lineTo(x0 + ancho, yL).lineWidth(0.6).strokeColor(AZUL).stroke();
  doc.moveTo(x0, yL + 2).lineTo(x0 + ancho, yL + 2).stroke();
  doc.fillColor('black');
  return yL + 12;
}

// Membrete de las hojas por empresa / bitácora (AgregarEncabezadoEmpresa)
function membreteEmpresa(doc, subtitulo = 'BITACORA DE VIAJES') {
  const x0 = doc.page.margins.left;
  const ancho = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const y0 = doc.page.margins.top;
  imagenAjustada(doc, rutaLogo('cooespatrans'), x0, y0, 130, 60);
  imagenAjustada(doc, rutaLogo('mintransporte'), x0 + ancho - 130, y0 + 4, 130, 55, true);
  doc.fillColor('black').font('Helvetica-Bold').fontSize(12)
    .text('COOPERATIVA DE TRANSPORTES ESPAÑA "COOESPATRANS"', x0, y0 + 2, { width: ancho, align: 'center' })
    .text('"COOESPATRANS"', { width: ancho, align: 'center' });
  doc.font('Helvetica').fontSize(10).text('NIT 900.109.959-3', { width: ancho, align: 'center' });
  doc.fontSize(11).text('TRANSPORTE DE CARGA SEGURO, CONFIABLE Y OPORTUNO', { width: ancho, align: 'center' });
  doc.font('Helvetica-Bold').text('REGISTRO GENERAL DE CARGUES EMPRESARIAL 2026', { width: ancho, align: 'center' })
    .text(subtitulo, { width: ancho, align: 'center' });
  return doc.y + 8;
}

// Tabla con encabezado repetido en cada página y filas especiales:
//   { _tipo: 'encabezado' } separador azul, { _tipo: 'total', celdas: {...} } fila de totales
function tablaPdf(doc, { columnas, filas, y, fontSize = 8, alturaFila = 16, cebraPorGrupo = true, encabezadoRepetido = true }) {
  const x0 = doc.page.margins.left;
  const ancho = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const totalPeso = columnas.reduce((s, c) => s + (c.peso || 1), 0);
  const anchos = columnas.map(c => (c.peso || 1) / totalPeso * ancho);
  let cy = y;
  const limite = () => doc.page.height - doc.page.margins.bottom - alturaFila;

  const dibujarEncabezado = () => {
    const h = alturaFila + 8;
    let x = x0;
    columnas.forEach((c, i) => {
      doc.rect(x, cy, anchos[i], h).fillAndStroke(AZUL, AZUL);
      doc.fillColor('white').font('Helvetica-Bold').fontSize(fontSize)
        .text(c.titulo, x + 2, cy + 3, { width: anchos[i] - 4, height: h - 4, align: 'center' });
      x += anchos[i];
    });
    cy += h;
  };
  const nuevaPagina = () => { doc.addPage(); cy = doc.page.margins.top; if (encabezadoRepetido) dibujarEncabezado(); };

  dibujarEncabezado();
  let n = 0;
  for (const f of filas) {
    if (cy > limite()) nuevaPagina();
    if (f._tipo === 'encabezado') { n = 0; dibujarEncabezado(); continue; }
    const esTotal = f._tipo === 'total';
    if (!esTotal) n += 1;
    let x = x0;
    const fondo = esTotal ? TOTAL_BG : (n % 2 === 0 ? CEBRA : null);
    // En la fila de totales la etiqueta ocupa las columnas iniciales sin valor
    const span = esTotal ? Math.max(1, columnas.findIndex((c, i) => i > 0 && f.celdas[c.clave] !== undefined)) : 1;
    columnas.forEach((c, i) => {
      if (esTotal && i > 0 && i < span) return; // ya cubierta por la etiqueta
      const w = esTotal && i === 0 ? anchos.slice(0, span).reduce((a, b) => a + b, 0) : anchos[i];
      if (fondo) doc.rect(x, cy, w, alturaFila).fill(fondo);
      doc.rect(x, cy, w, alturaFila).lineWidth(0.5).strokeColor(BORDE).stroke();
      const val = esTotal ? (f.celdas[c.clave] ?? '') : (c.valor ? c.valor(f) : f[c.clave]);
      doc.fillColor(esTotal ? AZUL : 'black').font(esTotal ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize)
        .text(String(val ?? ''), x + 2, cy + (alturaFila - fontSize) / 2 - 1,
          { width: w - 4, height: alturaFila, align: esTotal && i === 0 ? 'center' : (c.align || 'left'), lineBreak: false, ellipsis: true });
      x += w;
    });
    cy += alturaFila;
  }
  doc.fillColor('black');
  return cy;
}

function numerarPaginas(doc) {
  const r = doc.bufferedPageRange();
  for (let i = r.start; i < r.start + r.count; i += 1) {
    doc.switchToPage(i);
    const margenInferior = doc.page.margins.bottom;
    doc.page.margins.bottom = 0; // escribir en el pie sin que pdfkit cree otra página
    doc.font('Helvetica').fontSize(7).fillColor('#6b7280')
      .text(`Página ${i + 1} de ${r.count}`, doc.page.margins.left, doc.page.height - 22,
        { width: doc.page.width - doc.page.margins.left - doc.page.margins.right, align: 'right', lineBreak: false });
    doc.page.margins.bottom = margenInferior;
  }
}

// ══════════════════════════════════════════════════════════════════════════
// Excel: utilidades de estilo
// ══════════════════════════════════════════════════════════════════════════
const BORDE_X = { style: 'thin', color: { argb: 'FFBDD7EE' } };
const TODO_BORDE = { top: BORDE_X, left: BORDE_X, bottom: BORDE_X, right: BORDE_X };

function excelEncabezadoFila(ws, fila, titulos) {
  const r = ws.getRow(fila);
  titulos.forEach((t, i) => {
    const c = r.getCell(i + 1);
    c.value = t;
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL_ARGB } };
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    c.border = { top: { style: 'thin', color: { argb: AZUL_ARGB } }, bottom: { style: 'thin', color: { argb: AZUL_ARGB } }, left: { style: 'thin', color: { argb: AZUL_ARGB } }, right: { style: 'thin', color: { argb: AZUL_ARGB } } };
  });
  r.height = 30;
}

function excelLogo(wb, ws, ruta, col, fila, w, h) {
  if (!ruta) return;
  try {
    const ext = path.extname(ruta).slice(1).replace('jpg', 'jpeg');
    const id = wb.addImage({ filename: ruta, extension: ext });
    ws.addImage(id, { tl: { col, row: fila }, ext: { width: w, height: h }, editAs: 'oneCell' });
  } catch { /* sin logo */ }
}

// Membrete de RELACION (A1:lastCol)
function excelMembreteRelacion(wb, ws, ultimaCol, titulo, linea2, logoDer) {
  const L = String.fromCharCode(64 + ultimaCol);
  ws.mergeCells(`A1:${L}2`);
  ws.getCell('A1').value = 'COOPERATIVA DE TRANSPORTES ESPAÑA\n"COOESPATRANS"';
  ws.getCell('A1').font = { size: 13, bold: true, color: { argb: AZUL_ARGB } };
  ws.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  ws.getRow(1).height = 20; ws.getRow(2).height = 20;
  ws.mergeCells(`A3:${L}3`);
  ws.getCell('A3').value = `NIT 900.109.959-2\n${linea2}`;
  ws.getCell('A3').font = { size: 9, italic: true, color: { argb: AZUL_ARGB } };
  ws.getCell('A3').alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  ws.getRow(3).height = 26;
  ws.mergeCells(`A5:${L}5`);
  ws.getCell('A5').value = titulo;
  ws.getCell('A5').font = { size: 12, bold: true, color: { argb: AZUL_ARGB } };
  ws.getCell('A5').alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(5).height = 22;
  for (let c = 1; c <= ultimaCol; c += 1) {
    ws.getRow(1).getCell(c).border = { top: { style: 'double', color: { argb: AZUL_ARGB } } };
    ws.getRow(5).getCell(c).border = { bottom: { style: 'double', color: { argb: AZUL_ARGB } } };
  }
  excelLogo(wb, ws, rutaLogo('cooespatrans'), 0.1, 0.1, 100, 46);
  excelLogo(wb, ws, logoDer, ultimaCol - 1.6, 0.1, 100, 46);
}

function excelFormatoFila(r, n, nCols, cebra = true) {
  for (let c = 1; c <= nCols; c += 1) {
    const cell = r.getCell(c);
    cell.border = TODO_BORDE;
    if (cebra && n % 2 === 0) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F1FA' } };
  }
}
function excelFilaTotal(r, nCols) {
  for (let c = 1; c <= nCols; c += 1) {
    const cell = r.getCell(c);
    cell.font = { bold: true, color: { argb: AZUL_ARGB } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFBDD7EE' } };
    cell.border = { top: { style: 'medium', color: { argb: AZUL_ARGB } } };
  }
}
const FMT_PESOS = '"$" #,##0';

function anchosExcel(ws, anchos) { anchos.forEach((w, i) => { ws.getColumn(i + 1).width = w; }); }

function configurarHojaCarta(ws, { horizontal = false, filaTitulos = null, area = null } = {}) {
  ws.pageSetup = {
    paperSize: 1, orientation: horizontal ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
    horizontalCentered: true,
    margins: { left: 0.47, right: 0.47, top: 0.59, bottom: 0.47, header: 0.2, footer: 0.2 },
    ...(filaTitulos ? { printTitlesRow: `${filaTitulos}:${filaTitulos}` } : {}),
    ...(area ? { printArea: area } : {}),
  };
}

// ══════════════════════════════════════════════════════════════════════════
// 1. RELACIÓN DE CARGUES (facturación)
// ══════════════════════════════════════════════════════════════════════════
const COLS_RELACION = ['N°', 'Transportador', 'Placa', 'N° Planilla', 'Destino', 'Fecha', 'Cantidad', 'Tarifa', 'Auxiliar', 'Total'];

function filasAgrupadas(filas) {
  const ordenadas = ordenarPorPlaca(filas);
  const res = [];
  let placa = null; let n = 0;
  for (const f of ordenadas) {
    if (f.placa !== placa) {
      if (placa !== null) res.push({ _tipo: 'encabezado' });
      placa = f.placa; n = 0;
    }
    n += 1;
    res.push({ ...f, nLocal: n });
  }
  return res;
}

async function relacionExcel({ empresa, periodo, filas, logoClave }) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('RELACION', { properties: { tabColor: { argb: AZUL_ARGB } }, views: [{ state: 'frozen', ySplit: 7, showGridLines: false }] });
  excelMembreteRelacion(wb, ws, 10, `Relación de cargues ${empresa} para proceso de facturación del ${periodo}`,
    'TRANSPORTE DE CARGA SEGURO, CONFIABLE Y OPORTUNO', logoEmpresa(empresa, logoClave));
  excelEncabezadoFila(ws, 7, COLS_RELACION);
  let fila = 8; let total = 0;
  for (const f of filasAgrupadas(filas)) {
    if (f._tipo === 'encabezado') { excelEncabezadoFila(ws, fila, COLS_RELACION); ws.getRow(fila).height = 22; fila += 1; continue; }
    const r = ws.getRow(fila);
    r.values = [f.nLocal, f.transportador, f.placa, f.planilla || '', f.destino, f.fecha ? C.fmtDiaMes(f.fecha) : '',
      f.cantidad, f.totalTarifa === '' ? '' : f.totalTarifa, f.totalAuxiliar === '' ? '' : f.totalAuxiliar, f.total === '' ? '' : f.total];
    [8, 9, 10].forEach(c => { r.getCell(c).numFmt = FMT_PESOS; });
    [1, 3, 4, 6, 7].forEach(c => { r.getCell(c).alignment = { horizontal: 'center' }; });
    excelFormatoFila(r, f.nLocal, 10);
    if (esNum(f.total)) total += f.total;
    fila += 1;
  }
  const rt = ws.getRow(fila);
  ws.mergeCells(fila, 1, fila, 2);
  rt.getCell(1).value = 'TOTAL'; rt.getCell(1).alignment = { horizontal: 'center' };
  rt.getCell(10).value = total; rt.getCell(10).numFmt = FMT_PESOS;
  excelFilaTotal(rt, 10);
  anchosExcel(ws, [6, 26, 10, 12, 24, 14, 10, 14, 14, 16]);
  configurarHojaCarta(ws, { filaTitulos: 7, area: `A1:J${fila}` });
  return { buffer: await wb.xlsx.writeBuffer(), total };
}

async function relacionPdf({ empresa, periodo, filas, logoClave }) {
  const doc = nuevoPdf('portrait');
  const y = membreteRelacion(doc, { titulo: `Relación de cargues ${empresa} para proceso de facturación del ${periodo}`, logoDerecha: logoEmpresa(empresa, logoClave) });
  const grupos = filasAgrupadas(filas);
  const total = filas.reduce((s, f) => s + (esNum(f.total) ? f.total : 0), 0);
  grupos.push({ _tipo: 'total', celdas: { n: 'TOTAL', total: pesos(total) } });
  tablaPdf(doc, {
    y, fontSize: 7.5,
    columnas: [
      { titulo: 'N°', clave: 'n', peso: 0.5, align: 'center', valor: f => f.nLocal },
      { titulo: 'Transportador', clave: 'transportador', peso: 2 },
      { titulo: 'Placa', clave: 'placa', peso: 0.85, align: 'center' },
      { titulo: 'N° Planilla', clave: 'planilla', peso: 0.95, align: 'center' },
      { titulo: 'Destino', clave: 'destino', peso: 1.8 },
      { titulo: 'Fecha', clave: 'fecha', peso: 1.5, align: 'center', valor: f => (f.fecha ? C.fmtDiaMes(f.fecha) : '') },
      { titulo: 'Cant.', clave: 'cantidad', peso: 0.6, align: 'center' },
      { titulo: 'Tarifa', clave: 'totalTarifa', peso: 1.2, align: 'right', valor: f => pesos(f.totalTarifa) },
      { titulo: 'Auxiliar', clave: 'totalAuxiliar', peso: 1.2, align: 'right', valor: f => pesos(f.totalAuxiliar) },
      { titulo: 'Total', clave: 'total', peso: 1.3, align: 'right', valor: f => pesos(f.total) },
    ],
    filas: grupos,
  });
  numerarPaginas(doc);
  return { buffer: await pdfABuffer(doc), total };
}

// ══════════════════════════════════════════════════════════════════════════
// 2. RELACIÓN DE PAGO A CONDUCTORES
// ══════════════════════════════════════════════════════════════════════════
const COLS_PAGO = ['N', 'Transportador', 'Placa', 'N Planilla', 'Destino', 'Fecha', 'Cantidad', 'Flete Conductor', 'Auxiliar Pagado', 'Total Pagado'];

function datosPago(filas) {
  const placas = [...new Set(filas.map(f => f.placa))].sort();
  const bloques = placas.map(p => filas.filter(f => f.placa === p).map((f, i) => {
    const fl = esNum(f.totalFlete) ? f.totalFlete : 0;
    const ax = esNum(f.totalAuxiliarPagado) ? f.totalAuxiliarPagado : 0;
    return { ...f, nLocal: i + 1, totalPagado: fl + ax, _fl: fl, _ax: ax };
  }));
  const tot = { flete: 0, aux: 0, pagado: 0 };
  bloques.flat().forEach(f => { tot.flete += f._fl; tot.aux += f._ax; tot.pagado += f.totalPagado; });
  return { bloques, tot };
}

async function pagoExcel({ empresa, periodo, filas, logoClave }) {
  const { bloques, tot } = datosPago(filas);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('PAGOS', { properties: { tabColor: { argb: AZUL_ARGB } }, views: [{ state: 'frozen', ySplit: 7, showGridLines: false }] });
  excelMembreteRelacion(wb, ws, 10, `Relacion de pago a conductores ${empresa} para el periodo ${periodo}`,
    'RELACION DE PAGO A CONDUCTORES', logoEmpresa(empresa, logoClave));
  let fila = 7;
  for (const b of bloques) {
    excelEncabezadoFila(ws, fila, COLS_PAGO); ws.getRow(fila).height = 28; fila += 1;
    for (const f of b) {
      const r = ws.getRow(fila);
      r.values = [f.nLocal, f.transportador, f.placa, f.planilla || '', f.destino, f.fecha ? new Date(f.fecha) : '',
        f.cantidad, f.totalFlete === '' ? '' : f.totalFlete, f.totalAuxiliarPagado === '' ? '' : f.totalAuxiliarPagado, f.totalPagado];
      r.getCell(6).numFmt = 'dd/mm/yyyy';
      [8, 9, 10].forEach(c => { r.getCell(c).numFmt = FMT_PESOS; });
      [1, 3, 6, 7].forEach(c => { r.getCell(c).alignment = { horizontal: 'center' }; });
      excelFormatoFila(r, f.nLocal, 10);
      fila += 1;
    }
  }
  ws.mergeCells(fila, 1, fila, 7);
  const rt = ws.getRow(fila);
  rt.getCell(1).value = 'TOTAL GENERAL'; rt.getCell(1).alignment = { horizontal: 'center' };
  rt.getCell(8).value = tot.flete; rt.getCell(9).value = tot.aux; rt.getCell(10).value = tot.pagado;
  [8, 9, 10].forEach(c => { rt.getCell(c).numFmt = FMT_PESOS; });
  excelFilaTotal(rt, 10);
  anchosExcel(ws, [6, 26, 10, 12, 20, 12, 10, 16, 16, 16]);
  configurarHojaCarta(ws, { area: `A1:J${fila}` });
  return { buffer: await wb.xlsx.writeBuffer(), totales: tot };
}

async function pagoPdf({ empresa, periodo, filas, logoClave }) {
  const { bloques, tot } = datosPago(filas);
  const doc = nuevoPdf('portrait');
  const y = membreteRelacion(doc, { titulo: `Relacion de pago a conductores ${empresa} para el periodo ${periodo}`, linea2: 'RELACION DE PAGO A CONDUCTORES', logoDerecha: logoEmpresa(empresa, logoClave) });
  const lista = [];
  bloques.forEach((b, i) => { if (i > 0) lista.push({ _tipo: 'encabezado' }); lista.push(...b); });
  lista.push({ _tipo: 'total', celdas: { n: 'TOTAL GENERAL', totalFlete: pesos(tot.flete), totalAuxiliarPagado: pesos(tot.aux), totalPagado: pesos(tot.pagado) } });
  tablaPdf(doc, {
    y, fontSize: 7.5,
    columnas: [
      { titulo: 'N', clave: 'n', peso: 0.5, align: 'center', valor: f => f.nLocal },
      { titulo: 'Transportador', clave: 'transportador', peso: 2.1 },
      { titulo: 'Placa', clave: 'placa', peso: 0.9, align: 'center' },
      { titulo: 'N Planilla', clave: 'planilla', peso: 0.9, align: 'center' },
      { titulo: 'Destino', clave: 'destino', peso: 1.9 },
      { titulo: 'Fecha', clave: 'fecha', peso: 1, align: 'center', valor: f => C.fmtFecha(f.fecha) },
      { titulo: 'Cant.', clave: 'cantidad', peso: 0.6, align: 'center' },
      { titulo: 'Flete Conductor', clave: 'totalFlete', peso: 1.3, align: 'right', valor: f => pesos(f.totalFlete) },
      { titulo: 'Auxiliar Pagado', clave: 'totalAuxiliarPagado', peso: 1.3, align: 'right', valor: f => pesos(f.totalAuxiliarPagado) },
      { titulo: 'Total Pagado', clave: 'totalPagado', peso: 1.3, align: 'right', valor: f => pesos(f.totalPagado) },
    ],
    filas: lista,
  });
  numerarPaginas(doc);
  return { buffer: await pdfABuffer(doc), totales: tot };
}

// ══════════════════════════════════════════════════════════════════════════
// 3. INFORME COMPARATIVO DE UTILIDAD
// ══════════════════════════════════════════════════════════════════════════
function datosUtilidad(filas) {
  const grupos = filasAgrupadas(filas).map(f => {
    if (f._tipo) return f;
    const total = esNum(f.total) ? f.total : 0;
    const pagado = (esNum(f.totalFlete) ? f.totalFlete : 0) + (esNum(f.totalAuxiliarPagado) ? f.totalAuxiliarPagado : 0);
    const util = esNum(f.utilidad) ? f.utilidad : total - pagado;
    return { ...f, _total: total, _pagado: pagado, _util: util, _pct: esNum(f.utilidadPct) ? f.utilidadPct : 0 };
  });
  const viajes = grupos.filter(f => !f._tipo);
  const tot = viajes.reduce((a, f) => ({ total: a.total + f._total, pagado: a.pagado + f._pagado, util: a.util + f._util }), { total: 0, pagado: 0, util: 0 });
  tot.pct = tot.total ? tot.util / tot.total : 0;
  return { grupos, viajes, tot };
}

function narrativaUtilidad(empresa, periodo, n, tot) {
  return `Durante el periodo ${periodo}, ${empresa} registró ${n} viajes pendientes de facturar, por un total cobrado de $${C.fmtMiles(tot.total)}. ` +
    `De ese valor se pagó a los conductores (flete y auxiliar) $${C.fmtMiles(tot.pagado)}, dejando una utilidad para Cooespatrans de ` +
    `$${C.fmtMiles(tot.util)}, equivalente a un margen de rentabilidad del ${pct(tot.pct)} sobre lo facturado en este periodo.`;
}

const COLS_UTIL = ['N°', 'Transportador', 'Placa', 'N° Planilla', 'Destino', 'Fecha', 'Cantidad', 'Total Cobrado', 'Total Pagado Conductor', 'Utilidad Generada', 'Utilidad %'];

async function utilidadExcel({ empresa, periodo, filas, logoClave }) {
  const { grupos, viajes, tot } = datosUtilidad(filas);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Informe Utilidad', { properties: { tabColor: { argb: AZUL_ARGB } }, views: [{ state: 'frozen', ySplit: 7, showGridLines: false }] });
  excelMembreteRelacion(wb, ws, 11, `Informe de utilidad ${empresa} - comparativo viaje a viaje del periodo ${periodo}`,
    'TRANSPORTE DE CARGA SEGURO, CONFIABLE Y OPORTUNO', logoEmpresa(empresa, logoClave));
  excelEncabezadoFila(ws, 7, COLS_UTIL);
  let fila = 8;
  for (const f of grupos) {
    if (f._tipo === 'encabezado') { excelEncabezadoFila(ws, fila, COLS_UTIL); ws.getRow(fila).height = 22; fila += 1; continue; }
    const r = ws.getRow(fila);
    r.values = [f.nLocal, f.transportador, f.placa, f.planilla || '', f.destino, f.fecha ? new Date(f.fecha) : '', f.cantidad, f._total, f._pagado, f._util, f._pct];
    r.getCell(6).numFmt = 'dd/mm/yyyy';
    [8, 9, 10].forEach(c => { r.getCell(c).numFmt = FMT_PESOS; });
    r.getCell(11).numFmt = '0.0%';
    excelFormatoFila(r, f.nLocal, 11);
    fila += 1;
  }
  ws.mergeCells(fila, 1, fila, 7);
  const rt = ws.getRow(fila);
  rt.getCell(1).value = 'TOTAL GENERAL';
  rt.getCell(8).value = tot.total; rt.getCell(9).value = tot.pagado; rt.getCell(10).value = tot.util; rt.getCell(11).value = tot.pct;
  [8, 9, 10].forEach(c => { rt.getCell(c).numFmt = FMT_PESOS; });
  rt.getCell(11).numFmt = '0.0%';
  excelFilaTotal(rt, 11);
  // Resumen con barras de datos (comparativo de totales y distribución)
  let rr = fila + 3;
  ws.getCell(`A${rr - 1}`).value = 'Comparativo de Totales';
  ws.getCell(`A${rr - 1}`).font = { bold: true, color: { argb: AZUL_ARGB } };
  [['Total Cobrado', tot.total], ['Total Pagado Conductor', tot.pagado], ['Utilidad Generada', tot.util]].forEach(([k, v], i) => {
    ws.mergeCells(rr + i, 1, rr + i, 2);
    ws.getCell(rr + i, 1).value = k;
    ws.getCell(rr + i, 3).value = v; ws.getCell(rr + i, 3).numFmt = FMT_PESOS;
    ws.getCell(rr + i, 4).value = tot.total ? v / tot.total : 0; ws.getCell(rr + i, 4).numFmt = '0.0%';
  });
  ws.addConditionalFormatting({
    ref: `C${rr}:C${rr + 2}`,
    rules: [{ type: 'dataBar', minLength: 0, maxLength: 100, cfvo: [{ type: 'num', value: 0 }, { type: 'max' }], color: { argb: AZUL_ARGB }, gradient: false }],
  });
  rr += 4;
  ws.mergeCells(rr, 1, rr + 3, 11);
  ws.getCell(rr, 1).value = narrativaUtilidad(empresa, periodo, viajes.length, tot);
  ws.getCell(rr, 1).font = { italic: true, size: 10, color: { argb: AZUL_ARGB } };
  ws.getCell(rr, 1).alignment = { wrapText: true, vertical: 'top' };
  anchosExcel(ws, [6, 24, 10, 12, 20, 12, 10, 16, 18, 16, 11]);
  configurarHojaCarta(ws, { filaTitulos: 7, area: `A1:K${rr + 3}` });
  return { buffer: await wb.xlsx.writeBuffer(), totales: tot };
}

function graficaBarrasPdf(doc, x, y, w, h, datos) {
  const max = Math.max(...datos.map(d => Math.abs(d.valor)), 1);
  doc.font('Helvetica-Bold').fontSize(10).fillColor(AZUL).text('Comparativo de Totales', x, y, { width: w, align: 'center' });
  const base = y + h - 22; const area = h - 48;
  const bw = w / (datos.length * 2);
  datos.forEach((d, i) => {
    const bh = Math.max(1, Math.abs(d.valor) / max * area);
    const bx = x + bw / 2 + i * bw * 2;
    doc.rect(bx, base - bh, bw, bh).fill(d.color);
    doc.fillColor('#111827').font('Helvetica').fontSize(7.5).text(C.fmtPesos(d.valor), bx - bw / 2, base - bh - 11, { width: bw * 2, align: 'center' });
    doc.text(d.etiqueta, bx - bw / 2, base + 4, { width: bw * 2, align: 'center' });
  });
  doc.moveTo(x, base).lineTo(x + w, base).lineWidth(0.5).strokeColor('#9ca3af').stroke();
}

function graficaTortaPdf(doc, cx, cy, r, datos, titulo, x, w) {
  doc.font('Helvetica-Bold').fontSize(10).fillColor(AZUL).text(titulo, x, cy - r - 22, { width: w, align: 'center' });
  const total = datos.reduce((s, d) => s + Math.max(0, d.valor), 0) || 1;
  let ang = -Math.PI / 2;
  datos.forEach(d => {
    const frac = Math.max(0, d.valor) / total;
    const a2 = ang + frac * Math.PI * 2;
    if (frac > 0) {
      if (frac >= 0.9999) doc.circle(cx, cy, r).fill(d.color);
      else {
        doc.moveTo(cx, cy).lineTo(cx + r * Math.cos(ang), cy + r * Math.sin(ang));
        const pasos = Math.max(2, Math.ceil(frac * 60));
        for (let k = 1; k <= pasos; k += 1) { const a = ang + (a2 - ang) * k / pasos; doc.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a)); }
        doc.closePath().fill(d.color);
      }
      const am = (ang + a2) / 2;
      doc.fillColor('white').font('Helvetica-Bold').fontSize(9)
        .text(`${(frac * 100).toFixed(1)}%`, cx + r * 0.55 * Math.cos(am) - 20, cy + r * 0.55 * Math.sin(am) - 5, { width: 40, align: 'center' });
    }
    ang = a2;
  });
  let ly = cy + r + 8;
  datos.forEach(d => {
    doc.rect(x + w / 2 - 70, ly + 1, 8, 8).fill(d.color);
    doc.fillColor('#111827').font('Helvetica').fontSize(8).text(d.etiqueta, x + w / 2 - 58, ly, { width: 160 });
    ly += 12;
  });
}

async function utilidadPdf({ empresa, periodo, filas, logoClave }) {
  const { grupos, viajes, tot } = datosUtilidad(filas);
  const doc = nuevoPdf('portrait');
  const y = membreteRelacion(doc, { titulo: `Informe de utilidad ${empresa} - comparativo viaje a viaje del periodo ${periodo}`, logoDerecha: logoEmpresa(empresa, logoClave) });
  const lista = [...grupos, { _tipo: 'total', celdas: { n: 'TOTAL GENERAL', _total: pesos(tot.total), _pagado: pesos(tot.pagado), _util: pesos(tot.util), _pct: pct(tot.pct) } }];
  let cy = tablaPdf(doc, {
    y, fontSize: 7,
    columnas: [
      { titulo: 'N°', clave: 'n', peso: 0.45, align: 'center', valor: f => f.nLocal },
      { titulo: 'Transportador', clave: 'transportador', peso: 1.9 },
      { titulo: 'Placa', clave: 'placa', peso: 0.8, align: 'center' },
      { titulo: 'N° Planilla', clave: 'planilla', peso: 0.8, align: 'center' },
      { titulo: 'Destino', clave: 'destino', peso: 1.6 },
      { titulo: 'Fecha', clave: 'fecha', peso: 0.95, align: 'center', valor: f => C.fmtFecha(f.fecha) },
      { titulo: 'Cant.', clave: 'cantidad', peso: 0.5, align: 'center' },
      { titulo: 'Total Cobrado', clave: '_total', peso: 1.15, align: 'right', valor: f => pesos(f._total) },
      { titulo: 'Total Pagado Conductor', clave: '_pagado', peso: 1.15, align: 'right', valor: f => pesos(f._pagado) },
      { titulo: 'Utilidad Generada', clave: '_util', peso: 1.15, align: 'right', valor: f => pesos(f._util) },
      { titulo: 'Utilidad %', clave: '_pct', peso: 0.75, align: 'center', valor: f => pct(f._pct) },
    ],
    filas: lista,
  });
  // Gráficas apiladas y texto narrativo
  const x0 = doc.page.margins.left;
  const ancho = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  if (cy + 430 > doc.page.height - doc.page.margins.bottom) { doc.addPage(); cy = doc.page.margins.top; }
  cy += 20;
  graficaBarrasPdf(doc, x0 + 40, cy, ancho - 80, 190, [
    { etiqueta: 'Total Cobrado', valor: tot.total, color: AZUL },
    { etiqueta: 'Total Pagado Conductor', valor: tot.pagado, color: '#5B9BD5' },
    { etiqueta: 'Utilidad Generada', valor: tot.util, color: '#70AD47' },
  ]);
  cy += 230;
  graficaTortaPdf(doc, x0 + ancho / 2, cy + 70, 65, [
    { etiqueta: 'Total Pagado Conductor', valor: tot.pagado, color: '#5B9BD5' },
    { etiqueta: 'Utilidad Generada', valor: tot.util, color: '#70AD47' },
  ], 'Pagado vs Utilidad', x0, ancho);
  cy += 180;
  doc.font('Helvetica-Oblique').fontSize(10).fillColor(AZUL)
    .text(narrativaUtilidad(empresa, periodo, viajes.length, tot), x0 + 20, cy, { width: ancho - 40, align: 'justify' });
  numerarPaginas(doc);
  return { buffer: await pdfABuffer(doc), totales: tot };
}

// ══════════════════════════════════════════════════════════════════════════
// 4. BITÁCORA y HOJA POR EMPRESA
// ══════════════════════════════════════════════════════════════════════════
const COLS_BITACORA = [
  ['N°', 'numero', 5], ['EMPRESA', 'empresa', 16], ['MANIFIESTO', 'manifiesto', 13], ['CONDUCTOR', 'conductor', 22],
  ['PLACA', 'placa', 9], ['FECHA', 'fecha', 11], ['DESTINO', 'destino', 24], ['PESO KG', 'pesoKg', 9],
  ['TARIFA', 'tarifa', 12], ['FLETE', 'flete', 12], ['ANTICIPO', 'anticipo', 12], ['AUXILIAR', 'auxiliar', 11],
  ['Reportado', 'reportado', 22], ['CorreoEnviado', 'correoEnviado', 22], ['OBSERVACIONES', 'observaciones', 28],
];

// incluirControl: columnas de control (bitácora); incluirCalculos: SALDO y UTILIDAD (hojas por empresa)
async function bitacoraExcel({ viajes, titulo = 'BITACORA', incluirControl = true, incluirCalculos = false, subtitulo = 'BITACORA DE VIAJES' }) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(String(titulo).slice(0, 31), { views: [{ state: 'frozen', ySplit: incluirCalculos ? 7 : 7, showGridLines: false }] });
  const cols = [...COLS_BITACORA];
  if (incluirControl) cols.push(['Enviar (X)', 'enviarManifiesto', 10], ['ManifiestoEnviado', 'manifiestoEnviado', 22]);
  if (incluirCalculos) cols.push(['SALDO', 'saldo', 13], ['UTILIDAD', 'utilidad', 13]);
  const nCols = cols.length;
  const L = (n) => (n <= 26 ? String.fromCharCode(64 + n) : `A${String.fromCharCode(64 + n - 26)}`);
  const textos = ['COOPERATIVA DE TRANSPORTES ESPAÑA "COOESPATRANS"', '"COOESPATRANS"', 'NIT 900.109.959-3',
    'TRANSPORTE DE CARGA SEGURO, CONFIABLE Y OPORTUNO', 'REGISTRO GENERAL DE CARGUES EMPRESARIAL 2026', subtitulo];
  textos.forEach((t, i) => {
    ws.mergeCells(`A${i + 1}:${L(12)}${i + 1}`);
    const c = ws.getCell(`A${i + 1}`);
    c.value = t; c.alignment = { horizontal: 'center', vertical: 'middle' };
    c.font = { name: 'Calibri', size: [12, 12, 10, 11, 11, 11][i], bold: [true, true, false, false, true, true][i] };
  });
  excelLogo(wb, ws, rutaLogo('cooespatrans'), 0.05, 0, 130, 60);
  excelLogo(wb, ws, rutaLogo('mintransporte'), 10.4, 0.1, 125, 55);
  if (incluirCalculos) {
    const tot = viajes.reduce((s, v) => s + (esNum(v.utilidad) ? v.utilidad : 0), 0);
    const c = ws.getCell(`${L(nCols)}6`); c.value = tot; c.numFmt = FMT_PESOS; c.font = { bold: true };
  }
  excelEncabezadoFila(ws, 7, cols.map(c => c[0]));
  viajes.forEach((v, i) => {
    const r = ws.getRow(8 + i);
    r.values = cols.map(([, k]) => {
      if (k === 'fecha') return v.fecha ? new Date(v.fecha) : '';
      if (k === 'enviarManifiesto') return v.enviarManifiesto ? 'X' : '';
      if (k === 'saldo' || k === 'utilidad') return esNum(v[k]) ? v[k] : '';
      return v[k] ?? '';
    });
    cols.forEach(([, k], ci) => {
      const cell = r.getCell(ci + 1);
      cell.border = { top: { style: 'thin', color: { argb: 'FFBFBFBF' } }, left: { style: 'thin', color: { argb: 'FFBFBFBF' } }, bottom: { style: 'thin', color: { argb: 'FFBFBFBF' } }, right: { style: 'thin', color: { argb: 'FFBFBFBF' } } };
      if (k === 'fecha') cell.numFmt = 'dd/mm/yyyy';
      if (['tarifa', 'flete', 'anticipo', 'auxiliar', 'saldo', 'utilidad'].includes(k)) cell.numFmt = '"$"#,##0';
    });
  });
  cols.forEach(([, , w], i) => { ws.getColumn(i + 1).width = w; });
  configurarHojaCarta(ws, { horizontal: true, filaTitulos: 7 });
  return wb.xlsx.writeBuffer();
}

async function bitacoraPdf({ viajes, subtitulo = 'BITACORA DE VIAJES', columnasCompletas = false }) {
  const doc = nuevoPdf('landscape', 42);
  const y = membreteEmpresa(doc, subtitulo);
  const cols = [
    { titulo: 'N°', clave: 'numero', peso: 0.45, align: 'center' },
    { titulo: 'EMPRESA', clave: 'empresa', peso: 1.3 },
    { titulo: 'MANIFIESTO', clave: 'manifiesto', peso: 1.1 },
    { titulo: 'CONDUCTOR', clave: 'conductor', peso: 1.8 },
    { titulo: 'PLACA', clave: 'placa', peso: 0.8, align: 'center' },
    { titulo: 'FECHA', clave: 'fecha', peso: 0.95, align: 'center', valor: v => C.fmtFecha(v.fecha) },
    { titulo: 'DESTINO', clave: 'destino', peso: 2 },
    { titulo: 'PESO KG', clave: 'pesoKg', peso: 0.75, align: 'right', valor: v => C.fmtMiles(v.pesoKg) },
    { titulo: 'TARIFA', clave: 'tarifa', peso: 1, align: 'right', valor: v => pesos(v.tarifa) },
    { titulo: 'FLETE', clave: 'flete', peso: 1, align: 'right', valor: v => pesos(v.flete) },
    { titulo: 'ANTICIPO', clave: 'anticipo', peso: 1, align: 'right', valor: v => pesos(v.anticipo) },
    { titulo: 'AUXILIAR', clave: 'auxiliar', peso: 0.9, align: 'right', valor: v => pesos(v.auxiliar) },
  ];
  if (columnasCompletas) {
    cols.push(
      { titulo: 'Reportado', clave: 'reportado', peso: 1.4 },
      { titulo: 'CorreoEnviado', clave: 'correoEnviado', peso: 1.4 },
      { titulo: 'OBSERVACIONES', clave: 'observaciones', peso: 1.5 },
      { titulo: 'Enviar (X)', clave: 'enviarManifiesto', peso: 0.6, align: 'center', valor: v => (v.enviarManifiesto ? 'X' : '') },
      { titulo: 'ManifiestoEnviado', clave: 'manifiestoEnviado', peso: 1.4 },
    );
  }
  tablaPdf(doc, { y, columnas: cols, filas: viajes, fontSize: columnasCompletas ? 5.6 : 7, alturaFila: columnasCompletas ? 19 : 14 });
  numerarPaginas(doc);
  return pdfABuffer(doc);
}

// Planilla en blanco "BITÁCORA DE VIAJES COOESPATRANS" (hoja COOESPATRANS)
async function planillaBlancoPdf({ folio }) {
  const doc = nuevoPdf('landscape', 30);
  const x0 = doc.page.margins.left;
  const ancho = doc.page.width - 60;
  imagenAjustada(doc, rutaLogo('cooespatrans'), x0, 26, 120, 52);
  doc.font('Helvetica-Bold').fontSize(16).fillColor('black').text('BITACORA DE VIAJES COOESPATRANS', x0, 40, { width: ancho, align: 'center' });
  doc.fontSize(11).text(`FOLIO: ${C.fmtFecha(folio)}`, x0, 44, { width: ancho, align: 'right' });
  const filas = Array.from({ length: 30 }, (_, i) => ({ n: i + 1, fecha: C.fmtFecha(folio) }));
  tablaPdf(doc, {
    y: 90, fontSize: 8, alturaFila: 15,
    columnas: [
      { titulo: 'N°', clave: 'n', peso: 0.4, align: 'center' },
      { titulo: 'EMPRESA', clave: 'x1', peso: 1.3 }, { titulo: 'MANIFIESTO', clave: 'x2', peso: 1 },
      { titulo: 'CONDUCTOR', clave: 'x3', peso: 1.8 }, { titulo: 'PLACA', clave: 'x4', peso: 0.8 },
      { titulo: 'FECHA', clave: 'fecha', peso: 0.9, align: 'center' }, { titulo: 'DESTINO', clave: 'x5', peso: 1.8 },
      { titulo: 'PESO KG', clave: 'x6', peso: 0.8 }, { titulo: 'TARIFA', clave: 'x7', peso: 0.9 },
      { titulo: 'FLETE', clave: 'x8', peso: 0.9 }, { titulo: 'ANTICIPO', clave: 'x9', peso: 0.9 }, { titulo: 'AUXILIAR', clave: 'x10', peso: 0.9 },
    ],
    filas,
  });
  return pdfABuffer(doc);
}

// ══════════════════════════════════════════════════════════════════════════
// 5. MANIFIESTO ELECTRÓNICO DE CARGA (copia con QR)
// ══════════════════════════════════════════════════════════════════════════
const ALTURAS_MANIF = [20, 20, 20, 20, 20, 20, 15, 15, 13, 13, 14, 16, 15, 15, 15, 15, 15, 15, 15, 15, 16,
  15, 15, 15, 15, 15, 16, 17, 17, 17, 17, 17, 17, 17, 17, 27, 17, 17, 17, 12];

const LEY = '"La impresión en soporte cartular (papel) de este acto administrativo producido por medios electronicos en cumplimiento de la ley 527 de 1999 (Articulos 6 al 13) y de la ley 962 de 2005 (Articulo 6), es una reproducción del documento original que se encuentra en formato electrónico en la Base de Datos del RNDC en el Ministerio de Transporte, cuya representación digital goza de autenticidad, integridad y no repudio"';
const FRAUDE = 'Si es víctima de algún fraude o conoce de alguna irregularidad en el Registro Nacional de Despachos de Carga RNDC denúnciela a la Superintendencia de Puertos y Transporte, en la línea gratuita nacional 018000 915615 y a través del correo electrónico: atencionciudadano@supertransporte.gov.co';

// Texto del QR (formato del manifiesto oficial)
function textoQR(d) {
  const p = (s, n) => String(s || '').slice(0, n);
  return [`MEC:${d.rad}`, `Fecha:${d.fechaExp}`, `Placa:${d.placa}`, `Config:${d.config}`, `Orig:${d.origen}`,
    `Dest:${d.destino}`, `Mercancia:${p(d.prodDesc, 30)}`, `Conductor:${d.condDoc}`, `Empresa:${p(d.empresa, 30)}`,
    `Seguro:${d.segQR}`].join('\r\n');
}

async function manifiestoPdf(d) {
  const doc = new PDFDocument({ size: 'LETTER', layout: 'landscape', margin: 9 });
  const anchoUtil = doc.page.width - 18;
  const altoUtil = doc.page.height - 18;
  const k = Math.min(1, altoUtil / ALTURAS_MANIF.reduce((a, b) => a + b, 0));
  const colW = anchoUtil / 24;
  const filaY = [9];
  ALTURAS_MANIF.forEach((h, i) => filaY.push(filaY[i] + h * k));
  const X = (c) => 9 + (c - 1) * colW;

  const caja = (r1, c1, r2, c2, etq, valor, { tam = 9, alin = 'left', borde = true, negr = false, fondo = null, vcentro = false } = {}) => {
    const x = X(c1); const y = filaY[r1 - 1]; const w = X(c2 + 1) - x; const h = filaY[r2] - y;
    if (fondo) doc.rect(x, y, w, h).fill(fondo);
    if (borde) doc.rect(x, y, w, h).lineWidth(0.7).strokeColor('black').stroke();
    let ty = y + 1.5;
    if (etq) {
      doc.fillColor('black').font('Helvetica-Bold').fontSize(6.5 * k);
      const hEtq = doc.heightOfString(etq, { width: w - 4 });
      doc.text(etq, x + 2, ty, { width: w - 4 });
      ty += Math.max(7.5 * k, hEtq + 1);
    }
    const fs = tam * k;
    if (vcentro && !etq) {
      const hTxt = doc.font(negr ? 'Helvetica-Bold' : 'Helvetica').fontSize(fs).heightOfString(String(valor ?? ''), { width: w - 4 });
      ty = y + Math.max(1, (h - hTxt) / 2);
    }
    doc.fillColor('black').font(negr ? 'Helvetica-Bold' : 'Helvetica').fontSize(fs)
      .text(String(valor ?? ''), x + 2, ty, { width: w - 4, height: Math.max(1, y + h - ty), align: alin, ellipsis: true });
  };
  const titulo = (r, c1, c2, t) => caja(r, c1, r, c2, '', t, { tam: 10, alin: 'center', negr: true, fondo: '#D9D9D9', vcentro: true });

  // Encabezado
  imagenAjustada(doc, rutaLogo('cooespatrans'), X(1) + 2, filaY[0] + 2, X(5) - X(1) - 4, filaY[4] - filaY[0] - 4);
  caja(1, 5, 1, 14, '', 'MANIFIESTO ELECTRONICO DE CARGA', { tam: 13, alin: 'center', borde: false, negr: true, vcentro: true });
  caja(2, 5, 2, 14, '', d.empresa, { tam: 11, alin: 'center', borde: false, negr: true, vcentro: true });
  caja(4, 5, 4, 14, '', `Nit: ${d.empNit}`, { tam: 10, alin: 'center', borde: false, negr: true, vcentro: true });
  caja(5, 5, 5, 14, '', d.empDir, { tam: 9, alin: 'center', borde: false, vcentro: true });
  caja(6, 5, 6, 14, '', `Tel:  ${d.empTel}  ${d.empCiudad}`, { tam: 9, alin: 'center', borde: false, vcentro: true });
  caja(1, 15, 4, 20, '', LEY, { tam: 6, borde: false });
  caja(5, 15, 5, 20, '', `Manifiesto  : ${d.num}`, { tam: 12, borde: false, negr: true, fondo: '#E6E6E6', vcentro: true });
  caja(6, 15, 6, 20, '', `Autorización:  ${d.rad}`, { tam: 12, borde: false, negr: true, fondo: '#E6E6E6', vcentro: true });
  caja(5, 1, 6, 4, 'FECHA HORA RADICACION', d.fechaRad, { tam: 10 });
  // QR
  const qx = X(21); const qy = filaY[0]; const qw = X(25) - qx; const qh = filaY[6] - qy;
  if (d.segQR && d.rad) {
    const png = await QRCode.toBuffer(textoQR(d), { errorCorrectionLevel: 'L', margin: 0, scale: 6 });
    const lado = Math.min(qw, qh) - 6;
    doc.image(png, qx + (qw - lado) / 2, qy + 3, { width: lado, height: lado });
  } else {
    caja(1, 21, 6, 24, '', 'SIN CODIGO QR (falta el codigo de seguridad del RNDC)', { tam: 7, alin: 'center', vcentro: true });
  }
  // Viaje
  caja(7, 1, 8, 3, 'FECHA DE EXPEDICION', d.fechaExp, { tam: 10 });
  caja(7, 4, 8, 5, 'TIPO DE MANIFIESTO', d.tipo, { tam: d.tipo.length > 12 ? 5.4 : 9 });
  caja(7, 6, 8, 11, 'ORIGEN DEL VIAJE', d.origen, { tam: 10 });
  caja(7, 12, 8, 16, 'MUNICIPIO INTERMEDIO', '', { tam: 10 });
  caja(7, 17, 8, 24, 'DESTINO DEL VIAJE', d.destino, { tam: 10 });
  caja(9, 1, 10, 6, 'ORIGEN TRAYECTO EN VACIO 1', '', { tam: 9 });
  caja(9, 7, 10, 12, 'DESTINO TRAYECTO EN VACIO 1', '', { tam: 9 });
  caja(9, 13, 10, 18, 'ORIGEN TRAYECTO EN VACIO 2', '', { tam: 9 });
  caja(9, 19, 10, 24, 'DESTINO TRAYECTO EN VACIO 2', '', { tam: 9 });
  caja(11, 1, 11, 24, '', 'VIA A UTILIZAR :', { tam: 7, negr: true, vcentro: true });
  // Titular, vehículo y conductores
  titulo(12, 1, 24, 'INFORMACION DEL TITULAR, VEHICULO Y CONDUCTORES');
  caja(13, 1, 14, 6, 'TITULAR MANIFIESTO', d.titular);
  caja(13, 7, 14, 10, 'DOCUMENTO IDENTIFICACION', d.titDoc);
  caja(13, 11, 14, 17, 'DIRECCION', d.titDir);
  caja(13, 18, 14, 19, 'TELEFONOS', d.titTel);
  caja(13, 20, 14, 24, 'CIUDAD', d.titCiudad);
  caja(15, 1, 16, 2, 'PLACA', d.placa, { tam: 10 });
  caja(15, 3, 16, 4, 'MARCA', d.marca, { tam: 8 });
  caja(15, 5, 16, 6, 'PLACA SEMIREMOLQUE', '');
  caja(15, 7, 16, 8, 'PLACA SEMIREMOL 2', '');
  caja(15, 9, 16, 10, 'CONFIGURACION', d.config, { tam: 10 });
  caja(15, 11, 16, 12, 'PesoVacío', d.pesoVacio, { tam: 10 });
  caja(15, 13, 16, 14, 'PesoVacíoRemolque', '0', { tam: 10 });
  caja(15, 15, 16, 19, 'COMPAÑIA SEGUROS SOAT', d.soatAseg, { tam: 8 });
  caja(15, 20, 16, 22, 'No POLIZA', d.poliza);
  caja(15, 23, 16, 24, 'F.Vencimiento SOAT', d.soatVence, { tam: 8 });
  caja(17, 1, 18, 6, 'CONDUCTOR', d.condNom);
  caja(17, 7, 18, 10, 'DOCUMENTO IDENTIFICACION', d.condDoc);
  caja(17, 11, 18, 15, 'DIRECCION', d.condDir);
  caja(17, 16, 18, 17, 'TELEFONOS', d.condTel);
  caja(17, 18, 18, 20, 'No de LICENCIA', d.condLic, { tam: 8 });
  caja(17, 21, 18, 24, 'CIUDAD CONDUCTOR', d.condCiudad);
  caja(19, 1, 20, 6, 'CONDUCTOR Nro. 2', '');
  caja(19, 7, 20, 10, 'DOCUMENTO IDENTIFICACION', '');
  caja(19, 11, 20, 15, 'DIRECCION CONDUCTOR 2', '');
  caja(19, 16, 20, 17, 'TELEFONOS', '');
  caja(19, 18, 20, 20, 'No de LICENCIA', '-', { tam: 8 });
  caja(19, 21, 20, 24, 'CIUDAD CONDUCTOR 2', '');
  // Mercancía
  titulo(21, 1, 24, 'INFORMACION DE LA MERCANCIA TRANSPORTADA');
  caja(22, 1, 26, 2, 'Nro. Remesa', d.remesa);
  caja(22, 3, 26, 4, 'Unidad Medida', d.unidad);
  caja(22, 5, 26, 6, 'Cantidad', C.fmtMilManifiesto(d.cantidad));
  caja(22, 7, 26, 8, 'Naturaleza', d.naturaleza);
  caja(22, 9, 26, 12, `Empaque: ${d.empaque}   Producto Transportado`, `${d.prodCod}\n${d.prodDesc}`, { tam: 8 });
  caja(22, 13, 26, 18, 'Información Remitente / Lugar Cargue', `${d.remNit}  ${d.remNom}\n${d.remDir}\n${d.remMuni}`, { tam: 8 });
  caja(22, 19, 26, 22, 'Información Destinatario / Lugar Descargue', `${d.desNit}  ${d.desNom}\n${d.desSede}\n${d.desMuni}`, { tam: 8 });
  caja(22, 23, 26, 24, 'Dueño Poliza', d.dueno, { tam: 8 });
  // Valores
  titulo(27, 1, 9, 'VALORES');
  titulo(27, 10, 16, 'PAGO DEL SALDO');
  titulo(27, 17, 24, 'OBSERVACIONES');
  const valores = [['VALOR TOTAL DEL VIAJE', d.flete], ['RETENCION EN LA FUENTE', d.rete], ['RETENCION ICA', d.ica],
    ['RETENCION FOPAT', d.fopat], ['VALOR NETO A PAGAR', d.neto], ['VALOR ANTICIPO', d.anticipo], ['SALDO A PAGAR', d.saldo]];
  valores.forEach(([e, v], i) => {
    caja(28 + i, 1, 28 + i, 5, '', e, { tam: 8, alin: 'center', borde: false, vcentro: true });
    caja(28 + i, 6, 28 + i, 9, '', C.fmtMilManifiesto(v), { tam: 9, alin: 'right', vcentro: true });
  });
  caja(28, 10, 29, 11, '', 'LUGAR DE PAGO', { tam: 7, borde: false, vcentro: true });
  caja(28, 12, 29, 14, '', d.lugarPago, { tam: 9, alin: 'center', vcentro: true });
  caja(28, 15, 29, 16, '', d.fechaPago, { tam: 8, alin: 'center', vcentro: true });
  caja(30, 10, 30, 16, '', 'CARGUE PAGADO POR', { tam: 7, borde: false, vcentro: true });
  caja(31, 10, 31, 16, '', d.carguePor, { tam: 9, alin: 'center', vcentro: true });
  caja(32, 10, 32, 16, '', 'DESCARGUE PAGADO POR', { tam: 7, borde: false, vcentro: true });
  caja(33, 10, 33, 16, '', d.descarguePor, { tam: 9, alin: 'center', vcentro: true });
  caja(28, 17, 35, 24, '', d.observaciones || '', { tam: 8 });
  doc.rect(X(1), filaY[27], X(10) - X(1), filaY[35] - filaY[27]).lineWidth(0.7).stroke();
  doc.rect(X(10), filaY[27], X(17) - X(10), filaY[35] - filaY[27]).lineWidth(0.7).stroke();
  caja(36, 1, 36, 24, 'VALOR TOTAL DEL VIAJE EN LETRAS:', C.numeroALetras(d.flete), { tam: 8 });
  caja(37, 1, 39, 8, '', FRAUDE, { tam: 6 });
  caja(37, 9, 39, 16, '', 'Firma y Huella TITULAR MANIFIESTO o ACEPTACION DIGITAL', { tam: 8, negr: true });
  caja(37, 17, 39, 24, '', 'Firma y Huella del CONDUCTOR o ACEPTACION DIGITAL', { tam: 8, negr: true });
  caja(40, 1, 40, 24, '', `Copia impresa generada por ${d.empresa} (plataforma COOESPATRANS) el ${C.fmtFechaRndc(C.hoyColombia())}. El documento oficial está en el RNDC del Ministerio de Transporte.`, { tam: 6, borde: false });
  return pdfABuffer(doc);
}

module.exports = {
  LOGOS_DISPONIBLES, logoEmpresa, rutaLogo, ordenarPorPlaca,
  relacionExcel, relacionPdf, pagoExcel, pagoPdf, utilidadExcel, utilidadPdf, datosUtilidad, narrativaUtilidad,
  bitacoraExcel, bitacoraPdf, planillaBlancoPdf, manifiestoPdf, textoQR,
};
