// scripts/importarPlantillaViajes.js
//
// Carga en la base de datos (MONGODB_URI del .env) toda la información de la
// plantilla de Excel "PLANTILLA_DE_VIAJES_FORMULARIO.xlsm": empresas, correos,
// tarifas, conductores, bitácora, relación de fletes y todo lo del RNDC.
//
// Es SEGURO volver a correrlo: no borra ni sobrescribe nada, solo agrega lo
// que falta. También se puede hacer desde la web (Logística > Maestros >
// Importar plantilla).
//
// USO (desde la raíz del backend):
//   node scripts/importarPlantillaViajes.js "C:\ruta\PLANTILLA_DE_VIAJES_FORMULARIO.xlsm"

require('dotenv').config();
const fs = require('fs');
const mongoose = require('mongoose');
const { importarPlantilla } = require('../services/logistica/importador');

(async () => {
  const ruta = process.argv[2];
  if (!ruta || !fs.existsSync(ruta)) {
    console.error('Indique la ruta del archivo .xlsm de la plantilla de viajes.');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGODB_URI);
  const resultado = await importarPlantilla(fs.readFileSync(ruta));
  console.log(JSON.stringify(resultado, null, 2));
  await mongoose.disconnect();
})().catch((e) => {
  console.error('Error importando la plantilla:', e);
  process.exit(1);
});
