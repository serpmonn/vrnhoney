/**
 * CDEK API v2 client for VRNHoney shop (PVZ delivery, recipient pays shipping).
 */

let tokenCache = { accessToken: null, expiresAt: 0 };

function cfg() {
  return {
    account: String(process.env.CDEK_ACCOUNT || '').trim(),
    password: String(process.env.CDEK_SECURE_PASSWORD || '').trim(),
    apiUrl: String(process.env.CDEK_API_URL || 'https://api.cdek.ru/v2').replace(/\/$/, ''),
    fromCityCode: Number(process.env.CDEK_FROM_CITY_CODE || 506) || 506,
    fromAddress: String(process.env.CDEK_FROM_ADDRESS || '').trim(),
    intakeAddress: String(
      process.env.CDEK_INTAKE_ADDRESS ||
        process.env.CDEK_FROM_ADDRESS ||
        'Россия, Воронежская обл., г. Семилуки, ул. Башкирцева, д. 4'
    ).trim(),
    senderName: String(process.env.CDEK_SENDER_NAME || 'Попов Сергей Юрьевич').trim(),
    senderPhone: String(process.env.CDEK_SENDER_PHONE || '+79518675405').trim(),
    tariffCode: Number(process.env.CDEK_TARIFF_CODE || 136) || 136,
    tariffCodeDoor: Number(process.env.CDEK_TARIFF_CODE_DOOR || 137) || 137,
  };
}

export function cdekEnabled() {
  const c = cfg();
  return Boolean(c.account && c.password);
}

async function getToken() {
  const c = cfg();
  if (!c.account || !c.password) throw new Error('CDEK credentials missing');
  const now = Date.now();
  if (tokenCache.accessToken && tokenCache.expiresAt > now + 30_000) {
    return tokenCache.accessToken;
  }
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: c.account,
    client_secret: c.password,
  });
  const res = await fetch(`${c.apiUrl}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || data.message || `CDEK OAuth ${res.status}`);
  }
  const expiresIn = Number(data.expires_in) || 3600;
  tokenCache = {
    accessToken: data.access_token,
    expiresAt: now + expiresIn * 1000,
  };
  return tokenCache.accessToken;
}

export async function getCdekAccessToken() {
  return getToken();
}

async function cdekFetch(path, { method = 'GET', query, body, okStatuses } = {}) {
  const c = cfg();
  const token = await getToken();
  const url = new URL(c.apiUrl + path);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v == null || v === '') continue;
      url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  const allowed = okStatuses || [200, 201, 202];
  if (!allowed.includes(res.status) && !res.ok) {
    const msg =
      data?.requests?.[0]?.errors?.[0]?.message ||
      data?.error ||
      data?.message ||
      `CDEK ${res.status}`;
    const err = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    err.status = res.status;
    err.payload = data;
    throw err;
  }
  return data;
}

/** litres from product title/price fallback */
export function litersFromProduct(p) {
  const title = String(p?.title || '');
  const m = title.match(/(\d+(?:[.,]\d+)?)\s*л/i);
  if (m) return Math.max(0.5, Number(String(m[1]).replace(',', '.')) || 1);
  const price = Number(p?.price_rub) || 0;
  if (price >= 2500) return 3;
  if (price >= 1500) return 2;
  return 1;
}

/** CDEK package: weight grams, dims cm */
export function packageFromItems(items) {
  let liters = 0;
  for (const it of items || []) {
    const qty = Math.max(1, Number(it.qty) || 1);
    liters += litersFromProduct(it) * qty;
  }
  if (liters <= 0) liters = 1;
  // мёд ~1.4 кг/л + упаковка
  const weight = Math.max(500, Math.round(liters * 1400 + 200));
  let length = 20;
  let width = 15;
  let height = 20;
  if (liters >= 2.5) {
    length = 30;
    width = 20;
    height = 28;
  } else if (liters >= 1.5) {
    length = 25;
    width = 18;
    height = 24;
  }
  return { weight, length, width, height, liters };
}

export async function searchCities(q, size = 15) {
  const query = String(q || '').trim();
  if (query.length < 2) return [];
  const rows = await cdekFetch('/location/cities', {
    query: { city: query, country_codes: 'RU', size },
  });
  const list = Array.isArray(rows) ? rows : [];
  return list.map((c) => ({
    code: c.code,
    city: c.city,
    region: c.region || c.region_code || '',
    country_code: c.country_code || 'RU',
  }));
}

export async function listPvz(cityCode, size = 100) {
  const code = Number(cityCode);
  if (!code) return [];
  const rows = await cdekFetch('/deliverypoints', {
    query: { city_code: code, type: 'PVZ', size },
  });
  const list = Array.isArray(rows) ? rows : [];
  return list.map((p) => {
    const loc = p.location || {};
    return {
      code: p.code,
      name: p.name || p.code,
      address: loc.address || loc.address_full || '',
      address_full: loc.address_full || loc.address || '',
      postal_code: loc.postal_code || '',
      city: loc.city || '',
      city_code: loc.city_code || code,
      work_time: p.work_time || '',
      type: p.type || 'PVZ',
    };
  });
}

export async function calcDelivery({ cityCode, items, mode = 'pvz' }) {
  const c = cfg();
  const deliveryMode = mode === 'door' ? 'door' : 'pvz';
  const pkg = packageFromItems(items);
  const data = await cdekFetch('/calculator/tarifflist', {
    method: 'POST',
    body: {
      type: 1,
      from_location: { code: c.fromCityCode },
      to_location: { code: Number(cityCode) },
      packages: [
        {
          weight: pkg.weight,
          length: pkg.length,
          width: pkg.width,
          height: pkg.height,
        },
      ],
    },
  });
  const tariffs = Array.isArray(data?.tariff_codes) ? data.tariff_codes : [];
  const preferredCode = deliveryMode === 'door' ? c.tariffCodeDoor : c.tariffCode;
  const matched = tariffs.filter((t) => {
    const n = String(t.tariff_name || '').toLowerCase();
    if (deliveryMode === 'door') {
      return n.includes('склад-дверь') || n.includes('склад - дверь');
    }
    return n.includes('склад-склад') || n.includes('склад-постамат') || n.includes('склад - склад');
  });
  let chosen =
    matched.find((t) => Number(t.tariff_code) === preferredCode) ||
    matched.sort((a, b) => Number(a.delivery_sum) - Number(b.delivery_sum))[0] ||
    tariffs.find((t) => Number(t.tariff_code) === preferredCode) ||
    null;
  if (!chosen && tariffs.length) {
    chosen = [...tariffs].sort((a, b) => Number(a.delivery_sum) - Number(b.delivery_sum))[0];
  }
  if (!chosen) throw new Error('Нет доступных тарифов СДЭК для этого направления');
  return {
    shipping_rub: Math.round(Number(chosen.delivery_sum) || 0),
    tariff_code: Number(chosen.tariff_code),
    tariff_name: chosen.tariff_name || '',
    period_min: chosen.period_min ?? null,
    period_max: chosen.period_max ?? null,
    package: pkg,
    mode: deliveryMode,
  };
}

function normalizePhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('8')) return `+7${digits.slice(1)}`;
  if (digits.length === 11 && digits.startsWith('7')) return `+${digits}`;
  if (digits.length === 10) return `+7${digits}`;
  return String(phone || '').trim();
}

/**
 * Create CDEK IM order.
 * mode=pvz → delivery_point only; mode=door → to_location.address only.
 * Recipient pays delivery via delivery_recipient_cost. No COD for goods.
 */
export async function createCdekOrder({
  orderId,
  recipientName,
  recipientPhone,
  cityCode,
  pvzCode,
  address,
  postalCode,
  items,
  shippingRub,
  comment,
  mode = 'pvz',
}) {
  const c = cfg();
  const deliveryMode = mode === 'door' ? 'door' : 'pvz';
  const pkg = packageFromItems(items);
  const calc = await calcDelivery({ cityCode, items, mode: deliveryMode });
  const tariffCode = calc.tariff_code || (deliveryMode === 'door' ? c.tariffCodeDoor : c.tariffCode);
  const deliveryCost = Math.max(0, Number(shippingRub != null ? shippingRub : calc.shipping_rub) || 0);

  const body = {
    type: 1,
    number: `VRN-${orderId}`,
    tariff_code: tariffCode,
    comment: String(comment || `VRNHoney заказ #${orderId}`).slice(0, 255),
    sender: {
      name: c.senderName,
      phones: [{ number: normalizePhone(c.senderPhone) }],
    },
    recipient: {
      name: String(recipientName || '').trim(),
      phones: [{ number: normalizePhone(recipientPhone) }],
    },
    from_location: {
      code: c.fromCityCode,
      ...(c.fromAddress ? { address: c.fromAddress } : {}),
    },
    packages: [
      {
        number: '1',
        weight: pkg.weight,
        length: pkg.length,
        width: pkg.width,
        height: pkg.height,
        items: (items || []).map((it, idx) => ({
          name: String(it.title || `Товар ${idx + 1}`).slice(0, 255),
          ware_key: String(it.product_id || idx + 1),
          payment: { value: 0 },
          cost: Number(it.price_rub) || 0,
          weight: Math.max(
            100,
            Math.round((pkg.weight / Math.max(1, (items || []).reduce((s, x) => s + (x.qty || 1), 0))) * (it.qty || 1))
          ),
          amount: Math.max(1, Number(it.qty) || 1),
        })),
      },
    ],
    delivery_recipient_cost: {
      value: deliveryCost,
    },
  };

  if (deliveryMode === 'door') {
    const street = String(address || '').trim();
    if (!street) throw new Error('Укажите адрес доставки');
    body.to_location = {
      code: Number(cityCode),
      address: street,
      ...(postalCode ? { postal_code: String(postalCode) } : {}),
    };
  } else {
    if (!pvzCode) throw new Error('Укажите пункт выдачи СДЭК');
    body.delivery_point = String(pvzCode);
  }

  const data = await cdekFetch('/orders', { method: 'POST', body });
  const entity = data?.entity || {};
  const uuid = entity.uuid || data?.uuid || null;
  let number = entity.cdek_number || entity.number || null;

  if (uuid && !number) {
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 800));
      try {
        const info = await cdekFetch(`/orders/${uuid}`);
        const e = info?.entity || {};
        number = e.cdek_number || e.number || null;
        if (number) break;
      } catch {
        /* ignore */
      }
    }
  }

  return {
    uuid,
    number: number ? String(number) : null,
    tariff_code: tariffCode,
    shipping_rub: deliveryCost,
    mode: deliveryMode,
    raw: data,
  };
}

/** @deprecated use createCdekOrder */
export async function createPvzOrder(opts) {
  return createCdekOrder({ ...opts, mode: 'pvz' });
}

async function waitPrintUrl(createPath, getPath, body) {
  const created = await cdekFetch(createPath, { method: 'POST', body });
  let url = created?.entity?.url || null;
  const printUuid = created?.entity?.uuid || null;
  if (url) return { url, uuid: printUuid };
  if (!printUuid) {
    const msg =
      created?.requests?.[0]?.errors?.[0]?.message ||
      'Не удалось создать печатную форму СДЭК';
    throw new Error(msg);
  }
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 700));
    const info = await cdekFetch(`${getPath}/${printUuid}`);
    url = info?.entity?.url || null;
    if (url) return { url, uuid: printUuid };
    const st = String(info?.entity?.statuses?.[0]?.code || '').toUpperCase();
    if (st === 'INVALID' || st === 'REMOVED' || st === 'FAILED') {
      throw new Error(info?.entity?.statuses?.[0]?.name || 'Печатная форма СДЭК недоступна');
    }
  }
  throw new Error('Печатная форма СДЭК ещё не готова, попробуйте снова');
}

/** Штрихкод / наклейка на посылку */
export async function getBarcodePrintUrl(orderUuid, { format = 'A6', copyCount = 1 } = {}) {
  if (!orderUuid) throw new Error('Нет UUID заказа СДЭК');
  return waitPrintUrl('/print/barcodes', '/print/barcodes', {
    orders: [{ order_uuid: String(orderUuid) }],
    copy_count: copyCount,
    format,
  });
}

/** Квитанция / накладная к заказу */
export async function getWaybillPrintUrl(orderUuid, { copyCount = 2 } = {}) {
  if (!orderUuid) throw new Error('Нет UUID заказа СДЭК');
  return waitPrintUrl('/print/orders', '/print/orders', {
    orders: [{ order_uuid: String(orderUuid) }],
    copy_count: copyCount,
    type: 'tpl_russia',
  });
}

function moscowDateOffset(days = 0) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = fmt.formatToParts(new Date());
  const y = Number(parts.find((p) => p.type === 'year').value);
  const m = Number(parts.find((p) => p.type === 'month').value);
  const d = Number(parts.find((p) => p.type === 'day').value);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function todayMoscowDate() {
  return moscowDateOffset(0);
}

function tomorrowMoscowDate() {
  return moscowDateOffset(1);
}

/**
 * Тело заявки на забор (без отправки в СДЭК) — для проверки.
 */
export function buildCourierIntakePayload({
  orderUuid,
  cdekNumber,
  items,
  intakeDate,
  intakeTimeFrom = '12:00',
  intakeTimeTo = '18:00',
  comment,
  needCall = true,
}) {
  const c = cfg();
  if (!orderUuid && !cdekNumber) throw new Error('Нужен UUID или номер накладной СДЭК');
  if (!c.intakeAddress) throw new Error('Не задан адрес забора CDEK_INTAKE_ADDRESS');

  const date = String(intakeDate || todayMoscowDate());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Дата забора: ГГГГ-ММ-ДД');
  const timeFrom = String(intakeTimeFrom || '12:00').slice(0, 5);
  const timeTo = String(intakeTimeTo || '18:00').slice(0, 5);
  const pkg = packageFromItems(items);

  const body = {
    intake_date: date,
    intake_time_from: timeFrom,
    intake_time_to: timeTo,
    name: 'Мёд VRNHoney',
    weight: pkg.weight,
    length: pkg.length,
    width: pkg.width,
    height: pkg.height,
    comment: String(comment || 'Забор отправления VRNHoney').slice(0, 255),
    need_call: needCall !== false,
    sender: {
      name: c.senderName,
      phones: [{ number: normalizePhone(c.senderPhone) }],
    },
    from_location: {
      code: c.fromCityCode,
      address: c.intakeAddress,
    },
  };
  if (orderUuid) body.order_uuid = String(orderUuid);
  if (cdekNumber) {
    const num = Number(String(cdekNumber).replace(/\D/g, ''));
    if (num) body.cdek_number = num;
  }
  return body;
}

/**
 * Заявка на вызов курьера забора (intake) к уже созданной накладной.
 */
export async function createCourierIntake(opts) {
  const body = buildCourierIntakePayload(opts);
  const data = await cdekFetch('/intakes', { method: 'POST', body });
  const entity = data?.entity || {};
  let uuid = entity.uuid || null;
  let number = entity.intake_number || entity.number || null;

  if (uuid && !number) {
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 700));
      try {
        const info = await cdekFetch(`/intakes/${uuid}`);
        const e = info?.entity || {};
        number = e.intake_number || e.number || null;
        if (number || (e.statuses && e.statuses.length)) break;
      } catch {
        /* ignore */
      }
    }
  }

  const reqErr = data?.requests?.[0]?.errors?.[0]?.message;
  if (!uuid && reqErr) throw new Error(reqErr);

  return {
    uuid,
    number: number ? String(number) : null,
    intake_date: body.intake_date,
    intake_time_from: body.intake_time_from,
    intake_time_to: body.intake_time_to,
    raw: data,
  };
}

export async function cancelCourierIntake(intakeUuid) {
  if (!intakeUuid) throw new Error('Нет UUID заявки на забор');
  await cdekFetch(`/intakes/${intakeUuid}`, { method: 'DELETE' });
  return { ok: true };
}

/** Отмена накладной СДЭК (заказ IM). */
export async function cancelCdekOrder(orderUuid) {
  if (!orderUuid) throw new Error('Нет UUID заказа СДЭК');
  await cdekFetch(`/orders/${orderUuid}`, { method: 'DELETE' });
  return { ok: true };
}

export function defaultIntakeDate() {
  return todayMoscowDate();
}

export function defaultIntakeTimeFrom() {
  return '12:00';
}

export function defaultIntakeTimeTo() {
  return '18:00';
}

export function getIntakeAddress() {
  return cfg().intakeAddress;
}
