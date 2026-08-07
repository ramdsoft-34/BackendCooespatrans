// createSedeUser.js
const mongoose = require('mongoose');
const User = require('./models/User');
require('dotenv').config();

const sedesACrear = [
  {
    username: 'sede_neiva',
    email: 'neiva@cooespatrans.com',
    password: 'neiva123',
    role: 'sede',
    sedeNombre: 'Neiva'
  },
];

async function crearSedes() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Conectado a MongoDB');

    for (const sedeData of sedesACrear) {
      const existe = await User.findOne({ email: sedeData.email });
      if (existe) {
        console.log(`⚠️  Ya existe: ${sedeData.email}`);
        continue;
      }
      const sede = new User(sedeData);
      await sede.save();
      console.log(`✅ Creado: ${sedeData.username} (${sedeData.sedeNombre})`);
    }

    console.log('Proceso finalizado.');
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

crearSedes();