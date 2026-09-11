require('dotenv').config();
const express = require('express');
const compression = require('compression');
const cors = require('cors');
const path = require('path');
const fetch = (...args) => import('node-fetch').then(m => m.default(...args));

const app = express();
const PORT = process.env.PORT || 3000;

app.use(compression());
app.use(cors({ origin: process.env.ALLOW_ORIGIN || '*' }));
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

// Проверка токена (опционально)
function checkToken(req, res, next) {
  const token = req.headers['x-api-token'] || req.query.token;
  if (process.env.API_TOKEN && token !== process.env.API_TOKEN) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

/* ============================================
   ПОИСК (прокси Serper — ключ не палим)
   ============================================ */
app.post('/api/search', checkToken, async (req, res) => {
  const { q, type = 'search', gl = 'ru', hl = 'ru', num = 20 } = req.body;
  if (!q) return res.status(400).json({ error: 'q required' });

  const endpoints = {
    search: 'https://google.serper.dev/search',
    images: 'https://google.serper.dev/images',
    videos: 'https://google.serper.dev/videos',
    news:   'https://google.serper.dev/news',
    places: 'https://google.serper.dev/places',
    scholar:'https://google.serper.dev/scholar'
  };
  const url = endpoints[type] || endpoints.search;

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'X-API-KEY': process.env.SERPER_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ q, gl, hl, num })
    });
    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ============================================
   ЧТЕНИЕ СТРАНИЦЫ (для AI — обход CORS/X-Frame)
   ============================================ */
app.post('/api/fetch', checkToken, async (req, res) => {
  const { url, format = 'text' } = req.body;
  if (!url) return res.status(400).json({ error: 'url required' });

  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NovaBot/1.0)' }
    });
    const html = await r.text();

    if (format === 'html') return res.json({ url, html });
    // вырезаем текст
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 20000);
    res.json({ url, text, length: text.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ============================================
   ПРОКСИ К chatclaud
   ============================================ */
app.post('/api/ai', checkToken, async (req, res) => {
  const endpoint = process.env.CHATCLAUD_URL || 'https://chatclaud.onrender.com';
  try {
    const r = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    });
    const text = await r.text();
    res.status(r.status).send(text);
  } catch (e) {
    res.status(500).json({ error: e.message, endpoint });
  }
});

/* ============================================
   СТАТУС
   ============================================ */
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    version: '1.2.0',
    hasSerper: !!process.env.SERPER_KEY,
    chatclaud: process.env.CHATCLAUD_URL || 'default',
    time: new Date().toISOString()
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Nova Browser running on port ${PORT}`);
  console.log(`Serper key: ${process.env.SERPER_KEY ? 'OK' : 'MISSING'}`);
  console.log(`chatclaud: ${process.env.CHATCLAUD_URL || 'default'}`);
});
