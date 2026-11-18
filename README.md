# Schedulr

A self-hosted scheduling app. Hosts publish booking links; invitees pick a time in their own timezone; nobody trades availability over email.

## Quick start

```bash
npm install
npm run seed     # optional: demo host demo@schedulr.test / password123
npm start        # http://localhost:3000
```

Then open `http://localhost:3000/demo` for a booking page, or sign up at `/signup`.

Requires **Node 22.5+**. The app uses the built-in `node:sqlite`, so there are no native modules to compile. Data lives in `data/schedulr.db`; override it with `DB_PATH`.

## Features

**For hosts**
- Event types with their own URL, duration, location, color and description
- Scheduling rules per event type: buffers before/after, minimum notice, booking window (days ahead), custom start-time increments
- Weekly availability with multiple intervals per day, in the host's timezone
- Date overrides: custom hours for a day, or block it entirely
- Meetings view (upcoming / past / canceled), with cancel-with-reason
- Turn event types on and off without deleting them

**For invitees**
- Public profile page `/:username` and booking page `/:username/:slug`
- Month calendar showing only bookable days; times shown in the invitee's detected timezone, which they can change
- Confirmation page with Google Calendar link and `.ics` download
- Self-service reschedule and cancel through a private manage link

**Correctness**
- Slots are built from host wall-clock time, so they stay put across DST changes
- Each booking is re-validated inside a `BEGIN IMMEDIATE` transaction, so two people racing for one slot can't both get it
- Buffers apply on both sides: the new booking's own buffers and those of existing bookings
- A reschedule cancels the old booking and creates the new one atomically

## Project layout

```
src/
  server.js      Express routes (host dashboard, public pages, JSON API)
  slots.js       Pure availability → slot computation (unit-tested)
  scheduling.js  DB-backed slot lookup, booking creation, cancellation
  db.js          SQLite schema + helpers
  auth.js        scrypt password hashing, cookie sessions
  ics.js         iCalendar + Google Calendar link generation
  views/         Server-rendered HTML (auto-escaping tagged templates)
public/          CSS, booking calendar client, small dashboard helpers
test/            node:test unit + end-to-end HTTP tests
```

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/slots/:username/:slug?month=YYYY-MM&tz=Area/City` | Available start times, grouped by date in `tz` |
| POST | `/api/book/:username/:slug` | JSON `{start, name, email, notes, timezone, reschedule?}` → `{token, url}` |

## Tests

```bash
npm test
```

## Not built yet

These are what separates this from a production scheduling product, roughly in priority order:

1. **Calendar sync** (Google/Outlook free-busy). Today only Schedulr's own bookings block time, so a host's other meetings will be double-booked.
2. **Email notifications.** No confirmation, reminder or cancellation emails are sent. Invitees get the manage link only on the confirmation page.
3. **Video conferencing links** (Zoom/Meet auto-generation). Location is free text.
4. Custom invitee questions, team/round-robin scheduling, payments, rate limiting, CSRF tokens (SameSite=Lax cookies are the current defence), password reset.
