import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const UPLOADS_DIR = path.join(ROOT, 'uploads');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const dbPath = path.join(DATA_DIR, 'shop.sqlite');
export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  title_en TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  description_en TEXT NOT NULL DEFAULT '',
  price_rub INTEGER NOT NULL,
  stock INTEGER NOT NULL DEFAULT 0,
  image_path TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'new',
  customer_name TEXT NOT NULL,
  customer_last_name TEXT NOT NULL DEFAULT '',
  customer_patronymic TEXT NOT NULL DEFAULT '',
  customer_phone TEXT NOT NULL,
  customer_postal_code TEXT NOT NULL DEFAULT '',
  customer_address TEXT NOT NULL,
  comment TEXT NOT NULL DEFAULT '',
  items_json TEXT NOT NULL,
  items_total_rub INTEGER NOT NULL,
  shipping_rub INTEGER NOT NULL DEFAULT 0,
  shipping_note TEXT NOT NULL DEFAULT '',
  total_rub INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

export function getSetting(key, fallback = '') {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function setSetting(key, value) {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, String(value));
}

export function ensureAdminFromEnv(env) {
  const email = (env.ADMIN_EMAIL || 'admin@vrnhoney.ru').trim().toLowerCase();
  const password = env.ADMIN_PASSWORD || 'change-me';
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  const hash = bcrypt.hashSync(password, 10);
  if (existing) {
    db.prepare('UPDATE users SET password_hash = ?, is_admin = 1 WHERE id = ?').run(hash, existing.id);
    return existing.id;
  }
  const info = db
    .prepare(
      `INSERT INTO users (email, password_hash, name, is_admin)
       VALUES (?, ?, ?, 1)`
    )
    .run(email, hash, 'Админ');
  return info.lastInsertRowid;
}

export function ensureDefaultSettings(env) {
  // опциональные настройки — пока не используем фикс доставки
  void env;
}

/** Стартовый ассортимент как на лендинге — если витрина пустая */
export function ensureSeedProducts() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM products').get().c;
  if (count > 0) return;
  const seed = [
    {
      title: 'Цветочный мёд, 1 л',
      title_en: 'Flower honey, 1 L',
      description:
        'Светлый, нежный мёд из разнотравья. Обладает мягким вкусом и богатым составом полезных веществ.\nОбъём: 1 л.',
      description_en:
        'Light, delicate wildflower honey with a mild taste and a rich nutrient profile.\nVolume: 1 L.',
      price_rub: 900,
      stock: 100,
    },
    {
      title: 'Цветочный мёд, 2 л',
      title_en: 'Flower honey, 2 L',
      description:
        'Светлый, нежный мёд из разнотравья. Обладает мягким вкусом и богатым составом полезных веществ.\nОбъём: 2 л.',
      description_en:
        'Light, delicate wildflower honey with a mild taste and a rich nutrient profile.\nVolume: 2 L.',
      price_rub: 1800,
      stock: 50,
    },
    {
      title: 'Цветочный мёд, 3 л',
      title_en: 'Flower honey, 3 L',
      description:
        'Светлый, нежный мёд из разнотравья. Обладает мягким вкусом и богатым составом полезных веществ.\nОбъём: 3 л.',
      description_en:
        'Light, delicate wildflower honey with a mild taste and a rich nutrient profile.\nVolume: 3 L.',
      price_rub: 2700,
      stock: 50,
    },
  ];
  const ins = db.prepare(
    `INSERT INTO products (title, title_en, description, description_en, price_rub, stock, active)
     VALUES (?, ?, ?, ?, ?, ?, 1)`
  );
  for (const p of seed) {
    ins.run(p.title, p.title_en, p.description, p.description_en, p.price_rub, p.stock);
  }
}

/** EN-поля товаров на уже существующей БД */
export function migrateProductsEnFields() {
  const cols = db.prepare('PRAGMA table_info(products)').all().map((c) => c.name);
  if (!cols.includes('title_en')) {
    db.exec(`ALTER TABLE products ADD COLUMN title_en TEXT NOT NULL DEFAULT ''`);
  }
  if (!cols.includes('description_en')) {
    db.exec(`ALTER TABLE products ADD COLUMN description_en TEXT NOT NULL DEFAULT ''`);
  }
  // заполнить EN для известного seed-товара, если пусто
  db.prepare(
    `UPDATE products SET
       title_en = CASE WHEN title_en = '' OR title_en IS NULL THEN 'Flower honey, 1 L' ELSE title_en END,
       description_en = CASE
         WHEN description_en = '' OR description_en IS NULL THEN
           'Light, delicate wildflower honey with a mild taste and a rich nutrient profile.\nVolume: 1 L.'
         ELSE description_en END
     WHERE title LIKE 'Цветочный мёд%'`
  ).run();
}

/** Колонки для доставки на уже существующей БД */
export function migrateOrdersDeliveryFields() {
  const cols = db.prepare('PRAGMA table_info(orders)').all().map((c) => c.name);
  const add = (name, ddl) => {
    if (!cols.includes(name)) db.exec(`ALTER TABLE orders ADD COLUMN ${ddl}`);
  };
  add('customer_last_name', "customer_last_name TEXT NOT NULL DEFAULT ''");
  add('customer_patronymic', "customer_patronymic TEXT NOT NULL DEFAULT ''");
  add('customer_postal_code', "customer_postal_code TEXT NOT NULL DEFAULT ''");
  add('payment_status', "payment_status TEXT NOT NULL DEFAULT 'unpaid'");
  add('payment_id', 'payment_id TEXT');
  add('paid_at', 'paid_at TEXT');
  add('cdek_city_code', 'cdek_city_code INTEGER');
  add('cdek_pvz_code', 'cdek_pvz_code TEXT');
  add('cdek_pvz_address', "cdek_pvz_address TEXT NOT NULL DEFAULT ''");
  add('cdek_uuid', 'cdek_uuid TEXT');
  add('cdek_number', 'cdek_number TEXT');
  add('cdek_status', "cdek_status TEXT NOT NULL DEFAULT ''");
  add('cdek_tariff_code', 'cdek_tariff_code INTEGER');
  add('cdek_delivery_type', "cdek_delivery_type TEXT NOT NULL DEFAULT 'pvz'");
  add('cdek_intake_uuid', 'cdek_intake_uuid TEXT');
  add('cdek_intake_number', 'cdek_intake_number TEXT');
  add('cdek_intake_status', "cdek_intake_status TEXT NOT NULL DEFAULT ''");
  add('cdek_intake_date', "cdek_intake_date TEXT NOT NULL DEFAULT ''");
  add('cdek_intake_time_from', "cdek_intake_time_from TEXT NOT NULL DEFAULT ''");
  add('cdek_intake_time_to', "cdek_intake_time_to TEXT NOT NULL DEFAULT ''");
}

/** Галерея: фото/видео из админки */
export function migratePasswordResets() {
  db.exec(`
CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id);
CREATE INDEX IF NOT EXISTS idx_password_resets_exp ON password_resets(expires_at);
`);
}

export function ensureGalleryTable() {
  db.exec(`
CREATE TABLE IF NOT EXISTS gallery_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL DEFAULT 'image',
  source TEXT NOT NULL DEFAULT 'upload',
  file_path TEXT NOT NULL,
  alt TEXT NOT NULL DEFAULT '',
  alt_en TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);
}

/** Если галерея пуста — подтянуть существующие JPG из public/images/g */
export function ensureSeedGallery() {
  ensureGalleryTable();
  const count = db.prepare('SELECT COUNT(*) AS c FROM gallery_items').get().c;
  if (count > 0) return;

  const gDir = path.join(ROOT, 'public', 'images', 'g');
  if (!fs.existsSync(gDir)) return;
  const files = fs
    .readdirSync(gDir)
    .filter((f) => /\.jpe?g$/i.test(f))
    .sort((a, b) => {
      const na = parseInt(a, 10) || 0;
      const nb = parseInt(b, 10) || 0;
      return na - nb || a.localeCompare(b);
    });

  const ins = db.prepare(
    `INSERT INTO gallery_items (kind, source, file_path, alt, alt_en, sort_order, active)
     VALUES ('image', 'static', ?, ?, ?, ?, 1)`
  );
  const tx = db.transaction(() => {
    files.forEach((f, i) => {
      const n = parseInt(f, 10) || i + 1;
      ins.run(
        `g/${f}`,
        `Пасека и мёд VRNHoney — фото ${n}`,
        `VRNHoney apiary and honey — photo ${n}`,
        i + 1
      );
    });
  });
  tx();
}

export { ROOT, UPLOADS_DIR, DATA_DIR };
