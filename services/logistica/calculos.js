// services/logistica/calculos.js
// ─────────────────────────────────────────────────────────────────────────────
// Reglas de negocio y fórmulas trasladadas de la plantilla de viajes (VBA y
// fórmulas de Excel). Son funciones puras para poder probarlas y reutilizarlas
// en rutas, reportes e importación.
// ─────────────────────────────────────────────────────────────────────────────

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

// ── Texto ────────────────────────────────────────────────────────────────────

// ConvertirNombre: "JUAN pérez" → "Juan Pérez" (Nombre Propio).
function convertirNombre(texto) {
  const t = String(texto || '').trim();
  if (!t) return '';
  return t.toLowerCase().split(' ').filter(Boolean)
    .map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
}

// ConvertirDestino: "PASTO ALKOSTO" → "Pasto alkosto".
function convertirDestino(texto) {
  const t = String(texto || '').trim().toLowerCase();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

// StrConv(..., vbProperCase): cada palabra con mayúscula inicial.
const nombrePropio = convertirNombre;

// Quita tildes y diéresis (conserva la ñ si conservarEnie).
function quitarTildes(s, conservarEnie = false) {
  let r = String(s || '');
  if (conservarEnie) r = r.replace(/ñ/g, '\u0001').replace(/Ñ/g, '\u0002');
  r = r.normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (conservarEnie) r = r.replace(/\u0001/g, 'ñ').replace(/\u0002/g, 'Ñ');
  return r;
}

// NormTxt del VBA: mayúsculas sin tildes, solo letras A-Z y espacios simples.
function normTxt(s) {
  return quitarTildes(s).toUpperCase().replace(/[^A-Z]/g, ' ').replace(/\s+/g, ' ').trim();
}

const soloDigitos = (s) => String(s ?? '').replace(/[^0-9]/g, '');

// ValorNumerico: "$ 1.390.000" → 1390000 (solo dígitos, como el formulario).
function valorNumerico(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const d = soloDigitos(v);
  return d ? Number(d) : 0;
}

// ── Bitácora ─────────────────────────────────────────────────────────────────

// ObtenerPesoPorDestino: peso según la capacidad escrita en el destino.
function pesoPorDestino(destino) {
  const t = String(destino || '').toUpperCase();
  if (t.includes('1.0')) return 800;
  if (t.includes('5.0')) return 2500;
  if (t.includes('3.0')) return 1500;
  if (t.includes('6.0')) return 5000;
  return 0;
}

// Fórmulas de las hojas por empresa:
//   SALDO    = IF(J>0, J-K, "")                → flete - anticipo
//   UTILIDAD = IF(A>0, I-(I*1%)-J, "")         → tarifa - 1% tarifa - flete
function saldoViaje(v) {
  const flete = Number(v.flete) || 0;
  return flete > 0 ? flete - (Number(v.anticipo) || 0) : null;
}
function utilidadViaje(v) {
  if (!(Number(v.numero) > 0)) return null;
  const tarifa = Number(v.tarifa) || 0;
  return tarifa - tarifa * 0.01 - (Number(v.flete) || 0);
}

// Saludo según la hora (WhatsApp y correo de salida).
function saludoPorHora(fecha = new Date()) {
  const h = horaColombia(fecha);
  if (h < 12) return 'Buenos dias';
  if (h < 18) return 'Buenas tardes';
  return 'Buenas noches';
}

// ── Fechas (zona horaria de Colombia, UTC-5 sin horario de verano) ──────────
const OFFSET_CO = -5 * 60 * 60 * 1000;
const enColombia = (d) => new Date(new Date(d).getTime() + OFFSET_CO);
const horaColombia = (d) => enColombia(d).getUTCHours();

// Fecha "solo día" (medianoche UTC) del día actual en Colombia.
function hoyColombia() {
  const c = enColombia(new Date());
  return new Date(Date.UTC(c.getUTCFullYear(), c.getUTCMonth(), c.getUTCDate()));
}

// Convierte 'yyyy-mm-dd', 'dd/mm/yyyy' o Date a medianoche UTC. null si no es válida.
function parseFecha(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    return new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate()));
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return fechaValida(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return fechaValida(+m[3], +m[2], +m[1]);
  return null;
}
function fechaValida(y, mo, d) {
  const f = new Date(Date.UTC(y, mo - 1, d));
  return (f.getUTCFullYear() === y && f.getUTCMonth() === mo - 1 && f.getUTCDate() === d) ? f : null;
}

const dd = (n) => String(n).padStart(2, '0');
function fmtFecha(d) {           // dd/mm/yyyy
  if (!d) return '';
  const f = new Date(d);
  return `${dd(f.getUTCDate())}/${dd(f.getUTCMonth() + 1)}/${f.getUTCFullYear()}`;
}
function fmtFechaRndc(d) {       // aaaa/mm/dd (formato del manifiesto)
  if (!d) return '';
  const f = new Date(d);
  return `${f.getUTCFullYear()}/${dd(f.getUTCMonth() + 1)}/${dd(f.getUTCDate())}`;
}
function fmtFechaHoraAhora() {   // dd/mm/yyyy hh:nn (hora Colombia)
  const c = enColombia(new Date());
  return `${dd(c.getUTCDate())}/${dd(c.getUTCMonth() + 1)}/${c.getUTCFullYear()} ${dd(c.getUTCHours())}:${dd(c.getUTCMinutes())}`;
}
function fechaLarga(d) {         // "13 de octubre de 2026"
  const f = new Date(d);
  return `${f.getUTCDate()} de ${MESES[f.getUTCMonth()]} de ${f.getUTCFullYear()}`;
}
function fmtDiaMes(d) {          // "24 septiembre" (formato "dd mmmm" de la relación)
  const f = new Date(d);
  return `${dd(f.getUTCDate())} ${MESES[f.getUTCMonth()]}`;
}
// Último día del mes de la fecha (FECHAPAGOSALDOMANIFIESTO)
function finDeMes(d) {
  const f = new Date(d);
  return new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth() + 1, 0));
}

// NumeroMes: número del mes escrito en el periodo ("1-15 de septiembre de 2026" → "9").
function numeroMes(periodo) {
  const p = quitarTildes(periodo).toUpperCase();
  const i = MESES.findIndex(m => p.includes(m.toUpperCase()));
  if (i >= 0) return String(i + 1);
  return String(enColombia(new Date()).getUTCMonth() + 1);
}

// Limpia caracteres no válidos en nombres de archivo.
function limpiarNombreArchivo(s) {
  return String(s || '').replace(/[/\\:*?"<>|]/g, '-');
}

// ── Formatos numéricos ───────────────────────────────────────────────────────
function fmtMiles(n) {           // 1390000 → "1.390.000"
  const v = Math.round(Number(n) || 0);
  return v.toLocaleString('es-CO');
}
const fmtPesos = (n) => `$ ${fmtMiles(n)}`;

// ZMil: 1750000 → "1,750,000.00" (formato del manifiesto oficial)
function fmtMilManifiesto(x) {
  const neg = x < 0;
  const v = Math.abs(Math.round((Number(x) || 0) * 100) / 100);
  const ent = Math.trunc(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const dec = String(Math.round((v - Math.trunc(v)) * 100)).padStart(2, '0');
  return `${neg ? '-' : ''}${ent}.${dec}`;
}

// ZLetras: valor del viaje en letras ("UN MILLON SETECIENTOS CINCUENTA MIL PESOS").
function centenas(n) {
  const u = ['', 'UN', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE', 'DIEZ',
    'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE', 'DIECISEIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE',
    'VEINTE', 'VEINTIUN', 'VEINTIDOS', 'VEINTITRES', 'VEINTICUATRO', 'VEINTICINCO', 'VEINTISEIS',
    'VEINTISIETE', 'VEINTIOCHO', 'VEINTINUEVE'];
  const d = ['', '', '', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
  const c = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS',
    'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS'];
  if (n === 100) return 'CIEN';
  let r = '';
  const k = Math.floor(n / 100);
  if (k > 0) r = c[k];
  n %= 100;
  if (n > 0) {
    if (r) r += ' ';
    if (n < 30) r += u[n];
    else {
      r += d[Math.floor(n / 10)];
      if (n % 10 > 0) r += ` Y ${u[n % 10]}`;
    }
  }
  return r;
}
function numeroALetras(valor) {
  let n = Math.trunc(Number(valor) || 0);
  const orig = n;
  if (n <= 0) return 'CERO PESOS';
  let r = '';
  if (n >= 1000000) {
    const m = Math.trunc(n / 1000000);
    r = m === 1 ? 'UN MILLON' : `${centenas(m)} MILLONES`;
    n -= m * 1000000;
    if (n > 0) r += ' ';
  }
  if (n >= 1000) {
    const m = Math.trunc(n / 1000);
    r += m === 1 ? 'MIL' : `${centenas(m)} MIL`;
    n -= m * 1000;
    if (n > 0) r += ' ';
  }
  if (n > 0) r += centenas(n);
  if (orig >= 1000000 && orig % 1000000 === 0) r += ' DE';
  return `${r} PESOS`;
}

// ── Relación de fletes (fórmulas de la hoja RELACION) ───────────────────────
const AUX_BODEGA = 'Auxiliar de Bodega';
const esTat = (destino) => destino === 'Pasto TAT 1.0' || destino === 'Ipiales TAT 1.0';
const N = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0); // función N() de Excel

// Calcula todas las columnas de una fila de RELACION.
//   tarifa: { tarifaCliente, tarifaAuxiliar, fleteConductor, auxiliarPagado } o null
//   transportador: nombre del conductor por placa (o '')
function calcularRelacion(fila, tarifa, transportador = '') {
  const H = fila.cantidad === null || fila.cantidad === undefined || fila.cantidad === '' ? '' : Number(fila.cantidad);
  const J = fila.auxiliar;
  const F = fila.destino;
  const tat = esTat(F);
  const I = tarifa ? N(tarifa.tarifaCliente) : '';                                  // Tarifa
  const K = J === 'No' ? AUX_BODEGA : (tarifa ? N(tarifa.tarifaAuxiliar) : '');      // Auxiliar (x unidad)
  const L = H === '' ? '' : (tat ? N(I) * H : I);                                   // Total tarifa empresa
  const M = H === '' ? '' : (J === 'No' ? AUX_BODEGA : (K === '' ? '' : H * N(K))); // Total auxiliar empresa
  const Ntot = (H === '' || I === '') ? '' : (tat ? H * I : I) + H * N(K);         // Total cobrado
  const O = tarifa ? N(tarifa.fleteConductor) : '';                                 // Flete conductor (x unidad)
  const P = H === '' ? '' : (tat ? N(O) * H : O);                                   // Total flete conductor
  const Q = J === 'No' ? AUX_BODEGA : (tarifa ? N(tarifa.auxiliarPagado) : '');      // Auxiliar pagado (x unidad)
  const R = H === '' ? '' : (J === 'No' ? AUX_BODEGA : (Q === '' ? '' : H * N(Q))); // Total auxiliar pagado
  const T = H === '' ? '' : N(Ntot) - (N(R) + N(P));                                // Utilidad (SUM ignora texto)
  const U = I === '' ? '' : (N(Ntot) === 0 ? null : T / Ntot);                      // Utilidad %
  return {
    transportador,
    tarifa: I, auxiliarUnidad: K, totalTarifa: L, totalAuxiliar: M, total: Ntot,
    fleteConductor: O, totalFlete: P, auxiliarPagado: Q, totalAuxiliarPagado: R,
    utilidad: T, utilidadPct: U,
  };
}

module.exports = {
  MESES, AUX_BODEGA,
  convertirNombre, convertirDestino, nombrePropio, quitarTildes, normTxt, soloDigitos, valorNumerico,
  pesoPorDestino, saldoViaje, utilidadViaje, saludoPorHora,
  hoyColombia, parseFecha, fmtFecha, fmtFechaRndc, fmtFechaHoraAhora, fechaLarga, fmtDiaMes, finDeMes,
  enColombia, numeroMes, limpiarNombreArchivo,
  fmtMiles, fmtPesos, fmtMilManifiesto, numeroALetras,
  esTat, calcularRelacion, N,
};
