const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/sedeConfigController');
const { protect } = require('../controllers/authController');

// Solo 'admin' puede gestionar la visibilidad de sedes
const onlyAdmin = (req, res, next) => {
  if (req.user.role !== 'admin')
    return res.status(403).json({ message: 'Solo el administrador puede gestionar la visibilidad de sedes' });
  next();
};

router.get  ('/',               protect, onlyAdmin, ctrl.getAll);
router.patch('/:nombre/toggle', protect, onlyAdmin, ctrl.toggle);

module.exports = router;