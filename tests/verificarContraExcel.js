// tests/verificarContraExcel.js
// Compara los cálculos del módulo de logística con los valores que la
// plantilla de Excel tiene calculados (saldo, utilidad por empresa y todas
// las columnas de la hoja RELACION).
//   node tests/verificarContraExcel.js "C:\ruta\PLANTILLA_DE_VIAJES_FORMULARIO.xlsm"
const XLSX = require('xlsx');
const C = require('../services/logistica/calculos');

const wb = XLSX.readFile(process.argv[2]);
const filas = (n) => XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' });
let ok = 0; let mal = 0;
const igual = (a, b) => (a === '' && b === '') || (a === null && b === '') || (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 0.005) || a === b;
const comparar = (etq, calc, excel) => { if (igual(calc, excel)) ok += 1; else { mal += 1; console.log(`DIFERENCIA ${etq}: calculado=${JSON.stringify(calc)} excel=${JSON.stringify(excel)}`); } };

// 1. Hojas por empresa: SALDO (P) y UTILIDAD (Q), y el total Q6
// Solo se comparan las filas donde el Excel tiene la fórmula; las filas agregadas
// después del rango con fórmulas quedan en blanco en el Excel (y fuera de su total),
// mientras que la web aplica la fórmula a todos los viajes.
const empresas = filas('Empresas').slice(1).map(f => f[0]).filter(Boolean);
let sinFormula = 0;
for (const emp of empresas) {
  const ws = wb.Sheets[emp];
  const f = filas(emp);
  if (!f.length) continue;
  let total = 0;
  f.slice(7).forEach((r, i) => {
    if (r[0] === '') return;
    const fila = i + 8;
    if (!ws[`Q${fila}`] || !ws[`Q${fila}`].f) { sinFormula += 1; return; }
    const v = { numero: r[0], tarifa: r[8], flete: r[9], anticipo: r[10] };
    const s = C.saldoViaje(v); const u = C.utilidadViaje(v);
    comparar(`${emp} fila ${fila} saldo`, s === null ? '' : s, r[15]);
    comparar(`${emp} fila ${fila} utilidad`, u === null ? '' : u, r[16]);
    total += u || 0;
  });
  comparar(`${emp} total utilidad (filas con fórmula)`, total, f[5][16]);
}
console.log(`Filas de empresa sin fórmula en el Excel (la web sí las calcula): ${sinFormula}`);

// 2. RELACION: columnas calculadas a partir de Fletes y _CONDUCTORES
const fletes = new Map(filas('Fletes').slice(1).filter(r => r[0] && r[1]).map(r => [`${r[0]}|${r[1]}`, {
  tarifaCliente: r[2] === '' ? 0 : r[2], tarifaAuxiliar: r[3] === '' ? 0 : r[3], fleteConductor: r[4] === '' ? 0 : r[4], auxiliarPagado: r[5] === '' ? 0 : r[5] }]));
const conductores = new Map(filas('_CONDUCTORES').slice(1).filter(r => r[1]).reverse().map(r => [String(r[1]), r[0]]));
filas('RELACION').slice(10).forEach((r, i) => {
  if (!r[3]) return;
  const c = C.calcularRelacion({ empresa: r[1], placa: r[3], destino: r[5], cantidad: r[7], auxiliar: r[9] },
    fletes.get(`${r[1]}|${r[5]}`) || null, conductores.get(String(r[3])) || '');
  const fila = i + 11;
  [['transportador', 2], ['tarifa', 8], ['auxiliarUnidad', 10], ['totalTarifa', 11], ['totalAuxiliar', 12], ['total', 13],
    ['fleteConductor', 14], ['totalFlete', 15], ['auxiliarPagado', 16], ['totalAuxiliarPagado', 17], ['utilidad', 19], ['utilidadPct', 20]]
    .forEach(([k, col]) => comparar(`RELACION fila ${fila} ${k}`, c[k], r[col]));
});

// 3. Otras reglas
comparar('peso 5.0', C.pesoPorDestino('Pasto alkosto 5.0'), 2500);
comparar('peso 1.0', C.pesoPorDestino('Pasto tat 1.0'), 800);
comparar('peso 3.0', C.pesoPorDestino('Pasto may 1 aux 3.0'), 1500);
comparar('peso 6.0', C.pesoPorDestino('Tuquerres 6.0'), 5000);
comparar('nombre propio', C.convertirNombre('  jEFERSON   cussis '), 'Jeferson Cussis');
comparar('destino', C.convertirDestino('PASTO ALKOSTO 5.0'), 'Pasto alkosto 5.0');
comparar('letras', C.numeroALetras(1750000), 'UN MILLON SETECIENTOS CINCUENTA MIL PESOS');
comparar('letras 2', C.numeroALetras(2000000), 'DOS MILLONES DE PESOS');
comparar('mil manifiesto', C.fmtMilManifiesto(1732500), '1,732,500.00');
comparar('numero mes', C.numeroMes('16-30 de septiembre de 2026'), '9');

console.log(`\nComparaciones correctas: ${ok}  |  Diferencias: ${mal}`);
process.exit(mal ? 1 : 0);
