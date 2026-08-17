import { api, shopLocale } from '/js/shop.js?v=7';

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function renderItem(item) {
  const alt = esc(item.alt || '');
  if (item.kind === 'video') {
    return `<div class="gallery-item" data-kind="video" data-src="${esc(item.url)}" data-alt="${alt}">
      <video class="gallery-video gallery-img" src="${esc(item.url)}" muted playsinline preload="metadata" aria-label="${alt}"></video>
      <span class="gallery-video-badge" aria-hidden="true">▶</span>
    </div>`;
  }
  const img = `<img class="gallery-img" src="${esc(item.url)}" alt="${alt}" width="800" height="600" sizes="(max-width:768px) 45vw, 30vw" loading="lazy" decoding="async">`;
  if (item.webp_url) {
    return `<div class="gallery-item" data-kind="image" data-src="${esc(item.url)}" data-alt="${alt}">
      <picture><source type="image/webp" srcset="${esc(item.webp_url)}">${img}</picture>
    </div>`;
  }
  return `<div class="gallery-item" data-kind="image" data-src="${esc(item.url)}" data-alt="${alt}">${img}</div>`;
}

async function renderGallery() {
  const root = document.querySelector('.gallery');
  if (!root) return;
  const loading =
    shopLocale() === 'en' ? 'Loading gallery…' : 'Загрузка галереи…';
  const empty = shopLocale() === 'en' ? 'Gallery is empty.' : 'Галерея пока пуста.';
  root.innerHTML = `<p class="muted" style="grid-column:1/-1;text-align:center">${esc(loading)}</p>`;
  try {
    const { items } = await api('/gallery');
    if (!items?.length) {
      root.innerHTML = `<p class="muted" style="grid-column:1/-1;text-align:center">${esc(empty)}</p>`;
    } else {
      root.innerHTML = items.map(renderItem).join('');
    }
  } catch (err) {
    root.innerHTML = `<p class="muted" style="grid-column:1/-1;text-align:center">${esc(err.message || 'Error')}</p>`;
  }
  delete root.dataset.adsInserted;
  window.dispatchEvent(new CustomEvent('vrn-gallery-ready'));
}

renderGallery();
