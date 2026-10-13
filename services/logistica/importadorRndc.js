// services/logistica/importadorRndc.js
// Importa a los maestros del RNDC los archivos que se descargan del RNDC y del
// DANE (RNDC_ImportarVehiculos, RNDC_ImportarTerceros y RNDC_ImportarDane).
// Igual que en el Excel: no pisa lo que ya está escrito, solo agrega o completa.
const XLSX = require('xlsx');
const R = require('../../models/Rndc');
const { normTxt } = require('./calculos');

const DIR_DEF = 'PASTO';
const TEL_DEF = '9999999999';
const CIU_DEF = 'PASTO NARIÑO';

// Variables del manifiesto modelo M10062798 (RNDC_ActualizarModelo)
const VARIABLES_MODELO = [
  'R|NUMNITEMPRESATRANSPORTE|{NIT}|',
  'R|CONSECUTIVOREMESA|{REMESA}|',
  'R|CODOPERACIONTRANSPORTE|G|Carga general (manifiesto modelo: General). VERIFICAR',
  'R|CODNATURALEZACARGA|1|Carga Normal en el modelo. VERIFICAR codigo',
  'R|CANTIDADCARGADA|{PESO}|Kilogramos, columna PESO KG del viaje',
  'R|UNIDADMEDIDACAPACIDAD|1|Kilogramos en el modelo. VERIFICAR codigo',
  'R|CODTIPOEMPAQUE|0|Empaque Varios en el modelo. VERIFICAR codigo',
  'R|MERCANCIAREMESA|009980|Producto 009980 (viveres, abarrotes y electrodomesticos)',
  'R|DESCRIPCIONCORTAPRODUCTO|VIVERES ABARROTES Y ELECTRODOMESTICOS|',
  'R|CODTIPOIDREMITENTE|N|NIT. VERIFICAR',
  'R|NUMIDREMITENTE|{NIT_CLIENTE}|NIT de la empresa cliente (sin digito de verificacion)',
  'R|CODSEDEREMITENTE|1|Sede 1 = bodega Cujacal (Pasto). Cambiar si el cliente es otro. VERIFICAR',
  'R|CODTIPOIDDESTINATARIO|{DEST_TIPO}|Tipo del destinatario (N = NIT, C = cedula); vacio = N',
  'R|NUMIDDESTINATARIO|{DEST_ID}|Numero del destinatario (sin digito de verificacion); vacio = NIT del cliente',
  'R|CODSEDEDESTINATARIO|{DEST_SEDE}|Codigo de sede del destinatario en el RNDC',
  'R|CODTIPOIDPROPIETARIO|N|Propietario de la carga. N = NIT',
  'R|NUMIDPROPIETARIO|{NIT_CLIENTE}|Propietario de la carga = empresa cliente',
  'R|CODSEDEPROPIETARIO|1|Sede del propietario de la carga',
  'R|TIPOCONSOLIDADA|D|Remesa consolidada: Distribucion (D). Valores: R, D, A, N. VERIFICAR',
  'R|DUENOPOLIZA|E|Empresa de transporte (modelo). VERIFICAR',
  'R|FECHACITAPACTADACARGUE|{FECHA}|Fecha cita de cargue',
  'R|HORACITAPACTADACARGUE|12:00|Hora cita de cargue',
  'R|HORASPACTOCARGA|1|Tiempo pactado de cargue: horas',
  'R|MINUTOSPACTOCARGA|0|Tiempo pactado de cargue: minutos',
  'R|FECHACITAPACTADADESCARGUE|{FECHA}|Fecha cita de descargue',
  'R|HORACITAPACTADADESCARGUEREMESA|20:00|Hora cita de descargue',
  'R|HORASPACTODESCARGUE|1|Tiempo pactado de descargue: horas',
  'R|MINUTOSPACTODESCARGUE|0|Tiempo pactado de descargue: minutos',
  'R|NUMPOLIZATRANSPORTE|AB000314|Seguro de mercancia: poliza',
  'R|FECHAVENCIMIENTOPOLIZACARGA|24/04/2027|Seguro de mercancia: vencimiento. Actualizar cuando renueven',
  'R|COMPANIASEGURO|8600284155|NIT aseguradora La Equidad Seguros Generales',
  'M|NUMNITEMPRESATRANSPORTE|{NIT}|',
  'M|NUMMANIFIESTOCARGA|{MANIFIESTO}|',
  'M|CODOPERACIONTRANSPORTE|G|Manifiesto tipo General (U para urbano de Corbeta, automatico). VERIFICAR',
  'M|FECHAEXPEDICIONMANIFIESTO|{FECHA}|',
  'M|CODMUNICIPIOORIGENMANIFIESTO|{COD_ORIGEN}|Codigo DIVIPOLA 8 digitos',
  'M|CODMUNICIPIODESTINOMANIFIESTO|{COD_DESTINO}|Codigo DIVIPOLA 8 digitos segun el destino',
  'M|CODIDTITULARMANIFIESTO|C|Cedula del titular. VERIFICAR',
  'M|NUMIDTITULARMANIFIESTO|{TITULAR}|Si no hay cedula del titular usa la del conductor',
  'M|NUMPLACA|{PLACA}|',
  'M|CODIDCONDUCTOR|C|C = cedula de ciudadania. VERIFICAR',
  'M|NUMIDCONDUCTOR|{CED}|',
  'M|VALORFLETEPACTADOVIAJE|{FLETE}|',
  'M|RETENCIONFUENTEMANIFIESTO|{RETEFUENTE}|1% del flete',
  'M|RETENCIONICAMANIFIESTOCARGA|0|',
  'M|VALORANTICIPOMANIFIESTO|{ANTICIPO}|',
  'M|FECHAPAGOSALDOMANIFIESTO|{FECHA_PAGO}|Ultimo dia del mes. VERIFICAR regla',
  'M|OBSERVACIONES|{OBSERVACIONES}|Recomendaciones del manifiesto (max 500), de las observaciones de la bitacora',
  'M|CODRESPONSABLEPAGOCARGUE|R|R = remitente. VERIFICAR letra',
  'M|CODRESPONSABLEPAGODESCARGUE|D|D = destinatario. VERIFICAR letra',
  'M|RETENCIONFOPAT|{FOPAT}|FOPAT 0,1% del flete SOLO si el PBV > 10.500; si no, 0',
  'M|CODMUNICIPIOPAGOSALDO|52001000|Lugar del pago: Pasto Narino',
  'M|ACEPTACIONELECTRONICA|SI|Firma de aceptacion electronica del titular',
  'M|NITMONITOREOFLOTA|{NIT}|Empresa de monitoreo = la misma Cooperativa',
];

function primeraHoja(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  return { wb, ws: wb.Sheets[wb.SheetNames[0]] };
}
const filas = (ws) => XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });

function entero(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? String(Math.round(v)) : '';
  const s = String(v ?? '').trim();
  return (s === '.' || s.startsWith('**')) ? '' : s;
}
const limpiaNombre = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').replace(/ \.$/, '').trim();

function colH(hd, nombre) {
  return hd.findIndex(h => String(h).trim().toUpperCase() === nombre);
}

// Maestro: Vehículo del RNDC
async function importarVehiculos(buffer) {
  const { ws } = primeraHoja(buffer);
  const datos = filas(ws);
  const hd = datos[0] || [];
  const c = (n) => colH(hd, n);
  const cPl = c('NUMPLACA'); const cMa = c('MARCAVEHICULOCARGA'); const cCf = c('CONFIGURACIONUNIDADCARGA');
  const cPv = c('PESOVEHICULOVACIO'); const cAs = c('ASEGURADORASOAT'); const cNi = c('NUMNITASEGURADORASOAT');
  const cPo = c('NUMSEGUROSOAT'); const cVe = c('FECHAVENCIMIENTOSOAT'); const cIp = c('NUMIDPROPIETARIO');
  const cNp = c('VEHNOMBREPROP'); const cIt = c('NUMIDTENEDOR'); const cNt = c('VEHNOMBRETENENC');
  if ([cPl, cMa, cCf, cPv, cPo, cIp].some(x => x < 0)) {
    throw new Error('El archivo no tiene las columnas esperadas del Maestro de Vehículos (NUMPLACA, MARCAVEHICULOCARGA, ...).');
  }
  const existentesV = new Set((await R.RndcVehiculo.find().select('placa').lean()).map(v => v.placa));
  const existentesT = new Set((await R.RndcTitular.find().select('doc').lean()).map(t => t.doc));
  const nuevosV = []; const nuevosT = [];
  for (const f of datos.slice(1)) {
    const pl = String(f[cPl] ?? '').trim().toUpperCase();
    if (!pl) continue;
    let tit = entero(f[cIp]); let nom = limpiaNombre(f[cNp]);
    if ((!tit || tit === '0') && cIt >= 0) { tit = entero(f[cIt]); nom = limpiaNombre(f[cNt]); }
    if (tit && tit !== '0' && !existentesT.has(tit) && nom) { existentesT.add(tit); nuevosT.push({ doc: tit, nombre: nom }); }
    if (existentesV.has(pl)) continue;
    existentesV.add(pl);
    let cf = String(f[cCf] ?? '').trim();
    if (cf.includes(' - ')) cf = cf.slice(0, cf.indexOf(' - '));
    let ve = String(f[cVe] ?? '').trim();
    if (typeof f[cVe] === 'number') {
      const d = XLSX.SSF.parse_date_code(f[cVe]);
      ve = d ? `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}` : '';
    }
    ve = ve.length >= 10 && !ve.startsWith('1899') ? ve.slice(0, 10).replace(/-/g, '/') : '';
    let ni = cNi >= 0 ? entero(f[cNi]) : '';
    if (ni.length > 1) ni = ni.slice(0, -1); // sin dígito de verificación
    nuevosV.push({
      placa: pl, marca: String(f[cMa] ?? '').trim(), configuracion: cf, pesoVacio: entero(f[cPv]),
      soat: `${ni} ${cAs >= 0 ? String(f[cAs] ?? '').trim() : ''}`.trim(), poliza: entero(f[cPo]), venceSoat: ve, docTitular: tit,
    });
  }
  if (nuevosV.length) await R.RndcVehiculo.insertMany(nuevosV, { ordered: false });
  if (nuevosT.length) await R.RndcTitular.insertMany(nuevosT, { ordered: false });
  return { vehiculosNuevos: nuevosV.length, titularesNuevos: nuevosT.length,
    mensaje: `Vehículos nuevos agregados: ${nuevosV.length}. Propietarios nuevos (solo nombre): ${nuevosT.length}. Los que ya estaban no se tocaron.` };
}

// Nombre como lo imprime el RNDC: NOMBRES APELLIDOS
function nombreTercero(nom, a1, a2) {
  nom = limpiaNombre(nom); a1 = limpiaNombre(a1); a2 = limpiaNombre(a2);
  const ap = `${a1} ${a2}`.trim();
  if (!ap) return nom;
  if (nom.length > ap.length && nom.toUpperCase().startsWith(ap.toUpperCase())) return `${nom.slice(ap.length).trim()} ${ap}`;
  if (a1 && nom.toUpperCase().includes(a1.toUpperCase())) return nom;
  return `${nom} ${ap}`.trim();
}

// Maestro: Tercero del RNDC (titulares y conductores)
async function importarTerceros(buffer) {
  const { ws } = primeraHoja(buffer);
  const datos = filas(ws);
  const hd = datos[0] || [];
  const c = (n) => colH(hd, n);
  const cId = c('NUMIDTERCERO'); const cNo = c('NOMIDTERCERO'); const cA1 = c('PRIMERAPELLIDOIDTERCERO'); const cA2 = c('SEGUNDOAPELLIDOIDTERCERO');
  const cTe = c('NUMTELEFONOCONTACTO'); const cCe = c('NUMCELULARPERSONA'); const cDi = c('NOMENCLATURADIRECCION'); const cMu = c('MUNICIPIORNDC');
  const cCa = c('CODCATEGORIALICENCIACONDUCCION'); const cNl = c('NUMLICENCIACONDUCCION'); const cFe = c('FECHAINGRESO'); const cTp = c('CODTIPOIDTERCERO');
  if ([cId, cNo, cDi, cMu].some(x => x < 0)) {
    throw new Error('El archivo no tiene las columnas esperadas del Maestro: Tercero (NUMIDTERCERO, NOMIDTERCERO, ...).');
  }
  const dic = new Map();
  for (const f of datos.slice(1)) {
    const id = entero(f[cId]);
    if (!id) continue;
    const nom = nombreTercero(f[cNo], cA1 >= 0 ? f[cA1] : '', cA2 >= 0 ? f[cA2] : '');
    const dir = limpiaNombre(f[cDi]);
    const ciu = limpiaNombre(f[cMu]);
    let tel = cCe >= 0 ? entero(f[cCe]) : '';
    if (!tel || tel === '0') tel = cTe >= 0 ? entero(f[cTe]) : '';
    if (tel === '0') tel = '';
    let lic = '';
    if (cCa >= 0) {
      const cat = String(f[cCa] ?? '').trim();
      if (cat) {
        let num = cNl >= 0 ? entero(f[cNl]) : '';
        if (!num || num === '0') num = id;
        lic = `${cat}-${num}`;
      }
    }
    const fec = cFe >= 0 && typeof f[cFe] === 'number' ? f[cFe] : 0;
    const esNit = cTp >= 0 && String(f[cTp]).trim().toUpperCase() === 'N';
    const a = dic.get(id);
    if (!a) dic.set(id, { nom, dir, tel, ciu, lic, fec, esNit });
    else if (fec > a.fec) {
      Object.assign(a, { nom: nom || a.nom, dir: dir || a.dir, tel: tel || a.tel, ciu: ciu || a.ciu, lic: lic || a.lic, fec });
    } else {
      Object.assign(a, { nom: a.nom || nom, dir: a.dir || dir, tel: a.tel || tel, ciu: a.ciu || ciu, lic: a.lic || lic });
    }
  }
  // Titulares existentes sin dirección: se completan
  let upT = 0;
  const titulares = await R.RndcTitular.find({ $or: [{ direccion: '' }, { direccion: null }] });
  for (const t of titulares) {
    const a = dic.get(t.doc);
    if (a) {
      if (a.nom) t.nombre = a.nom;
      t.direccion = a.dir || DIR_DEF; t.telefono = a.tel || TEL_DEF; t.ciudad = a.ciu || CIU_DEF;
      upT += 1;
    } else { t.direccion = DIR_DEF; t.telefono = t.telefono || TEL_DEF; t.ciudad = t.ciudad || CIU_DEF; }
    await t.save();
  }
  // Conductores: existentes se completan, los nuevos (personas, no NIT) se agregan
  let upC = 0;
  const existentes = await R.RndcConductor.find({ cedula: { $in: [...dic.keys()] } });
  const ya = new Set();
  for (const c2 of existentes) {
    ya.add(c2.cedula);
    const a = dic.get(c2.cedula);
    if (!c2.nombre) c2.nombre = a.nom;
    if (!c2.direccion) c2.direccion = a.dir || DIR_DEF;
    if (!c2.telefono) c2.telefono = a.tel || TEL_DEF;
    if (!c2.licencia) c2.licencia = a.lic;
    if (!c2.ciudad) c2.ciudad = a.ciu || CIU_DEF;
    await c2.save();
    upC += 1;
  }
  const nuevos = [];
  for (const [id, a] of dic) {
    if (!a.esNit && !ya.has(id) && a.nom) {
      nuevos.push({ cedula: id, nombre: a.nom, direccion: a.dir || DIR_DEF, telefono: a.tel || TEL_DEF, licencia: a.lic, ciudad: a.ciu || CIU_DEF });
    }
  }
  if (nuevos.length) await R.RndcConductor.insertMany(nuevos, { ordered: false });
  return { terceros: dic.size, titularesActualizados: upT, conductoresNuevos: nuevos.length, conductoresCompletados: upC,
    mensaje: `Terceros del maestro: ${dic.size}. Titulares actualizados: ${upT}. Conductores nuevos: ${nuevos.length}. Conductores completados: ${upC}.` };
}

// DIVIPOLA (cabeceras municipales tipo CM)
async function importarDane(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const nombre = wb.SheetNames.find(n => n === 'Cabeceras - Centros Poblados') || wb.SheetNames[wb.SheetNames.length - 1];
  const datos = filas(wb.Sheets[nombre]);
  const docs = [];
  for (const f of datos.slice(11)) {
    if (String(f[6]).trim() !== 'CM') continue;
    const nom = String(f[3]);
    let corto = nom;
    for (const sep of ['(', ',', ' - ']) { const p = corto.indexOf(sep); if (p > 0) corto = corto.slice(0, p); }
    docs.push({ codDepto: String(f[0]), departamento: String(f[1]), codMunicipio: String(f[2]), municipio: nom,
      codigo: String(f[4]), nombreNormalizado: normTxt(nom), nombreCorto: normTxt(corto) });
  }
  if (!docs.length) throw new Error('No se encontraron cabeceras municipales (tipo CM) en el archivo.');
  await R.RndcDane.deleteMany({});
  await R.RndcDane.insertMany(docs, { ordered: false });
  return { municipios: docs.length, mensaje: `Cabeceras municipales importadas: ${docs.length}.` };
}

module.exports = { VARIABLES_MODELO, importarVehiculos, importarTerceros, importarDane };
