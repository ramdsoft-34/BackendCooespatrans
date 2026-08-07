// controllers/authController.js
const User = require('../models/User');
const jwt = require('jsonwebtoken');
const Bodega = require('../models/Bodega');

const generateToken = (userId) =>
  jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '7d' });

// Sedes válidas — un solo lugar para mantenerlas
const SEDES_VALIDAS = ['Pitalito', 'Neiva', 'Pasto'];

// Roles que REQUIEREN sedeNombre (sede operativa + admin de sede)
const ROLES_CON_SEDE = ['sede'];
const ROLES_CON_BODEGA = ['jefeBodega'];

// ── Middleware de protección ──────────────────────────────────────────────
exports.protect = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token)
      return res.status(401).json({ success: false, message: 'Token no proporcionado' });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId).select('-password');

    if (!user || !user.isActive)
      return res.status(401).json({ success: false, message: 'Token inválido' });

    req.user = user;
    next();
  } catch {
    res.status(401).json({ success: false, message: 'Token inválido' });
  }
};

// ── POST /api/auth/register ───────────────────────────────────────────────
exports.registerUser = async (req, res) => {
  try {
    const { username, password, email, role, sedeNombre } = req.body;

    if (!username || !password || !email)
      return res.status(400).json({
        success: false,
        message: 'username, password y email son requeridos'
      });

    // ✅ 'sede' y 'adminSede' requieren sedeNombre
    if (ROLES_CON_SEDE.includes(role) && !sedeNombre)
      return res.status(400).json({
        success: false,
        message: `sedeNombre es requerida para el rol ${role}`
      });
    // ✅ jefeBodega requiere bodegaId válido
    if (ROLES_CON_BODEGA.includes(role)) {
      if (!req.body.bodegaId)
        return res.status(400).json({
          success: false,
          message: `bodegaId es requerido para el rol ${role}`
        });

      const bodega = await Bodega.findById(req.body.bodegaId);
      if (!bodega)
        return res.status(400).json({
          success: false,
          message: 'Bodega no encontrada'
        });
    }

    if (sedeNombre && !SEDES_VALIDAS.includes(sedeNombre))
      return res.status(400).json({
        success: false,
        message: `Sede inválida. Opciones: ${SEDES_VALIDAS.join(', ')}`
      });

    const existe = await User.findOne({ $or: [{ username }, { email }] });
    if (existe)
      return res.status(409).json({
        success: false,
        message: 'Usuario o email ya registrado'
      });

    const user = await User.create({
      username,
      password,
      email,
      role: role || 'user',
      sedeNombre: ROLES_CON_SEDE.includes(role) ? sedeNombre : null,
      bodegaId: ROLES_CON_BODEGA.includes(role) ? req.body.bodegaId : null,
    });

    res.status(201).json({
      success: true,
      message: 'Usuario creado correctamente',
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        sedeNombre: user.sedeNombre,
        bodegaId: user.bodegaId,
      },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'Error al crear usuario',
      error: err.message
    });
  }
};

// ── POST /api/auth/login ──────────────────────────────────────────────────
exports.loginUser = async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({
        success: false,
        message: 'Username y password son requeridos'
      });

    const user = await User.findOne({
      $or: [{ username }, { email: username }],
      isActive: true,
    });

    if (!user || !(await user.comparePassword(password)))
      return res.status(401).json({
        success: false,
        message: 'Credenciales inválidas'
      });

    const token = generateToken(user._id);

    res.status(200).json({
      success: true,
      message: 'Login exitoso',
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        sedeNombre: user.sedeNombre,
        bodegaId: user.bodegaId,
      },
    });
  } catch {
    res.status(500).json({ success: false, message: 'Error interno del servidor' });
  }
};

// ── GET /api/auth/verify ──────────────────────────────────────────────────
exports.verifyToken = async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token)
      return res.status(401).json({ success: false, message: 'Token no proporcionado' });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId).select('-password');

    if (!user || !user.isActive)
      return res.status(401).json({ success: false, message: 'Token inválido' });

    res.status(200).json({
      success: true,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        sedeNombre: user.sedeNombre,
        bodegaId: user.bodegaId,
      },
    });
  } catch {
    res.status(401).json({ success: false, message: 'Token inválido' });
  }
};

// ── GET /api/auth/users ───────────────────────────────────────────────────
exports.getAllUsers = async (req, res) => {
  try {
    const { role: callerRole, sedeNombre: callerSede } = req.user;

    // ✅ admin ve todos; adminSede solo ve los de su sede
    if (callerRole === 'admin') {
      const users = await User.find().select('-password').sort({ createdAt: -1 });
      return res.status(200).json({ success: true, users });
    }

    if (callerRole === 'adminSede') {
      // Solo devuelve usuarios cuya sedeNombre coincide con la del adminSede
      const users = await User
        .find({ sedeNombre: callerSede })
        .select('-password')
        .sort({ createdAt: -1 });
      return res.status(200).json({ success: true, users });
    }

    return res.status(403).json({ success: false, message: 'Sin permisos' });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'Error al obtener usuarios',
      error: err.message
    });
  }
};

// ── PUT /api/auth/users/:id ───────────────────────────────────────────────
exports.updateUser = async (req, res) => {
  try {
    const { role: callerRole, sedeNombre: callerSede } = req.user;

    // Solo admin y adminSede pueden editar
    if (!['admin', 'adminSede'].includes(callerRole))
      return res.status(403).json({ success: false, message: 'Sin permisos' });

    const { email, role, sedeNombre, password } = req.body;

    if (ROLES_CON_SEDE.includes(role) && !sedeNombre)
      return res.status(400).json({
        success: false,
        message: 'sedeNombre requerida para ese rol'
      });

    if (sedeNombre && !SEDES_VALIDAS.includes(sedeNombre))
      return res.status(400).json({ success: false, message: 'Sede inválida' });

    const user = await User.findById(req.params.id);
    if (!user)
      return res.status(404).json({ success: false, message: 'Usuario no encontrado' });

    // ✅ adminSede solo puede editar usuarios de su propia sede
    if (callerRole === 'adminSede' && user.sedeNombre !== callerSede)
      return res.status(403).json({
        success: false,
        message: 'Solo puedes editar usuarios de tu sede'
      });

    // ✅ adminSede no puede cambiar roles — solo el admin puede
    if (callerRole === 'adminSede' && role && role !== user.role)
      return res.status(403).json({
        success: false,
        message: 'No tienes permiso para cambiar el rol de un usuario'
      });

    if (email) user.email = email.toLowerCase().trim();
    if (role) user.role = role;
    user.sedeNombre = ROLES_CON_SEDE.includes(role ?? user.role) ? sedeNombre : null;
    if (password) user.password = password;

    await user.save();

    res.status(200).json({
      success: true,
      message: 'Usuario actualizado',
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        sedeNombre: user.sedeNombre,
        bodegaId: user.bodegaId,
      },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'Error al actualizar',
      error: err.message
    });
  }
};

// ── DELETE /api/auth/users/:id ────────────────────────────────────────────
exports.deleteUser = async (req, res) => {
  try {
    const { role: callerRole, sedeNombre: callerSede } = req.user;

    if (!['admin', 'adminSede'].includes(callerRole))
      return res.status(403).json({ success: false, message: 'Sin permisos' });

    if (req.params.id === req.user._id.toString())
      return res.status(400).json({
        success: false,
        message: 'No puedes eliminarte a ti mismo'
      });

    const user = await User.findById(req.params.id);
    if (!user)
      return res.status(404).json({ success: false, message: 'Usuario no encontrado' });

    // ✅ adminSede solo puede eliminar usuarios de su sede
    if (callerRole === 'adminSede' && user.sedeNombre !== callerSede)
      return res.status(403).json({
        success: false,
        message: 'Solo puedes eliminar usuarios de tu sede'
      });

    await user.deleteOne();
    res.status(200).json({ success: true, message: 'Usuario eliminado correctamente' });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'Error al eliminar',
      error: err.message
    });
  }
};