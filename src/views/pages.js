'use strict';
const { DateTime } = require('luxon');
const { html, json } = require('./html');

const TIMEZONES = Intl.supportedValuesOf('timeZone');
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const COLORS = ['#006bff', '#8247f5', '#e55cff', '#ff4f00', '#ffa600', '#0ae8f0', '#17e885', '#1d3a6b'];

const fmtDuration = (m) => (m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)} hr ${m % 60} min` : `${m / 60} hr`);
const minToHHMM = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

function layout({ title, user, body, flash, bare = false, scripts = [] }) {
  return html`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title ? `${title} · Schedulr` : 'Schedulr'}</title>
  <link rel="stylesheet" href="/static/styles.css">
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='8' fill='%23006bff'/><path d='M9 12h14M9 17h9M9 22h6' stroke='white' stroke-width='2.5' stroke-linecap='round'/></svg>">
</head>
<body class="${bare ? 'bare' : ''}">
  ${bare ? '' : nav(user)}
  <main class="${bare ? 'public' : 'container'}">
    ${flash ? html`<div class="flash flash-${flash.type}">${flash.message}</div>` : ''}
    ${body}
  </main>
  ${scripts.map((s) => html`<script src="${s}" defer></script>`)}
</body>
</html>`;
}

function nav(user) {
  return html`<header class="topbar">
  <div class="container topbar-inner">
    <a class="brand" href="${user ? '/dashboard' : '/'}"><span class="brand-mark"></span>Schedulr</a>
    ${user
      ? html`<nav class="nav">
        <a href="/dashboard">Event types</a>
        <a href="/bookings">Meetings</a>
        <a href="/availability">Availability</a>
        <a href="/settings">Settings</a>
        <form method="post" action="/logout" class="inline"><button class="link">Log out</button></form>
      </nav>`
      : html`<nav class="nav"><a href="/login">Log in</a><a class="btn btn-sm" href="/signup">Sign up free</a></nav>`}
  </div>
</header>`;
}

/* ---------- Marketing / auth ---------- */

function landing({ user }) {
  return layout({
    user,
    body: html`<section class="hero">
  <h1>Easy scheduling ahead</h1>
  <p class="lead">Share a link, let people pick a time that works, skip the back-and-forth emails.</p>
  <div class="hero-cta">
    <a class="btn btn-lg" href="/signup">Get started</a>
    <a class="btn btn-lg btn-ghost" href="/demo">See a booking page</a>
  </div>
</section>
<section class="features">
  <div class="card"><h3>Event types</h3><p>15-minute intros, hour-long consults — each with its own link, duration, buffers and notice rules.</p></div>
  <div class="card"><h3>Your hours, your rules</h3><p>Set weekly availability in your timezone and block out specific dates.</p></div>
  <div class="card"><h3>Timezone smart</h3><p>Invitees see times in their own timezone. No mental math.</p></div>
</section>`,
  });
}

function authForm({ mode, error, values = {}, next = '' }) {
  const signup = mode === 'signup';
  return layout({
    title: signup ? 'Sign up' : 'Log in',
    body: html`<div class="auth-card card">
  <h1>${signup ? 'Create your account' : 'Welcome back'}</h1>
  ${error ? html`<div class="flash flash-error">${error}</div>` : ''}
  <form method="post" action="/${mode}${next ? `?next=${encodeURIComponent(next)}` : ''}" class="stack">
    ${signup
      ? html`<label>Full name<input name="name" required maxlength="100" value="${values.name || ''}"></label>
    <label>Username <small>schedulr link: /<b>username</b></small>
      <input name="username" required pattern="[a-z0-9][a-z0-9-]{1,30}" title="2-31 chars: lowercase letters, digits, hyphens" value="${values.username || ''}"></label>`
      : ''}
    <label>Email<input type="email" name="email" required value="${values.email || ''}"></label>
    <label>Password<input type="password" name="password" required minlength="${signup ? 8 : 1}"></label>
    ${signup ? html`<input type="hidden" name="timezone" id="tz-detect" value="UTC">` : ''}
    <button class="btn btn-block">${signup ? 'Sign up' : 'Log in'}</button>
  </form>
  <p class="muted center">${signup
    ? html`Already have an account? <a href="/login">Log in</a>`
    : html`New here? <a href="/signup">Create an account</a>`}</p>
</div>
${signup ? html`<script>document.getElementById('tz-detect').value = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';</script>` : ''}`,
  });
}

/* ---------- Dashboard ---------- */

function dashboard({ user, eventTypes, baseUrl, flash }) {
  return layout({
    title: 'Event types',
    user,
    flash,
    scripts: ['/static/app.js'],
    body: html`<div class="page-head">
  <div>
    <h1>Event types</h1>
    <p class="muted">Your booking page: <a href="/${user.username}" target="_blank">${baseUrl}/${user.username}</a></p>
  </div>
  <a class="btn" href="/event-types/new">+ New event type</a>
</div>
${eventTypes.length === 0
  ? html`<div class="empty card"><h3>No event types yet</h3><p>Create one to start taking bookings.</p><a class="btn" href="/event-types/new">Create event type</a></div>`
  : html`<div class="grid">
  ${eventTypes.map(
    (et) => html`<div class="card et-card ${et.active ? '' : 'inactive'}" style="--accent:${et.color}">
    <div class="et-card-body">
      <h3>${et.title}</h3>
      <p class="muted">${fmtDuration(et.duration_min)}${et.location ? ` · ${et.location}` : ''}</p>
      <a class="small" href="/${user.username}/${et.slug}" target="_blank">View booking page</a>
      ${et.active ? '' : html`<span class="badge">Off</span>`}
    </div>
    <div class="et-card-foot">
      <button class="btn btn-ghost btn-sm" data-copy="${baseUrl}/${user.username}/${et.slug}">Copy link</button>
      <div class="row">
        <a class="btn btn-ghost btn-sm" href="/event-types/${et.id}/edit">Edit</a>
        <form method="post" action="/event-types/${et.id}/toggle" class="inline"><button class="btn btn-ghost btn-sm">${et.active ? 'Turn off' : 'Turn on'}</button></form>
      </div>
    </div>
  </div>`
  )}
</div>`}`,
  });
}

function eventTypeForm({ user, et, error }) {
  const isNew = !et.id;
  const v = {
    title: '', slug: '', description: '', duration_min: 30, location: '', color: COLORS[0],
    buffer_before_min: 0, buffer_after_min: 0, min_notice_min: 240, max_days_ahead: 60, slot_interval_min: '',
    ...et,
  };
  const durations = [15, 30, 45, 60, 90, 120];
  return layout({
    title: isNew ? 'New event type' : `Edit ${v.title}`,
    user,
    scripts: ['/static/app.js'],
    body: html`<div class="page-head"><h1>${isNew ? 'New event type' : 'Edit event type'}</h1><a href="/dashboard">← Back</a></div>
${error ? html`<div class="flash flash-error">${error}</div>` : ''}
<form method="post" action="${isNew ? '/event-types' : `/event-types/${v.id}`}" class="card form-card stack">
  <label>Event name<input name="title" required maxlength="100" value="${v.title}" data-slug-source></label>
  <label>URL <small>/${user.username}/<b>slug</b></small><input name="slug" required pattern="[a-z0-9][a-z0-9-]{0,60}" value="${v.slug}" data-slug-target ${isNew ? '' : 'data-touched'}></label>
  <label>Description<textarea name="description" rows="3" maxlength="2000">${v.description}</textarea></label>
  <div class="cols">
    <label>Duration (minutes)
      <input name="duration_min" type="number" min="5" max="720" step="5" required value="${v.duration_min}" list="durations">
      <datalist id="durations">${durations.map((d) => html`<option value="${d}">`)}</datalist>
    </label>
    <label>Location<input name="location" maxlength="200" placeholder="Zoom, phone, office address…" value="${v.location}"></label>
  </div>
  <fieldset>
    <legend>Color</legend>
    <div class="swatches">${COLORS.map(
      (c) => html`<label class="swatch" style="--c:${c}"><input type="radio" name="color" value="${c}" ${c === v.color ? 'checked' : ''}><span></span></label>`
    )}</div>
  </fieldset>
  <details ${isNew ? '' : 'open'}>
    <summary>Scheduling rules</summary>
    <div class="cols">
      <label>Buffer before (min)<input name="buffer_before_min" type="number" min="0" max="240" value="${v.buffer_before_min}"></label>
      <label>Buffer after (min)<input name="buffer_after_min" type="number" min="0" max="240" value="${v.buffer_after_min}"></label>
      <label>Minimum notice (min)<input name="min_notice_min" type="number" min="0" max="43200" value="${v.min_notice_min}"></label>
      <label>Bookable up to (days ahead)<input name="max_days_ahead" type="number" min="1" max="365" value="${v.max_days_ahead}"></label>
      <label>Start-time increments (min) <small>blank = duration</small><input name="slot_interval_min" type="number" min="5" max="240" step="5" value="${v.slot_interval_min ?? ''}"></label>
    </div>
  </details>
  <div class="row between">
    <button class="btn">${isNew ? 'Create' : 'Save changes'}</button>
  </div>
</form>
${isNew
  ? ''
  : html`<form method="post" action="/event-types/${v.id}/delete" class="danger-zone" data-confirm="Delete this event type? Existing bookings for it will also be removed.">
  <button class="btn btn-danger btn-sm">Delete event type</button>
</form>`}`,
  });
}

/* ---------- Availability ---------- */

function availabilityPage({ user, weekly, overrides, flash }) {
  const byDay = Array.from({ length: 7 }, (_, i) => weekly.filter((w) => w.weekday === i + 1));
  return layout({
    title: 'Availability',
    user,
    flash,
    scripts: ['/static/app.js'],
    body: html`<div class="page-head"><h1>Availability</h1></div>
<form method="post" action="/availability" class="card form-card stack" id="weekly-form">
  <label>Timezone
    <select name="timezone">${TIMEZONES.map((tz) => html`<option ${tz === user.timezone ? 'selected' : ''}>${tz}</option>`)}</select>
  </label>
  <h3>Weekly hours</h3>
  <div class="weekly">
    ${byDay.map(
      (intervals, i) => html`<div class="day-row" data-day="${i + 1}">
      <label class="day-toggle"><input type="checkbox" ${intervals.length ? 'checked' : ''} data-day-toggle> <b>${WEEKDAYS[i].slice(0, 3).toUpperCase()}</b></label>
      <div class="intervals">
        ${intervals.map(
          (w) => html`<div class="interval">
          <input type="time" name="d${i + 1}_start" value="${minToHHMM(w.start_min)}" step="900" required>
          <span>–</span>
          <input type="time" name="d${i + 1}_end" value="${minToHHMM(w.end_min)}" step="900" required>
          <button type="button" class="icon-btn" data-remove-interval title="Remove">×</button>
        </div>`
        )}
        <span class="muted unavailable">Unavailable</span>
      </div>
      <button type="button" class="icon-btn" data-add-interval title="Add hours">+</button>
    </div>`
    )}
  </div>
  <div><button class="btn">Save availability</button></div>
</form>

<div class="card form-card stack">
  <h3>Date overrides</h3>
  <p class="muted">Change hours for a specific date, or mark it unavailable (holidays, vacations).</p>
  <form method="post" action="/availability/overrides" class="override-form">
    <label>Date<input type="date" name="date" required min="${DateTime.now().setZone(user.timezone).toISODate()}"></label>
    <label>From<input type="time" name="start" step="900"></label>
    <label>To<input type="time" name="end" step="900"></label>
    <button class="btn btn-sm">Add override</button>
  </form>
  <p class="small muted">Leave times blank to block the whole day.</p>
  ${overrides.length
    ? html`<ul class="override-list">${overrides.map(
        (o) => html`<li>
      <span><b>${DateTime.fromISO(o.date).toFormat('ccc, LLL d, yyyy')}</b> — ${o.start_min == null ? 'Unavailable' : `${minToHHMM(o.start_min)}–${minToHHMM(o.end_min)}`}</span>
      <form method="post" action="/availability/overrides/${o.id}/delete" class="inline"><button class="link">Remove</button></form>
    </li>`
      )}</ul>`
    : ''}
</div>`,
  });
}

/* ---------- Bookings (host) ---------- */

function bookingsPage({ user, tab, bookings, flash }) {
  const tabs = [
    ['upcoming', 'Upcoming'],
    ['past', 'Past'],
    ['canceled', 'Canceled'],
  ];
  let lastDate = null;
  return layout({
    title: 'Meetings',
    user,
    flash,
    scripts: ['/static/app.js'],
    body: html`<div class="page-head"><h1>Meetings</h1></div>
<div class="tabs">${tabs.map(([k, label]) => html`<a href="/bookings?tab=${k}" class="${tab === k ? 'active' : ''}">${label}</a>`)}</div>
<div class="card list">
  ${bookings.length === 0
    ? html`<div class="empty"><p class="muted">No ${tab} meetings.</p></div>`
    : bookings.map((b) => {
        const start = DateTime.fromISO(b.start_utc).setZone(user.timezone);
        const end = DateTime.fromISO(b.end_utc).setZone(user.timezone);
        const dateLabel = start.toFormat('cccc, LLLL d, yyyy');
        const header = dateLabel !== lastDate ? html`<div class="list-date">${dateLabel}</div>` : '';
        lastDate = dateLabel;
        return html`${header}<div class="list-item">
      <div class="li-time"><span class="dot" style="background:${b.color}"></span>${start.toFormat('h:mm a')} – ${end.toFormat('h:mm a')}</div>
      <div class="li-main">
        <b>${b.invitee_name}</b> <span class="muted">${b.invitee_email}</span>
        <div class="muted small">Event type <b>${b.event_title}</b>${b.notes ? html` · “${b.notes}”` : ''}</div>
        ${b.status === 'canceled' ? html`<div class="small danger">Canceled by ${b.canceled_by || 'unknown'}${b.cancel_reason ? `: ${b.cancel_reason}` : ''}</div>` : ''}
      </div>
      <div class="li-actions">
        ${tab === 'upcoming'
          ? html`<form method="post" action="/bookings/${b.id}/cancel" class="inline" data-confirm="Cancel this meeting with ${b.invitee_name}?" data-prompt="reason">
          <input type="hidden" name="reason"><button class="btn btn-ghost btn-sm">Cancel</button></form>`
          : ''}
      </div>
    </div>`;
      })}
</div>`,
  });
}

function settingsPage({ user, error, flash }) {
  return layout({
    title: 'Settings',
    user,
    flash,
    body: html`<div class="page-head"><h1>Settings</h1></div>
${error ? html`<div class="flash flash-error">${error}</div>` : ''}
<form method="post" action="/settings" class="card form-card stack">
  <label>Name<input name="name" required maxlength="100" value="${user.name}"></label>
  <label>Username<input name="username" required pattern="[a-z0-9][a-z0-9-]{1,30}" value="${user.username}"></label>
  <label>Email<input type="email" value="${user.email}" disabled></label>
  <div><button class="btn">Save</button></div>
</form>`,
  });
}

/* ---------- Public pages ---------- */

function avatar(name) {
  const initials = name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  return html`<div class="avatar">${initials}</div>`;
}

function publicProfile({ host, eventTypes }) {
  return layout({
    title: host.name,
    bare: true,
    body: html`<div class="public-card profile">
  <div class="profile-head">${avatar(host.name)}<h1>${host.name}</h1>
  <p class="muted">Welcome to my scheduling page. Please follow the instructions to add an event to my calendar.</p></div>
  ${eventTypes.length === 0
    ? html`<p class="muted center">No events are available right now.</p>`
    : html`<div class="profile-grid">${eventTypes.map(
        (et) => html`<a class="profile-et" href="/${host.username}/${et.slug}" style="--accent:${et.color}">
      <span class="dot" style="background:${et.color}"></span>
      <div><h3>${et.title}</h3><p class="muted small">${fmtDuration(et.duration_min)}</p></div>
      <span class="chev">›</span>
    </a>`
      )}</div>`}
</div>
${poweredBy()}`,
  });
}

function eventMeta(host, et) {
  return html`<div class="ev-meta">
  ${avatar(host.name)}
  <p class="muted">${host.name}</p>
  <h1>${et.title}</h1>
  <p class="meta-line"><span class="ico">◷</span>${fmtDuration(et.duration_min)}</p>
  ${et.location ? html`<p class="meta-line"><span class="ico">⌖</span>${et.location}</p>` : ''}
  ${et.description ? html`<p class="ev-desc">${et.description}</p>` : ''}
</div>`;
}

function bookingPage({ host, et, reschedule }) {
  return layout({
    title: `${et.title} · ${host.name}`,
    bare: true,
    scripts: ['/static/booking.js'],
    body: html`<div class="public-card booking" style="--accent:${et.color}">
  <aside class="booking-side">
    <a class="back" href="/${host.username}">←</a>
    ${eventMeta(host, et)}
    ${reschedule
      ? html`<div class="resched-note"><b>Rescheduling</b><br>Former time: ${DateTime.fromISO(reschedule.start_utc).setZone(reschedule.invitee_timezone).toFormat("cccc, LLL d 'at' h:mm a")}</div>`
      : ''}
    <div id="selected-meta" class="meta-line hidden"></div>
  </aside>
  <section class="booking-main" id="booking-app">
    <div class="step step-calendar">
      <h2>Select a Date &amp; Time</h2>
      <div class="cal-wrap">
        <div class="calendar">
          <div class="cal-head">
            <button type="button" class="icon-btn" id="cal-prev" aria-label="Previous month">‹</button>
            <span id="cal-title"></span>
            <button type="button" class="icon-btn" id="cal-next" aria-label="Next month">›</button>
          </div>
          <div class="cal-grid cal-dow"><span>MON</span><span>TUE</span><span>WED</span><span>THU</span><span>FRI</span><span>SAT</span><span>SUN</span></div>
          <div class="cal-grid" id="cal-days"></div>
          <div class="tz-select">
            <label class="small"><b>Time zone</b>
              <select id="tz">${TIMEZONES.map((tz) => html`<option>${tz}</option>`)}</select>
            </label>
          </div>
        </div>
        <div class="times hidden" id="times">
          <div class="times-date" id="times-date"></div>
          <div class="times-list" id="times-list"></div>
        </div>
      </div>
    </div>
    <div class="step step-form hidden">
      <button type="button" class="back" id="form-back">←</button>
      <h2>Enter Details</h2>
      <form id="book-form" class="stack">
        <label>Name *<input name="name" required maxlength="200" value="${reschedule ? reschedule.invitee_name : ''}"></label>
        <label>Email *<input name="email" type="email" required maxlength="200" value="${reschedule ? reschedule.invitee_email : ''}"></label>
        <label>Please share anything that will help prepare for our meeting.<textarea name="notes" rows="4" maxlength="2000">${reschedule ? reschedule.notes : ''}</textarea></label>
        <div class="flash flash-error hidden" id="form-error"></div>
        <div><button class="btn btn-pill" id="submit-btn">${reschedule ? 'Reschedule Event' : 'Schedule Event'}</button></div>
      </form>
    </div>
  </section>
</div>
${poweredBy()}
<script>window.SCHEDULR = ${json({
      username: host.username,
      slug: et.slug,
      duration: et.duration_min,
      reschedule: reschedule ? reschedule.token : null,
    })};</script>`,
  });
}

function bookingConfirmation({ booking, host, et, tz, googleUrl, justBooked }) {
  const start = DateTime.fromISO(booking.start_utc).setZone(tz);
  const end = DateTime.fromISO(booking.end_utc).setZone(tz);
  const canceled = booking.status === 'canceled';
  const past = DateTime.fromISO(booking.end_utc) < DateTime.utc();
  return layout({
    title: canceled ? 'Canceled' : 'Confirmed',
    bare: true,
    scripts: ['/static/app.js'],
    body: html`<div class="public-card confirm" style="--accent:${et.color}">
  <div class="confirm-head">
    ${canceled
      ? html`<div class="status-ico cancel">×</div><h1>Canceled</h1>`
      : html`<div class="status-ico ok">✓</div><h1>${justBooked ? 'You are scheduled' : 'Your meeting'}</h1>
    <p class="muted">${justBooked ? 'A calendar invitation is ready below.' : ''}</p>`}
  </div>
  <div class="confirm-box">
    <h3>${et.title}</h3>
    <p class="meta-line"><span class="ico">👤</span>${host.name}</p>
    <p class="meta-line ${canceled ? 'strike' : ''}"><span class="ico">🗓</span>${start.toFormat('h:mm a')} – ${end.toFormat('h:mm a')}, ${start.toFormat('cccc, LLLL d, yyyy')}</p>
    <p class="meta-line"><span class="ico">🌐</span>${tz}</p>
    ${et.location ? html`<p class="meta-line"><span class="ico">⌖</span>${et.location}</p>` : ''}
    ${canceled && booking.cancel_reason ? html`<p class="meta-line"><span class="ico">✎</span>Reason: ${booking.cancel_reason}</p>` : ''}
  </div>
  ${canceled
    ? html`<p class="center"><a class="btn" href="/${host.username}/${et.slug}">Schedule a new time</a></p>`
    : html`${past ? '' : html`<div class="row center gap">
      <a class="btn btn-ghost btn-sm" href="${googleUrl}" target="_blank" rel="noopener">Add to Google Calendar</a>
      <a class="btn btn-ghost btn-sm" href="/booking/${booking.token}/invite.ics">Download .ics</a>
    </div>
    <hr>
    <p class="center small muted">Need to make a change?</p>
    <div class="row center gap">
      <a class="btn btn-ghost btn-sm" href="/${host.username}/${et.slug}?reschedule=${booking.token}">Reschedule</a>
      <form method="post" action="/booking/${booking.token}/cancel" class="inline" data-confirm="Cancel this meeting?" data-prompt="reason">
        <input type="hidden" name="reason"><button class="btn btn-ghost btn-sm danger">Cancel</button>
      </form>
    </div>
    <p class="center small muted">Bookmark this page — it’s your link to manage this meeting.</p>`}`}
</div>
${poweredBy()}`,
  });
}

const poweredBy = () => html`<p class="powered">Powered by <a href="/">Schedulr</a></p>`;

function notFound({ user, message = "We couldn't find that page." } = {}) {
  return layout({
    title: 'Not found',
    user,
    bare: !user,
    body: html`<div class="public-card center"><h1>404</h1><p class="muted">${message}</p><a class="btn" href="/">Go home</a></div>`,
  });
}

module.exports = {
  landing,
  authForm,
  dashboard,
  eventTypeForm,
  availabilityPage,
  bookingsPage,
  settingsPage,
  publicProfile,
  bookingPage,
  bookingConfirmation,
  notFound,
  TIMEZONES,
};
