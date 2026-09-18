const express = require('express');
const router = express.Router();
const { stmts } = require('../db');

router.get('/', (req, res) => {
  const meta = stmts.getMeta.get();
  res.json({
    last_synced_at: meta.last_synced_at,
    rows_in_sheet: meta.rows_in_sheet,
    rows_in_db: meta.rows_in_db,
    last_new_rows: meta.last_new_rows,
    last_deleted: meta.last_deleted,
    last_updated: meta.last_updated,
    fingerprint: meta.fingerprint,
    last_status: meta.last_status,
  });
});

module.exports = router;
