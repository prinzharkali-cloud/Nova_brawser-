/**
 * Nova Browser — server.js
 * Чистый Node.js, без зависимостей.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

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

/* ============ SSRF защита ============ */
function isSafeUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (!['http:', 'https:'].includes(u.protocol)) return false;
    const host = u.hostname.toLowerCase();
    if (
      host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' ||
      host.endsWith('.local') ||
      /^10\./.test(host) || /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
      /^169\.254\./.test(host)
    ) return false;
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
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/|youtube\.com\/embed\/)([\w-]{11})/
  ];
  for (const re of patterns) {
    const m = String(url).match(re);
    if (m) return m[1];
  }
  return null;
}

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
    const pageRes = await fetch('https://www.youtube.com/watch?v=' + videoId, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'ru,en;q=0.9' }
    });
    const html = await pageRes.text();
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
          const capRes = await fetch(track.baseUrl);
          const capXml = await capRes.text();
          const lines = [...capXml.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map(x =>
            x[1].replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#39;/g,"'").replace(/\n/g,' ')
          );
          result.subtitles = lines.join(' ').slice(0, 8000);
        }
      } catch (e) {}
    }
  } catch (e) {}
  return result;
}

/* ============ SERVER ============ */
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url || '/', 'http://localhost');
  const pathname = u.pathname;

  if (req.method === 'OPTIONS') return send(res, 204, '');

  /* ===== /api/health ===== */
  if (pathname === '/api/health') {
    return send(res, 200, {
      ok: true,
      version: '1.2.0',
      hasSerper: !!process.env.SERPER_KEY,
      chatclaud: process.env.CHATCLAUD_URL || 'https://chatclaud.onrender.com',
      time: new Date().toISOString()
    });
  }

  /* ===== /api/search — прокси к Serper ===== */
  if (pathname === '/api/search' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const q = body.q || '';
      const type = body.type || 'search';
      if (!q) return send(res, 400, { error: 'q required' });
      if (!process.env.SERPER_KEY) return send(res, 500, { error: 'SERPER_KEY не задан' });

      const endpoints = {
        search: 'https://google.serper.dev/search',
        images: 'https://google.serper.dev/images',
        videos: 'https://google.serper.dev/videos',
        news: 'https://google.serper.dev/news'
      };
      const url = endpoints[type] || endpoints.search;

      const r = await fetch(url, {
        method: 'POST',
        headers: {
          'X-API-KEY': process.env.SERPER_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ q, gl: 'ru', hl: 'ru', num: 20 })
      });
      const data = await r.json();
      return send(res, 200, data);
    } catch (e) {
      return send(res, 500, { error: e.message });
    }
  }

  /* ===== /api/fetch-url — читать страницы ===== */
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

  /* ===== /api/ai — прокси к ChatClaud ===== */
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

  /* ===== static ===== */
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
  console.log('Nova Browser on port', PORT);
  console.log('Serper key:', process.env.SERPER_KEY ? 'OK' : 'MISSING');
});
