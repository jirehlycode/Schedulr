'use strict';
const { DateTime, Interval } = require('luxon');

/**
 * Compute bookable start times for an event type.
 *
 * Pure function: everything it needs is passed in, so it is unit-testable.
 *
 * @param {object}   o
 * @param {object}   o.eventType   row from event_types
 * @param {string}   o.hostTz      IANA zone the availability is expressed in
 * @param {Array}    o.weekly      [{weekday 1-7, start_min, end_min}]
 * @param {Array}    o.overrides   [{date 'YYYY-MM-DD', start_min|null, end_min|null}]
 * @param {Array}    o.busy        [{start_utc, end_utc}] confirmed bookings for this host (any event type)
 * @param {DateTime} o.rangeStart  inclusive (any zone)
 * @param {DateTime} o.rangeEnd    exclusive (any zone)
 * @param {DateTime} [o.now]
 * @returns {DateTime[]} slot starts in UTC, ascending
 */
function computeSlots({ eventType, hostTz, weekly, overrides, busy, rangeStart, rangeEnd, now = DateTime.utc() }) {
  const duration = eventType.duration_min;
  const step = eventType.slot_interval_min || duration;
  const bufBefore = eventType.buffer_before_min || 0;
  const bufAfter = eventType.buffer_after_min || 0;

  const earliest = now.plus({ minutes: eventType.min_notice_min || 0 });
  const latest = now.setZone(hostTz).startOf('day').plus({ days: (eventType.max_days_ahead || 60) + 1 });

  const lo = DateTime.max(rangeStart.toUTC(), earliest.toUTC());
  const hi = DateTime.min(rangeEnd.toUTC(), latest.toUTC());
  if (hi <= lo) return [];

  const overridesByDate = new Map();
  for (const o of overrides) {
    if (!overridesByDate.has(o.date)) overridesByDate.set(o.date, []);
    overridesByDate.get(o.date).push(o);
  }

  const busyIntervals = busy.map((b) =>
    Interval.fromDateTimes(DateTime.fromISO(b.start_utc, { zone: 'utc' }), DateTime.fromISO(b.end_utc, { zone: 'utc' }))
  );

  const slots = [];
  // Walk host-local days that could overlap [lo, hi).
  let day = lo.setZone(hostTz).startOf('day').minus({ days: 1 });
  const lastDay = hi.setZone(hostTz).startOf('day').plus({ days: 1 });

  for (; day <= lastDay; day = day.plus({ days: 1 })) {
    const dateKey = day.toISODate();
    let windows;
    if (overridesByDate.has(dateKey)) {
      windows = overridesByDate.get(dateKey).filter((o) => o.start_min != null && o.end_min != null);
    } else {
      windows = weekly.filter((w) => w.weekday === day.weekday);
    }

    for (const w of windows) {
      for (let m = w.start_min; m + duration <= w.end_min; m += step) {
        // Build from wall-clock components so DST transitions resolve correctly.
        const start = DateTime.fromObject(
          { year: day.year, month: day.month, day: day.day, hour: Math.floor(m / 60), minute: m % 60 },
          { zone: hostTz }
        );
        if (!start.isValid) continue; // wall time skipped by DST
        const end = start.plus({ minutes: duration });
        if (start < lo || start >= hi) continue;

        const blocked = Interval.fromDateTimes(start.minus({ minutes: bufBefore }), end.plus({ minutes: bufAfter }));
        if (busyIntervals.some((b) => b.overlaps(blocked))) continue;

        slots.push(start.toUTC());
      }
    }
  }

  // Dedupe (overlapping availability windows) and sort.
  const seen = new Set();
  return slots
    .filter((s) => {
      const k = s.toMillis();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => a.toMillis() - b.toMillis());
}

/** Group UTC slot DateTimes by calendar date in the viewer's zone. */
function groupByDate(slots, tz) {
  const out = {};
  for (const s of slots) {
    const local = s.setZone(tz);
    const key = local.toISODate();
    (out[key] ||= []).push(s.toISO({ suppressMilliseconds: true }));
  }
  return out;
}

module.exports = { computeSlots, groupByDate };
