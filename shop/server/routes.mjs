import { Router } from 'express';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { nanoid } from 'nanoid';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { sendPasswordResetEmail, sendNewOrderNotify } from './mail.mjs';
import { db, getSetting, setSetting, UPLOADS_DIR, ROOT } from './db.mjs';
import {
  createSession,
  destroySession,
  setSessionCookie,
  clearSessionCookie,
  readSessionId,
  requireUser,
  requireAdmin,
} from './session.mjs';
import {
  getPaymentsClient,
  paymentsEnabled,
  paymentReturnUrl,
  formatAmountRub,
} from './yookassa.mjs';
import { getRequestIp, isYooKassaIp } from './yookassaWebhookAuth.mjs';
import { requestLocale, t, localizeProductFields } from './locale.mjs';
import {
  cdekEnabled,
  searchCities,
  listPvz,
  calcDelivery,
  createCdekOrder,
  getBarcodePrintUrl,
  getWaybillPrintUrl,
  getCdekAccessToken,
  createCourierIntake,
  cancelCourierIntake,
  cancelCdekOrder,
  defaultIntakeDate,
  defaultIntakeTimeFrom,
  defaultIntakeTimeTo,
  buildCourierIntakePayload,
  getIntakeAddress,
  litersFromProduct,
} from './cdek.mjs';

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase().slice(0, 8) || '.jpg';
      cb(null, `${Date.now()}-${nanoid(8)}${ext}`);
    },
  }),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) {
      return cb(new Error('Только изображения JPEG/PNG/WebP/GIF'));
    }
    cb(null, true);
  },
});

const GALLERY_UPLOAD_DIR = path.join(UPLOADS_DIR, 'gallery');
fs.mkdirSync(GALLERY_UPLOAD_DIR, { recursive: true });

const galleryUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, GALLERY_UPLOAD_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase().slice(0, 10) || '.bin';
      cb(null, `${Date.now()}-${nanoid(8)}${ext}`);
    },
  }),
  limits: { fileSize: 80 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok =
      /^image\/(jpeg|png|webp|gif)$/.test(file.mimetype) ||
      /^video\/(mp4|webm|quicktime)$/.test(file.mimetype);
    if (!ok) return cb(new Error('Только фото (JPEG/PNG/WebP/GIF) или видео (MP4/WebM/MOV)'));
    cb(null, true);
  },
});

function galleryItemRow(row, lang = 'ru') {
  const isStatic = row.source === 'static';
  const filePath = String(row.file_path || '');
  let url = '';
  let webp_url = null;
  if (isStatic) {
    url = `/images/${filePath.replace(/^\/+/, '')}`;
    if (/\.jpe?g$/i.test(filePath)) {
      const webp = filePath.replace(/\.jpe?g$/i, '.webp');
      const abs = path.join(ROOT, 'public', 'images', webp);
      if (fs.existsSync(abs)) webp_url = `/images/${webp}`;
    }
  } else {
    url = `/uploads/gallery/${path.basename(filePath)}`;
  }
  const alt = lang === 'en' && row.alt_en ? row.alt_en : row.alt || row.alt_en || '';
  return {
    id: row.id,
    kind: row.kind === 'video' ? 'video' : 'image',
    source: row.source,
    url,
    webp_url,
    alt,
    alt_ru: row.alt || '',
    alt_en: row.alt_en || '',
    sort_order: row.sort_order,
    active: !!row.active,
    created_at: row.created_at,
  };
}

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    phone: u.phone,
    is_admin: !!u.is_admin,
  };
}

function productRow(p, lang = 'ru', forAdmin = false) {
  const loc = localizeProductFields(p, lang);
  const row = {
    id: p.id,
    title: forAdmin ? p.title : loc.title,
    description: forAdmin ? p.description : loc.description,
    price_rub: p.price_rub,
    stock: p.stock,
    image_url: p.image_path ? `/uploads/${path.basename(p.image_path)}` : null,
    active: !!p.active,
    created_at: p.created_at,
    updated_at: p.updated_at,
  };
  if (forAdmin) {
    row.title_en = p.title_en || '';
    row.description_en = p.description_en || '';
  }
  return row;
}

function localizeOrderItems(items, lang) {
  return (items || []).map((it) => {
    const p = db.prepare('SELECT * FROM products WHERE id = ?').get(it.product_id);
    if (!p) return it;
    const loc = localizeProductFields(p, lang);
    return { ...it, title: loc.title };
  });
}

export function buildApiRouter({ secureCookies }) {
  const api = Router();

  api.get('/health', (_req, res) => res.json({ ok: true }));

  api.get('/me', (req, res) => {
    res.json({ user: publicUser(req.user) });
  });

  api.get('/settings/public', (_req, res) => {
    res.json({
      fixed_shipping_rub: Number(getSetting('fixed_shipping_rub', '350')) || 0,
      shipping_note: getSetting('shipping_note', ''),
      site_name: process.env.SITE_NAME || 'VRNHoney Shop',
      cdek_enabled: cdekEnabled(),
      payments_enabled: paymentsEnabled(),
    });
  });

  api.get('/cdek/cities', async (req, res) => {
    const lang = requestLocale(req);
    if (!cdekEnabled()) return res.status(503).json({ error: t(lang, 'cdekUnavailable') });
    try {
      const cities = await searchCities(String(req.query?.q || ''), 15);
      res.json({ cities });
    } catch (err) {
      console.error('[cdek] cities', err);
      res.status(502).json({ error: err.message || t(lang, 'cdekCalcFailed') });
    }
  });

  api.get('/cdek/pvz', async (req, res) => {
    const lang = requestLocale(req);
    if (!cdekEnabled()) return res.status(503).json({ error: t(lang, 'cdekUnavailable') });
    try {
      const cityCode = Number(req.query?.city_code);
      if (!cityCode) return res.status(400).json({ error: t(lang, 'cdekRequired') });
      const pvz = await listPvz(cityCode, 120);
      res.json({ pvz });
    } catch (err) {
      console.error('[cdek] pvz', err);
      res.status(502).json({ error: err.message || t(lang, 'cdekCalcFailed') });
    }
  });

  api.post('/cdek/calc', async (req, res) => {
    const lang = requestLocale(req);
    if (!cdekEnabled()) return res.status(503).json({ error: t(lang, 'cdekUnavailable') });
    try {
      const cityCode = Number(req.body?.city_code);
      const items = Array.isArray(req.body?.items) ? req.body.items : [];
      if (!cityCode) return res.status(400).json({ error: t(lang, 'cdekRequired') });
      const normalized = [];
      for (const it of items) {
        const product = db
          .prepare('SELECT * FROM products WHERE id = ? AND active = 1')
          .get(it.product_id);
        if (!product) continue;
        const loc = localizeProductFields(product, lang);
        normalized.push({
          product_id: product.id,
          title: loc.title,
          price_rub: product.price_rub,
          qty: Math.max(1, Math.min(99, Number(it.qty) || 1)),
        });
      }
      if (!normalized.length) return res.status(400).json({ error: t(lang, 'cartEmpty') });
      const mode = req.body?.mode === 'door' ? 'door' : 'pvz';
      const calc = await calcDelivery({ cityCode, items: normalized, mode });
      res.json({
        shipping_rub: calc.shipping_rub,
        tariff_code: calc.tariff_code,
        tariff_name: calc.tariff_name,
        period_min: calc.period_min,
        period_max: calc.period_max,
        package: calc.package,
        mode: calc.mode,
        pay_at_pickup: true,
      });
    } catch (err) {
      console.error('[cdek] calc', err);
      res.status(502).json({ error: err.message || t(lang, 'cdekCalcFailed') });
    }
  });

  api.post('/auth/register', (req, res) => {
    const email = String(req.body?.email || '')
      .trim()
      .toLowerCase();
    const password = String(req.body?.password || '');
    const name = String(req.body?.name || '').trim();
    const phone = String(req.body?.phone || '').trim();
    const lang = requestLocale(req);
    if (!email || !password || password.length < 6) {
      return res.status(400).json({ error: t(lang, 'emailPasswordRequired') });
    }
    if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) {
      return res.status(409).json({ error: t(lang, 'emailTaken') });
    }
    const hash = bcrypt.hashSync(password, 10);
    const info = db
      .prepare(
        `INSERT INTO users (email, password_hash, name, phone) VALUES (?, ?, ?, ?)`
      )
      .run(email, hash, name, phone);
    const session = createSession(info.lastInsertRowid);
    setSessionCookie(res, session.id, secureCookies);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json({ user: publicUser(user) });
  });

  api.post('/auth/login', (req, res) => {
    const email = String(req.body?.email || '')
      .trim()
      .toLowerCase();
    const password = String(req.body?.password || '');
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    const lang = requestLocale(req);
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: t(lang, 'badCredentials') });
    }
    destroySession(readSessionId(req));
    const session = createSession(user.id);
    setSessionCookie(res, session.id, secureCookies);
    res.json({ user: publicUser(user) });
  });

  api.post('/auth/logout', (req, res) => {
    destroySession(readSessionId(req));
    clearSessionCookie(res, secureCookies);
    res.json({ ok: true });
  });

  const forgotHits = new Map();
  function forgotLimited(key) {
    const now = Date.now();
    const row = forgotHits.get(key);
    if (row && now - row.at < 120_000) return true;
    forgotHits.set(key, { at: now });
    if (forgotHits.size > 2000) {
      for (const [k, v] of forgotHits) {
        if (now - v.at > 15 * 60_000) forgotHits.delete(k);
      }
    }
    return false;
  }
  function hashResetToken(token) {
    return createHash('sha256').update(String(token)).digest('hex');
  }
  function publicOrigin(req) {
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'vrnhoney.ru')
      .split(',')[0]
      .trim()
      .split(':')[0];
    const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
    return `${proto}://${host}`;
  }

  api.post('/auth/forgot', async (req, res) => {
    const lang = requestLocale(req);
    const email = String(req.body?.email || '')
      .trim()
      .toLowerCase();
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: t(lang, 'resetEmailRequired') });
    }
    const ip = req.ip || req.socket?.remoteAddress || '';
    if (forgotLimited(`ip:${ip}`) || forgotLimited(`em:${email}`)) {
      return res.status(429).json({ error: t(lang, 'resetTooOften') });
    }
    const user = db.prepare('SELECT id, email FROM users WHERE email = ?').get(email);
    if (user) {
      db.prepare(`DELETE FROM password_resets WHERE user_id = ? OR expires_at <= datetime('now')`).run(
        user.id
      );
      const token = randomBytes(32).toString('hex');
      db.prepare(
        `INSERT INTO password_resets (token_hash, user_id, expires_at)
         VALUES (?, ?, datetime('now', '+1 hour'))`
      ).run(hashResetToken(token), user.id);
      const path = lang === 'en' ? '/en/login.html' : '/login.html';
      const resetLink = `${publicOrigin(req)}${path}?reset=${encodeURIComponent(token)}`;
      try {
        await sendPasswordResetEmail({ to: user.email, resetLink, lang });
      } catch (err) {
        console.error('[mail] reset', err.message || err);
        db.prepare('DELETE FROM password_resets WHERE token_hash = ?').run(hashResetToken(token));
      }
    }
    res.json({ ok: true, message: t(lang, 'resetSent') });
  });

  api.post('/auth/reset', (req, res) => {
    const lang = requestLocale(req);
    const token = String(req.body?.token || '').trim();
    const password = String(req.body?.password || '');
    if (!token || password.length < 6) {
      return res.status(400).json({ error: t(lang, 'resetPasswordShort') });
    }
    const row = db
      .prepare(
        `SELECT user_id FROM password_resets
         WHERE token_hash = ? AND expires_at > datetime('now')`
      )
      .get(hashResetToken(token));
    if (!row) return res.status(400).json({ error: t(lang, 'resetInvalid') });
    const hash = bcrypt.hashSync(password, 10);
    db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(hash, row.user_id);
    db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(row.user_id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.user_id);
    res.json({ ok: true, message: t(lang, 'resetOk') });
  });

  api.get('/products', (req, res) => {
    const lang = requestLocale(req);
    const admin = !!req.user?.is_admin;
    const rows = admin
      ? db.prepare('SELECT * FROM products ORDER BY id DESC').all()
      : db
          .prepare('SELECT * FROM products WHERE active = 1 ORDER BY id DESC')
          .all();
    res.json({ products: rows.map((p) => productRow(p, lang, admin)) });
  });

  api.get('/products/:id', (req, res) => {
    const lang = requestLocale(req);
    const admin = !!req.user?.is_admin;
    const p = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
    if (!p || (!p.active && !admin)) {
      return res.status(404).json({ error: t(lang, 'productNotFound') });
    }
    res.json({ product: productRow(p, lang, admin) });
  });

  api.post('/orders', requireUser, async (req, res) => {
    const lang = requestLocale(req);
    if (!paymentsEnabled()) {
      return res.status(503).json({ error: t(lang, 'paymentsUnavailable') });
    }
    if (req.user.is_admin) {
      return res.status(400).json({ error: t(lang, 'adminCannotOrder') });
    }
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) return res.status(400).json({ error: t(lang, 'cartEmpty') });

    const customer_last_name = String(req.body?.customer_last_name || '').trim();
    const customer_name = String(req.body?.customer_name || req.user.name || '').trim();
    const customer_patronymic = String(req.body?.customer_patronymic || '').trim();
    const customer_phone = String(req.body?.customer_phone || req.user.phone || '').trim();
    const delivery_type = req.body?.cdek_delivery_type === 'door' ? 'door' : 'pvz';
    const cdek_city_code = Number(req.body?.cdek_city_code) || 0;
    const cdek_pvz_code =
      delivery_type === 'pvz' ? String(req.body?.cdek_pvz_code || '').trim() : '';
    const cdek_pvz_address =
      delivery_type === 'pvz' ? String(req.body?.cdek_pvz_address || '').trim() : '';
    const door_address =
      delivery_type === 'door' ? String(req.body?.customer_address || '').trim() : '';
    const customer_postal_code = String(req.body?.customer_postal_code || '')
      .replace(/\D/g, '')
      .trim();
    const customer_address =
      delivery_type === 'door' ? door_address : cdek_pvz_address || String(req.body?.customer_address || '').trim();
    const comment = String(req.body?.comment || '').trim();
    if (!customer_last_name || !customer_name || !customer_patronymic || !customer_phone) {
      return res.status(400).json({
        error: t(lang, 'deliveryRequired'),
      });
    }
    if (!cdekEnabled() || !cdek_city_code) {
      return res.status(400).json({ error: t(lang, 'cdekRequired') });
    }
    if (delivery_type === 'pvz' && (!cdek_pvz_code || !customer_address)) {
      return res.status(400).json({ error: t(lang, 'cdekPvzRequired') });
    }
    if (delivery_type === 'door' && !customer_address) {
      return res.status(400).json({ error: t(lang, 'cdekAddressRequired') });
    }

    const normalized = [];
    let items_total_rub = 0;
    for (const it of items) {
      const product = db
        .prepare('SELECT * FROM products WHERE id = ? AND active = 1')
        .get(it.product_id);
      const qty = Math.max(1, Math.min(99, Number(it.qty) || 1));
      if (!product) return res.status(400).json({ error: t(lang, 'productUnavailable') });
      if (product.stock < qty) {
        const locTitle = localizeProductFields(product, lang).title;
        return res.status(400).json({ error: t(lang, 'stockShort', locTitle) });
      }
      const line = product.price_rub * qty;
      items_total_rub += line;
      const loc = localizeProductFields(product, lang);
      normalized.push({
        product_id: product.id,
        title: loc.title,
        price_rub: product.price_rub,
        qty,
        line_rub: line,
        liters: litersFromProduct(product),
      });
    }

    let calc;
    try {
      calc = await calcDelivery({ cityCode: cdek_city_code, items: normalized, mode: delivery_type });
    } catch (err) {
      console.error('[cdek] calc on order', err);
      return res.status(502).json({ error: err.message || t(lang, 'cdekCalcFailed') });
    }

    // shipping_rub — справочно (платит получатель); в ЮKassa только мёд
    const shipping_rub = calc.shipping_rub;
    const shipping_note =
      delivery_type === 'door'
        ? `СДЭК до двери: ${customer_address}. Оплата доставки при получении ~${shipping_rub} ₽ (${calc.tariff_name || 'тариф ' + calc.tariff_code})`
        : `СДЭК ПВЗ ${cdek_pvz_code}: ${customer_address}. Оплата доставки при получении ~${shipping_rub} ₽ (${calc.tariff_name || 'тариф ' + calc.tariff_code})`;
    const total_rub = items_total_rub;
    const postal =
      customer_postal_code && /^\d{6}$/.test(customer_postal_code)
        ? customer_postal_code
        : String(req.body?.cdek_postal_code || '').replace(/\D/g, '').slice(0, 6);

    const tx = db.transaction(() => {
      for (const it of normalized) {
        const r = db
          .prepare('UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?')
          .run(it.qty, it.product_id, it.qty);
        if (r.changes !== 1) throw new Error('STOCK');
      }
      const info = db
        .prepare(
          `INSERT INTO orders (
            user_id, status, payment_status, customer_name, customer_last_name, customer_patronymic,
            customer_phone, customer_postal_code, customer_address, comment,
            items_json, items_total_rub, shipping_rub, shipping_note, total_rub,
            cdek_city_code, cdek_pvz_code, cdek_pvz_address, cdek_tariff_code, cdek_status, cdek_delivery_type
          ) VALUES (?, 'new', 'unpaid', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          req.user.id,
          customer_name,
          customer_last_name,
          customer_patronymic,
          customer_phone,
          postal || '',
          customer_address,
          comment,
          JSON.stringify(normalized),
          items_total_rub,
          shipping_rub,
          shipping_note,
          total_rub,
          cdek_city_code,
          cdek_pvz_code || null,
          delivery_type === 'pvz' ? customer_address : '',
          calc.tariff_code,
          'pending',
          delivery_type
        );
      return info.lastInsertRowid;
    });

    try {
      const orderId = tx();
      let order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
      setImmediate(() => {
        sendNewOrderNotify(order, { adminUrl: 'https://vrnhoney.ru/admin/' }).catch((err) => {
          console.error('[mail] new order notify', err.message || err);
        });
      });
      let confirmationUrl = null;
      const client = getPaymentsClient();
      if (client && order.total_rub > 0) {
        try {
          const payment = await client.createPayment(
            {
              amount: { value: formatAmountRub(order.total_rub), currency: 'RUB' },
              confirmation: { type: 'redirect', return_url: paymentReturnUrl(lang) },
              capture: true,
              description: `Order #${order.id} VRNHoney`.slice(0, 128),
              metadata: {
                orderId: String(order.id),
                userId: String(req.user.id),
                locale: lang,
              },
            },
            randomUUID()
          );
          db.prepare(
            `UPDATE orders SET payment_id = ?, payment_status = 'pending', updated_at = datetime('now') WHERE id = ?`
          ).run(payment.id, order.id);
          confirmationUrl = payment.confirmation?.confirmation_url || null;
          order = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
        } catch (payErr) {
          console.error('[yookassa] createPayment failed', payErr);
          return res.status(201).json({
            order: formatOrder(order, lang),
            confirmationUrl: null,
            paymentError: payErr.message || t(lang, 'paymentCreateFailed'),
          });
        }
      }
      res.status(201).json({ order: formatOrder(order, lang), confirmationUrl });
    } catch (e) {
      if (e.message === 'STOCK') {
        return res.status(409).json({ error: t(lang, 'stockConflict') });
      }
      throw e;
    }
  });

  api.post('/orders/:id/pay', requireUser, async (req, res) => {
    const lang = requestLocale(req);
    if (!paymentsEnabled()) {
      return res.status(503).json({ error: t(lang, 'paymentsUnavailable') });
    }
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
    if (!order || order.user_id !== req.user.id) {
      return res.status(404).json({ error: t(lang, 'orderNotFound') });
    }
    if (order.payment_status === 'paid') {
      return res.status(400).json({ error: t(lang, 'alreadyPaid') });
    }
    if (order.status === 'cancelled') {
      return res.status(400).json({ error: t(lang, 'orderCancelled') });
    }
    const client = getPaymentsClient();
    if (!client) return res.status(503).json({ error: t(lang, 'paymentsUnavailable') });
    if (order.total_rub <= 0) return res.status(400).json({ error: t(lang, 'nothingToPay') });

    try {
      const payment = await client.createPayment(
        {
          amount: { value: formatAmountRub(order.total_rub), currency: 'RUB' },
          confirmation: { type: 'redirect', return_url: paymentReturnUrl(lang) },
          capture: true,
          description: `Order #${order.id} VRNHoney`.slice(0, 128),
          metadata: {
            orderId: String(order.id),
            userId: String(req.user.id),
            locale: lang,
          },
        },
        randomUUID()
      );
      db.prepare(
        `UPDATE orders SET payment_id = ?, payment_status = 'pending', updated_at = datetime('now') WHERE id = ?`
      ).run(payment.id, order.id);
      const confirmationUrl = payment.confirmation?.confirmation_url;
      if (!confirmationUrl) {
        return res.status(502).json({ error: t(lang, 'noPaymentUrl') });
      }
      res.json({
        order: formatOrder(db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id), lang),
        confirmationUrl,
      });
    } catch (err) {
      console.error('[yookassa] repay failed', err);
      res.status(502).json({ error: err.message || t(lang, 'paymentError') });
    }
  });

  api.get('/orders/mine', requireUser, (req, res) => {
    const lang = requestLocale(req);
    const rows = db
      .prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC')
      .all(req.user.id);
    res.json({ orders: rows.map((o) => formatOrder(o, lang)), paymentsEnabled: paymentsEnabled() });
  });

  api.post('/payments/yookassa/webhook', async (req, res) => {
    try {
      const ip = getRequestIp(req);
      if (!isYooKassaIp(ip) && process.env.YOOKASSA_SKIP_IP !== '1') {
        console.warn('[yookassa] webhook bad IP', ip);
        return res.sendStatus(403);
      }

      const event = req.body?.event;
      const object = req.body?.object;
      if (!object?.id) return res.sendStatus(200);

      const client = getPaymentsClient();
      if (!client) return res.sendStatus(200);

      if (event === 'payment.succeeded' || object.status === 'succeeded') {
        const payment = await client.getPayment(object.id);
        if (payment.status !== 'succeeded') return res.sendStatus(200);
        markOrderPaidFromPayment(payment);
        return res.sendStatus(200);
      }

      if (event === 'payment.canceled' || object.status === 'canceled') {
        const payment = await client.getPayment(object.id);
        const orderId = Number(payment.metadata?.orderId);
        if (orderId) {
          const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
          if (order && order.payment_status !== 'paid') {
            db.prepare(
              `UPDATE orders SET payment_status = 'canceled', updated_at = datetime('now') WHERE id = ?`
            ).run(orderId);
          }
        }
        return res.sendStatus(200);
      }

      return res.sendStatus(200);
    } catch (err) {
      console.error('[yookassa] webhook error', err);
      return res.sendStatus(500);
    }
  });

  // ---- admin ----
  api.get('/admin/orders', requireAdmin, (_req, res) => {
    const rows = db.prepare('SELECT * FROM orders ORDER BY id DESC').all();
    res.json({ orders: rows.map(formatOrder) });
  });

  api.patch('/admin/orders/:id', requireAdmin, async (req, res) => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
    const lang = requestLocale(req);
    if (!order) return res.status(404).json({ error: t(lang, 'orderNotFound') });
    const status = req.body?.status != null ? String(req.body.status) : order.status;
    const allowed = ['new', 'confirmed', 'shipped', 'done', 'cancelled'];
    if (!allowed.includes(status)) return res.status(400).json({ error: t(lang, 'badStatus') });
    // shipping_rub — инфо для получателя; total_rub = только товар (ЮKassa)
    let shipping_rub = order.shipping_rub;
    if (req.body?.shipping_rub != null) {
      shipping_rub = Math.max(0, Number(req.body.shipping_rub) || 0);
    }
    const total_rub = order.items_total_rub;
    const becomingCancelled = status === 'cancelled' && order.status !== 'cancelled';

    if (becomingCancelled && cdekEnabled() && (order.cdek_uuid || order.cdek_intake_uuid)) {
      try {
        if (order.cdek_intake_uuid) {
          try {
            await cancelCourierIntake(order.cdek_intake_uuid);
          } catch (e) {
            console.warn('[cdek] cancel intake on order cancel', e.message || e);
          }
        }
        if (order.cdek_uuid) {
          await cancelCdekOrder(order.cdek_uuid);
        }
        db.prepare(
          `UPDATE orders SET
            cdek_status = 'cancelled',
            cdek_intake_status = CASE WHEN ? != '' THEN 'cancelled' ELSE cdek_intake_status END,
            cdek_intake_uuid = NULL,
            cdek_intake_number = NULL,
            updated_at = datetime('now')
           WHERE id = ?`
        ).run(order.cdek_intake_uuid || '', order.id);
      } catch (err) {
        console.error('[cdek] cancel order', err);
        db.prepare(
          `UPDATE orders SET cdek_status = ?, updated_at = datetime('now') WHERE id = ?`
        ).run(`error:${String(err.message || err).slice(0, 180)}`, order.id);
        return res.status(502).json({
          error: err.message || t(lang, 'cdekOrderCancelFailed'),
          order: formatOrder(db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id)),
        });
      }
    }

    db.prepare(
      `UPDATE orders SET status = ?, shipping_rub = ?, total_rub = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).run(status, shipping_rub, total_rub, order.id);
    res.json({ order: formatOrder(db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id)) });
  });

  api.post('/admin/orders/:id/cdek', requireAdmin, async (req, res) => {
    const lang = requestLocale(req);
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
    if (!order) return res.status(404).json({ error: t(lang, 'orderNotFound') });
    if (!cdekEnabled()) return res.status(503).json({ error: t(lang, 'cdekUnavailable') });
    if (order.payment_status !== 'paid') {
      return res.status(400).json({ error: t(lang, 'cdekNeedPaid') });
    }
    const force = req.body?.force === true || req.body?.force === 1 || req.body?.force === '1';
    if (!force && (order.cdek_uuid || order.cdek_number)) {
      return res.json({
        order: formatOrder(order),
        already: true,
        message: t(lang, 'cdekAlready'),
      });
    }
    if (force) {
      db.prepare(
        `UPDATE orders SET cdek_uuid = NULL, cdek_number = NULL, cdek_status = '', updated_at = datetime('now') WHERE id = ?`
      ).run(order.id);
    }
    try {
      await ensureCdekShipment(order.id);
      res.json({
        order: formatOrder(db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id)),
      });
    } catch (err) {
      console.error('[cdek] admin create', err);
      res.status(502).json({
        error: err.message || t(lang, 'cdekCreateFailed'),
        order: formatOrder(db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id)),
      });
    }
  });

  api.get('/admin/orders/:id/cdek/print/:kind', requireAdmin, async (req, res) => {
    const lang = requestLocale(req);
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
    if (!order) return res.status(404).json({ error: t(lang, 'orderNotFound') });
    if (!cdekEnabled()) return res.status(503).json({ error: t(lang, 'cdekUnavailable') });
    if (!order.cdek_uuid) {
      return res.status(400).json({ error: t(lang, 'cdekPrintNeedOrder') });
    }
    const kind = String(req.params.kind || '').toLowerCase();
    const asJson = String(req.query.json || '') === '1';
    try {
      const result =
        kind === 'barcode' || kind === 'label'
          ? await getBarcodePrintUrl(order.cdek_uuid)
          : kind === 'waybill' || kind === 'receipt'
            ? await getWaybillPrintUrl(order.cdek_uuid)
            : null;
      if (!result?.url) return res.status(400).json({ error: t(lang, 'cdekPrintBadKind') });
      if (asJson) {
        return res.json({ url: result.url, uuid: result.uuid, kind });
      }
      // PDF с api.cdek.ru требует Bearer — отдаём через наш бэкенд
      const token = await getCdekAccessToken();
      const pdfRes = await fetch(result.url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!pdfRes.ok) {
        const errText = await pdfRes.text().catch(() => '');
        throw new Error(errText || `CDEK PDF ${pdfRes.status}`);
      }
      const buf = Buffer.from(await pdfRes.arrayBuffer());
      const label = kind === 'barcode' || kind === 'label' ? 'naklejka' : 'kvitanciya';
      const filename = `${label}-VRN-${order.id}.pdf`;
      const asDownload =
        String(req.query.download || '') === '1' || String(req.query.dl || '') === '1';
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `${asDownload ? 'attachment' : 'inline'}; filename="${filename}"`
      );
      res.setHeader('Content-Length', String(buf.length));
      res.send(buf);
    } catch (err) {
      console.error('[cdek] print', kind, err);
      res.status(502).json({ error: err.message || t(lang, 'cdekPrintFailed') });
    }
  });

  api.post('/admin/orders/:id/cdek/intake', requireAdmin, async (req, res) => {
    const lang = requestLocale(req);
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
    if (!order) return res.status(404).json({ error: t(lang, 'orderNotFound') });
    if (!cdekEnabled()) return res.status(503).json({ error: t(lang, 'cdekUnavailable') });
    if (order.payment_status !== 'paid') {
      return res.status(400).json({ error: t(lang, 'cdekNeedPaid') });
    }
    if (!order.cdek_uuid && !order.cdek_number) {
      return res.status(400).json({ error: t(lang, 'cdekPrintNeedOrder') });
    }
    if (order.cdek_intake_uuid && !req.body?.force && !req.body?.dry_run) {
      return res.status(400).json({ error: t(lang, 'cdekIntakeAlready') });
    }
    try {
      const items = JSON.parse(order.items_json || '[]');
      const intakeOpts = {
        orderUuid: order.cdek_uuid,
        cdekNumber: order.cdek_number,
        items,
        intakeDate: req.body?.intake_date || defaultIntakeDate(),
        intakeTimeFrom: req.body?.intake_time_from || defaultIntakeTimeFrom(),
        intakeTimeTo: req.body?.intake_time_to || defaultIntakeTimeTo(),
        comment: req.body?.comment || `VRNHoney заказ #${order.id}`,
        needCall: req.body?.need_call !== false,
      };

      if (req.body?.dry_run === true || req.body?.dry_run === 1 || req.body?.dry_run === '1') {
        const preview = buildCourierIntakePayload(intakeOpts);
        return res.json({
          dry_run: true,
          preview,
          message: t(lang, 'cdekIntakeDryRun'),
        });
      }

      if (order.cdek_intake_uuid && req.body?.force) {
        try {
          await cancelCourierIntake(order.cdek_intake_uuid);
        } catch (e) {
          console.warn('[cdek] cancel old intake', e.message || e);
        }
      }
      const created = await createCourierIntake(intakeOpts);
      db.prepare(
        `UPDATE orders SET
          cdek_intake_uuid = ?,
          cdek_intake_number = ?,
          cdek_intake_status = 'created',
          cdek_intake_date = ?,
          cdek_intake_time_from = ?,
          cdek_intake_time_to = ?,
          updated_at = datetime('now')
         WHERE id = ?`
      ).run(
        created.uuid,
        created.number,
        created.intake_date,
        created.intake_time_from,
        created.intake_time_to,
        order.id
      );
      res.json({
        intake: created,
        order: formatOrder(db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id)),
      });
    } catch (err) {
      console.error('[cdek] intake', err);
      db.prepare(
        `UPDATE orders SET cdek_intake_status = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(`error:${String(err.message || err).slice(0, 180)}`, order.id);
      res.status(502).json({
        error: err.message || t(lang, 'cdekIntakeFailed'),
        order: formatOrder(db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id)),
      });
    }
  });

  api.delete('/admin/orders/:id/cdek/intake', requireAdmin, async (req, res) => {
    const lang = requestLocale(req);
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
    if (!order) return res.status(404).json({ error: t(lang, 'orderNotFound') });
    if (!order.cdek_intake_uuid) {
      return res.status(400).json({ error: t(lang, 'cdekIntakeMissing') });
    }
    try {
      await cancelCourierIntake(order.cdek_intake_uuid);
      db.prepare(
        `UPDATE orders SET
          cdek_intake_uuid = NULL,
          cdek_intake_number = NULL,
          cdek_intake_status = 'cancelled',
          updated_at = datetime('now')
         WHERE id = ?`
      ).run(order.id);
      res.json({
        ok: true,
        order: formatOrder(db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id)),
      });
    } catch (err) {
      console.error('[cdek] intake cancel', err);
      res.status(502).json({ error: err.message || t(lang, 'cdekIntakeCancelFailed') });
    }
  });

  api.get('/admin/settings', requireAdmin, (_req, res) => {
    res.json({
      fixed_shipping_rub: Number(getSetting('fixed_shipping_rub', '350')) || 0,
      shipping_note: getSetting('shipping_note', ''),
      cdek_intake_address: getIntakeAddress(),
    });
  });

  api.put('/admin/settings', requireAdmin, (req, res) => {
    if (req.body?.fixed_shipping_rub != null) {
      setSetting('fixed_shipping_rub', Math.max(0, Number(req.body.fixed_shipping_rub) || 0));
    }
    if (req.body?.shipping_note != null) {
      setSetting('shipping_note', String(req.body.shipping_note));
    }
    res.json({
      fixed_shipping_rub: Number(getSetting('fixed_shipping_rub', '350')) || 0,
      shipping_note: getSetting('shipping_note', ''),
    });
  });

  api.post('/admin/products', requireAdmin, (req, res) => {
    upload.single('image')(req, res, (err) => {
      const lang = requestLocale(req);
      if (err) return res.status(400).json({ error: err.message || t(lang, 'uploadError') });
      const title = String(req.body?.title || '').trim();
      const title_en = String(req.body?.title_en || '').trim();
      const description = String(req.body?.description || '').trim();
      const description_en = String(req.body?.description_en || '').trim();
      const price_rub = Math.max(0, Math.round(Number(req.body?.price_rub) || 0));
      const stock = Math.max(0, Math.round(Number(req.body?.stock) || 0));
      const active = req.body?.active === '0' || req.body?.active === false ? 0 : 1;
      if (!title || !price_rub) {
        return res.status(400).json({ error: t(lang, 'titlePriceRequired') });
      }
      const image_path = req.file ? req.file.filename : null;
      const info = db
        .prepare(
          `INSERT INTO products (title, title_en, description, description_en, price_rub, stock, image_path, active)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(title, title_en, description, description_en, price_rub, stock, image_path, active);
      const p = db.prepare('SELECT * FROM products WHERE id = ?').get(info.lastInsertRowid);
      res.status(201).json({ product: productRow(p, 'ru', true) });
    });
  });

  api.put('/admin/products/:id', requireAdmin, (req, res) => {
    upload.single('image')(req, res, (err) => {
      const lang = requestLocale(req);
      if (err) return res.status(400).json({ error: err.message || t(lang, 'uploadError') });
      const p = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
      if (!p) return res.status(404).json({ error: t(lang, 'productNotFound') });
      const title = String(req.body?.title ?? p.title).trim();
      const title_en = String(
        req.body?.title_en != null ? req.body.title_en : p.title_en || ''
      ).trim();
      const description = String(req.body?.description ?? p.description).trim();
      const description_en = String(
        req.body?.description_en != null ? req.body.description_en : p.description_en || ''
      ).trim();
      const price_rub = Math.max(
        0,
        Math.round(Number(req.body?.price_rub != null ? req.body.price_rub : p.price_rub) || 0)
      );
      const stock = Math.max(
        0,
        Math.round(Number(req.body?.stock != null ? req.body.stock : p.stock) || 0)
      );
      let active = p.active;
      if (req.body?.active != null) {
        active = req.body.active === '0' || req.body.active === false || req.body.active === 0 ? 0 : 1;
      }
      let image_path = p.image_path;
      if (req.file) {
        if (p.image_path) {
          const old = path.join(UPLOADS_DIR, path.basename(p.image_path));
          try {
            fs.unlinkSync(old);
          } catch {
            /* ignore */
          }
        }
        image_path = req.file.filename;
      }
      db.prepare(
        `UPDATE products SET title=?, title_en=?, description=?, description_en=?, price_rub=?, stock=?, image_path=?, active=?,
         updated_at=datetime('now') WHERE id=?`
      ).run(title, title_en, description, description_en, price_rub, stock, image_path, active, p.id);
      res.json({
        product: productRow(db.prepare('SELECT * FROM products WHERE id = ?').get(p.id), 'ru', true),
      });
    });
  });

  api.delete('/admin/products/:id', requireAdmin, (req, res) => {
    const p = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
    const lang = requestLocale(req);
    if (!p) return res.status(404).json({ error: t(lang, 'productNotFound') });
    db.prepare('DELETE FROM products WHERE id = ?').run(p.id);
    if (p.image_path) {
      try {
        fs.unlinkSync(path.join(UPLOADS_DIR, path.basename(p.image_path)));
      } catch {
        /* ignore */
      }
    }
    res.json({ ok: true });
  });

  api.get('/gallery', (req, res) => {
    const lang = requestLocale(req);
    const admin = !!req.user?.is_admin;
    const rows = admin
      ? db.prepare('SELECT * FROM gallery_items ORDER BY sort_order ASC, id ASC').all()
      : db
          .prepare(
            'SELECT * FROM gallery_items WHERE active = 1 ORDER BY sort_order ASC, id ASC'
          )
          .all();
    res.json({ items: rows.map((r) => galleryItemRow(r, lang)) });
  });

  api.post('/admin/gallery', requireAdmin, (req, res) => {
    const lang = requestLocale(req);
    galleryUpload.single('file')(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.message || t(lang, 'uploadError') });
      if (!req.file) return res.status(400).json({ error: 'Выберите файл' });
      const isVideo = /^video\//.test(req.file.mimetype);
      const kind = isVideo ? 'video' : 'image';
      const alt = String(req.body?.alt || '').trim();
      const alt_en = String(req.body?.alt_en || '').trim();
      const maxSort =
        db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM gallery_items').get().m || 0;
      const info = db
        .prepare(
          `INSERT INTO gallery_items (kind, source, file_path, alt, alt_en, sort_order, active)
           VALUES (?, 'upload', ?, ?, ?, ?, 1)`
        )
        .run(kind, req.file.filename, alt, alt_en, maxSort + 1);
      const row = db.prepare('SELECT * FROM gallery_items WHERE id = ?').get(info.lastInsertRowid);
      res.json({ item: galleryItemRow(row, 'ru') });
    });
  });

  api.patch('/admin/gallery/:id', requireAdmin, (req, res) => {
    const lang = requestLocale(req);
    const row = db.prepare('SELECT * FROM gallery_items WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Элемент не найден' });
    const alt = req.body?.alt != null ? String(req.body.alt) : row.alt;
    const alt_en = req.body?.alt_en != null ? String(req.body.alt_en) : row.alt_en;
    const active =
      req.body?.active != null ? (req.body.active ? 1 : 0) : row.active ? 1 : 0;
    const sort_order =
      req.body?.sort_order != null
        ? Math.max(0, Number(req.body.sort_order) || 0)
        : row.sort_order;
    db.prepare(
      `UPDATE gallery_items SET alt=?, alt_en=?, active=?, sort_order=? WHERE id=?`
    ).run(alt, alt_en, active, sort_order, row.id);
    res.json({
      item: galleryItemRow(db.prepare('SELECT * FROM gallery_items WHERE id = ?').get(row.id), 'ru'),
    });
  });

  api.delete('/admin/gallery/:id', requireAdmin, (req, res) => {
    const row = db.prepare('SELECT * FROM gallery_items WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Элемент не найден' });
    db.prepare('DELETE FROM gallery_items WHERE id = ?').run(row.id);
    if (row.source === 'upload' && row.file_path) {
      try {
        fs.unlinkSync(path.join(GALLERY_UPLOAD_DIR, path.basename(row.file_path)));
      } catch {
        /* ignore */
      }
    }
    res.json({ ok: true });
  });

  return api;
}

function markOrderPaidFromPayment(payment) {
  const orderId = Number(payment.metadata?.orderId);
  if (!orderId) return;
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) return;
  if (order.payment_status === 'paid') return;
  db.prepare(
    `UPDATE orders SET
      payment_status = 'paid',
      payment_id = ?,
      paid_at = datetime('now'),
      status = CASE WHEN status = 'new' THEN 'confirmed' ELSE status END,
      updated_at = datetime('now')
     WHERE id = ?`
  ).run(payment.id, orderId);
  // async CDEK waybill — не блокируем webhook
  const skipCdek =
    String(order.comment || '').includes('TEST_NO_CDEK') ||
    order.cdek_status === 'skip';
  if (skipCdek) {
    db.prepare(
      `UPDATE orders SET cdek_status = 'skip', updated_at = datetime('now') WHERE id = ?`
    ).run(orderId);
    return;
  }
  setImmediate(() => {
    ensureCdekShipment(orderId).catch((err) => {
      console.error('[cdek] auto create after pay', orderId, err.message || err);
    });
  });
}

async function ensureCdekShipment(orderId) {
  if (!cdekEnabled()) return null;
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) return null;
  if (order.payment_status !== 'paid') {
    const err = new Error('NEED_PAID');
    throw err;
  }
  if (order.cdek_uuid || order.cdek_number) {
    return {
      uuid: order.cdek_uuid,
      number: order.cdek_number,
      already: true,
    };
  }
  if (!order.cdek_city_code) {
    db.prepare(
      `UPDATE orders SET cdek_status = ?, updated_at = datetime('now') WHERE id = ?`
    ).run('missing_city', orderId);
    throw new Error('missing_city');
  }
  const deliveryType = order.cdek_delivery_type === 'door' ? 'door' : 'pvz';
  if (deliveryType === 'pvz' && !order.cdek_pvz_code) {
    db.prepare(
      `UPDATE orders SET cdek_status = ?, updated_at = datetime('now') WHERE id = ?`
    ).run('missing_pvz', orderId);
    throw new Error('missing_pvz');
  }
  if (deliveryType === 'door' && !String(order.customer_address || '').trim()) {
    db.prepare(
      `UPDATE orders SET cdek_status = ?, updated_at = datetime('now') WHERE id = ?`
    ).run('missing_address', orderId);
    throw new Error('missing_address');
  }
  const items = JSON.parse(order.items_json || '[]');
  const recipientName = [order.customer_last_name, order.customer_name, order.customer_patronymic]
    .filter(Boolean)
    .join(' ');
  db.prepare(
    `UPDATE orders SET cdek_status = 'creating', updated_at = datetime('now') WHERE id = ?`
  ).run(orderId);
  try {
    const created = await createCdekOrder({
      orderId: order.id,
      recipientName,
      recipientPhone: order.customer_phone,
      cityCode: order.cdek_city_code,
      pvzCode: order.cdek_pvz_code,
      address: order.customer_address,
      postalCode: order.customer_postal_code,
      items,
      shippingRub: order.shipping_rub,
      comment: order.comment,
      mode: deliveryType,
    });
    db.prepare(
      `UPDATE orders SET
        cdek_uuid = ?,
        cdek_number = ?,
        cdek_tariff_code = COALESCE(?, cdek_tariff_code),
        cdek_status = 'created',
        status = CASE WHEN status IN ('new','confirmed') THEN 'shipped' ELSE status END,
        updated_at = datetime('now')
       WHERE id = ?`
    ).run(created.uuid, created.number, created.tariff_code, orderId);
    return created;
  } catch (err) {
    db.prepare(
      `UPDATE orders SET cdek_status = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(`error:${String(err.message || err).slice(0, 180)}`, orderId);
    throw err;
  }
}

function formatOrder(o, lang = 'ru') {
  let items = JSON.parse(o.items_json || '[]');
  if (lang === 'en') items = localizeOrderItems(items, lang);
  return {
    id: o.id,
    user_id: o.user_id,
    status: o.status,
    payment_status: o.payment_status || 'unpaid',
    payment_id: o.payment_id || null,
    paid_at: o.paid_at || null,
    customer_name: o.customer_name,
    customer_last_name: o.customer_last_name || '',
    customer_patronymic: o.customer_patronymic || '',
    customer_phone: o.customer_phone,
    customer_postal_code: o.customer_postal_code || '',
    customer_address: o.customer_address,
    comment: o.comment,
    items,
    items_total_rub: o.items_total_rub,
    shipping_rub: o.shipping_rub,
    shipping_note: o.shipping_note,
    total_rub: o.total_rub,
    cdek_city_code: o.cdek_city_code || null,
    cdek_pvz_code: o.cdek_pvz_code || null,
    cdek_pvz_address: o.cdek_pvz_address || '',
    cdek_delivery_type: o.cdek_delivery_type === 'door' ? 'door' : 'pvz',
    cdek_uuid: o.cdek_uuid || null,
    cdek_number: o.cdek_number || null,
    cdek_status: o.cdek_status || '',
    cdek_tariff_code: o.cdek_tariff_code || null,
    cdek_intake_uuid: o.cdek_intake_uuid || null,
    cdek_intake_number: o.cdek_intake_number || null,
    cdek_intake_status: o.cdek_intake_status || '',
    cdek_intake_date: o.cdek_intake_date || '',
    cdek_intake_time_from: o.cdek_intake_time_from || '',
    cdek_intake_time_to: o.cdek_intake_time_to || '',
    created_at: o.created_at,
    updated_at: o.updated_at,
  };
}
