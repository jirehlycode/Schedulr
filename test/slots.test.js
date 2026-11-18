'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DateTime } = require('luxon');
const { computeSlots, groupByDate } = require('../src/slots');

const et = (over = {}) => ({
  duration_min: 30, slot_interval_min: null, buffer_before_min: 0, buffer_after_min: 0,
  min_notice_min: 0, max_days_ahead: 60, ...over,
});
const nineToFive = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start_min: 540, end_min: 1020 }));
const NY = 'America/New_York';
// Monday 2026-11-23, viewed from a "now" the previous Friday.
const NOW = DateTime.fromISO('2026-11-20T12:00:00', { zone: NY });
const day = (iso, zone = NY) => {
  const s = DateTime.fromISO(iso, { zone });
  return { rangeStart: s.startOf('day'), rangeEnd: s.startOf('day').plus({ days: 1 }) };
};
const local = (slots, zone = NY) => slots.map((s) => s.setZone(zone).toFormat('HH:mm'));

test('generates 30-minute slots across a 9-5 day', () => {
  const slots = computeSlots({ eventType: et(), hostTz: NY, weekly: nineToFive, overrides: [], busy: [], now: NOW, ...day('2026-11-23') });
  assert.equal(slots.length, 16);
  assert.equal(local(slots)[0], '09:00');
  assert.equal(local(slots).at(-1), '16:30');
});

test('no slots on weekends', () => {
  const slots = computeSlots({ eventType: et(), hostTz: NY, weekly: nineToFive, overrides: [], busy: [], now: NOW, ...day('2026-11-22') });
  assert.equal(slots.length, 0);
});

test('custom start-time increments', () => {
  const slots = computeSlots({ eventType: et({ duration_min: 60, slot_interval_min: 15 }), hostTz: NY, weekly: nineToFive, overrides: [], busy: [], now: NOW, ...day('2026-11-23') });
  assert.deepEqual(local(slots).slice(0, 3), ['09:00', '09:15', '09:30']);
  assert.equal(local(slots).at(-1), '16:00');
});

test('existing bookings and buffers block overlapping slots', () => {
  const busy = [{ start_utc: DateTime.fromISO('2026-11-23T11:00', { zone: NY }).toUTC().toISO(), end_utc: DateTime.fromISO('2026-11-23T11:30', { zone: NY }).toUTC().toISO() }];
  const plain = local(computeSlots({ eventType: et(), hostTz: NY, weekly: nineToFive, overrides: [], busy, now: NOW, ...day('2026-11-23') }));
  assert.ok(!plain.includes('11:00'));
  assert.ok(plain.includes('10:30') && plain.includes('11:30'));

  const buffered = local(computeSlots({ eventType: et({ buffer_before_min: 15, buffer_after_min: 15 }), hostTz: NY, weekly: nineToFive, overrides: [], busy, now: NOW, ...day('2026-11-23') }));
  assert.ok(!buffered.includes('10:30'), 'after-buffer of 10:30 slot runs into 11:00 booking');
  assert.ok(!buffered.includes('11:30'), 'before-buffer of 11:30 slot runs into booking end');
  assert.ok(buffered.includes('10:00') && buffered.includes('12:00'));
});

test('minimum notice hides near-term slots', () => {
  const now = DateTime.fromISO('2026-11-23T10:05', { zone: NY });
  const slots = local(computeSlots({ eventType: et({ min_notice_min: 120 }), hostTz: NY, weekly: nineToFive, overrides: [], busy: [], now, ...day('2026-11-23') }));
  assert.equal(slots[0], '12:30');
});

test('max days ahead caps the booking window', () => {
  const slots = computeSlots({ eventType: et({ max_days_ahead: 2 }), hostTz: NY, weekly: nineToFive, overrides: [], busy: [], now: NOW, ...day('2026-11-23') });
  assert.equal(slots.length, 0); // Fri + 2 days = through Sunday
});

test('date overrides replace or block weekly hours', () => {
  const custom = computeSlots({ eventType: et(), hostTz: NY, weekly: nineToFive, overrides: [{ date: '2026-11-23', start_min: 600, end_min: 660 }], busy: [], now: NOW, ...day('2026-11-23') });
  assert.deepEqual(local(custom), ['10:00', '10:30']);
  const blocked = computeSlots({ eventType: et(), hostTz: NY, weekly: nineToFive, overrides: [{ date: '2026-11-23', start_min: null, end_min: null }], busy: [], now: NOW, ...day('2026-11-23') });
  assert.equal(blocked.length, 0);
  const weekend = computeSlots({ eventType: et(), hostTz: NY, weekly: nineToFive, overrides: [{ date: '2026-11-22', start_min: 600, end_min: 630 }], busy: [], now: NOW, ...day('2026-11-22') });
  assert.deepEqual(local(weekend), ['10:00']);
});

test('slots stay at host wall-clock times across a DST change', () => {
  const now = DateTime.fromISO('2026-10-28T12:00', { zone: NY });
  const before = computeSlots({ eventType: et(), hostTz: NY, weekly: nineToFive, overrides: [], busy: [], now, ...day('2026-10-30') });
  const after = computeSlots({ eventType: et(), hostTz: NY, weekly: nineToFive, overrides: [], busy: [], now, ...day('2026-11-02') });
  assert.equal(local(before)[0], '09:00');
  assert.equal(local(after)[0], '09:00');
  assert.equal(before[0].toUTC().hour, 13); // EDT
  assert.equal(after[0].toUTC().hour, 14); // EST
});

test('invitee in another timezone sees the right local dates', () => {
  // Host in New York 9-5; invitee in Tokyo (UTC+9) → Monday NY morning is Monday ~23:00 Tokyo.
  const range = { rangeStart: DateTime.fromISO('2026-11-23', { zone: 'Asia/Tokyo' }), rangeEnd: DateTime.fromISO('2026-11-25', { zone: 'Asia/Tokyo' }) };
  const slots = computeSlots({ eventType: et(), hostTz: NY, weekly: nineToFive, overrides: [], busy: [], now: NOW, ...range });
  const grouped = groupByDate(slots, 'Asia/Tokyo');
  assert.deepEqual(Object.keys(grouped), ['2026-11-23', '2026-11-24']);
  assert.equal(DateTime.fromISO(grouped['2026-11-23'][0]).setZone('Asia/Tokyo').toFormat('HH:mm'), '23:00');
});
