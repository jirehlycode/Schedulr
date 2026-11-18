'use strict';
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DateTime } = require('luxon');
const app = require('../src/server');

let server, base, cookie;

test.before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

const form = (obj) => new URLSearchParams(obj).toString();
const req = (path, opts = {}) =>
  fetch(base + path, { redirect: 'manual', ...opts, headers: { ...(cookie ? { cookie } : {}), ...opts.headers } });

test('host signs up and gets defaults', async () => {
  const res = await req('/signup', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form({ name: 'Sam Host', email: 'sam@example.com', username: 'sam', password: 'supersecret', timezone: 'UTC' }),
  });
  assert.equal(res.status, 302);
  cookie = res.headers.getSetCookie().find((c) => c.startsWith('sid=')).split(';')[0];
  const dash = await req('/dashboard');
  assert.equal(dash.status, 200);
  assert.match(await dash.text(), /30 Minute Meeting/);
});

test('reserved and duplicate usernames are rejected', async () => {
  for (const username of ['dashboard', 'sam']) {
    const res = await fetch(base + '/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form({ name: 'X', email: `${username}x@example.com`, username, password: 'supersecret' }),
    });
    assert.equal(res.status, 400);
  }
});

test('host data is private', async () => {
  const res = await fetch(base + '/dashboard', { redirect: 'manual' });
  assert.equal(res.status, 302);
  assert.match(res.headers.get('location'), /^\/login/);
});

test('invitee books, double-booking is refused, reschedule and cancel work', async () => {
  const profile = await fetch(`${base}/sam`);
  assert.match(await profile.text(), /30 Minute Meeting/);

  const month = DateTime.utc().plus({ days: 7 }).toFormat('yyyy-MM');
  const slotsRes = await fetch(`${base}/api/slots/sam/30min?month=${month}&tz=Europe/Berlin`);
  const { slots } = await slotsRes.json();
  const all = Object.values(slots).flat();
  assert.ok(all.length > 0, 'expected available slots');
  const [first, second] = all;

  const book = (start, extra = {}) =>
    fetch(`${base}/api/book/sam/30min`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ start, name: 'Ivy Invitee', email: 'ivy@example.com', timezone: 'Europe/Berlin', ...extra }),
    });

  const ok = await book(first);
  assert.equal(ok.status, 201);
  const { token } = await ok.json();

  const dup = await book(first);
  assert.equal(dup.status, 409, 'same slot must not be bookable twice');

  const bad = await book(second, { email: 'not-an-email' });
  assert.equal(bad.status, 400);

  // Slot disappears from availability
  const after = await (await fetch(`${base}/api/slots/sam/30min?month=${month}&tz=Europe/Berlin`)).json();
  assert.ok(!Object.values(after.slots).flat().includes(first));

  // Confirmation page + ICS
  const conf = await fetch(`${base}/booking/${token}`);
  assert.equal(conf.status, 200);
  const ics = await fetch(`${base}/booking/${token}/invite.ics`);
  assert.match(await ics.text(), /BEGIN:VEVENT/);

  // Host sees it
  const meetings = await req('/bookings');
  assert.match(await meetings.text(), /Ivy Invitee/);

  // Reschedule to the second slot: old booking is canceled, original slot frees up
  const res2 = await book(second, { reschedule: token });
  assert.equal(res2.status, 201);
  const { token: token2 } = await res2.json();
  const freed = await (await fetch(`${base}/api/slots/sam/30min?month=${month}&tz=Europe/Berlin`)).json();
  assert.ok(Object.values(freed.slots).flat().includes(first));
  assert.match(await (await fetch(`${base}/booking/${token}`)).text(), /Canceled/);

  // Old token can't be used to reschedule again
  const again = await book(first, { reschedule: token });
  assert.equal(again.status, 400);

  // Invitee cancels
  const cancel = await fetch(`${base}/booking/${token2}/cancel`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form({ reason: 'Conflict came up' }),
  });
  assert.equal(cancel.status, 302);
  assert.match(await (await fetch(`${base}/booking/${token2}`)).text(), /Conflict came up/);
});

test('turned-off event types are not bookable', async () => {
  const dash = await (await req('/dashboard')).text();
  const id = /\/event-types\/(\d+)\/toggle/.exec(dash)[1];
  await req(`/event-types/${id}/toggle`, { method: 'POST' });
  assert.equal((await fetch(`${base}/sam/30min`)).status, 404);
  assert.equal((await fetch(`${base}/api/slots/sam/30min`)).status, 404);
});

test('user-supplied text is HTML-escaped', async () => {
  await req('/event-types', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form({ title: '<script>alert(1)</script>', slug: 'xss', duration_min: '30' }),
  });
  const page = await (await fetch(`${base}/sam/xss`)).text();
  assert.ok(!page.includes('<script>alert(1)</script>'));
  assert.ok(page.includes('&lt;script&gt;'));
});
