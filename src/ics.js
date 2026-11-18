'use strict';
const { DateTime } = require('luxon');

const fmt = (iso) => DateTime.fromISO(iso, { zone: 'utc' }).toFormat("yyyyMMdd'T'HHmmss'Z'");
const esc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');

/** Fold lines to 75 octets per RFC 5545. */
function fold(line) {
  const out = [];
  while (line.length > 74) {
    out.push(line.slice(0, 74));
    line = ' ' + line.slice(74);
  }
  out.push(line);
  return out.join('\r\n');
}

function buildIcs({ uid, title, description, location, startUtc, endUtc, organizerName, organizerEmail, canceled = false }) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Schedulr//EN',
    'CALSCALE:GREGORIAN',
    `METHOD:${canceled ? 'CANCEL' : 'PUBLISH'}`,
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${fmt(DateTime.utc().toISO())}`,
    `DTSTART:${fmt(startUtc)}`,
    `DTEND:${fmt(endUtc)}`,
    `SUMMARY:${esc(title)}`,
    `DESCRIPTION:${esc(description)}`,
    `LOCATION:${esc(location)}`,
    `ORGANIZER;CN=${esc(organizerName)}:mailto:${organizerEmail}`,
    `STATUS:${canceled ? 'CANCELLED' : 'CONFIRMED'}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}

function googleCalendarUrl({ title, description, location, startUtc, endUtc }) {
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: `${fmt(startUtc)}/${fmt(endUtc)}`,
    details: description || '',
    location: location || '',
  });
  return `https://calendar.google.com/calendar/render?${p}`;
}

module.exports = { buildIcs, googleCalendarUrl };
