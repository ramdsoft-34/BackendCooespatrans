// migrateOwners.js
// ─────────────────────────────────────────────────────────────────────────────
// Asigna un `owner` a los registros ANTIGUOS (bodegas, clientes, viajes) que se
// crearon antes de introducir el aislamiento por usuario.
//
// Tras el cambio, todo registro sin `owner` queda invisible para todos (que es
// justo el comportamiento deseado: un usuario nuevo ve su espacio vacío). Si
// quieres CONSERVAR los datos históricos y asignárselos a una cuenta concreta,
// ejecuta este script indicando el email de esa cuenta:
//
//   node migrateOwners.js correo@ejemplo.com
//
// Si NO ejecutas el script, los datos viejos simplemente dejan de mostrarse
// (no se borran). Puedes asignarlos más tarde cuando quieras.
// ─────────────────────────────────────────────────────────────────────────────
const mongoose = require('mongoose');
require('dotenv').config();

const User    = require('./models/User');
const Bodega  = require('./models/Bodega');
const Cliente = require('./models/Cliente');
const Viaje   = require('./models/Viaje');

async function run() {
  const email = process.argv[2];
  if (!email) {
    console.error('❌ Uso: node migrateOwners.js <email-del-usuario-destino>');
    console.error('   Ese usuario pasará a ser propietario de todos los datos sin owner.');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Conectado a MongoDB');

  const user = await User.findOne({ email: email.toLowerCase().trim() });
  if (!user) {
    console.error(`❌ No existe un usuario con email: ${email}`);
    process.exit(1);
  }
  console.log(`✅ Usuario destino: ${user.username} (${user.email}) — id ${user._id}`);

  const filtro = { $or: [{ owner: { $exists: false } }, { owner: null }] };

  const rB = await Bodega.updateMany(filtro, { $set: { owner: user._id } });
  const rC = await Cliente.updateMany(filtro, { $set: { owner: user._id } });
  const rV = await Viaje.updateMany(filtro, { $set: { owner: user._id } });

  console.log(`Bodegas actualizadas:  ${rB.modifiedCount}`);
  console.log(`Clientes actualizados: ${rC.modifiedCount}`);
  console.log(`Viajes actualizados:   ${rV.modifiedCount}`);
  console.log('Migración finalizada.');
  process.exit(0);
}

run().catch(err => {
  console.error('Error en migración:', err);
  process.exit(1);
});
