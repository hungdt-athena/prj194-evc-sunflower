const express = require('express');
const store = require('../db');
const { createSettings } = require('../settings');

// Router nhận settings từ ngoài để test dựng được bản chạy trên DB trong RAM.
function createRouter(settings) {
const router = express.Router();

function requireToken(req, res, next) {
  const token = req.get('x-config-token') || '';
  if (!settings.checkToken(token)) {
    return res.status(401).json({ error: 'Your session has expired. Enter the password again.' });
  }
  next();
}

router.get('/', (req, res) => {
  res.json({ values: settings.getValues(), schema: settings.schema(), locked: settings.isLocked() });
});

router.post('/unlock', (req, res) => {
  const result = settings.unlock(String(req.body?.password || ''), req.ip);
  if (result.token) return res.json({ token: result.token, expiresAt: result.expiresAt });
  if (result.lockedOutFor) {
    return res.status(429).json({
      error: `Too many wrong passwords. Try again in ${Math.ceil(result.lockedOutFor / 60)} minutes.`,
      retryInSeconds: result.lockedOutFor,
    });
  }
  return res.status(401).json({ error: result.error, triesLeft: result.triesLeft });
});

router.post('/', requireToken, (req, res) => {
  const result = settings.saveValues(req.body?.values);
  if (result.fields) return res.status(400).json({ error: 'Some values need fixing.', fields: result.fields });
  res.json({ values: result.values });
});

router.post('/reset', requireToken, (req, res) => {
  res.json({ values: settings.resetToDefaults() });
});

router.post('/password', requireToken, (req, res) => {
  const result = settings.changePassword(String(req.body?.current || ''), String(req.body?.next || ''));
  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ ok: true });
});

return router;
}

module.exports = createRouter(createSettings({ store }));
module.exports.createRouter = createRouter;
