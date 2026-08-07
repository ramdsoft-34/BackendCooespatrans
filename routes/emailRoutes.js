const nodemailer = require('nodemailer');
const router = require('express').Router();

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: {
    user: 'ricardomelo.cooespatrans@gmail.com',
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

router.post('/send', async (req, res) => {
  const { from, to, subject, text } = req.body;
  try {
    await transporter.sendMail({ from, to, subject, text });
    res.json({ ok: true });
  } catch (err) {
    console.error('Error nodemailer:', err);
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;