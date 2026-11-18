'use strict';
// Creates a demo host: demo@schedulr.test / password123 → booking page at /demo
const { q, transaction } = require('../src/db');
const { hashPassword } = require('../src/auth');

const existing = q.get('SELECT id FROM users WHERE username = ?', 'demo');
if (existing) {
  console.log('Demo user already exists. Log in with demo@schedulr.test / password123');
  process.exit(0);
}

transaction(() => {
  const { lastInsertRowid } = q.run(
    'INSERT INTO users (email, name, username, password_hash, timezone) VALUES (?, ?, ?, ?, ?)',
    'demo@schedulr.test', 'Alex Rivera', 'demo', hashPassword('password123'), 'America/New_York'
  );
  const id = Number(lastInsertRowid);
  for (let d = 1; d <= 5; d++) {
    q.run('INSERT INTO availability (user_id, weekday, start_min, end_min) VALUES (?, ?, ?, ?)', id, d, 9 * 60, 12 * 60);
    q.run('INSERT INTO availability (user_id, weekday, start_min, end_min) VALUES (?, ?, ?, ?)', id, d, 13 * 60, 17 * 60);
  }
  const types = [
    ['15 Minute Intro', '15min', 15, 'Quick hello to see if we are a fit.', 'Phone call', '#17e885', 0, 5],
    ['30 Minute Meeting', '30min', 30, '', 'Google Meet', '#006bff', 0, 10],
    ['60 Minute Consultation', 'consult', 60, 'A deep dive into your project. Please come with questions!', 'Zoom', '#8247f5', 15, 15],
  ];
  for (const [title, slug, dur, desc, loc, color, bb, ba] of types) {
    q.run(
      `INSERT INTO event_types (user_id, title, slug, duration_min, description, location, color, buffer_before_min, buffer_after_min)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, title, slug, dur, desc, loc, color, bb, ba
    );
  }
});
console.log('Seeded demo user: demo@schedulr.test / password123 → http://localhost:3000/demo');
