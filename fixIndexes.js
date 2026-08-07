// fixIndexes.js
// ─────────────────────────────────────────────────────────────────────────────
// Elimina el índice único GLOBAL antiguo sobre `codigo` de la colección de
// viajes (ahora el código de planilla es único POR usuario) y sincroniza los
// nuevos índices definidos en los modelos.
//
// Ejecuta una sola vez, antes de arrancar el servidor con el nuevo código:
//   node fixIndexes.js
// ─────────────────────────────────────────────────────────────────────────────
const mongoose = require('mongoose');
require('dotenv').config();

const Bodega  = require('./models/Bodega');
const Cliente = require('./models/Cliente');
const Viaje   = require('./models/Viaje');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Conectado a MongoDB');

  // 1) Eliminar el índice único global obsoleto sobre codigo (si existe)
  try {
    await Viaje.collection.dropIndex('codigo_1');
    console.log('✅ Índice obsoleto "codigo_1" eliminado');
  } catch (err) {
    if (err.codeName === 'IndexNotFound' || /index not found/i.test(err.message)) {
      console.log('ℹ️  No existía "codigo_1" (nada que eliminar)');
    } else {
      console.warn('⚠️  No se pudo eliminar "codigo_1":', err.message);
    }
  }

  // 2) Sincronizar los índices declarados en los modelos
  //    (crea owner+codigo, owner+nombre, owner+bodegaId, etc.)
  console.log('Sincronizando índices de los modelos...');
  await Promise.all([
    Bodega.syncIndexes(),
    Cliente.syncIndexes(),
    Viaje.syncIndexes(),
  ]);
  console.log('✅ Índices sincronizados');

  console.log('Listo.');
  process.exit(0);
}

run().catch(err => {
  console.error('Error en fixIndexes:', err);
  process.exit(1);
});
