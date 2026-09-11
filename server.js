/**
 * Nova Browser — server.js
 * Мультидвижок: Serper #1 + Serper #2 + Tavily работают вместе.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

/* ============================================
   КЛЮЧИ (из env, с fallback на встроенные)
   ============================================ */
const SERPER_KEY_1 = process.env.SERPER_KEY || '34e2b98552e12dafa0dcf1eb81399f3cbc435019';
const SERPER_KEY_2 = process.env.SERPER_KEY_2 || '1025273686ebb849b608e75816420fb6a99e7e78';
const TAVILY_KEY   = process.env.TAVILY_KEY || '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';

/* ============================================
   КЕШ (чтобы не жечь лимиты)
   ============================================ */
const CACHE_TTL = 10 * 60 * 1000; // 10 минут
const cache = new Map();

function cacheGet(key) {
  const v = cache.get(key);
  if (!v) return null;
  if (Date.now() - v.t > CACHE_TTL) { cache.delete(key); return null; }
  return v.data;
}
function cacheSet(key, data) {
  cache.set(key, { t: Date.now(), data });
  if (cache.size > 300) {
    const oldest = [...cache.keys()].slice(0, 100);
    oldest.forEach(k => cache.delete(k));
  }
}

/* ============================================
   AUTH
   ============================================ */
function checkBasicAuth(req) {
  const user = process.env.SITE_USER;
  const pass = process.env.SITE_PASS;
  if (!user || !pass) return true;
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Basic ')) return false;
  try {
    const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
    const idx = decoded.indexOf(':');
    return decoded.slice(0, idx) === user && decoded.slice(idx + 1) === pass;
  } catch (e) { return false; }
}

function checkApiAuth(req) {
  const hasToken = !!process.env.API_TOKEN;
  const hasSite = !!(process.env.SITE_USER && process.env.SITE_PASS);
  if (!hasToken && !hasSite) return true;
  if (hasToken) {
    const t = req.headers['x-api-token'];
    if (t && t === process.env.API_TOKEN) return true;
  }
  if (hasSite && checkBasicAuth(req)) return true;
  return false;
}

function requireAuth(res) {
  res.writeHead(401, {
    'WWW-Authenticate': 'Basic realm="Nova Browser"',
    'Content-Type': 'text/plain; charset=utf-8'
  });
  res.end('401 Unauthorized');
}

/* ============================================
   УТИЛИТЫ
   ============================================ */
function send(res, code, body, type) {
  type = type || 'application/json; charset=utf-8';
  res.writeHead(code, {
    'Content-Type': type,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Token',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  });
  if (Buffer.isBuffer(body) || typeof body === 'string') res.end(body);
  else res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
  };
  return map[ext] || 'application/octet-stream';
}

function safeJoin(root, reqPath) {
  const decoded = decodeURIComponent(reqPath.split('?')[0]);
  const cleaned = path.normalize(decoded).replace(/^(\.\.[/\\])+/, '');
  const full = path.join(root, cleaned);
  if (!full.startsWith(root)) return null;
  return full;
}

function isSafeUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (!['http:', 'https:'].includes(u.protocol)) return false;
    const host = u.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' ||
        host.endsWith('.local') ||
        /^10\./.test(host) || /^192\.168\./.test(host) ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(host) || /^169\.254\./.test(host)) return false;
    return true;
  } catch (e) { return false; }
}

function htmlToText(html) {
  let s = String(html || '');
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  s = s.replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');
  s = s.replace(/<svg[\s\S]*?<\/svg>/gi, ' ');
  s = s.replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<[^>]+>/g, ' ');
  s = s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
       .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
       .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  s = s.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

function extractTitle(html) {
  const m = String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? htmlToText(m[1]).slice(0, 200) : '';
}

function youtubeVideoId(url) {
  const re = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/|youtube\.com\/embed\/)([\w-]{11})/;
  const m = String(url).match(re);
  return m ? m[1] : null;
}

/* ============================================
   ПОИСК: SERPER (два ключа)
   ============================================ */
async function serperSearch(key, query, type, gl, hl) {
  const endpoints = {
    search: 'https://google.serper.dev/search',
    images: 'https://google.serper.dev/images',
    videos: 'https://google.serper.dev/videos',
    news: 'https://google.serper.dev/news',
    places: 'https://google.serper.dev/places',
    scholar: 'https://google.serper.dev/scholar'
  };
  const url = endpoints[type] || endpoints.search;
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'X-API-KEY': key,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ q: query, gl: gl || 'ru', hl: hl || 'ru', num: 20 })
    });
    if (!r.ok) {
      console.warn('[serper] HTTP', r.status, 'type=' + type);
      return null;
    }
    return await r.json();
  } catch (e) {
    console.warn('[serper] fail:', e.message);
    return null;
  }
}

/* ============================================
   ПОИСК: TAVILY
   ============================================ */
async function tavilySearch(query, depth) {
  try {
    const r = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: TAVILY_KEY,
        query: query,
        search_depth: depth || 'advanced',
        include_answer: true,
        include_raw_content: false,
        max_results: 10,
        topic: 'general'
      })
    });
    if (!r.ok) {
      console.warn('[tavily] HTTP', r.status);
      return null;
    }
    return await r.json();
  } catch (e) {
    console.warn('[tavily] fail:', e.message);
    return null;
  }
}

/* ============================================
   СЛИЯНИЕ РЕЗУЛЬТАТОВ
   ============================================ */
function normalizeUrl(u) {
  try {
    const x = new URL(u);
    return x.hostname.replace(/^www\./, '') + x.pathname.replace(/\/$/, '');
  } catch (e) { return String(u || '').toLowerCase(); }
}

function mergeResults(engineResults, type) {
  // engineResults = [{ source: 'serper1'|'serper2'|'tavily', data: {...} }]
  const merged = [];
  const seen = new Set();

  // 1) Serper organic/videos/images/news
  engineResults.forEach((er) => {
    if (!er || !er.data) return;
    const arr = er.data.organic || er.data.videos || er.data.images || er.data.news || [];
    arr.forEach((item, idx) => {
      const link = item.link || item.url || '';
      const key = normalizeUrl(link);
      if (!key || seen.has(key)) return;
      seen.add(key);
      merged.push({
        title: item.title || '',
        link: link,
        snippet: item.snippet || item.description || item.date || '',
        source: item.source || '',
        imageUrl: item.imageUrl || item.thumbnailUrl || '',
        position: idx,
        engine: er.source,
        // ranking weight: serper1=3, serper2=2, tavily=1
        weight: er.source === 'serper1' ? 3 : er.source === 'serper2' ? 2 : 1
      });
    });
  });

  // 2) Tavily answer — отдельно
  const tavilyAnswer = engineResults.find(e => e && e.source === 'tavily');
  const answer = tavilyAnswer && tavilyAnswer.data && tavilyAnswer.data.answer ? tavilyAnswer.data.answer : null;

  // 3) Сортировка: сначала взвешенные, потом по позиции
  merged.sort((a, b) => {
    if (b.weight !== a.weight) return b.weight - a.weight;
    return a.position - b.position;
  });

  return { items: merged, answer };
}

/* ============================================
   МУЛЬТИПОИСК — все три движка параллельно
   ============================================ */
async function multiSearch(query, type) {
  const cacheKey = type + ':' + query.toLowerCase();
  const cached = cacheGet(cacheKey);
  if (cached) {
    console.log('[cache hit]', cacheKey);
    return cached;
  }

  const tasks = [];

  // Serper #1 — основной
  tasks.push(serperSearch(SERPER_KEY_1, query, type).then(d => ({ source: 'serper1', data: d })).catch(() => null));

  // Serper #2 — второй ключ (тоже параллельно — больше результатов)
  if (SERPER_KEY_2 && SERPER_KEY_2 !== SERPER_KEY_1) {
    tasks.push(serperSearch(SERPER_KEY_2, query, type).then(d => ({ source: 'serper2', data: d })).catch(() => null));
  }

  // Tavily — только для типа "search" и "news" (там есть answer)
  if (type === 'search' || type === 'news') {
    tasks.push(tavilySearch(query, type === 'news' ? 'basic' : 'advanced').then(d => ({ source: 'tavily', data: d })).catch(() => null));
  }

  const results = (await Promise.all(tasks)).filter(Boolean);
  const merged = mergeResults(results, type);

  const output = {
    ok: true,
    type: type,
    query: query,
    enginesUsed: results.map(r => r.source),
    answer: merged.answer,
    count: merged.items.length,
    // кладём в разные поля в зависимости от типа (совместимость с фронтом)
    organic: type === 'search' ? merged.items : undefined,
    videos: type === 'videos' ? merged.items : undefined,
    images: type === 'images' ? merged.items : undefined,
    news: type === 'news' ? merged.items : undefined,
    // универсальное поле — все результаты
    all: merged.items
  };

  cacheSet(cacheKey, output);
  return output;
}

/* ============================================
   FETCH URL (чтение страниц)
   ============================================ */
async function fetchYouTube(videoId) {
  const result = {
    type: 'youtube', videoId, title: '', description: '', channel: '',
    url: 'https://www.youtube.com/watch?v=' + videoId
  };
  try {
    const oe = await fetch('https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=' + videoId + '&format=json');
    if (oe.ok) {
      const j = await oe.json();
      result.title = j.title || '';
      result.channel = j.author_name || '';
    }
  } catch (e) {}
  try {
    const r = await fetch('https://www.youtube.com/watch?v=' + videoId, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'ru,en;q=0.9' }
    });
    const html = await r.text();
    let m = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
    if (m) result.description = m[1];
    m = html.match(/"viewCount"\s*:\s*"(\d+)"/);
    if (m) result.views = m[1];
    m = html.match(/"captionTracks"\s*:\s*(\[[\s\S]*?\])/);
    if (m) {
      try {
        const tracks = JSON.parse(m[1]);
        let track = tracks.find(t => t.languageCode && t.languageCode.startsWith('ru'))
                 || tracks.find(t => t.languageCode && t.languageCode.startsWith('en'))
                 || tracks[0];
        if (track && track.baseUrl) {
          const c = await fetch(track.baseUrl);
          const xml = await c.text();
          const lines = [...xml.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map(x =>
            x[1].replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#39;/g,"'").replace(/\n/g,' ')
          );
          result.subtitles = lines.join(' ').slice(0, 8000);
        }
      } catch (e) {}
    }
  } catch (e) {}
  return result;
}

/* ============================================
   СЕРВЕР
   ============================================ */
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url || '/', 'http://localhost');
  const pathname = u.pathname;

  if (req.method === 'OPTIONS') return send(res, 204, '');

  /* /api/health — открыт */
  if (pathname === '/api/health') {
    return send(res, 200, {
      ok: true,
      version: '2.0.0',
      engines: {
        serper1: !!SERPER_KEY_1,
        serper2: !!SERPER_KEY_2,
        tavily: !!TAVILY_KEY
      },
      hasAuth: !!(process.env.SITE_USER && process.env.SITE_PASS),
      hasApiToken: !!process.env.API_TOKEN,
      chatclaud: process.env.CHATCLAUD_URL || 'https://chatclaud.onrender.com',
      time: new Date().toISOString()
    });
  }

  /* Все /api/* — требуют токен или Basic Auth */
  if (pathname.startsWith('/api/')) {
    if (!checkApiAuth(req)) return requireAuth(res);

    /* /api/search — МУЛЬТИПОИСК */
    if (pathname === '/api/search' && req.method === 'POST') {
      try {
        const body = await readBody(req);
        const q = (body.q || '').trim();
        const type = body.type || 'search';
        if (!q) return send(res, 400, { error: 'q required' });
        const data = await multiSearch(q, type);
        return send(res, 200, data);
      } catch (e) {
        console.error('[search]', e);
        return send(res, 500, { error: e.message });
      }
    }

    /* /api/fetch-url */
    if (pathname === '/api/fetch-url' && req.method === 'POST') {
      try {
        const body = await readBody(req);
        const url = (body.url || '').trim();
        if (!url) return send(res, 400, { error: 'url required' });
        if (!isSafeUrl(url)) return send(res, 400, { error: 'unsafe url' });

        const ytId = youtubeVideoId(url);
        if (ytId) {
          const yt = await fetchYouTube(ytId);
          return send(res, 200, {
            ok: true, type: 'video', source: 'youtube',
            url, title: yt.title, description: yt.description,
            channel: yt.channel, subtitles: yt.subtitles,
            hasSubtitles: !!yt.subtitles
          });
        }

        const r = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; NovaBot/1.0)',
            'Accept': 'text/html,application/xhtml+xml',
            'Accept-Language': 'ru,en;q=0.9'
          },
          redirect: 'follow'
        });
        if (!r.ok) return send(res, 502, { error: 'HTTP ' + r.status });

        const ct = r.headers.get('content-type') || '';
        if (!ct.includes('text/html') && !ct.includes('text/plain')) {
          return send(res, 200, { ok: true, type: 'file', contentType: ct });
        }
        const html = await r.text();
        const title = extractTitle(html);
        const text = htmlToText(html);
        return send(res, 200, {
          ok: true, type: 'page', url, title,
          text: text.slice(0, 12000),
          fullLength: text.length,
          truncated: text.length > 12000
        });
      } catch (e) {
        return send(res, 500, { error: e.message });
      }
    }

    /* /api/ai — прокси к ChatClaud */
    if (pathname === '/api/ai' && req.method === 'POST') {
      try {
        const body = await readBody(req);
        const endpoint = process.env.CHATCLAUD_URL || 'https://chatclaud.onrender.com';
        const r = await fetch(endpoint + '/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const text = await r.text();
        return send(res, r.status, text);
      } catch (e) {
        return send(res, 500, { error: e.message });
      }
    }

    return send(res, 404, { error: 'not found' });
  }

  /* Статика — Basic Auth */
  if (!checkBasicAuth(req)) return requireAuth(res);

  let filePath = safeJoin(ROOT, pathname === '/' ? '/public/index.html' : pathname);
  if (!filePath) return send(res, 403, { error: 'forbidden' });

  fs.readFile(filePath, (err, data) => {
    if (err) {
      const fallback = path.join(ROOT, 'public', 'index.html');
      if (fs.existsSync(fallback)) {
        return fs.readFile(fallback, (e2, html) => {
          if (e2) return send(res, 404, { error: 'not found' });
          send(res, 200, html, 'text/html; charset=utf-8');
        });
      }
      return send(res, 404, { error: 'not found' });
    }
    send(res, 200, data, contentType(filePath));
  });
});

server.listen(PORT, () => {
  console.log('Nova Browser v2.0 on port', PORT);
  console.log('Serper #1:', SERPER_KEY_1 ? 'OK' : 'MISSING');
  console.log('Serper #2:', SERPER_KEY_2 ? 'OK' : 'MISSING');
  console.log('Tavily:   ', TAVILY_KEY ? 'OK' : 'MISSING');
  console.log('Basic Auth:', process.env.SITE_USER ? 'ON' : 'OFF');
  console.log('API Token: ', process.env.API_TOKEN ? 'ON' : 'OFF');
});
