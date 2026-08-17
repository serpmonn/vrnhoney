/** Shop locale helpers (ru|en) */

export function requestLocale(req) {
  const h = String(req.headers['x-shop-locale'] || '').toLowerCase();
  const q = String(req.query?.lang || '').toLowerCase();
  if (h === 'en' || q === 'en') return 'en';
  const bodyLang = String(req.body?.locale || req.body?.lang || '').toLowerCase();
  if (bodyLang === 'en') return 'en';
  return 'ru';
}

const ERR = {
  ru: {
    emailPasswordRequired: 'Email и пароль от 6 символов обязательны',
    emailTaken: 'Такой email уже зарегистрирован',
    badCredentials: 'Неверный email или пароль',
    productNotFound: 'Товар не найден',
    adminCannotOrder: 'Админ оформляет заказы через витрину под покупателем',
    cartEmpty: 'Корзина пуста',
    deliveryRequired: 'Укажите ФИО, телефон и пункт выдачи СДЭК',
    postalInvalid: 'Индекс должен быть из 6 цифр',
    cdekRequired: 'Выберите способ доставки и укажите ПВЗ или адрес',
    cdekUnavailable: 'Доставка СДЭК временно недоступна',
    cdekCalcFailed: 'Не удалось рассчитать доставку',
    cdekCreateFailed: 'Не удалось создать накладную СДЭК',
    cdekAlready: 'Накладная СДЭК уже создана',
    cdekNeedPaid: 'Сначала заказ должен быть оплачен',
    cdekAddressRequired: 'Укажите адрес доставки до двери',
    cdekPvzRequired: 'Выберите город и пункт выдачи СДЭК',
    cdekPrintNeedOrder: 'Сначала нужна накладная СДЭК',
    cdekPrintBadKind: 'Неверный тип печатной формы',
    cdekPrintFailed: 'Не удалось получить печатную форму СДЭК',
    cdekIntakeFailed: 'Не удалось вызвать курьера СДЭК',
    cdekIntakeAlready: 'Заявка на забор уже создана',
    cdekIntakeMissing: 'Нет заявки на забор',
    cdekIntakeCancelFailed: 'Не удалось отменить заявку на забор',
    cdekOrderCancelFailed: 'Не удалось отменить накладную в СДЭК',
    cdekIntakeDryRun: 'Проверка OK: в СДЭК ничего не отправлено',
    productUnavailable: 'Товар недоступен',
    stockShort: (title) => `Недостаточно «${title}» на складе`,
    paymentCreateFailed: 'Не удалось создать платёж',
    stockConflict: 'Не хватило остатка, обновите корзину',
    orderNotFound: 'Заказ не найден',
    alreadyPaid: 'Заказ уже оплачен',
    orderCancelled: 'Заказ отменён',
    paymentsUnavailable: 'Онлайн-оплата временно недоступна',
    nothingToPay: 'Нечего оплачивать',
    noPaymentUrl: 'ЮKassa не вернула ссылку оплаты',
    paymentError: 'Ошибка создания платежа',
    badStatus: 'Неверный статус',
    uploadError: 'Ошибка загрузки',
    titlePriceRequired: 'Название и цена обязательны',
    imageOnly: 'Только изображения JPEG/PNG/WebP/GIF',
    needAuth: 'Нужна авторизация',
    adminOnly: 'Только для админа',
    internal: 'Внутренняя ошибка',
    resetEmailRequired: 'Укажите email',
    resetSent: 'Если такой email есть, мы отправили ссылку для смены пароля.',
    resetTooOften: 'Слишком частые запросы. Подождите пару минут.',
    resetInvalid: 'Ссылка недействительна или устарела. Запросите новую.',
    resetPasswordShort: 'Новый пароль должен быть не короче 6 символов',
    resetOk: 'Пароль обновлён. Можно войти.',
  },
  en: {
    emailPasswordRequired: 'Email and a password of at least 6 characters are required',
    emailTaken: 'This email is already registered',
    badCredentials: 'Invalid email or password',
    productNotFound: 'Product not found',
    adminCannotOrder: 'Admins cannot place orders; sign in as a buyer',
    cartEmpty: 'Cart is empty',
    deliveryRequired: 'Provide full name, phone and a CDEK pickup point',
    postalInvalid: 'Postal code must be 6 digits',
    cdekRequired: 'Choose delivery method and fill pickup point or address',
    cdekUnavailable: 'CDEK delivery is temporarily unavailable',
    cdekCalcFailed: 'Could not calculate delivery',
    cdekCreateFailed: 'Could not create CDEK shipment',
    cdekAlready: 'CDEK shipment already created',
    cdekNeedPaid: 'Order must be paid first',
    cdekAddressRequired: 'Enter a door delivery address',
    cdekPvzRequired: 'Select a city and CDEK pickup point',
    cdekPrintNeedOrder: 'CDEK shipment is required first',
    cdekPrintBadKind: 'Unknown print form type',
    cdekPrintFailed: 'Could not get CDEK print form',
    cdekIntakeFailed: 'Could not request CDEK courier pickup',
    cdekIntakeAlready: 'Courier pickup already requested',
    cdekIntakeMissing: 'No courier pickup request',
    cdekIntakeCancelFailed: 'Could not cancel courier pickup',
    cdekOrderCancelFailed: 'Could not cancel the CDEK waybill',
    cdekIntakeDryRun: 'Dry run OK: nothing sent to CDEK',
    productUnavailable: 'Product unavailable',
    stockShort: (title) => `Not enough stock for “${title}”`,
    paymentCreateFailed: 'Could not create payment',
    stockConflict: 'Not enough stock left — please refresh your cart',
    orderNotFound: 'Order not found',
    alreadyPaid: 'Order already paid',
    orderCancelled: 'Order cancelled',
    paymentsUnavailable: 'Online payment is temporarily unavailable',
    nothingToPay: 'Nothing to pay',
    noPaymentUrl: 'YooKassa did not return a payment link',
    paymentError: 'Payment creation error',
    badStatus: 'Invalid status',
    uploadError: 'Upload error',
    titlePriceRequired: 'Title and price are required',
    imageOnly: 'Only JPEG/PNG/WebP/GIF images are allowed',
    needAuth: 'Authorization required',
    adminOnly: 'Admins only',
    internal: 'Internal error',
    resetEmailRequired: 'Enter your email',
    resetSent: 'If this email is registered, we sent a password reset link.',
    resetTooOften: 'Too many requests. Please wait a couple of minutes.',
    resetInvalid: 'This link is invalid or expired. Request a new one.',
    resetPasswordShort: 'New password must be at least 6 characters',
    resetOk: 'Password updated. You can sign in now.',
  },
};

export function t(lang, key, ...args) {
  const dict = ERR[lang] || ERR.ru;
  const val = dict[key] ?? ERR.ru[key] ?? key;
  return typeof val === 'function' ? val(...args) : val;
}

export function localizeProductFields(p, lang) {
  if (!p) return p;
  const useEn = lang === 'en';
  return {
    title: useEn && p.title_en ? p.title_en : p.title,
    description: useEn && p.description_en ? p.description_en : p.description,
  };
}
