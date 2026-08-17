/**
 * Клиент ЮKassa API v3 (fetch).
 * @see https://yookassa.ru/developers/api
 */
import { randomUUID } from 'node:crypto';

const API_URL = 'https://api.yookassa.ru/v3/';

export class YooKassaError extends Error {
  constructor(error) {
    super(error?.description || error?.message || 'YooKassa error');
    this.name = 'YooKassaError';
    this.id = error?.id;
    this.code = error?.code;
    this.parameter = error?.parameter;
  }
}

export class YooKassa {
  constructor({ shopId, secretKey }) {
    this.shopId = shopId;
    this.secretKey = secretKey;
  }

  createPayment(payload, idempotenceKey) {
    return this.#request('POST', 'payments', payload, idempotenceKey);
  }

  getPayment(paymentId) {
    return this.#request('GET', `payments/${paymentId}`);
  }

  async #request(method, path, payload, idempotenceKey) {
    const key = idempotenceKey || randomUUID();
    const auth = Buffer.from(`${this.shopId}:${this.secretKey}`).toString('base64');
    const res = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        Authorization: `Basic ${auth}`,
        'Idempotence-Key': key,
        'Content-Type': 'application/json',
      },
      body: method === 'GET' ? undefined : JSON.stringify(payload ?? {}),
    });

    const data = await res.json().catch(() => ({}));
    if (res.status === 202) {
      const delay = Number(data?.retry_after) || 1000;
      await new Promise((r) => setTimeout(r, delay));
      return this.#request(method, path, payload, key);
    }
    if (!res.ok) throw new YooKassaError(data);
    return data;
  }
}

export function paymentsEnabled() {
  return Boolean(process.env.YOOKASSA_SHOP_ID && process.env.YOOKASSA_SECRET_KEY);
}

export function getPaymentsClient() {
  if (!paymentsEnabled()) return null;
  return new YooKassa({
    shopId: process.env.YOOKASSA_SHOP_ID,
    secretKey: process.env.YOOKASSA_SECRET_KEY,
  });
}

export function paymentReturnUrl(locale = 'ru') {
  if (process.env.YOOKASSA_RETURN_URL && locale !== 'en') {
    return process.env.YOOKASSA_RETURN_URL;
  }
  const base = (process.env.PUBLIC_BASE_URL || 'https://dev.vrnhoney.ru').replace(/\/$/, '');
  const path = locale === 'en' ? '/en/account.html' : '/account.html';
  return `${base}${path}?payment=return`;
}

export function formatAmountRub(n) {
  return Number(n || 0).toFixed(2);
}
