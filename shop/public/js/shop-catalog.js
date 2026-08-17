import { api, money, refreshNav, addToCart, tt } from '/js/shop.js?v=8';

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function splitDescription(raw) {
  const text = String(raw || '').trim();
  const weightMatch = text.match(/(?:Вес|Weight):\s*(.+)$/im);
  const weight = weightMatch ? weightMatch[1].trim() : '';
  const body = weightMatch
    ? text.replace(/\n?\s*(?:Вес|Weight):\s*.+$/im, '').trim()
    : text;
  return { body, weight };
}

async function renderCatalog() {
  const root = document.getElementById('shop-catalog');
  if (!root) return;
  try {
    await refreshNav();
    const { products } = await api('/products');
    if (!products.length) {
      root.innerHTML = `<p class="shop-catalog__empty">${esc(tt('emptyCatalog'))}</p>`;
      return;
    }
    root.innerHTML = products
      .map((p) => {
        const { body, weight } = splitDescription(p.description);
        const inStock = p.stock > 0;
        return `
      <article class="product shop-card" data-id="${p.id}">
        <div class="shop-card__media">
          ${
            p.image_url
              ? `<img src="${esc(p.image_url)}" alt="${esc(p.title)}" loading="lazy">`
              : `<div class="shop-card__placeholder" aria-hidden="true"><span>${esc(tt('honey'))}</span></div>`
          }
          <span class="shop-card__stock ${inStock ? 'is-ok' : 'is-out'}">${
            inStock ? `${p.stock} ${tt('pcs')}` : tt('out')
          }</span>
        </div>
        <div class="shop-card__body">
          <div class="shop-card__row">
            <h3 class="shop-card__title">${esc(p.title)}</h3>
            <span class="shop-card__price">${money(p.price_rub)}</span>
          </div>
          ${body ? `<p class="shop-card__text">${esc(body)}</p>` : ''}
          <div class="shop-card__row shop-card__row--sub">
            ${weight ? `<span class="shop-card__weight">${esc(weight)}</span>` : '<span></span>'}
          </div>
          <div class="shop-card__cart">
            <div class="shop-qty" data-qty-wrap="${p.id}">
              <button type="button" class="shop-qty__btn" data-qty-minus aria-label="${esc(tt('less'))}" ${inStock ? '' : 'disabled'}>-</button>
              <input class="shop-qty__input" type="number" min="1" max="${Math.max(1, p.stock)}" value="1" inputmode="numeric" aria-label="${esc(tt('qty'))}" ${inStock ? '' : 'disabled'}>
              <button type="button" class="shop-qty__btn" data-qty-plus aria-label="${esc(tt('more'))}" ${inStock ? '' : 'disabled'}>+</button>
            </div>
            <button type="button" class="shop-btn shop-card__buy" data-add="${p.id}" data-stock="${p.stock}" ${
              inStock ? '' : 'disabled'
            }>${inStock ? tt('addToCart') : tt('out')}</button>
          </div>
        </div>
      </article>`;
      })
      .join('');

    root.querySelectorAll('.shop-qty').forEach((wrap) => {
      const input = wrap.querySelector('.shop-qty__input');
      const minus = wrap.querySelector('[data-qty-minus]');
      const plus = wrap.querySelector('[data-qty-plus]');
      const max = Math.max(1, Number(input?.max) || 1);

      const readQty = () => {
        const n = parseInt(String(input.value).replace(/\D/g, ''), 10);
        return Number.isFinite(n) ? n : 1;
      };

      const setQty = (n) => {
        let q = Math.round(n);
        if (!Number.isFinite(q) || q < 1) q = 1;
        if (q > max) q = max;
        input.value = String(q);
        if (!input.disabled) {
          if (minus) minus.disabled = q <= 1;
          if (plus) plus.disabled = q >= max;
        }
        return q;
      };

      setQty(readQty());

      minus?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        setQty(readQty() - 1);
      });
      plus?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        setQty(readQty() + 1);
      });
      input.addEventListener('change', () => setQty(readQty()));
      input.addEventListener('blur', () => setQty(readQty()));
    });

    root.querySelectorAll('[data-add]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const card = btn.closest('.shop-card');
        const input = card?.querySelector('.shop-qty__input');
        const stock = Math.max(1, Number(btn.dataset.stock) || 1);
        let qty = parseInt(String(input?.value || '1').replace(/\D/g, ''), 10);
        if (!Number.isFinite(qty) || qty < 1) qty = 1;
        if (qty > stock) qty = stock;
        if (input) input.value = String(qty);
        addToCart(Number(btn.dataset.add), qty);
        const prev = btn.textContent;
        btn.textContent = tt('added');
        setTimeout(() => {
          btn.textContent = prev;
        }, 900);
      });
    });
  } catch (e) {
    root.innerHTML = `<div class="shop-flash err">${esc(e.message)}</div>`;
  }
}

renderCatalog();
