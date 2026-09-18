const express = require('express');
const router = express.Router();
const { getDashboardData } = require('../db');

router.get('/', (req, res) => {
  try {
    res.json(getDashboardData());
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

module.exports = router;
