const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { format } = require('date-fns');

const sitemapPath = '/var/www/vrnhoney.ru/sitemap.xml';
const siteRoot = '/var/www/vrnhoney.ru';
const siteBaseUrl = 'https://vrnhoney.ru';

fs.readFile(sitemapPath, 'utf8', (err, data) => {
  if (err) {
    console.error('Ошибка чтения sitemap:', err);
    return;
  }

  const dom = new JSDOM(data, { contentType: 'text/xml' });
  const document = dom.window.document;

  const urlNodes = document.querySelectorAll('url');

  urlNodes.forEach(urlNode => {
    const loc = urlNode.querySelector('loc');
    if (!loc) return;

    const locUrl = loc.textContent.trim();

    let relativePath = locUrl;
    if (relativePath.startsWith(siteBaseUrl)) {
      relativePath = relativePath.slice(siteBaseUrl.length);
    }

    if (relativePath.startsWith('/')) {
      relativePath = relativePath.slice(1);
    }

    if (relativePath === '' || relativePath === '/') {
      relativePath = 'main.html';
    }

    const filePath = path.join(siteRoot, relativePath);

    if (!fs.existsSync(filePath)) {
      console.warn(`Файл не найден для URL ${locUrl}: ${filePath}`);
      return;
    }

    try {
      const stat = fs.statSync(filePath);
      const lastmodDate = format(stat.mtime, 'yyyy-MM-dd');

      let lastmodNode = urlNode.querySelector('lastmod');
      if (!lastmodNode) {
        lastmodNode = document.createElement('lastmod');
        urlNode.appendChild(lastmodNode);
      }

      lastmodNode.textContent = lastmodDate;
    } catch (e) {
      console.error(`Ошибка получения mtime для ${filePath}:`, e);
    }
  });

  fs.writeFile(
    sitemapPath,
    '<?xml version="1.0" encoding="UTF-8"?>\n' + document.documentElement.outerHTML + '\n',
    'utf8',
    err => {
      if (err) {
        console.error('Ошибка записи sitemap:', err);
        return;
      }
      console.log('sitemap.xml обновлён на основе mtime файлов');
    }
  );
});
