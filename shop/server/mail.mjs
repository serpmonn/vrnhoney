/**
 * Outbound mail via local sendmail/postfix (no extra SMTP keys).
 */
import { spawn } from 'node:child_process';

export function mailFrom() {
  return String(process.env.MAIL_FROM || 'VRNHoney <noreply@vrnhoney.ru>').trim();
}

function encodeSubject(subject) {
  return `=?UTF-8?B?${Buffer.from(String(subject), 'utf8').toString('base64')}?=`;
}

export function notifyEmails() {
  const raw = String(
    process.env.ORDER_NOTIFY_EMAILS || 'popova.gv.1963@gmail.com,sergei@serpmonn.ru'
  );
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.includes('@'));
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

export function sendMail({ to, subject, text, html }) {
  const from = mailFrom();
  const recipients = Array.isArray(to) ? to.join(', ') : String(to || '').trim();
  if (!recipients) return Promise.reject(new Error('Нет получателя письма'));
  const boundary = `bnd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const raw = [
    `From: ${from}`,
    `To: ${recipients}`,
    `Subject: ${encodeSubject(subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    text,
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    html,
    `--${boundary}--`,
    '',
  ].join('\r\n');

  return new Promise((resolve, reject) => {
    const child = spawn('/usr/sbin/sendmail', ['-t', '-i'], {
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    let err = '';
    child.stderr.on('data', (d) => {
      err += String(d);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ ok: true });
      else reject(new Error(err.trim() || `sendmail ${code}`));
    });
    child.stdin.end(raw);
  });
}

export async function sendPasswordResetEmail({ to, resetLink, lang = 'ru' }) {
  const ru = lang !== 'en';
  const subject = ru ? 'Восстановление пароля VRNHoney' : 'VRNHoney password reset';
  const text = ru
    ? `Чтобы задать новый пароль, откройте ссылку (действует 1 час):\n${resetLink}\n\nЕсли вы не просили восстановление — просто проигнорируйте письмо.`
    : `Set a new password using this link (valid for 1 hour):\n${resetLink}\n\nIf you did not request this, ignore the email.`;
  const html = `
    <div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;color:#2a2118">
      <h2 style="color:#9a5c0a;margin:0 0 12px">${ru ? 'Восстановление пароля' : 'Password reset'}</h2>
      <p>${ru ? 'Нажмите кнопку, чтобы задать новый пароль. Ссылка действует 1 час.' : 'Click the button to set a new password. The link is valid for 1 hour.'}</p>
      <p style="margin:24px 0">
        <a href="${resetLink}" style="background:#c47a12;color:#fff;padding:12px 22px;text-decoration:none;border-radius:999px;display:inline-block;font-weight:700">
          ${ru ? 'Сменить пароль' : 'Change password'}
        </a>
      </p>
      <p style="font-size:13px;color:#6e5f50;word-break:break-all">${resetLink}</p>
      <p style="font-size:12px;color:#6e5f50">${ru ? 'Если вы не просили восстановление — проигнорируйте это письмо.' : 'If you did not request this, ignore this email.'}</p>
    </div>`;
  return sendMail({ to, subject, text, html });
}

export async function sendNewOrderNotify(order, { adminUrl } = {}) {
  const emails = notifyEmails();
  if (!emails.length) return { skipped: true };
  const id = order.id;
  const fio = [order.customer_last_name, order.customer_name, order.customer_patronymic]
    .filter(Boolean)
    .join(' ');
  let items = [];
  try {
    items = JSON.parse(order.items_json || '[]');
  } catch {
    items = [];
  }
  const itemsText = items.length
    ? items.map((i) => `• ${i.title} × ${i.qty} — ${i.line_rub || i.price_rub} ₽`).join('\n')
    : '—';
  const itemsHtml = items.length
    ? `<ul>${items
        .map((i) => `<li>${esc(i.title)} × ${esc(i.qty)} — ${esc(i.line_rub || i.price_rub)} ₽</li>`)
        .join('')}</ul>`
    : '<p>—</p>';
  const delivery =
    order.cdek_delivery_type === 'door'
      ? `до двери: ${order.customer_address || ''}`
      : `ПВЗ ${order.cdek_pvz_code || ''}: ${order.customer_address || order.cdek_pvz_address || ''}`;
  const pay = ({ unpaid: 'не оплачен', pending: 'ожидает оплаты', paid: 'оплачен', canceled: 'оплата отменена' })[
    order.payment_status
  ] || order.payment_status || 'не оплачен';
  const link = adminUrl || 'https://vrnhoney.ru/admin/';
  const subject = `Новый заказ #${id} VRNHoney — ${order.total_rub} ₽`;
  const text = [
    `Новый заказ #${id}`,
    `Клиент: ${fio}`,
    `Телефон: ${order.customer_phone || '—'}`,
    `Оплата: ${pay}, сумма ${order.total_rub} ₽ (мёд)`,
    order.shipping_rub ? `Доставка при получении: ${order.shipping_rub} ₽` : '',
    `Доставка: ${delivery}`,
    order.comment ? `Комментарий: ${order.comment}` : '',
    '',
    'Состав:',
    itemsText,
    '',
    `Админка: ${link}`,
  ]
    .filter((line) => line !== '')
    .join('\n');
  const html = `
    <div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;color:#2a2118">
      <h2 style="color:#9a5c0a;margin:0 0 12px">Новый заказ #${esc(id)}</h2>
      <p><strong>${esc(fio)}</strong><br>${esc(order.customer_phone || '—')}</p>
      <p>Оплата: ${esc(pay)} · мёд <strong>${esc(order.total_rub)} ₽</strong>
        ${order.shipping_rub ? `<br>Доставка при получении: ${esc(order.shipping_rub)} ₽` : ''}</p>
      <p>Доставка: ${esc(delivery)}</p>
      ${order.comment ? `<p>Комментарий: ${esc(order.comment)}</p>` : ''}
      <p style="margin:0 0 6px"><strong>Состав</strong></p>
      ${itemsHtml}
      <p style="margin:24px 0">
        <a href="${esc(link)}" style="background:#c47a12;color:#fff;padding:12px 22px;text-decoration:none;border-radius:999px;display:inline-block;font-weight:700">
          Открыть админку
        </a>
      </p>
    </div>`;
  const results = [];
  for (const to of emails) {
    try {
      await sendMail({ to, subject, text, html });
      results.push({ to, ok: true });
    } catch (err) {
      console.error('[mail] order notify', to, err.message || err);
      results.push({ to, ok: false, error: err.message });
    }
  }
  return { results };
}
