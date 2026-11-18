'use strict';
const path = require('node:path');
const express = require('express');
const { DateTime } = require('luxon');
const { q, transaction } = require('./db');
const auth = require('./auth');
const views = require('./views/pages');
const { availableSlots, createBooking, cancelBooking, BookingError } = require('./scheduling');
const { groupByDate } = require('./slots');
const { buildIcs, googleCalendarUrl } = require('./ics');
const { rateLimit } = require('./ratelimit');

// Set ALLOW_SIGNUP=false on a personal deployment so strangers can't create host accounts.
const ALLOW_SIGNUP = process.env.ALLOW_SIGNUP !== 'false';
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });
const bookLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 30 });

const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  // Booking manage links carry a secret token in the URL; don't leak it to other sites.
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});
app.get('/healthz', (_req, res) => res.type('text').send('ok'));
app.use(express.urlencoded({ extended: false, limit: '50kb' }));
app.use(express.json({ limit: '50kb' }));
app.use('/static', express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h' }));
app.use(auth.loadUser);

const RESERVED = new Set([
  'login', 'logout', 'signup', 'dashboard', 'api', 'booking', 'bookings', 'event-types',
  'availability', 'settings', 'static', 'admin', 'help', 'about', 'favicon.ico', 'robots.txt',
]);
const USERNAME_RE = /^[a-z0-9][a-z0-9-]{1,30}$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,60}$/;

const send = (res, page, status = 200) => res.status(status).type('html').send(String(page));
const baseUrl = (req) => `${req.protocol}://${req.get('host')}`;
const validTz = (tz) => typeof tz === 'string' && DateTime.local().setZone(tz).isValid;
const int = (v, def, min, max) => {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return def;
  return Math.min(max, Math.max(min, n));
};
const hhmmToMin = (s) => {
  const m = /^(\d{2}):(\d{2})$/.exec(s || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const safeNext = (n) => (typeof n === 'string' && n.startsWith('/') && !n.startsWith('//') ? n : '/dashboard');

// One-shot flash messages via a short-lived cookie.
app.use((req, res, next) => {
  const m = /(?:^|;\s*)flash=([^;]+)/.exec(req.headers.cookie || '');
  if (m) {
    try {
      req.flash = JSON.parse(Buffer.from(decodeURIComponent(m[1]), 'base64url').toString());
    } catch {}
    res.append('Set-Cookie', 'flash=; Max-Age=0; Path=/');
  }
  res.flash = (type, message) =>
    res.append('Set-Cookie', `flash=${Buffer.from(JSON.stringify({ type, message })).toString('base64url')}; Max-Age=60; Path=/; SameSite=Lax`);
  next();
});

/* ---------------- Marketing & auth ---------------- */

app.get('/', (req, res) => (req.user ? res.redirect('/dashboard') : send(res, views.landing({ user: null }))));

const signupClosed = (req, res) =>
  send(res, views.authForm({ mode: 'login', error: 'Sign-ups are closed on this server. Log in if you already have an account.' }), 403);
app.get('/signup', (req, res) => (ALLOW_SIGNUP ? send(res, views.authForm({ mode: 'signup' })) : signupClosed(req, res)));
app.post('/signup', authLimiter, (req, res) => {
  if (!ALLOW_SIGNUP) return signupClosed(req, res);
  const { name = '', email = '', password = '' } = req.body;
  const username = String(req.body.username || '').toLowerCase().trim();
  const values = { name, email, username };
  const fail = (error) => send(res, views.authForm({ mode: 'signup', error, values }), 400);

  if (!name.trim()) return fail('Name is required.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail('Enter a valid email.');
  if (!USERNAME_RE.test(username) || RESERVED.has(username)) return fail('That username is not allowed.');
  if (password.length < 8) return fail('Password must be at least 8 characters.');
  if (q.get('SELECT 1 FROM users WHERE email = ?', email)) return fail('An account with that email already exists.');
  if (q.get('SELECT 1 FROM users WHERE username = ?', username)) return fail('That username is taken.');

  const tz = validTz(req.body.timezone) ? req.body.timezone : 'UTC';
  const userId = transaction(() => {
    const info = q.run(
      'INSERT INTO users (email, name, username, password_hash, timezone) VALUES (?, ?, ?, ?, ?)',
      email.trim(), name.trim(), username, auth.hashPassword(password), tz
    );
    const id = Number(info.lastInsertRowid);
    // Sensible defaults: Mon–Fri 9–5 and a 30-minute meeting.
    for (let d = 1; d <= 5; d++) q.run('INSERT INTO availability (user_id, weekday, start_min, end_min) VALUES (?, ?, 540, 1020)', id, d);
    q.run(`INSERT INTO event_types (user_id, title, slug, duration_min) VALUES (?, '30 Minute Meeting', '30min', 30)`, id);
    return id;
  });
  auth.createSession(req, res, userId);
  res.flash('success', 'Welcome to Schedulr! We set up Mon–Fri 9am–5pm availability and a 30-minute event to get you started.');
  res.redirect('/dashboard');
});

app.get('/login', (req, res) => send(res, views.authForm({ mode: 'login', next: req.query.next })));
app.post('/login', authLimiter, (req, res) => {
  const { email = '', password = '' } = req.body;
  const user = q.get('SELECT * FROM users WHERE email = ?', email.trim());
  if (!user || !auth.verifyPassword(password, user.password_hash)) {
    return send(res, views.authForm({ mode: 'login', error: 'Invalid email or password.', values: { email }, next: req.query.next }), 401);
  }
  auth.createSession(req, res, user.id);
  res.redirect(safeNext(req.query.next));
});

app.post('/logout', (req, res) => {
  auth.destroySession(req, res);
  res.redirect('/');
});

/* ---------------- Host: event types ---------------- */

app.get('/dashboard', auth.requireUser, (req, res) => {
  const eventTypes = q.all('SELECT * FROM event_types WHERE user_id = ? ORDER BY active DESC, created_at', req.user.id);
  send(res, views.dashboard({ user: req.user, eventTypes, baseUrl: baseUrl(req), flash: req.flash }));
});

function readEventType(body) {
  const interval = parseInt(body.slot_interval_min, 10);
  return {
    title: String(body.title || '').trim().slice(0, 100),
    slug: String(body.slug || '').toLowerCase().trim(),
    description: String(body.description || '').slice(0, 2000),
    duration_min: int(body.duration_min, 30, 5, 720),
    location: String(body.location || '').trim().slice(0, 200),
    color: /^#[0-9a-f]{6}$/i.test(body.color) ? body.color : '#006bff',
    buffer_before_min: int(body.buffer_before_min, 0, 0, 240),
    buffer_after_min: int(body.buffer_after_min, 0, 0, 240),
    min_notice_min: int(body.min_notice_min, 240, 0, 43200),
    max_days_ahead: int(body.max_days_ahead, 60, 1, 365),
    slot_interval_min: Number.isNaN(interval) ? null : Math.min(240, Math.max(5, interval)),
  };
}

function validateEventType(et, userId, id = null) {
  if (!et.title) return 'Event name is required.';
  if (!SLUG_RE.test(et.slug)) return 'URL slug may only contain lowercase letters, digits and hyphens.';
  if (q.get('SELECT 1 FROM event_types WHERE user_id = ? AND slug = ? AND id IS NOT ?', userId, et.slug, id)) {
    return 'You already have an event type with that URL.';
  }
  return null;
}

const ET_COLS = ['title', 'slug', 'description', 'duration_min', 'location', 'color', 'buffer_before_min', 'buffer_after_min', 'min_notice_min', 'max_days_ahead', 'slot_interval_min'];

app.get('/event-types/new', auth.requireUser, (req, res) => send(res, views.eventTypeForm({ user: req.user, et: {} })));
app.post('/event-types', auth.requireUser, (req, res) => {
  const et = readEventType(req.body);
  const error = validateEventType(et, req.user.id);
  if (error) return send(res, views.eventTypeForm({ user: req.user, et, error }), 400);
  q.run(
    `INSERT INTO event_types (user_id, ${ET_COLS.join(', ')}) VALUES (?, ${ET_COLS.map(() => '?').join(', ')})`,
    req.user.id, ...ET_COLS.map((c) => et[c])
  );
  res.flash('success', `Created “${et.title}”.`);
  res.redirect('/dashboard');
});

function ownedEventType(req, res, next) {
  const et = q.get('SELECT * FROM event_types WHERE id = ? AND user_id = ?', req.params.id, req.user.id);
  if (!et) return send(res, views.notFound({ user: req.user }), 404);
  req.et = et;
  next();
}

app.get('/event-types/:id/edit', auth.requireUser, ownedEventType, (req, res) => send(res, views.eventTypeForm({ user: req.user, et: req.et })));
app.post('/event-types/:id', auth.requireUser, ownedEventType, (req, res) => {
  const et = { ...readEventType(req.body), id: req.et.id };
  const error = validateEventType(et, req.user.id, req.et.id);
  if (error) return send(res, views.eventTypeForm({ user: req.user, et, error }), 400);
  q.run(`UPDATE event_types SET ${ET_COLS.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, ...ET_COLS.map((c) => et[c]), req.et.id);
  res.flash('success', 'Saved.');
  res.redirect('/dashboard');
});
app.post('/event-types/:id/toggle', auth.requireUser, ownedEventType, (req, res) => {
  q.run('UPDATE event_types SET active = 1 - active WHERE id = ?', req.et.id);
  res.redirect('/dashboard');
});
app.post('/event-types/:id/delete', auth.requireUser, ownedEventType, (req, res) => {
  q.run('DELETE FROM event_types WHERE id = ?', req.et.id);
  res.flash('success', `Deleted “${req.et.title}”.`);
  res.redirect('/dashboard');
});

/* ---------------- Host: availability ---------------- */

app.get('/availability', auth.requireUser, (req, res) => {
  const weekly = q.all('SELECT * FROM availability WHERE user_id = ? ORDER BY weekday, start_min', req.user.id);
  const today = DateTime.now().setZone(req.user.timezone).toISODate();
  const overrides = q.all('SELECT * FROM date_overrides WHERE user_id = ? AND date >= ? ORDER BY date, start_min', req.user.id, today);
  send(res, views.availabilityPage({ user: req.user, weekly, overrides, flash: req.flash }));
});

app.post('/availability', auth.requireUser, (req, res) => {
  const rows = [];
  for (let d = 1; d <= 7; d++) {
    const starts = [].concat(req.body[`d${d}_start`] || []);
    const ends = [].concat(req.body[`d${d}_end`] || []);
    for (let i = 0; i < starts.length; i++) {
      const s = hhmmToMin(starts[i]);
      let e = hhmmToMin(ends[i]);
      if (e === 0) e = 1440; // "00:00" as end means midnight
      if (s == null || e == null || e <= s) {
        res.flash('error', 'Each interval needs an end time after its start time.');
        return res.redirect('/availability');
      }
      rows.push([d, s, e]);
    }
  }
  const tz = validTz(req.body.timezone) ? req.body.timezone : req.user.timezone;
  transaction(() => {
    q.run('UPDATE users SET timezone = ? WHERE id = ?', tz, req.user.id);
    q.run('DELETE FROM availability WHERE user_id = ?', req.user.id);
    for (const [d, s, e] of rows) q.run('INSERT INTO availability (user_id, weekday, start_min, end_min) VALUES (?, ?, ?, ?)', req.user.id, d, s, e);
  });
  res.flash('success', 'Availability saved.');
  res.redirect('/availability');
});

app.post('/availability/overrides', auth.requireUser, (req, res) => {
  const date = String(req.body.date || '');
  if (!DateTime.fromISO(date).isValid || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.flash('error', 'Pick a valid date.');
    return res.redirect('/availability');
  }
  const s = hhmmToMin(req.body.start);
  let e = hhmmToMin(req.body.end);
  if (e === 0) e = 1440;
  const blockDay = s == null && e == null;
  if (!blockDay && (s == null || e == null || e <= s)) {
    res.flash('error', 'Override needs both times (end after start), or neither to block the day.');
    return res.redirect('/availability');
  }
  transaction(() => {
    // A full-day block replaces anything else on that date; adding hours removes an existing block.
    if (blockDay) q.run('DELETE FROM date_overrides WHERE user_id = ? AND date = ?', req.user.id, date);
    else q.run('DELETE FROM date_overrides WHERE user_id = ? AND date = ? AND start_min IS NULL', req.user.id, date);
    q.run('INSERT INTO date_overrides (user_id, date, start_min, end_min) VALUES (?, ?, ?, ?)', req.user.id, date, blockDay ? null : s, blockDay ? null : e);
  });
  res.flash('success', 'Override added.');
  res.redirect('/availability');
});

app.post('/availability/overrides/:id/delete', auth.requireUser, (req, res) => {
  q.run('DELETE FROM date_overrides WHERE id = ? AND user_id = ?', req.params.id, req.user.id);
  res.redirect('/availability');
});

/* ---------------- Host: bookings & settings ---------------- */

app.get('/bookings', auth.requireUser, (req, res) => {
  const tab = ['upcoming', 'past', 'canceled'].includes(req.query.tab) ? req.query.tab : 'upcoming';
  const now = DateTime.utc().toISO();
  const where = {
    upcoming: `b.status = 'confirmed' AND b.end_utc >= ? ORDER BY b.start_utc ASC`,
    past: `b.status = 'confirmed' AND b.end_utc < ? ORDER BY b.start_utc DESC`,
    canceled: `b.status = 'canceled' AND ? IS NOT NULL ORDER BY b.start_utc DESC`,
  }[tab];
  const bookings = q.all(
    `SELECT b.*, e.title AS event_title, e.color FROM bookings b JOIN event_types e ON e.id = b.event_type_id
     WHERE b.user_id = ? AND ${where} LIMIT 200`,
    req.user.id, now
  );
  send(res, views.bookingsPage({ user: req.user, tab, bookings, flash: req.flash }));
});

app.post('/bookings/:id/cancel', auth.requireUser, (req, res) => {
  const b = q.get('SELECT id FROM bookings WHERE id = ? AND user_id = ?', req.params.id, req.user.id);
  if (b) cancelBooking(b.id, 'host', req.body.reason);
  res.flash('success', 'Meeting canceled.');
  res.redirect('/bookings');
});

app.get('/settings', auth.requireUser, (req, res) => send(res, views.settingsPage({ user: req.user, flash: req.flash })));
app.post('/settings', auth.requireUser, (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 100);
  const username = String(req.body.username || '').toLowerCase().trim();
  const fail = (error) => send(res, views.settingsPage({ user: { ...req.user, name, username }, error }), 400);
  if (!name) return fail('Name is required.');
  if (!USERNAME_RE.test(username) || RESERVED.has(username)) return fail('That username is not allowed.');
  if (q.get('SELECT 1 FROM users WHERE username = ? AND id != ?', username, req.user.id)) return fail('That username is taken.');
  q.run('UPDATE users SET name = ?, username = ? WHERE id = ?', name, username, req.user.id);
  res.flash('success', 'Settings saved.');
  res.redirect('/settings');
});

/* ---------------- Public API ---------------- */

function findPublicEventType(username, slug) {
  const host = q.get('SELECT * FROM users WHERE username = ?', username);
  if (!host) return {};
  const et = q.get('SELECT * FROM event_types WHERE user_id = ? AND slug = ? AND active = 1', host.id, slug);
  return { host, et };
}

function findRescheduleBooking(token, et) {
  if (!token) return null;
  const b = q.get(`SELECT * FROM bookings WHERE token = ? AND event_type_id = ? AND status = 'confirmed'`, token, et.id);
  return b && DateTime.fromISO(b.start_utc) > DateTime.utc() ? b : null;
}

// GET /api/slots/:username/:slug?month=2026-11&tz=Europe/London
app.get('/api/slots/:username/:slug', (req, res) => {
  const { host, et } = findPublicEventType(req.params.username, req.params.slug);
  if (!et) return res.status(404).json({ error: 'Event type not found.' });
  const tz = validTz(req.query.tz) ? req.query.tz : host.timezone;
  const month = DateTime.fromFormat(String(req.query.month || ''), 'yyyy-MM', { zone: tz });
  const start = (month.isValid ? month : DateTime.now().setZone(tz)).startOf('month');
  const end = start.plus({ months: 1 });
  const reschedule = findRescheduleBooking(req.query.reschedule, et);
  const slots = availableSlots(host, et, start, end, { excludeBookingId: reschedule?.id ?? null });
  res.json({ timezone: tz, month: start.toFormat('yyyy-MM'), slots: groupByDate(slots, tz) });
});

app.post('/api/book/:username/:slug', bookLimiter, (req, res) => {
  const { host, et } = findPublicEventType(req.params.username, req.params.slug);
  if (!et) return res.status(404).json({ error: 'Event type not found.' });
  const { start, name, email, notes, timezone, reschedule: rToken } = req.body || {};
  let reschedule = null;
  if (rToken) {
    reschedule = findRescheduleBooking(rToken, et);
    if (!reschedule) return res.status(400).json({ error: 'The meeting you are rescheduling can no longer be changed.' });
  }
  try {
    const { token } = createBooking({ host, eventType: et, startIso: start, name, email, notes, timezone, reschedule });
    res.status(201).json({ token, url: `/booking/${token}?new=1` });
  } catch (err) {
    if (err instanceof BookingError) return res.status(err.status).json({ error: err.message });
    throw err;
  }
});

/* ---------------- Invitee booking management ---------------- */

function loadBookingByToken(token) {
  const booking = q.get('SELECT * FROM bookings WHERE token = ?', token);
  if (!booking) return null;
  const host = q.get('SELECT id, name, username, email, timezone FROM users WHERE id = ?', booking.user_id);
  const et = q.get('SELECT * FROM event_types WHERE id = ?', booking.event_type_id);
  return { booking, host, et };
}

app.get('/booking/:token', (req, res) => {
  const found = loadBookingByToken(req.params.token);
  if (!found) return send(res, views.notFound({ message: 'This booking link is invalid.' }), 404);
  const { booking, host, et } = found;
  const googleUrl = googleCalendarUrl({
    title: `${et.title} with ${host.name}`,
    description: booking.notes,
    location: et.location,
    startUtc: booking.start_utc,
    endUtc: booking.end_utc,
  });
  send(res, views.bookingConfirmation({ booking, host, et, tz: booking.invitee_timezone, googleUrl, justBooked: req.query.new === '1' }));
});

app.get('/booking/:token/invite.ics', (req, res) => {
  const found = loadBookingByToken(req.params.token);
  if (!found) return res.status(404).end();
  const { booking, host, et } = found;
  const ics = buildIcs({
    uid: `booking-${booking.id}@schedulr`,
    title: `${et.title} with ${host.name}`,
    description: booking.notes,
    location: et.location,
    startUtc: booking.start_utc,
    endUtc: booking.end_utc,
    organizerName: host.name,
    organizerEmail: host.email,
    canceled: booking.status === 'canceled',
  });
  res.type('text/calendar').attachment(`${et.slug}.ics`).send(ics);
});

app.post('/booking/:token/cancel', (req, res) => {
  const found = loadBookingByToken(req.params.token);
  if (!found) return send(res, views.notFound(), 404);
  cancelBooking(found.booking.id, 'invitee', req.body.reason);
  res.redirect(`/booking/${req.params.token}`);
});

/* ---------------- Public profile & booking page (keep last) ---------------- */

app.get('/:username', (req, res, next) => {
  if (RESERVED.has(req.params.username)) return next();
  const host = q.get('SELECT * FROM users WHERE username = ?', req.params.username);
  if (!host) return next();
  const eventTypes = q.all('SELECT * FROM event_types WHERE user_id = ? AND active = 1 ORDER BY created_at', host.id);
  send(res, views.publicProfile({ host, eventTypes }));
});

app.get('/:username/:slug', (req, res, next) => {
  if (RESERVED.has(req.params.username)) return next();
  const { host, et } = findPublicEventType(req.params.username, req.params.slug);
  if (!et) return next();
  const reschedule = findRescheduleBooking(req.query.reschedule, et);
  send(res, views.bookingPage({ host, et, reschedule }));
});

app.use((req, res) => send(res, views.notFound({ user: req.user }), 404));

app.use((err, req, res, _next) => {
  console.error(err);
  if (req.path.startsWith('/api/')) return res.status(500).json({ error: 'Something went wrong.' });
  res.status(500).type('text').send('Something went wrong.');
});

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const server = app.listen(port, '0.0.0.0', () => console.log(`Schedulr listening on port ${port}`));
  const shutdown = () => {
    server.close(() => {
      require('./db').db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

module.exports = app;
