// routes/authRoutes.js
const express = require('express');
const router  = express.Router();
const { loginUser, verifyToken, registerUser, protect,  getAllUsers, updateUser, deleteUser   } = require('../controllers/authController');

router.post('/register', registerUser);   // 👈 nuevo
router.post('/login',    loginUser);
router.get ('/verify',   verifyToken);
router.get ('/users',          protect, getAllUsers);   // listar
router.put ('/users/:id',      protect, updateUser);   // editar
router.delete('/users/:id',    protect, deleteUser);   // eliminar


module.exports = router;