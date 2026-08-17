import dotenv from 'dotenv';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  db,
  ensureAdminFromEnv,
  ensureDefaultSettings,
  ensureSeedProducts,
  migrateOrdersDeliveryFields,
  migrateProductsEnFields,
  migratePasswordResets,
  ensureSeedGallery,
  ROOT,
  UPLOADS_DIR,
} from './db.mjs';
import { attachUser } from './session.mjs';
import { buildApiRouter } from './routes.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(ROOT, '.env'), override: true });

const PORT = Number(process.env.PORT || 3107);
const secureCookies = process.env.SECURE_COOKIES !== '0';

ensureDefaultSettings(process.env);
ensureAdminFromEnv(process.env);
migrateProductsEnFields();
ensureSeedProducts();
migrateOrdersDeliveryFields();
migratePasswordResets();
ensureSeedGallery();

const app = express();
app.set('trust proxy', 1);
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(
  rateLimit({
    windowMs: 60_000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
      const p = req.path || '';
      if (p === '/api/payments/yookassa/webhook') return true;
      if (p === '/api/health') return true;
      // Галерея ~90 фото не должна съедать лимит API/HTML
      if (
        p.startsWith('/images/') ||
        p.startsWith('/uploads/') ||
        p.startsWith('/styles/') ||
        p.startsWith('/scripts/') ||
        p.startsWith('/css/') ||
        p.startsWith('/js/') ||
        p.startsWith('/favicon')
      ) {
        return true;
      }
      if (/\.(webp|jpe?g|png|gif|svg|ico|css|js|map|woff2?|ttf|mp4|webm|mov)$/i.test(p)) return true;
      return false;
    },
  })
);

// Soft noindex only on staging host (dev)
app.use((req, res, next) => {
  const rawHost =
    req.headers['x-forwarded-host'] || req.headers.host || req.hostname || '';
  const host = String(rawHost).split(',')[0].trim().split(':')[0].toLowerCase();
  if (host === 'dev.vrnhoney.ru') {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  }
  next();
});

function isLanIp(ip) {
  if (!ip) return false;
  const v = String(ip).replace(/^::ffff:/, '');
  if (v === '127.0.0.1' || v === '::1') return true;
  if (/^10\./.test(v)) return true;
  if (/^192\.168\./.test(v)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(v)) return true;
  return false;
}

function clientIp(req) {
  // trust proxy=1 → req.ip уже из X-Forwarded-For
  return req.ip || req.socket?.remoteAddress || '';
}

const basicUser = process.env.BASIC_AUTH_USER;
const basicPass = process.env.BASIC_AUTH_PASS;
const basicHosts = String(process.env.BASIC_AUTH_HOSTS || 'dev.vrnhoney.ru')
  .split(',')
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);
if (basicUser && basicPass) {
  app.use((req, res, next) => {
    if (req.path === '/api/health') return next();
    if (req.path === '/api/payments/yookassa/webhook') return next();
    const rawHost =
      req.headers['x-forwarded-host'] || req.headers.host || req.hostname || '';
    const host = String(rawHost)
      .split(',')[0]
      .trim()
      .split(':')[0]
      .toLowerCase();
    // Basic Auth только на указанных хостах (dev); прод vrnhoney.ru — открыт
    if (!host || (basicHosts.length && !basicHosts.includes(host))) return next();
    // Локальная сеть — без Basic Auth
    if (isLanIp(clientIp(req))) return next();
    const hdr = req.headers.authorization || '';
    if (!hdr.startsWith('Basic ')) {
      res.setHeader('WWW-Authenticate', 'Basic realm="VRNHoney Dev"');
      return res.status(401).send('Auth required');
    }
    const decoded = Buffer.from(hdr.slice(6), 'base64').toString('utf8');
    const i = decoded.indexOf(':');
    const u = decoded.slice(0, i);
    const p = decoded.slice(i + 1);
    if (u === basicUser && p === basicPass) return next();
    res.setHeader('WWW-Authenticate', 'Basic realm="VRNHoney Dev"');
    return res.status(401).send('Auth required');
  });
}

app.use(attachUser);
app.use('/uploads', express.static(UPLOADS_DIR, { maxAge: '7d' }));
app.use('/api', buildApiRouter({ secureCookies }));
app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'] }));

app.get('/en', (_req, res) => res.redirect(301, '/en/'));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) return next();
  if (req.path === '/en' || req.path.startsWith('/en/')) {
    return res.sendFile(path.join(ROOT, 'public', 'en', 'index.html'));
  }
  res.sendFile(path.join(ROOT, 'public', 'index.html'));
});

app.use((err, req, res, _next) => {
  console.error(err);
  const en = String(req.headers['x-shop-locale'] || '').toLowerCase() === 'en';
  res.status(500).json({ error: en ? 'Internal error' : 'Внутренняя ошибка' });
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`vrnhoney-shop on http://127.0.0.1:${PORT}`);
  console.log(`admin: ${process.env.ADMIN_EMAIL}`);
  void db;
});
