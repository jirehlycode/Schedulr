'use strict';
const { DateTime } = require('luxon');
const { q, transaction } = require('./db');
const { computeSlots } = require('./slots');
const { randomToken } = require('./auth');

function loadHostAvailability(userId) {
  return {
    weekly: q.all('SELECT weekday, start_min, end_min FROM availability WHERE user_id = ?', userId),
    overrides: q.all('SELECT date, start_min, end_min FROM date_overrides WHERE user_id = ?', userId),
  };
}

function loadBusy(userId, from, to, excludeBookingId = null) {
  // Pad by a day so buffers at the edges are respected. Each existing booking keeps the
  // buffers of its own event type, so a booked 60-min consult with a 15-min after-buffer
  // blocks 15 minutes past its end even for a different event type with no buffers.
  const rows = q.all(
    `SELECT b.start_utc, b.end_utc, e.buffer_before_min, e.buffer_after_min
     FROM bookings b JOIN event_types e ON e.id = b.event_type_id
     WHERE b.user_id = ? AND b.status = 'confirmed' AND b.end_utc > ? AND b.start_utc < ? AND b.id IS NOT ?`,
    userId,
    from.minus({ days: 1 }).toUTC().toISO(),
    to.plus({ days: 1 }).toUTC().toISO(),
    excludeBookingId
  );
  return rows.map((r) => ({
    start_utc: DateTime.fromISO(r.start_utc, { zone: 'utc' }).minus({ minutes: r.buffer_before_min }).toISO(),
    end_utc: DateTime.fromISO(r.end_utc, { zone: 'utc' }).plus({ minutes: r.buffer_after_min }).toISO(),
  }));
}

function availableSlots(host, eventType, rangeStart, rangeEnd, { excludeBookingId = null, now } = {}) {
  const { weekly, overrides } = loadHostAvailability(host.id);
  const busy = loadBusy(host.id, rangeStart, rangeEnd, excludeBookingId);
  return computeSlots({ eventType, hostTz: host.timezone, weekly, overrides, busy, rangeStart, rangeEnd, now });
}

class BookingError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/**
 * Create a booking after re-validating the slot inside a write transaction,
 * so two invitees racing for the same time can't both win.
 * When `reschedule` is given, the old booking is canceled atomically.
 */
function createBooking({ host, eventType, startIso, name, email, notes, timezone, reschedule = null }) {
  const start = DateTime.fromISO(startIso, { zone: 'utc' });
  if (!start.isValid) throw new BookingError('Invalid start time.');
  if (!name || !name.trim()) throw new BookingError('Name is required.');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BookingError('A valid email is required.');
  if (!DateTime.local().setZone(timezone).isValid) timezone = 'UTC';

  return transaction(() => {
    const slots = availableSlots(host, eventType, start.minus({ minutes: 1 }), start.plus({ minutes: 1 }), {
      excludeBookingId: reschedule ? reschedule.id : null,
    });
    if (!slots.some((s) => s.toMillis() === start.toMillis())) {
      throw new BookingError('Sorry, that time is no longer available. Please pick another.', 409);
    }

    if (reschedule) {
      q.run(
        `UPDATE bookings SET status = 'canceled', cancel_reason = 'Rescheduled', canceled_by = 'invitee' WHERE id = ?`,
        reschedule.id
      );
    }

    const end = start.plus({ minutes: eventType.duration_min });
    const token = randomToken(18);
    const info = q.run(
      `INSERT INTO bookings (event_type_id, user_id, invitee_name, invitee_email, invitee_timezone, notes,
                             start_utc, end_utc, token, rescheduled_from)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      eventType.id,
      host.id,
      name.trim().slice(0, 200),
      email.trim().slice(0, 200),
      timezone,
      (notes || '').trim().slice(0, 2000),
      start.toISO(),
      end.toISO(),
      token,
      reschedule ? reschedule.id : null
    );
    return { id: Number(info.lastInsertRowid), token };
  });
}

function cancelBooking(bookingId, by, reason) {
  q.run(
    `UPDATE bookings SET status = 'canceled', canceled_by = ?, cancel_reason = ? WHERE id = ? AND status = 'confirmed'`,
    by,
    (reason || '').slice(0, 500),
    bookingId
  );
}

module.exports = { availableSlots, createBooking, cancelBooking, BookingError };
