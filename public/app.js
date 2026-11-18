(() => {
  'use strict';

  // Copy-link buttons
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-copy]');
    if (!btn) return;
    try {
      await navigator.clipboard.writeText(btn.dataset.copy);
      const old = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(() => (btn.textContent = old), 1500);
    } catch {
      window.prompt('Copy this link:', btn.dataset.copy);
    }
  });

  // Confirm (and optionally prompt for a reason) before destructive form submits
  document.addEventListener('submit', (e) => {
    const form = e.target;
    if (!form.dataset.confirm) return;
    if (form.dataset.prompt) {
      const reason = window.prompt(`${form.dataset.confirm}\n\nReason (optional):`, '');
      if (reason === null) return e.preventDefault();
      const input = form.querySelector(`[name="${form.dataset.prompt}"]`);
      if (input) input.value = reason;
    } else if (!window.confirm(form.dataset.confirm)) {
      e.preventDefault();
    }
  });

  // Auto-generate slug from title until the user edits the slug
  const src = document.querySelector('[data-slug-source]');
  const dst = document.querySelector('[data-slug-target]');
  if (src && dst) {
    dst.addEventListener('input', () => dst.setAttribute('data-touched', ''));
    src.addEventListener('input', () => {
      if (dst.hasAttribute('data-touched')) return;
      dst.value = src.value.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 60);
    });
  }

  // Weekly availability editor
  const weekly = document.getElementById('weekly-form');
  if (weekly) {
    const intervalHtml = (day, s = '09:00', e = '17:00') => {
      const div = document.createElement('div');
      div.className = 'interval';
      div.innerHTML = `<input type="time" name="d${day}_start" value="${s}" step="900" required>
        <span>–</span>
        <input type="time" name="d${day}_end" value="${e}" step="900" required>
        <button type="button" class="icon-btn" data-remove-interval title="Remove">×</button>`;
      return div;
    };
    const sync = (row) => {
      const has = row.querySelectorAll('.interval').length > 0;
      row.querySelector('[data-day-toggle]').checked = has;
      row.classList.toggle('off', !has);
    };
    weekly.querySelectorAll('.day-row').forEach(sync);

    weekly.addEventListener('click', (e) => {
      const row = e.target.closest('.day-row');
      if (!row) return;
      const day = row.dataset.day;
      if (e.target.matches('[data-add-interval]')) {
        const list = row.querySelector('.intervals');
        const last = [...list.querySelectorAll('.interval')].pop();
        let start = '09:00', end = '17:00';
        if (last) {
          // New interval starts an hour after the previous one ends.
          const [h, m] = last.querySelectorAll('input')[1].value.split(':').map(Number);
          const sMin = Math.min(h * 60 + m + 60, 22 * 60);
          start = `${String(Math.floor(sMin / 60)).padStart(2, '0')}:${String(sMin % 60).padStart(2, '0')}`;
          const eMin = Math.min(sMin + 60, 23 * 60 + 45);
          end = `${String(Math.floor(eMin / 60)).padStart(2, '0')}:${String(eMin % 60).padStart(2, '0')}`;
        }
        list.insertBefore(intervalHtml(day, start, end), list.querySelector('.unavailable'));
        sync(row);
      } else if (e.target.matches('[data-remove-interval]')) {
        e.target.closest('.interval').remove();
        sync(row);
      }
    });

    weekly.addEventListener('change', (e) => {
      if (!e.target.matches('[data-day-toggle]')) return;
      const row = e.target.closest('.day-row');
      const list = row.querySelector('.intervals');
      if (e.target.checked) list.insertBefore(intervalHtml(row.dataset.day), list.querySelector('.unavailable'));
      else list.querySelectorAll('.interval').forEach((n) => n.remove());
      sync(row);
    });
  }
})();
