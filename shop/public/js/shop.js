const cartKey = 'vh_cart_v1';
const YM_ID = 108970969;
const paidGoalKey = 'vh_payment_success_ids';

export function ensureMetrika() {
  if (typeof window === 'undefined' || window.__vhYmInit) return;
  window.__vhYmInit = true;
  const m = window;
  const e = document;
  m.ym =
    m.ym ||
    function () {
      (m.ym.a = m.ym.a || []).push(arguments);
    };
  m.ym.l = 1 * new Date();
  const src = 'https://mc.yandex.ru/metrika/tag.js';
  if (![...e.scripts].some((s) => s.src === src)) {
    const k = e.createElement('script');
    k.async = 1;
    k.src = src;
    const a = e.getElementsByTagName('script')[0];
    if (a && a.parentNode) a.parentNode.insertBefore(k, a);
    else e.head.appendChild(k);
  }
  m.ym(YM_ID, 'init', {
    clickmap: true,
    trackLinks: true,
    accurateTrackBounce: true,
    webvisor: true,
  });
}

export function ymReach(goal, params) {
  ensureMetrika();
  try {
    if (typeof window.ym === 'function') {
      if (params) window.ym(YM_ID, 'reachGoal', goal, params);
      else window.ym(YM_ID, 'reachGoal', goal);
    }
  } catch (_) {}
}

/** Цель Директа: успешная оплата (заказ уже paid), один раз на заказ. */
export function trackPaidOrders(orders) {
  const list = Array.isArray(orders) ? orders : [];
  let done = [];
  try {
    done = JSON.parse(localStorage.getItem(paidGoalKey) || '[]');
  } catch {
    done = [];
  }
  const seen = new Set(done.map(Number).filter(Number.isFinite));
  let changed = false;
  for (const o of list) {
    const id = Number(o?.id);
    if (!id || o.payment_status !== 'paid' || seen.has(id)) continue;
    seen.add(id);
    changed = true;
    ymReach('payment_success', {
      order_price: Number(o.total_rub) || 0,
      currency: 'RUB',
    });
  }
  if (changed) localStorage.setItem(paidGoalKey, JSON.stringify([...seen]));
}

export async function watchPaymentSuccess(initialOrders) {
  trackPaidOrders(initialOrders);
  const returning = new URLSearchParams(location.search).get('payment') === 'return';
  if (!returning) return;
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 2500));
    try {
      const { orders } = await api('/orders/mine');
      trackPaidOrders(orders);
      if ((orders || []).some((o) => o.payment_status === 'paid')) return;
    } catch {
      /* ignore */
    }
  }
}

ensureMetrika();

export function shopLocale() {
  return location.pathname === '/en' || location.pathname.startsWith('/en/') ? 'en' : 'ru';
}

export function shopHome() {
  return shopLocale() === 'en' ? '/en/' : '/';
}

export function shopPath(file) {
  // file: 'cart.html' | 'login.html' | 'account.html' | 'offer.html'
  return shopLocale() === 'en' ? `/en/${file}` : `/${file}`;
}

const I18N = {
  ru: {
    error: 'Ошибка',
    logout: 'Выйти',
    account: 'Кабинет',
    login: 'Войти',
    addToCart: 'В корзину',
    added: 'Добавлено',
    out: 'Нет',
    pcs: 'шт.',
    honey: 'мёд',
    emptyCatalog: 'Пока нет товаров в витрине.',
    less: 'Меньше',
    more: 'Больше',
    qty: 'Количество',
  },
  en: {
    error: 'Error',
    logout: 'Log out',
    account: 'Account',
    login: 'Sign in',
    addToCart: 'Add to cart',
    added: 'Added',
    out: 'Out',
    pcs: 'pcs',
    honey: 'honey',
    emptyCatalog: 'No products in the storefront yet.',
    less: 'Less',
    more: 'More',
    qty: 'Quantity',
  },
};

export function tt(key) {
  const lang = shopLocale();
  return I18N[lang][key] || I18N.ru[key] || key;
}

export function money(n) {
  const lang = shopLocale() === 'en' ? 'en-US' : 'ru-RU';
  return new Intl.NumberFormat(lang).format(Number(n) || 0) + ' ₽';
}

export function getCart() {
  try {
    return JSON.parse(localStorage.getItem(cartKey) || '[]');
  } catch {
    return [];
  }
}

export function setCart(items) {
  localStorage.setItem(cartKey, JSON.stringify(items));
  window.dispatchEvent(new Event('cart-change'));
}

export function cartCount() {
  return getCart().reduce((s, i) => s + (i.qty || 0), 0);
}

export function addToCart(productId, qty = 1) {
  const items = getCart();
  const found = items.find((i) => i.product_id === productId);
  if (found) found.qty = Math.min(99, found.qty + qty);
  else items.push({ product_id: productId, qty });
  setCart(items);
}

export async function api(path, opts = {}) {
  const lang = shopLocale();
  const headers = {
    'X-Shop-Locale': lang,
    ...(opts.headers || {}),
  };
  if (!(opts.body instanceof FormData)) {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
  }
  const sep = path.includes('?') ? '&' : '?';
  const url = '/api' + path + sep + 'lang=' + encodeURIComponent(lang);
  const res = await fetch(url, {
    credentials: 'same-origin',
    ...opts,
    headers: opts.body instanceof FormData
      ? { 'X-Shop-Locale': lang, ...(opts.headers || {}) }
      : headers,
    body: opts.body instanceof FormData || opts.body == null ? opts.body : JSON.stringify(opts.body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText || tt('error'));
  return data;
}

export async function refreshNav() {
  document.querySelectorAll('[data-cart-count]').forEach((el) => {
    el.textContent = String(cartCount());
  });
  const loginLinks = document.querySelectorAll('[data-shop-login]');
  const accountLinks = document.querySelectorAll('[data-shop-account]');
  try {
    const { user } = await api('/me');
    if (user) {
      loginLinks.forEach((a) => {
        a.hidden = false;
        a.textContent = tt('logout');
        a.href = '#logout';
        a.onclick = async (e) => {
          e.preventDefault();
          await api('/auth/logout', { method: 'POST', body: {} });
          location.href = shopHome();
        };
      });
      accountLinks.forEach((a) => {
        a.hidden = false;
        a.textContent = tt('account');
        a.href = user.is_admin ? '/admin/' : shopPath('account.html');
      });
    } else {
      loginLinks.forEach((a) => {
        a.hidden = false;
        a.textContent = tt('login');
        a.href = shopPath('login.html');
        a.onclick = null;
      });
      accountLinks.forEach((a) => {
        a.hidden = true;
      });
    }
    return user;
  } catch {
    loginLinks.forEach((a) => {
      a.hidden = false;
      a.textContent = tt('login');
      a.href = shopPath('login.html');
      a.onclick = null;
    });
    accountLinks.forEach((a) => {
      a.hidden = true;
    });
    return null;
  }
}

window.addEventListener('cart-change', () => {
  document.querySelectorAll('[data-cart-count]').forEach((el) => {
    el.textContent = String(cartCount());
  });
});

if (document.querySelector('[data-shop-account], [data-shop-login], [data-cart-count]')) {
  refreshNav();
}

/** Кнопка показать/скрыть пароль рядом с input[type=password] */
export function bindPasswordToggles(root = document) {
  const showLabel = shopLocale() === 'en' ? 'Show' : 'Показать';
  const hideLabel = shopLocale() === 'en' ? 'Hide' : 'Скрыть';
  const showAria = shopLocale() === 'en' ? 'Show password' : 'Показать пароль';
  const hideAria = shopLocale() === 'en' ? 'Hide password' : 'Скрыть пароль';
  root.querySelectorAll('.password-field').forEach((wrap) => {
    const input = wrap.querySelector('input');
    const btn = wrap.querySelector('.password-field__toggle');
    if (!input || !btn || btn.dataset.bound) return;
    btn.dataset.bound = '1';
    const sync = () => {
      const shown = input.type === 'text';
      btn.classList.toggle('is-shown', shown);
      btn.setAttribute('aria-pressed', shown ? 'true' : 'false');
      btn.setAttribute('aria-label', shown ? hideAria : showAria);
      btn.title = shown ? hideAria : showAria;
      const showEl = btn.querySelector('.password-field__label-show');
      const hideEl = btn.querySelector('.password-field__label-hide');
      if (showEl) showEl.textContent = showLabel;
      if (hideEl) hideEl.textContent = hideLabel;
    };
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      input.type = input.type === 'password' ? 'text' : 'password';
      sync();
      input.focus({ preventScroll: true });
    });
    sync();
  });
}
