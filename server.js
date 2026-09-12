/**
 * Nova Browser — server.js v3.0
 *
 * Новое:
 *   - Кеш с разным TTL по типу (news 5м, search 30м, fetch 24ч)
 *   - /api/summarize — сжатие страниц (extractive + Tavily answer)
 *   - /api/multi-fetch — читать много URL параллельно
 *   - /api/related — похожие запросы
 *   - /api/trending — тренды
 *   - YouTube: субтитры с таймкодами
 *
 * Env:
 *   SERPER_KEY, SERPER_KEY_2, TAVILY_KEY
 *   API_TOKEN, SITE_USER, SITE_PASS
 *   CHATCLAUD_URL, NODE_ENV
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

/* ============================================
   КЛЮЧИ
   ============================================ */
const SERPER_KEY_1 = process.env.SERPER_KEY || '34e2b98552e12dafa0dcf1eb81399f3cbc435019';
const SERPER_KEY_2 = process.env.SERPER_KEY_2 || '1025273686ebb849b608e75816420fb6a99e7e78';
const TAVILY_KEY   = process.env.TAVILY_KEY || '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';

/* ============================================
   КЕШ с TTL по типу
   ============================================ */
const CACHE_TTL = {
  news:      5  * 60 * 1000,
  search:    30 * 60 * 1000,
  videos:    2  * 60 * 60 * 1000,
  images:    2  * 60 * 60 * 1000,
  fetch:     24 * 60 * 60 * 1000,
  summarize: 6  * 60 * 60 * 1000,
  related:   60 * 60 * 1000,
  trending:  15 * 60 * 1000
};

const cache = new Map();
const CACHE_MAX_SIZE = 500;

function cacheGet(key, type) {
  const v = cache.get(key);
  if (!v) return null;
  const ttl = CACHE_TTL[type] || CACHE_TTL.search;
  if (Date.now() - v.t > ttl) { cache.delete(key); return null; }
  return v.data;
}
function cacheSet(key, data) {
  cache.set(key, { t: Date.now(), data });
  if (cache.size > CACHE_MAX_SIZE) {
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
    '.ico': 'image/x-icon',
    '.webp': 'image/webp'
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
       .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
       .replace(/&mdash;/g, '—').replace(/&ndash;/g, '–');
  s = s.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

function extractTitle(html) {
  const m = String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? htmlToText(m[1]).slice(0, 200) : '';
}

function extractMeta(html, name) {
  const re = new RegExp('<meta[^>]+(?:name|property)=["\']' + name + '["\'][^>]+content=["\']([^"\']+)["\']', 'i');
  const re2 = new RegExp('<meta[^>]+content=["\']([^"\']+)["\'][^>]+(?:name|property)=["\']' + name + '["\']', 'i');
  const m = String(html).match(re) || String(html).match(re2);
  return m ? m[1].slice(0, 500) : '';
}

function youtubeVideoId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/|youtube\.com\/embed\/)([\w-]{11})/,
    /youtube\.com\/watch\?.*v=([\w-]{11})/
  ];
  for (const re of patterns) {
    const m = String(url).match(re);
    if (m) return m[1];
  }
  return null;
}

/* ============================================
   EXTRACTIVE SUMMARY (без LLM)
   ============================================ */
function extractiveSummary(text, maxSentences) {
  maxSentences = maxSentences || 6;
  const src = String(text || '').replace(/\s+/g, ' ').trim();
  if (src.length < 200) return src;

  // Разбиваем на предложения
  const sentences = src
    .split(/(?<=[.!?…])\s+(?=[А-ЯA-Z«"])/)
    .filter(s => s.length > 30 && s.length < 400);

  if (sentences.length <= maxSentences) return sentences.join(' ');

  // Скор предложений
  const scored = sentences.map((s, i) => {
    let score = 0;
    if (i === 0) score += 3;         // первое предложение
    if (i === 1) score += 2;         // второе
    if (/\d/.test(s)) score += 2;    // есть числа
    if (/[А-ЯA-Z]{3,}/.test(s)) score += 1;  // есть аббревиатуры
    if (/(важно|главное|ключев|итог|основн|результат|вывод)/i.test(s)) score += 2;
    if (s.length > 80 && s.length < 250) score += 1;  // средняя длина
    return { s, i, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const picked = scored.slice(0, maxSentences).sort((a, b) => a.i - b.i);

  return picked.map(x => x.s).join(' ');
}

/* ============================================
   SERPER
   ============================================ */
async function serperSearch(key, query, type, gl, hl) {
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
   TAVILY
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
  const merged = [];
  const seen = new Set();

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
        weight: er.source === 'serper1' ? 3 : er.source === 'serper2' ? 2 : 1
      });
    });
  });

  const tavilyAnswer = engineResults.find(e => e && e.source === 'tavily');
  const answer = tavilyAnswer && tavilyAnswer.data && tavilyAnswer.data.answer ? tavilyAnswer.data.answer : null;

  merged.sort((a, b) => {
    if (b.weight !== a.weight) return b.weight - a.weight;
    return a.position - b.position;
  });

  return { items: merged, answer };
}

/* ============================================
   МУЛЬТИПОИСК
   ============================================ */
async function multiSearch(query, type) {
  const cacheKey = 'search:' + type + ':' + query.toLowerCase();
  const cached = cacheGet(cacheKey, type);
  if (cached) {
    console.log('[cache hit]', cacheKey);
    return cached;
  }

  const tasks = [];
  tasks.push(serperSearch(SERPER_KEY_1, query, type).then(d => ({ source: 'serper1', data: d })).catch(() => null));
  if (SERPER_KEY_2 && SERPER_KEY_2 !== SERPER_KEY_1) {
    tasks.push(serperSearch(SERPER_KEY_2, query, type).then(d => ({ source: 'serper2', data: d })).catch(() => null));
  }
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
    organic: type === 'search' ? merged.items : undefined,
    videos: type === 'videos' ? merged.items : undefined,
    images: type === 'images' ? merged.items : undefined,
    news: type === 'news' ? merged.items : undefined,
    all: merged.items
  };

  cacheSet(cacheKey, output);
  return output;
}

/* ============================================
   YOUTUBE — субтитры с таймкодами
   ============================================ */
function formatTimecode(seconds) {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return h + ':' + String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
  return m + ':' + String(sec).padStart(2, '0');
}

async function fetchYouTube(videoId) {
  const result = {
    type: 'youtube', videoId, title: '', description: '', channel: '',
    duration: '', views: '', subtitles: '', subtitlesTimed: [],
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
    const pageRes = await fetch('https://www.youtube.com/watch?v=' + videoId, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        'Accept-Language': 'ru,en;q=0.9'
      }
    });
    const html = await pageRes.text();
    let m = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
    if (m) result.description = m[1];
    m = html.match(/"viewCount"\s*:\s*"(\d+)"/);
    if (m) result.views = m[1];
    m = html.match(/"ownerChannelName"\s*:\s*"([^"]+)"/);
    if (m && !result.channel) result.channel = m[1];
    m = html.match(/"lengthSeconds"\s*:\s*"(\d+)"/);
    if (m) result.duration = formatTimecode(parseInt(m[1], 10));

    // Субтитры
    m = html.match(/"captionTracks"\s*:\s*(\[[\s\S]*?\])/);
    if (m) {
      try {
        const tracks = JSON.parse(m[1]);
        let track = tracks.find(t => t.languageCode && t.languageCode.startsWith('ru'))
                 || tracks.find(t => t.languageCode && t.languageCode.startsWith('en'))
                 || tracks[0];
        if (track && track.baseUrl) {
          const capRes = await fetch(track.baseUrl);
          const capXml = await capRes.text();

          // Парсим с таймкодами
          const matches = [...capXml.matchAll(/<text[^>]*start="([\d.]+)"[^>]*?(?:dur="([\d.]+)")?[^>]*>([\s\S]*?)<\/text>/g)];
          const timed = matches.map(x => ({
            start: parseFloat(x[1]),
            time: formatTimecode(parseFloat(x[1])),
            text: x[3].replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
              .replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/\n/g,' ').trim()
          })).filter(x => x.text);

          if (timed.length) {
            // Разбиваем на 30-секундные блоки
            const blocks = [];
            let cur = { time: timed[0].time, start: timed[0].start, text: '' };
            timed.forEach(item => {
              if (item.start - cur.start > 30) {
                if (cur.text.trim()) blocks.push(cur);
                cur = { time: item.time, start: item.start, text: item.text };
              } else {
                cur.text += ' ' + item.text;
              }
            });
            if (cur.text.trim()) blocks.push(cur);

            result.subtitlesTimed = blocks.slice(0, 100).map(b => ({
              time: b.time,
              text: b.text.trim().slice(0, 300)
            }));

            result.subtitles = timed.map(x => x.text).join(' ').slice(0, 8000);
          }
        }
      } catch (e) {}
    }
  } catch (e) {}
  return result;
}

async function fetchOembed(url) {
  const tests = [
    { re: /vk\.com\/video/, api: 'https://vk.com/oembed?url=' + encodeURIComponent(url) + '&format=json' },
    { re: /rutube\.ru\/video/, api: 'https://rutube.ru/api/oembed/?url=' + encodeURIComponent(url) + '&format=json' },
    { re: /vimeo\.com\/\d+/, api: 'https://vimeo.com/api/oembed.json?url=' + encodeURIComponent(url) }
  ];
  for (const s of tests) {
    if (s.re.test(url)) {
      try {
        const r = await fetch(s.api);
        if (r.ok) return await r.json();
      } catch (e) {}
    }
  }
  return null;
}

/* ============================================
   FETCH URL (главная функция)
   ============================================ */
async function fetchUrlContent(cleanUrl, maxLength) {
  maxLength = maxLength || 12000;

  // YouTube
  const ytId = youtubeVideoId(cleanUrl);
  if (ytId) {
    const yt = await fetchYouTube(ytId);
    return {
      ok: true, type: 'video', source: 'youtube', url: cleanUrl,
      title: yt.title, description: yt.description, channel: yt.channel,
      duration: yt.duration, views: yt.views,
      subtitles: yt.subtitles || '',
      subtitlesTimed: yt.subtitlesTimed || [],
      hasSubtitles: !!yt.subtitles
    };
  }

  // VK / Rutube / Vimeo
  const oe = await fetchOembed(cleanUrl);
  if (oe) {
    return {
      ok: true, type: 'video', source: 'oembed', url: cleanUrl,
      title: oe.title || '', description: oe.description || '',
      channel: oe.author_name || '', thumbnail: oe.thumbnail_url || ''
    };
  }

  // Обычная страница
  const r = await fetch(cleanUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; NovaBot/1.0; +https://nova-browser.onrender.com)',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'ru,en;q=0.9'
    },
    redirect: 'follow'
  });
  if (!r.ok) return { ok: false, error: 'HTTP ' + r.status, url: cleanUrl };

  const ct = r.headers.get('content-type') || '';
  if (!ct.includes('text/html') && !ct.includes('text/plain')) {
    return { ok: true, type: 'file', url: cleanUrl, contentType: ct, message: 'Не HTML' };
  }

  const html = await r.text();
  const title = extractTitle(html);
  const description = extractMeta(html, 'description') || extractMeta(html, 'og:description');
  const fullText = htmlToText(html);

  return {
    ok: true, type: 'page', url: cleanUrl, title, description,
    text: fullText.slice(0, maxLength),
    fullLength: fullText.length,
    truncated: fullText.length > maxLength,
    summary: extractiveSummary(fullText, 5)
  };
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
      version: '3.0.0',
      engines: {
        serper1: !!SERPER_KEY_1,
        serper2: !!SERPER_KEY_2,
        tavily:  !!TAVILY_KEY
      },
      hasAuth: !!(process.env.SITE_USER && process.env.SITE_PASS),
      hasApiToken: !!process.env.API_TOKEN,
      chatclaud: process.env.CHATCLAUD_URL || 'https://chatclaud.onrender.com',
      cacheSize: cache.size,
      time: new Date().toISOString()
    });
  }

  /* Все /api/* — токен или Basic Auth */
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

        const cacheKey = 'fetch:' + url;
        const cached = cacheGet(cacheKey, 'fetch');
        if (cached) return send(res, 200, cached);

        const result = await fetchUrlContent(url);
        if (result && result.ok) cacheSet(cacheKey, result);
        return send(res, 200, result);
      } catch (e) {
        return send(res, 500, { error: e.message });
      }
    }

    /* /api/multi-fetch — читать несколько URL параллельно */
    if (pathname === '/api/multi-fetch' && req.method === 'POST') {
      try {
        const body = await readBody(req);
        const urls = Array.isArray(body.urls) ? body.urls.slice(0, 10) : [];
        if (!urls.length) return send(res, 400, { error: 'urls required' });

        const tasks = urls.map(async (rawUrl) => {
          const url = String(rawUrl).trim();
          if (!isSafeUrl(url)) return { url, ok: false, error: 'unsafe' };
          const cacheKey = 'fetch:' + url;
          const cached = cacheGet(cacheKey, 'fetch');
          if (cached) return cached;
          try {
            const result = await fetchUrlContent(url);
            if (result && result.ok) cacheSet(cacheKey, result);
            return result;
          } catch (e) {
            return { url, ok: false, error: e.message };
          }
        });

        const results = await Promise.all(tasks);
        return send(res, 200, {
          ok: true,
          count: results.length,
          success: results.filter(r => r && r.ok).length,
          results: results
        });
      } catch (e) {
        return send(res, 500, { error: e.message });
      }
    }

    /* /api/summarize — сжатие страницы или текста */
    if (pathname === '/api/summarize' && req.method === 'POST') {
      try {
        const body = await readBody(req);
        const url = (body.url || '').trim();
        const text = (body.text || '').trim();
        const maxSentences = Math.min(20, Math.max(3, parseInt(body.maxSentences, 10) || 6));

        if (!url && !text) return send(res, 400, { error: 'url or text required' });

        // Если URL — сначала читаем
        if (url) {
          if (!isSafeUrl(url)) return send(res, 400, { error: 'unsafe url' });
          const cacheKey = 'summarize:' + url + ':' + maxSentences;
          const cached = cacheGet(cacheKey, 'summarize');
          if (cached) return send(res, 200, cached);

          const page = await fetchUrlContent(url);
          if (!page || !page.ok) return send(res, 502, { error: 'fetch failed' });

          if (page.type === 'video' && page.subtitles) {
            const summary = extractiveSummary(page.subtitles, maxSentences);
            const result = {
              ok: true,
              type: 'video',
              url,
              title: page.title,
              channel: page.channel,
              summary,
              timed: page.subtitlesTimed || []
            };
            cacheSet(cacheKey, result);
            return send(res, 200, result);
          }

          if (page.type === 'page' && page.text) {
            const summary = extractiveSummary(page.text, maxSentences);
            const result = {
              ok: true,
              type: 'page',
              url,
              title: page.title,
              summary,
              keyPoints: summary.split(/(?<=[.!?…])\s+/).filter(s => s.length > 20).slice(0, 6)
            };
            cacheSet(cacheKey, result);
            return send(res, 200, result);
          }

          return send(res, 200, { ok: true, type: page.type, url, summary: page.description || page.title || '' });
        }

        // Если просто текст
        const summary = extractiveSummary(text, maxSentences);
        return send(res, 200, {
          ok: true,
          type: 'text',
          summary,
          keyPoints: summary.split(/(?<=[.!?…])\s+/).filter(s => s.length > 20).slice(0, 6)
        });
      } catch (e) {
        return send(res, 500, { error: e.message });
      }
    }

    /* /api/related — похожие запросы */
    if (pathname === '/api/related' && req.method === 'POST') {
      try {
        const body = await readBody(req);
        const q = (body.q || '').trim();
        if (!q) return send(res, 400, { error: 'q required' });

        const cacheKey = 'related:' + q.toLowerCase();
        const cached = cacheGet(cacheKey, 'related');
        if (cached) return send(res, 200, cached);

        // Serper даёт relatedSearches в organic
        const data = await serperSearch(SERPER_KEY_1, q, 'search');
        const related = [];
        if (data) {
          if (Array.isArray(data.relatedSearches)) {
            data.relatedSearches.forEach(r => {
              if (r.query) related.push(r.query);
            });
          }
          if (data.peopleAlsoAsk) {
            data.peopleAlsoAsk.forEach(r => {
              if (r.question) related.push(r.question);
            });
          }
        }

        const result = {
          ok: true,
          query: q,
          related: related.slice(0, 10)
        };
        cacheSet(cacheKey, result);
        return send(res, 200, result);
      } catch (e) {
        return send(res, 500, { error: e.message });
      }
    }

    /* /api/trending — тренды */
    if (pathname === '/api/trending' && req.method === 'GET') {
      try {
        const region = (u.searchParams.get('region') || 'ru').toLowerCase();
        const cacheKey = 'trending:' + region;
        const cached = cacheGet(cacheKey, 'trending');
        if (cached) return send(res, 200, cached);

        // Serper /news по общей теме
        const data = await serperSearch(SERPER_KEY_1, region === 'ru' ? 'новости сегодня' : 'top news today', 'news', region, region);
        const items = (data && data.news) || [];
        const trends = items.slice(0, 10).map(n => ({
          title: n.title || '',
          source: n.source || '',
          date: n.date || '',
          link: n.link || ''
        }));

        const result = { ok: true, region, count: trends.length, trends };
        cacheSet(cacheKey, result);
        return send(res, 200, result);
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

  /* Статика */
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
  console.log('Nova Browser v3.0 on port', PORT);
  console.log('Serper #1:', SERPER_KEY_1 ? 'OK' : 'MISSING');
  console.log('Serper #2:', SERPER_KEY_2 ? 'OK' : 'MISSING');
  console.log('Tavily:   ', TAVILY_KEY ? 'OK' : 'MISSING');
  console.log('Basic Auth:', process.env.SITE_USER ? 'ON' : 'OFF');
  console.log('API Token: ', process.env.API_TOKEN ? 'ON' : 'OFF');
});
