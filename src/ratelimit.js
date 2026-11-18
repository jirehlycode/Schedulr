'use strict';

/**
 * Minimal in-memory fixed-window rate limiter keyed by client IP.
 * Good enough for a single instance; swap for a shared store if you run several.
 */
function rateLimit({ windowMs, max, message = 'Too many requests. Please try again later.' }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
  }, windowMs).unref();

  return (req, res, next) => {
    const key = req.ip || 'unknown';
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || entry.reset <= now) {
      entry = { count: 0, reset: now + windowMs };
      hits.set(key, entry);
    }
    entry.count++;
    if (entry.count > max) {
      res.setHeader('Retry-After', Math.ceil((entry.reset - now) / 1000));
      if (req.path.startsWith('/api/') || req.is('json')) return res.status(429).json({ error: message });
      return res.status(429).type('text').send(message);
    }
    next();
  };
}

module.exports = { rateLimit };
