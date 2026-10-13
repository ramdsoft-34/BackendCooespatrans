const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const compression = require('compression');
const dotenv = require('dotenv');
const authRoutes = require('./routes/authRoutes');
const { protect } = require('./controllers/authController');

dotenv.config();

const app = express();

const corsOptions = {
  origin: [
    'https://www.cooespatrans.com',
    'https://cooespatrans.com'
  ],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(compression());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

app.use('/pdfs', express.static('/var/www/cooespatrans/pdfs'));
app.use('/uploads', express.static('/var/www/cooespatrans/uploads', {
  maxAge: '1d',
  etag: true,
}));

mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('Conectado a MongoDB'))
  .catch((error) => console.error('Error conectando a MongoDB:', error));

app.use('/api/auth',           authRoutes);
// Rutas de datos: protegidas y filtradas por usuario autenticado (owner).
// En viajes y cargar, la protección se aplica por-ruta dentro del router,
// para no romper los endpoints usados por la app móvil del conductor.
app.use('/api/cargar',         require('./routes/cargarRoutes'));
app.use('/api/viajes',         require('./routes/viajeRoutes'));
app.use('/api/clientes',       protect, require('./routes/clienteRoutes'));
app.use('/api/bodegas',        protect, require('./routes/bodegaRoutes'));
app.use('/api/pdfs',           require('./routes/pdfRoutes'));
app.use('/api/planillas',      require('./routes/planillaRoutes'));
app.use('/api/email',          require('./routes/emailRoutes'));
app.use('/api/manifiestos',    require('./routes/manifestoRoutes')); // ← NUEVO
app.use('/api/sede-config',    require('./routes/sedeConfigRoutes'));
app.use('/api/notificaciones', protect, require('./routes/notificacionRoutes')); // ← NUEVO
// 📖 Manual de usuario: GET público (sin protect); las rutas de escritura
// están protegidas dentro del propio archivo (protect + solo admin).
app.use('/api/manual',         require('./routes/manualRoutes'));

app.get('/', (_req, res) => {
  res.json({ message: 'Servidor Cooespatrans funcionando correctamente' });
});

app.use((err, _req, res, _next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Error interno del servidor', error: err.message });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));