import { nanoid } from 'nanoid';
import { db } from './db.mjs';

const COOKIE = 'vh_session';
const DAYS = 14;

export function createSession(userId) {
  const id = nanoid(32);
  const expires = new Date(Date.now() + DAYS * 864e5).toISOString();
  db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').run(
    id,
    userId,
    expires
  );
  return { id, expires };
}

export function destroySession(sessionId) {
  if (!sessionId) return;
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

export function getUserBySession(sessionId) {
  if (!sessionId) return null;
  const row = db
    .prepare(
      `SELECT u.* FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.expires_at > datetime('now')`
    )
    .get(sessionId);
  return row || null;
}

export function setSessionCookie(res, sessionId, secure) {
  const maxAge = DAYS * 86400;
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${
      secure ? '; Secure' : ''
    }`
  );
}

export function clearSessionCookie(res, secure) {
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`
  );
}

export function readSessionId(req) {
  const raw = req.headers.cookie || '';
  const parts = raw.split(';').map((p) => p.trim());
  for (const p of parts) {
    if (p.startsWith(`${COOKIE}=`)) return decodeURIComponent(p.slice(COOKIE.length + 1));
  }
  return null;
}

export function attachUser(req, _res, next) {
  req.user = getUserBySession(readSessionId(req));
  next();
}

export function requireUser(req, res, next) {
  if (!req.user) {
    const en = String(req.headers['x-shop-locale'] || '').toLowerCase() === 'en';
    return res.status(401).json({ error: en ? 'Authorization required' : 'Нужна авторизация' });
  }
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user?.is_admin) {
    const en = String(req.headers['x-shop-locale'] || '').toLowerCase() === 'en';
    return res.status(403).json({ error: en ? 'Admins only' : 'Только для админа' });
  }
  next();
}
