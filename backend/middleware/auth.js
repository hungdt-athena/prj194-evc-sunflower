/**
 * Auth middleware: checks x-api-key header for sync endpoints.
 */
function requireApiKey(req, res, next) {
  const key = req.headers['x-api-key'];
  const expected = process.env.SYNC_API_KEY;

  if (!expected) {
    // No key configured, allow all (dev mode)
    return next();
  }

  if (key !== expected) {
    return res.status(401).json({ error: 'Unauthorized: invalid API key' });
  }

  next();
}

module.exports = { requireApiKey };
