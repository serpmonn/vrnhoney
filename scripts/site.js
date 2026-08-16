(function () {
  'use strict';

  // Блоки РСЯ vrnhoney.ru
  // Активные: -9 top, -10 inContent, -11 topMobile, -12 floor
  // В кабинете заархивировать старые: -2,-3,-5,-6,-7,-8 и прочие не из списка выше
  var AD_BLOCKS = {
    top: 'R-A-15746761-9',
    inContent: 'R-A-15746761-10',
    topMobile: 'R-A-15746761-11',
    floor: 'R-A-15746761-12'
  };

  var MOBILE_MAX = 768;
  var TOP_AD_FALLBACK_MS = 4000;

  function isMobile() {
    return window.matchMedia('(max-width: ' + MOBILE_MAX + 'px)').matches;
  }

  function ymReach(goal) {
    try {
      if (typeof ym === 'function') ym(108970969, 'reachGoal', goal);
    } catch (_) {}
  }

  /* ---- Tabs ---- */
  function showTab(tabId) {
    var panels = document.querySelectorAll('[data-tab-panel]');
    panels.forEach(function (panel) {
      var active = panel.getAttribute('data-tab-panel') === tabId;
      panel.classList.toggle('is-active', active);
      if (active) panel.removeAttribute('hidden');
      else panel.setAttribute('hidden', '');
    });
    document.body.classList.remove('menu-open');
    var nav = document.getElementById('mainNav');
    if (nav) nav.classList.remove('active');
  }

  function initTabs() {
    document.querySelectorAll('[data-tab]').forEach(function (link) {
      link.addEventListener('click', function (e) {
        e.preventDefault();
        showTab(link.getAttribute('data-tab'));
      });
    });

    var hash = (location.hash || '').replace('#', '');
    if (hash && document.querySelector('[data-tab-panel="' + hash + '"]')) {
      showTab(hash);
    }
  }

  /* ---- Mobile menu ---- */
  function initMenu() {
    var toggle = document.getElementById('menuToggle');
    var overlay = document.getElementById('menuOverlay');
    var nav = document.getElementById('mainNav');

    function closeMenu() {
      document.body.classList.remove('menu-open');
      if (nav) nav.classList.remove('active');
    }

    function openMenu() {
      document.body.classList.add('menu-open');
      if (nav) nav.classList.add('active');
    }

    if (toggle) {
      toggle.addEventListener('click', function () {
        if (document.body.classList.contains('menu-open')) closeMenu();
        else openMenu();
      });
    }
    if (overlay) overlay.addEventListener('click', closeMenu);
  }

  /* ---- Lightbox ---- */
  function initLightbox() {
    var root = document.getElementById('lightbox');
    if (!root || root.dataset.lightboxReady === '1') return;
    root.dataset.lightboxReady = '1';

    var img = root.querySelector('img');
    var video = root.querySelector('video');
    if (!video) {
      video = document.createElement('video');
      video.setAttribute('controls', '');
      video.setAttribute('playsinline', '');
      video.hidden = true;
      root.insertBefore(video, root.querySelector('.lightbox-next'));
    }
    var index = 0;

    function mediaList() {
      var gallery = document.querySelector('.gallery');
      if (!gallery) return [];
      var list = Array.prototype.slice.call(gallery.querySelectorAll('.gallery-item'));
      if (!list.length) {
        list = Array.prototype.slice.call(gallery.querySelectorAll('.gallery-img'));
      }
      return list;
    }

    function openAt(i) {
      var list = mediaList();
      if (!list.length) return;
      index = (i + list.length) % list.length;
      var el = list[index];
      var kind = el.getAttribute('data-kind') || (el.tagName === 'VIDEO' ? 'video' : 'image');
      var src = el.getAttribute('data-src') || el.currentSrc || el.src || '';
      var alt = el.getAttribute('data-alt') || el.getAttribute('alt') || '';
      if (kind === 'video') {
        img.hidden = true;
        img.removeAttribute('src');
        video.hidden = false;
        video.src = src;
        video.play().catch(function () {});
      } else {
        video.pause();
        video.removeAttribute('src');
        video.hidden = true;
        img.hidden = false;
        img.src = src;
        img.alt = alt;
      }
      root.hidden = false;
      root.classList.add('is-open');
    }

    function close() {
      root.classList.remove('is-open');
      root.hidden = true;
      img.src = '';
      img.hidden = false;
      video.pause();
      video.removeAttribute('src');
      video.hidden = true;
    }

    document.addEventListener('click', function (e) {
      var gallery = document.querySelector('.gallery');
      if (!gallery || !gallery.contains(e.target)) return;
      var item = e.target.closest('.gallery-item');
      if (!item) {
        var legacy = e.target.closest('.gallery-img');
        if (!legacy) return;
        item = legacy;
      }
      var list = mediaList();
      var i = list.indexOf(item);
      if (i < 0) return;
      e.preventDefault();
      openAt(i);
    });

    root.querySelector('.lightbox-close').addEventListener('click', close);
    root.querySelector('.lightbox-prev').addEventListener('click', function () { openAt(index - 1); });
    root.querySelector('.lightbox-next').addEventListener('click', function () { openAt(index + 1); });
    root.addEventListener('click', function (e) {
      if (e.target === root) close();
    });
    document.addEventListener('keydown', function (e) {
      if (!root.classList.contains('is-open')) return;
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowLeft') openAt(index - 1);
      if (e.key === 'ArrowRight') openAt(index + 1);
    });
  }

  function refreshGalleryUi() {
    var gallery = document.querySelector('.gallery');
    if (gallery) delete gallery.dataset.adsInserted;
    insertGalleryAds();
  }

  /* ---- Ads ---- */
  var yandexBannerSeq = 0;
  var topAdRequested = false;
  var topAdShown = false;
  var floorRequested = false;
  var galleryAdObserver = null;

  function adWrapFor(slotEl) {
    if (!slotEl) return null;
    return slotEl.closest('.ad-container, .gallery-ad, .ad-under-nav') || slotEl;
  }

  function hideAdWrap(wrap) {
    if (!wrap || wrap.__adFillResolved) return;
    wrap.__adFillResolved = true;
    wrap.classList.add('is-empty', 'is-collapsed');
    wrap.classList.remove('ad-loading', 'ad-pending');
    wrap.setAttribute('hidden', '');
    wrap.style.display = 'none';
  }

  function markAdLoaded(wrap) {
    if (!wrap || wrap.__adFillResolved) return;
    wrap.__adFillResolved = true;
    wrap.classList.remove('is-empty', 'is-collapsed', 'ad-loading', 'ad-pending');
    wrap.classList.add('ad-loaded');
    wrap.removeAttribute('hidden');
    wrap.style.display = '';
  }

  function slotLooksFilled(slot) {
    if (!slot) return false;
    var html = (slot.innerHTML || '').trim();
    if (!html) return false;
    if (slot.querySelector('iframe, img[src], video, canvas, yatag, [data-container]')) return true;
    if (html.length > 200) return true;
    var text = (slot.innerText || '').replace(/\s+/g, ' ').trim();
    return text.length >= 20;
  }

  function watchSlotFill(slot, wrap, timeoutMs) {
    var deadline = Date.now() + (timeoutMs || 8000);
    function tick() {
      if (!wrap || wrap.__adFillResolved) return;
      if (wrap.__yandexRendered || slotLooksFilled(slot)) {
        markAdLoaded(wrap);
        return;
      }
      if (Date.now() >= deadline) {
        hideAdWrap(wrap);
        return;
      }
      setTimeout(tick, 400);
    }
    setTimeout(tick, 500);
  }

  function renderBanner(blockId, slotEl) {
    if (!blockId || !slotEl || slotEl.dataset.adRendered === '1') return;
    slotEl.dataset.adRendered = '1';
    var wrap = adWrapFor(slotEl);
    if (wrap) {
      wrap.classList.add('ad-loading');
      wrap.classList.remove('is-empty', 'is-collapsed', 'ad-pending');
      wrap.style.display = '';
      wrap.removeAttribute('hidden');
    }

    window.yaContextCb.push(function () {
      try {
        var pageNumber = ++yandexBannerSeq;
        Ya.Context.AdvManager.render(
          {
            blockId: blockId,
            renderTo: slotEl.id,
            pageNumber: pageNumber,
            onRender: function () {
              if (wrap) {
                wrap.__yandexRendered = true;
                markAdLoaded(wrap);
              }
            }
          },
          function () {
            setTimeout(function () {
              if (!wrap || wrap.__yandexRendered || wrap.__adFillResolved) return;
              hideAdWrap(wrap);
            }, 750);
          }
        );
        watchSlotFill(slotEl, wrap, 9000);
      } catch (_) {
        hideAdWrap(wrap);
      }
    });
  }

  function tryFloorFallback() {
    if (topAdShown || floorRequested || !AD_BLOCKS.floor || !isMobile()) return;
    // Top Ad не показался — можно Floor (оба сразу нельзя)
    renderFloorAd();
  }

  function renderTopAd() {
    if (!AD_BLOCKS.topMobile || topAdRequested || floorRequested || !isMobile()) return;
    topAdRequested = true;
    window.yaContextCb.push(function () {
      try {
        Ya.Context.AdvManager.render(
          {
            blockId: AD_BLOCKS.topMobile,
            type: 'topAd',
            onRender: function () {
              topAdShown = true;
            }
          },
          function () {
            setTimeout(tryFloorFallback, 500);
          }
        );
      } catch (_) {
        tryFloorFallback();
      }
    });
    // Если onRender/no-fill не пришли — запасной Floor
    setTimeout(function () {
      if (!topAdShown) tryFloorFallback();
    }, TOP_AD_FALLBACK_MS);
  }

  function renderFloorAd() {
    if (!AD_BLOCKS.floor || floorRequested || topAdShown || !isMobile()) return;
    floorRequested = true;
    window.yaContextCb.push(function () {
      try {
        Ya.Context.AdvManager.render({
          blockId: AD_BLOCKS.floor,
          type: 'floorAd',
          platform: 'touch'
        });
      } catch (_) {}
    });
  }

  function observeGalleryAd(wrap) {
    if (!wrap) return;
    if (!('IntersectionObserver' in window)) {
      wrap.classList.remove('ad-pending');
      var slot = wrap.querySelector('[data-ad="inContent"]');
      if (slot) renderBanner(AD_BLOCKS.inContent, slot);
      return;
    }
    if (!galleryAdObserver) {
      galleryAdObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          var el = entry.target;
          galleryAdObserver.unobserve(el);
          el.classList.remove('ad-pending');
          var s = el.querySelector('[data-ad="inContent"]');
          if (s) renderBanner(AD_BLOCKS.inContent, s);
        });
      }, { rootMargin: '200px 0px', threshold: 0.01 });
    }
    galleryAdObserver.observe(wrap);
  }

  function insertGalleryAds() {
    var gallery = document.querySelector('.gallery');
    if (!gallery || gallery.dataset.adsInserted === '1') return;
    gallery.dataset.adsInserted = '1';

    var imgs = Array.prototype.slice.call(gallery.querySelectorAll('.gallery-item, .gallery-img'));
    // Prefer wrapping items; fall back to bare imgs
    imgs = imgs.filter(function (el, idx, arr) {
      if (el.classList.contains('gallery-img') && el.closest('.gallery-item')) return false;
      return true;
    });
    var step = 9;
    var n = 0;
    for (var i = step; i <= imgs.length; i += step) {
      n += 1;
      var wrap = document.createElement('div');
      wrap.className = 'gallery-ad ad-pending';
      wrap.setAttribute(
        'aria-label',
        (document.documentElement.lang || '').toLowerCase().indexOf('en') === 0 ? 'Advertisement' : 'Реклама'
      );

      var slot = document.createElement('div');
      slot.id = 'yandex_rtb_gal_' + n;
      slot.className = 'ad-slot gallery-ad__slot';
      slot.setAttribute('data-ad', 'inContent');
      wrap.appendChild(slot);

      var after = imgs[i - 1];
      if (after && after.parentNode === gallery) {
        after.insertAdjacentElement('afterend', wrap);
        if (AD_BLOCKS.inContent) observeGalleryAd(wrap);
        else hideAdWrap(wrap);
      }
    }
  }

  function initAds() {
    insertGalleryAds();

    if (AD_BLOCKS.top && !isMobile()) {
      renderBanner(AD_BLOCKS.top, document.getElementById('yandex_rtb_top'));
    } else {
      hideAdWrap(document.querySelector('.ad-under-nav'));
    }

    if (isMobile()) {
      if (AD_BLOCKS.topMobile) renderTopAd();
      else if (AD_BLOCKS.floor) renderFloorAd();
    }

    // Обычные in-content (не галерея) — сразу
    document.querySelectorAll('.ad-container [data-ad="inContent"]').forEach(function (el) {
      if (!AD_BLOCKS.inContent) {
        hideAdWrap(adWrapFor(el));
        return;
      }
      renderBanner(AD_BLOCKS.inContent, el);
    });
  }

  function initGoals() {
    document.querySelectorAll('a[href^="tel:"]').forEach(function (a) {
      a.addEventListener('click', function () { ymReach('phone_click'); });
    });
    var buy = document.getElementById('buy-btn');
    if (buy) buy.addEventListener('click', function () { ymReach('buy_button_click'); });
  }

  document.addEventListener('DOMContentLoaded', function () {
    initTabs();
    initMenu();
    initLightbox();
    initAds();
    initGoals();
  });
  window.addEventListener('vrn-gallery-ready', refreshGalleryUi);
})();
