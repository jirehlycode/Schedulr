(() => {
  'use strict';
  const cfg = window.SCHEDULR;
  const $ = (id) => document.getElementById(id);
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

  const today = new Date();
  const state = {
    tz: browserTz,
    year: today.getFullYear(),
    month: today.getMonth(), // 0-based
    slots: {},
    selectedDate: null,
    selectedSlot: null,
    autoAdvanced: 0,
  };

  const tzSelect = $('tz');
  if (![...tzSelect.options].some((o) => o.value === state.tz)) tzSelect.add(new Option(state.tz, state.tz, true, true));
  tzSelect.value = state.tz;

  const pad = (n) => String(n).padStart(2, '0');
  const monthKey = () => `${state.year}-${pad(state.month + 1)}`;
  const fmtTime = (iso) =>
    new Intl.DateTimeFormat(undefined, { timeZone: state.tz, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
  const fmtLong = (iso) =>
    new Intl.DateTimeFormat(undefined, { timeZone: state.tz, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(iso));
  const fmtDateKey = (key) => {
    const [y, m, d] = key.split('-').map(Number);
    return new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(Date.UTC(y, m - 1, d));
  };

  // Don't allow navigating to months before the current one.
  const isCurrentMonthOrBefore = () =>
    state.year < today.getFullYear() || (state.year === today.getFullYear() && state.month <= today.getMonth());

  let reqId = 0;
  async function loadMonth() {
    const id = ++reqId;
    $('cal-days').classList.add('loading');
    renderCalendar();
    const params = new URLSearchParams({ month: monthKey(), tz: state.tz });
    if (cfg.reschedule) params.set('reschedule', cfg.reschedule);
    try {
      const res = await fetch(`/api/slots/${encodeURIComponent(cfg.username)}/${encodeURIComponent(cfg.slug)}?${params}`);
      const data = await res.json();
      if (id !== reqId) return; // stale response
      state.slots = data.slots || {};
    } catch {
      if (id !== reqId) return;
      state.slots = {};
    }
    $('cal-days').classList.remove('loading');

    // Like the big scheduling apps: if this month is empty on first load, jump ahead.
    if (Object.keys(state.slots).length === 0 && state.autoAdvanced < 2) {
      state.autoAdvanced++;
      shiftMonth(1);
      return;
    }
    if (state.selectedDate && !state.slots[state.selectedDate]) state.selectedDate = null;
    renderCalendar();
    renderTimes();
  }

  function shiftMonth(delta) {
    state.month += delta;
    if (state.month < 0) { state.month = 11; state.year--; }
    if (state.month > 11) { state.month = 0; state.year++; }
    state.selectedSlot = null;
    loadMonth();
  }

  function renderCalendar() {
    $('cal-title').textContent = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(new Date(state.year, state.month, 1));
    $('cal-prev').disabled = isCurrentMonthOrBefore();
    const grid = $('cal-days');
    grid.innerHTML = '';
    const first = new Date(state.year, state.month, 1);
    const offset = (first.getDay() + 6) % 7; // Monday-first
    const days = new Date(state.year, state.month + 1, 0).getDate();
    for (let i = 0; i < offset; i++) grid.appendChild(document.createElement('span'));
    for (let d = 1; d <= days; d++) {
      const key = `${monthKey()}-${pad(d)}`;
      const available = !!state.slots[key];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = d;
      btn.className = 'day' + (available ? ' available' : '') + (state.selectedDate === key ? ' selected' : '');
      btn.disabled = !available;
      if (available) btn.setAttribute('aria-label', `${fmtDateKey(key)}, ${state.slots[key].length} times available`);
      btn.addEventListener('click', () => {
        state.selectedDate = key;
        state.selectedSlot = null;
        renderCalendar();
        renderTimes();
      });
      grid.appendChild(btn);
    }
  }

  function renderTimes() {
    const box = $('times');
    const list = $('times-list');
    document.querySelector('.cal-wrap').classList.toggle('with-times', !!state.selectedDate);
    if (!state.selectedDate) return box.classList.add('hidden');
    box.classList.remove('hidden');
    $('times-date').textContent = fmtDateKey(state.selectedDate);
    list.innerHTML = '';
    for (const iso of state.slots[state.selectedDate] || []) {
      const row = document.createElement('div');
      row.className = 'time-row' + (state.selectedSlot === iso ? ' picked' : '');
      const t = document.createElement('button');
      t.type = 'button';
      t.className = 'time-btn';
      t.textContent = fmtTime(iso);
      t.addEventListener('click', () => {
        state.selectedSlot = iso;
        renderTimes();
      });
      row.appendChild(t);
      if (state.selectedSlot === iso) {
        const next = document.createElement('button');
        next.type = 'button';
        next.className = 'next-btn';
        next.textContent = 'Next';
        next.addEventListener('click', showForm);
        row.appendChild(next);
      }
      list.appendChild(row);
    }
  }

  function showForm() {
    const iso = state.selectedSlot;
    const end = new Date(new Date(iso).getTime() + cfg.duration * 60000).toISOString();
    const meta = $('selected-meta');
    meta.innerHTML = '';
    const line1 = document.createElement('div');
    line1.textContent = `🗓 ${fmtTime(iso)} – ${fmtTime(end)}, ${fmtLong(iso)}`;
    const line2 = document.createElement('div');
    line2.textContent = `🌐 ${state.tz}`;
    meta.append(line1, line2);
    meta.classList.remove('hidden');
    document.querySelector('.step-calendar').classList.add('hidden');
    document.querySelector('.step-form').classList.remove('hidden');
    $('book-form').querySelector('input[name=name]').focus();
  }

  function showCalendar() {
    $('selected-meta').classList.add('hidden');
    document.querySelector('.step-form').classList.add('hidden');
    document.querySelector('.step-calendar').classList.remove('hidden');
  }

  $('form-back').addEventListener('click', showCalendar);
  $('cal-prev').addEventListener('click', () => { state.autoAdvanced = 99; shiftMonth(-1); });
  $('cal-next').addEventListener('click', () => { state.autoAdvanced = 99; shiftMonth(1); });
  tzSelect.addEventListener('change', () => {
    state.tz = tzSelect.value;
    state.selectedDate = null;
    state.selectedSlot = null;
    loadMonth();
  });

  $('book-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const err = $('form-error');
    const btn = $('submit-btn');
    err.classList.add('hidden');
    btn.disabled = true;
    const fd = new FormData(form);
    try {
      const res = await fetch(`/api/book/${encodeURIComponent(cfg.username)}/${encodeURIComponent(cfg.slug)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          start: state.selectedSlot,
          name: fd.get('name'),
          email: fd.get('email'),
          notes: fd.get('notes'),
          timezone: state.tz,
          reschedule: cfg.reschedule,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw Object.assign(new Error(data.error || 'Booking failed.'), { status: res.status });
      window.location.href = data.url;
    } catch (ex) {
      err.textContent = ex.message;
      err.classList.remove('hidden');
      btn.disabled = false;
      if (ex.status === 409) {
        state.selectedSlot = null;
        setTimeout(() => { showCalendar(); loadMonth(); }, 1800);
      }
    }
  });

  loadMonth();
})();
