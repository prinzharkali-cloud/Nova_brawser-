(function(){
'use strict';

/* ============================================
   КОНФИГ
   ============================================ */
var AI_URL = 'https://chatclaud.onrender.com';
var COMPANY = 'milanmichaimilan';

/* ============================================
   ХЕЛПЕРЫ
   ============================================ */
function $(id){ return document.getElementById(id); }
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
function escA(s){ return String(s==null?'':s).replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function enc(s){ try{ return btoa(unescape(encodeURIComponent(s))); }catch(e){ return s; } }
function dec(s){ try{ return decodeURIComponent(escape(atob(s))); }catch(e){ return ''; } }
function now(){ return Date.now(); }
function uid(){ return Math.random().toString(36).slice(2,10); }
function fmt(ts){ try{ return new Date(ts).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}); }catch(e){ return ''; } }

var LS = {
  get:function(k,d){ try{ var v=localStorage.getItem(k); return v===null?d:JSON.parse(v); }catch(e){ return d; } },
  set:function(k,v){ try{ localStorage.setItem(k,JSON.stringify(v)); return true; }catch(e){ return false; } },
  del:function(k){ try{ localStorage.removeItem(k); }catch(e){} }
};

var toastTid = null;
function toast(m, ms){
  ms = ms||2000;
  var t = $('toast');
  t.textContent = m;
  t.classList.add('on');
  clearTimeout(toastTid);
  toastTid = setTimeout(function(){ t.classList.remove('on'); }, ms);
}

/* ============================================
   АВТОРИЗАЦИЯ
   ============================================ */
var currentUser = null;
var authMode = 'login';

function getUsers(){ return LS.get('nb_users', {}); }
function saveUsers(u){ return LS.set('nb_users', u); }
function uKey(k){ return 'nb_' + currentUser + '_' + k; }
function uGet(k,d){ return LS.get(uKey(k), d); }
function uSet(k,v){ return LS.set(uKey(k), v); }

function setAuthMode(m){
  authMode = m;
  $('segL').classList.toggle('on', m === 'login');
  $('segR').classList.toggle('on', m === 'reg');
  $('wrapConf').style.display = (m === 'reg') ? 'block' : 'none';
  $('btnGo').textContent = (m === 'reg') ? 'Создать' : 'Войти';
  $('msg').textContent = ''; $('msg').className = 'msg';
}

function doAuth(){
  var nick = $('inNick').value.trim();
  var pass = $('inPass').value;
  var conf = $('inConf').value;
  var m = $('msg');
  function err(t){ m.className='msg e'; m.textContent=t; }
  function ok(t){ m.className='msg s'; m.textContent=t; }
  if (nick.length < 3){ err('Ник от 3 символов'); return; }
  if (pass.length < 4){ err('Пароль от 4 символов'); return; }
  var users = getUsers();
  if (authMode === 'reg'){
    if (pass !== conf){ err('Пароли не совпадают'); return; }
    if (users[nick]){ err('Ник занят'); return; }
    users[nick] = { pass: enc(pass), created: now() };
    if (!saveUsers(users)){ err('Ошибка сохранения'); return; }
    ok('Создано');
    setTimeout(function(){ enter(nick); }, 500);
  } else {
    if (!users[nick]){ err('Не найден'); return; }
    if (dec(users[nick].pass) !== pass){ err('Неверный пароль'); return; }
    ok('Вход...');
    setTimeout(function(){ enter(nick); }, 350);
  }
}

function enter(nick){
  currentUser = nick;
  LS.set('nb_current', nick);
  $('auth').classList.add('h');
  $('app').classList.add('on');
  $('uname').textContent = nick;
  $('ava').textContent = nick[0].toUpperCase();
  tabs = []; activeTab = null;
  newTab();
  initAI();

  if (window.__pendingSearch) {
    var p = window.__pendingSearch;
    window.__pendingSearch = null;
    setTimeout(function(){
      currentFilter = p.type;
      updateFilterBtns();
      doSearch(p.q, p.type);
    }, 500);
  }
}

function logout(){
  LS.del('nb_current');
  currentUser = null;
  tabs = []; activeTab = null;
  $('app').classList.remove('on');
  $('auth').classList.remove('h');
  $('inPass').value = ''; $('inConf').value = '';
  $('msg').textContent = ''; $('msg').className = 'msg';
  setAuthMode('login');
  closeDw(); closeAI();
}

/* ============================================
   ВКЛАДКИ
   ============================================ */
var tabs = [];
var activeTab = null;

function newTab(url){
  var t = {
    id: uid(),
    title: url ? url.replace(/^https?:\/\//,'').split('/')[0] : 'Новая',
    url: url || '',
    history: url ? [url] : [],
    hIndex: url ? 0 : -1,
    mode: url ? 'page' : 'home',
    query: '',
    results: null
  };
  tabs.push(t);
  activeTab = t.id;
  renderTabs(); renderActive();
  return t;
}

function closeTab(id){
  var i = -1;
  for (var k = 0; k < tabs.length; k++) if (tabs[k].id === id){ i = k; break; }
  if (i < 0) return;
  tabs.splice(i, 1);
  if (activeTab === id) activeTab = tabs.length ? tabs[Math.max(0,i-1)].id : null;
  if (!tabs.length){ newTab(); return; }
  renderTabs(); renderActive();
}

function switchTab(id){ activeTab = id; renderTabs(); renderActive(); }
function getActive(){ for (var i = 0; i < tabs.length; i++) if (tabs[i].id === activeTab) return tabs[i]; return null; }

function renderTabs(){
  var bar = $('tabs');
  if (!tabs.length){ bar.innerHTML = ''; return; }
  var h = '';
  for (var i = 0; i < tabs.length; i++){
    var t = tabs[i];
    h += '<div class="tb ' + (t.id === activeTab ? 'on' : '') + '" data-id="' + t.id + '">'
      + '<span class="tt">' + esc(t.title || 'Вкладка') + '</span>'
      + '<button class="x" data-close="' + t.id + '" type="button">✕</button></div>';
  }
  h += '<button class="tp" id="tabPlus" type="button">＋</button>';
  bar.innerHTML = h;
  var items = bar.querySelectorAll('.tb');
  for (var j = 0; j < items.length; j++){
    items[j].addEventListener('click', function(e){
      if (e.target.classList.contains('x')) return;
      switchTab(this.getAttribute('data-id'));
    });
  }
  var xs = bar.querySelectorAll('.x');
  for (var k = 0; k < xs.length; k++){
    xs[k].addEventListener('click', function(e){ e.stopPropagation(); closeTab(this.getAttribute('data-close')); });
  }
  var tp = $('tabPlus'); if (tp) tp.addEventListener('click', function(){ newTab(); });
}

function renderActive(){
  var t = getActive();
  if (!t){ $('ct').innerHTML = ''; updateNav(); return; }
  if (t.mode === 'home') renderHome();
  else if (t.mode === 'search') renderResults(t.results);
  else if (t.mode === 'images') renderImages(t.results);
  else if (t.mode === 'videos') renderVideos(t.results);
  else if (t.mode === 'news') renderNews(t.results);
  else if (t.mode === 'page') renderPage(t.url);
  $('q').value = t.query || t.url || '';
  updateNav();
}

function updateNav(){
  var t = getActive();
  $('btnBack').disabled = !t || t.hIndex <= 0;
  $('btnFwd').disabled = !t || !t.history || t.hIndex >= t.history.length - 1;
}

function pushHistory(t, url){
  if (!t.history) t.history = [];
  t.history = t.history.slice(0, t.hIndex + 1);
  t.history.push(url);
  t.hIndex = t.history.length - 1;
}

function navBack(){
  var t = getActive(); if (!t || t.hIndex <= 0) return;
  t.hIndex--; t.url = t.history[t.hIndex]; t.mode = 'page';
  renderActive();
}
function navFwd(){
  var t = getActive(); if (!t || t.hIndex >= t.history.length - 1) return;
  t.hIndex++; t.url = t.history[t.hIndex]; t.mode = 'page';
  renderActive();
}
function reloadTab(){
  var t = getActive(); if (!t) return;
  if (t.mode === 'page'){ renderPage(t.url); toast('Обновлено'); }
  else if (t.query && t.mode !== 'home') doSearch(t.query, t.mode);
}

/* ============================================
   ГЛАВНАЯ
   ============================================ */
function goHome(){
  var t = getActive();
  if (!t){ newTab(); return; }
  t.mode = 'home'; t.query = ''; t.url = '';
  $('q').value = '';
  currentFilter = 'search'; updateFilterBtns();
  renderTabs(); renderActive();
}

function updateFilterBtns(){
  var fls = document.querySelectorAll('.fl');
  for (var i = 0; i < fls.length; i++) fls[i].classList.toggle('on', fls[i].getAttribute('data-t') === currentFilter);
}

function renderHome(){
  var bms = uGet('bookmarks', []);
  var tops = uGet('topSites', []);
  var h = '<div class="hm">';
  h += '<div class="clk" id="clk"></div>';
  h += '<div class="dt" id="dt"></div>';

  h += '<div class="lb">ChatClaud</div><div class="gd">';
  h += '<div class="tl" id="homeAI"><div class="ic">◈</div><div class="nm">Чат</div></div>';
  h += '<a class="tl" href="' + escA(AI_URL) + '" target="_blank"><div class="ic">↗</div><div class="nm">Сайт</div></a>';
  h += '</div>';

  if (tops.length){
    h += '<div class="lb">Часто</div><div class="gd">';
    for (var i = 0; i < Math.min(tops.length, 6); i++){
      h += '<div class="tl" data-url="' + escA(tops[i].url) + '"><div class="ic">' + (tops[i].icon||'◈') + '</div><div class="nm">' + esc(tops[i].name || '') + '</div></div>';
    }
    h += '</div>';
  }

  h += '<div class="lb">Быстрый доступ</div><div class="gd">';
  var qs = [
    { n:'YouTube', u:'https://youtube.com', i:'▶' },
    { n:'GitHub', u:'https://github.com', i:'◆' },
    { n:'Wikipedia', u:'https://ru.wikipedia.org', i:'▤' },
    { n:'Habr', u:'https://habr.com', i:'◇' },
    { n:'Погода', u:'https://yandex.ru/pogoda', i:'◐' }
  ];
  for (var j = 0; j < qs.length; j++){
    h += '<div class="tl" data-url="' + escA(qs[j].u) + '"><div class="ic">' + qs[j].i + '</div><div class="nm">' + esc(qs[j].n) + '</div></div>';
  }
  h += '</div>';

  if (bms.length){
    h += '<div class="lb">Закладки</div><div class="gd">';
    for (var k = 0; k < Math.min(bms.length, 12); k++){
      h += '<div class="tl" data-url="' + escA(bms[k].url) + '"><div class="ic">★</div><div class="nm">' + esc(bms[k].title || bms[k].url) + '</div></div>';
    }
    h += '</div>';
  }
  h += '<div style="text-align:center;margin-top:44px;color:var(--text-3);font-size:9px;letter-spacing:2.5px">© ' + COMPANY.toUpperCase() + '</div>';
  h += '</div>';

  $('ct').innerHTML = h;
  var tiles = $('ct').querySelectorAll('.tl[data-url]');
  for (var m = 0; m < tiles.length; m++){
    tiles[m].addEventListener('click', function(){ openUrl(this.getAttribute('data-url')); });
  }
  var hai = $('homeAI'); if (hai) hai.addEventListener('click', openAI);
  startClock();
}

var clockTid = null;
function startClock(){
  clearInterval(clockTid);
  function upd(){
    var c = $('clk'), d = $('dt');
    if (!c || !d){ clearInterval(clockTid); return; }
    var n = new Date();
    c.textContent = n.toLocaleTimeString('ru-RU', { hour:'2-digit', minute:'2-digit' });
    d.textContent = n.toLocaleDateString('ru-RU', { weekday:'long', day:'numeric', month:'long' });
  }
  upd();
  clockTid = setInterval(upd, 1000);
}

/* ============================================
   ПОИСК
   ============================================ */
var currentFilter = 'search';

function search(){
  var query = $('q').value.trim();
  if (!query) return;
  if (/^https?:\/\//.test(query) || /^[\w-]+\.(ru|com|org|net|io|dev|ai|me|tv)(\/|$)/i.test(query)){
    openUrl(query.indexOf('http') === 0 ? query : 'https://' + query);
    return;
  }
  doSearch(query, currentFilter);
}

function doSearch(query, type){
  type = type || 'search';
  var t = getActive();
  if (!t) t = newTab();
  t.query = query; t.mode = type;
  $('ct').innerHTML = '<div class="ep"><div class="ic">⌕</div><div class="tx">Поиск...</div></div>';
  startProg();

  fetch('/api/search', {
    method:'POST',
    headers:{ 'Content-Type':'application/json' },
    body: JSON.stringify({ q: query, type: type })
  })
  .then(function(r){ return r.json(); })
  .then(function(d){
    t.results = d;
    endProg();
    if (type === 'search') renderResults(d);
    else if (type === 'images') renderImages(d);
    else if (type === 'videos') renderVideos(d);
    else if (type === 'news') renderNews(d);
    renderTabs();
  })
  .catch(function(e){
    endProg();
    $('ct').innerHTML = '<div class="ep"><div class="ic">!</div><div class="tx">Ошибка: ' + esc(e.message) + '</div></div>';
  });
}

function renderResults(d){
  var items = (d && (d.all || d.organic)) || [];
  var answer = (d && d.answer) || '';
  var engines = (d && d.enginesUsed) || [];

  if (!items.length && !answer){
    $('ct').innerHTML = '<div class="ep"><div class="ic">○</div><div class="tx">Ничего не найдено</div></div>';
    return;
  }

  var h = '<div class="rs">';

  if (answer){
    h += '<div class="answer-box"><div class="ab-label">Краткий ответ · AI</div><div class="ab-text">' + esc(answer) + '</div></div>';
  }

  if (engines.length && items.length){
    h += '<div class="engines-bar">' + engines.map(function(e){ return e.toUpperCase(); }).join(' + ') + ' · ' + items.length + ' результатов</div>';
  }

  for (var i = 0; i < items.length; i++){
    var item = items[i];
    h += '<div class="ri" data-url="' + escA(item.link) + '" style="animation-delay:' + (i*0.03) + 's">'
      + '<div class="t">' + esc(item.title || '') + '</div>'
      + '<div class="u">' + esc(item.link || '') + '</div>'
      + '<div class="d">' + esc(item.snippet || '') + '</div></div>';
  }
  h += '</div>';
  $('ct').innerHTML = h;
  bindResults();
}

function renderImages(d){
  var items = (d && (d.images || d.all)) || [];
  if (!items.length){ $('ct').innerHTML = '<div class="ep"><div class="ic">▣</div><div class="tx">Нет картинок</div></div>'; return; }
  var h = '<div class="ig">';
  for (var i = 0; i < items.length; i++){
    h += '<div class="ii" data-url="' + escA(items[i].link) + '"><img src="' + escA(items[i].imageUrl) + '" loading="lazy" onerror="this.style.opacity=0.3"><div class="cp">' + esc(items[i].title || '') + '</div></div>';
  }
  h += '</div>';
  $('ct').innerHTML = h;
  bindResults();
}

function renderVideos(d){
  var items = (d && (d.videos || d.all)) || [];
  if (!items.length){ $('ct').innerHTML = '<div class="ep"><div class="ic">▶</div><div class="tx">Нет видео</div></div>'; return; }
  var h = '<div class="rs">';
  for (var i = 0; i < items.length; i++){
    var it = items[i];
    var canEmbed = videoEmbedUrl(it.link);
    h += '<div class="ri" data-url="' + escA(it.link) + '"' + (canEmbed ? ' data-embed="' + escA(canEmbed) + '"' : '') + ' style="animation-delay:' + (i*0.03) + 's">'
      + '<div class="t">' + (canEmbed ? '▶ ' : '') + esc(it.title || '') + '</div>'
      + '<div class="u">' + esc(it.link || '') + '</div>'
      + '<div class="d">' + esc(it.snippet || '') + '</div></div>';
  }
  h += '</div>';
  $('ct').innerHTML = h;
  bindResults();
}

function renderNews(d){
  var items = (d && (d.news || d.all)) || [];
  if (!items.length){ $('ct').innerHTML = '<div class="ep"><div class="ic">▤</div><div class="tx">Нет новостей</div></div>'; return; }
  var h = '<div class="rs">';
  for (var i = 0; i < items.length; i++){
    h += '<div class="ri" data-url="' + escA(items[i].link) + '" style="animation-delay:' + (i*0.03) + 's">'
      + '<div class="t">' + esc(items[i].title || '') + '</div>'
      + '<div class="u">' + esc(items[i].source || '') + ' · ' + esc(items[i].date || '') + '</div>'
      + '<div class="d">' + esc(items[i].snippet || '') + '</div></div>';
  }
  h += '</div>';
  $('ct').innerHTML = h;
  bindResults();
}

function bindResults(){
  var els = $('ct').querySelectorAll('[data-url]');
  for (var i = 0; i < els.length; i++){
    els[i].addEventListener('click', function(){
      var embed = this.getAttribute('data-embed');
      if (embed) openPage(embed, this.getAttribute('data-url'));
      else openUrl(this.getAttribute('data-url'));
    });
  }
}

/* ============================================
   ВИДЕО EMBED
   ============================================ */
function videoEmbedUrl(url){
  if (!url) return null;
  var m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([\w-]{11})/);
  if (m) return 'https://www.youtube.com/embed/' + m[1] + '?autoplay=1&rel=0';
  m = url.match(/rutube\.ru\/video\/([\w]+)/);
  if (m) return 'https://rutube.ru/play/embed/' + m[1];
  m = url.match(/vk\.com\/video(-?\d+)_(\d+)/);
  if (m) return 'https://vk.com/video_ext.php?oid=' + m[1] + '&id=' + m[2] + '&hd=2';
  m = url.match(/vimeo\.com\/(\d+)/);
  if (m) return 'https://player.vimeo.com/video/' + m[1];
  return null;
}

/* ============================================
   ОТКРЫТИЕ
   ============================================ */
function openUrl(url){
  var t = getActive();
  if (!t) t = newTab(url);
  t.url = url; t.mode = 'page';
  t.title = url.replace(/^https?:\/\//, '').split('/')[0];
  pushHistory(t, url);
  renderActive(); renderTabs();
  addHistory(url, t.title);
  addTop(url, t.title);
}

function openPage(embedUrl, originalUrl){
  var t = getActive();
  if (!t) t = newTab(originalUrl);
  t.url = originalUrl; t.mode = 'page';
  t.title = originalUrl.replace(/^https?:\/\//, '').split('/')[0];
  pushHistory(t, originalUrl);
  renderActive(); renderTabs();
  addHistory(originalUrl, t.title);
  addTop(originalUrl, t.title);
  setTimeout(function(){
    var fr = $('ct').querySelector('iframe');
    if (fr) fr.src = embedUrl;
  }, 50);
}

function renderPage(url){
  var bms = uGet('bookmarks', []);
  var isB = false;
  for (var i = 0; i < bms.length; i++) if (bms[i].url === url){ isB = true; break; }
  var isH = url.indexOf('https://') === 0;
  var embedUrl = videoEmbedUrl(url);
  var srcUrl = embedUrl || url;

  var h = '<div class="ifw">';
  h += '<div class="ifb">';
  h += '<button class="nb" id="pgHome"><span class="s">⌂</span></button>';
  h += '<button class="nb" id="pgBack"><span class="s">←</span></button>';
  h += '<span style="color:var(--text-3);font-size:11px">' + (isH ? '🔒' : '⚠') + '</span>';
  h += '<span class="u">' + esc(url) + '</span>';
  h += '<button class="nb" id="pgBm"><span class="s">' + (isB ? '★' : '☆') + '</span></button>';
  h += '<a class="nb" href="' + escA(url) + '" target="_blank"><span class="s">↗</span></a>';
  h += '</div>';
  h += '<div class="frame-wrap">';
  h += '<iframe src="' + escA(srcUrl) + '" sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation"></iframe>';
  h += '<div class="blocked" id="blk"><div class="ic">◯</div><div class="tx">Сайт запрещает показ внутри браузера.</div><a class="but" href="' + escA(url) + '" target="_blank">Открыть внешне</a></div>';
  h += '</div></div>';

  $('ct').innerHTML = h;
  startProg();

  var fr = $('ct').querySelector('iframe');
  var loaded = false;
  if (fr){
    fr.addEventListener('load', function(){ loaded = true; endProg(); });
    setTimeout(function(){
      if (!loaded){ endProg(); var blk = $('blk'); if (blk) blk.classList.add('on'); }
    }, 6000);
  }
  $('pgHome').addEventListener('click', goHome);
  $('pgBack').addEventListener('click', navBack);
  $('pgBm').addEventListener('click', function(){ toggleBm(url, url); });
}

/* ============================================
   ЗАКЛАДКИ / ИСТОРИЯ / TOP
   ============================================ */
function toggleBm(url, title){
  var list = uGet('bookmarks', []);
  var i = -1;
  for (var k = 0; k < list.length; k++) if (list[k].url === url){ i = k; break; }
  if (i >= 0){ list.splice(i, 1); toast('Убрано из закладок'); }
  else { list.unshift({ url: url, title: title || url, ts: now() }); toast('★ Добавлено'); }
  uSet('bookmarks', list);
  renderActive();
}

function addHistory(url, title){
  var l = uGet('history', []);
  l.unshift({ url: url, title: title || url, ts: now() });
  uSet('history', l.slice(0, 300));
}

function addTop(url, title){
  var host = '';
  try { host = new URL(url).hostname; } catch(e){ return; }
  var l = uGet('topSites', []);
  var f = null;
  for (var i = 0; i < l.length; i++) if (l[i].url.indexOf(host) !== -1){ f = l[i]; break; }
  if (f) f.count = (f.count||0) + 1;
  else l.push({ url: url, name: title || host, icon: '◈', count: 1 });
  l.sort(function(a,b){ return (b.count||0) - (a.count||0); });
  uSet('topSites', l.slice(0, 12));
}

/* ============================================
   DRAWER
   ============================================ */
function openDw(type){
  $('dw').classList.add('on');
  var titles = { bookmarks: 'Закладки', history: 'История', settings: 'Настройки' };
  $('dwTitle').textContent = titles[type] || 'Панель';
  var b = $('dwBody');

  if (type === 'bookmarks'){
    var l = uGet('bookmarks', []);
    if (!l.length){ b.innerHTML = '<div class="emp">Нет закладок</div>'; return; }
    var h = '';
    for (var i = 0; i < l.length; i++){
      h += '<div class="di"><div class="inf" data-url="' + escA(l[i].url) + '"><div class="t">' + esc(l[i].title) + '</div><div class="s">' + esc(l[i].url) + '</div></div><button class="dl" data-del="' + i + '">✕</button></div>';
    }
    b.innerHTML = h; bindDw();
  }
  else if (type === 'history'){
    var hs = uGet('history', []);
    var hh = '';
    if (hs.length) hh += '<button class="btn" id="clrHs" style="margin-bottom:14px">Очистить историю</button>';
    if (hs.length){
      for (var j = 0; j < hs.length; j++){
        hh += '<div class="di"><div class="inf" data-url="' + escA(hs[j].url) + '"><div class="t">' + esc(hs[j].title) + '</div><div class="s">' + fmt(hs[j].ts) + '</div></div><button class="dl" data-hdel="' + j + '">✕</button></div>';
      }
    } else hh = '<div class="emp">История пуста</div>';
    b.innerHTML = hh; bindDw();
    var cb = $('clrHs');
    if (cb) cb.addEventListener('click', function(){
      if (confirm('Очистить всю историю?')){ uSet('history', []); openDw('history'); }
    });
  }
  else if (type === 'settings'){
    var sh = '<div style="text-align:center;padding:14px 0 22px"><div class="ava" style="width:64px;height:64px;font-size:24px;margin:0 auto 12px">' + esc(currentUser[0].toUpperCase()) + '</div>'
      + '<div style="font-size:15px;color:#fff;font-weight:600">' + esc(currentUser) + '</div></div>'
      + '<div class="di" style="cursor:default"><div class="inf"><div class="t">ChatClaud</div><div class="s">AI-чат с поиском</div></div><a class="nb" href="' + escA(AI_URL) + '" target="_blank"><span class="s">↗</span></a></div>'
      + '<div style="font-size:11px;color:var(--text-3);line-height:1.9;padding:16px 4px;text-align:center;letter-spacing:1px">NOVA · версия 3.0<br>© ' + COMPANY + '</div>'
      + '<button class="btn" id="outBtn" style="margin-top:10px;background:rgba(255,69,58,0.15);color:#ff453a">Выйти из аккаунта</button>';
    b.innerHTML = sh;
    $('outBtn').addEventListener('click', function(){ if (confirm('Выйти?')) logout(); });
  }
}

function bindDw(){
  var items = $('dwBody').querySelectorAll('.inf[data-url]');
  for (var i = 0; i < items.length; i++){
    items[i].addEventListener('click', function(){ openUrl(this.getAttribute('data-url')); closeDw(); });
  }
  var dels = $('dwBody').querySelectorAll('[data-del]');
  for (var j = 0; j < dels.length; j++){
    dels[j].addEventListener('click', function(){
      var idx = parseInt(this.getAttribute('data-del'), 10);
      var l = uGet('bookmarks', []); l.splice(idx, 1); uSet('bookmarks', l);
      openDw('bookmarks');
    });
  }
  var hdels = $('dwBody').querySelectorAll('[data-hdel]');
  for (var k = 0; k < hdels.length; k++){
    hdels[k].addEventListener('click', function(){
      var idx = parseInt(this.getAttribute('data-hdel'), 10);
      var l2 = uGet('history', []); l2.splice(idx, 1); uSet('history', l2);
      openDw('history');
    });
  }
}

function closeDw(){ $('dw').classList.remove('on'); }

/* ============================================
   AI PANEL (связка с ChatClaud)
   ============================================ */
var aiHistory = [];
var aiBusy = false;

function openAI(){
  $('ai').classList.add('on');
  setTimeout(function(){ $('aiIn').focus(); }, 250);
  try { window.ccUnlockSpeech && window.ccUnlockSpeech(); } catch(e){}
}
function closeAI(){ $('ai').classList.remove('on'); }

function initAI(){
  var hist = uGet('aiHistory', []);
  if (hist.length) aiHistory = hist;
  renderAI();
}

function renderAI(){
  var b = $('aib');
  var h = '';
  if (!aiHistory.length){
    h = '<div class="m a">Привет. Я ChatClaud. Ищу в интернете, читаю страницы, открываю видео в Nova. Просто напиши, что нужно.</div>';
  } else {
    for (var i = 0; i < aiHistory.length; i++){
      var m = aiHistory[i];
      h += '<div class="m ' + (m.role === 'user' ? 'u' : 'a') + '">' + esc(m.text) + '</div>';
    }
  }
  b.innerHTML = h;
  b.scrollTop = b.scrollHeight;
}

function addMsg(role, text){
  aiHistory.push({ role: role, text: text, ts: now() });
  if (aiHistory.length > 100) aiHistory = aiHistory.slice(-80);
  uSet('aiHistory', aiHistory);
  renderAI();
}

function clearAI(){
  if (!confirm('Очистить чат?')) return;
  aiHistory = []; uSet('aiHistory', []); renderAI();
}

function sendAI(){
  var inp = $('aiIn');
  var text = inp.value.trim();
  if (!text || aiBusy) return;
  inp.value = ''; inp.style.height = 'auto';
  addMsg('user', text);
  aiBusy = true;
  $('aiSend').disabled = true;
  $('aiSt').textContent = 'думает...';

  var ctx = getBrowserContext();

  fetch('/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: text, history: aiHistory.slice(-10), context: ctx })
  })
  .then(function(r){ return r.text(); })
  .then(function(resp){ handleAIResponse(resp); })
  .catch(function(e){
    addMsg('assistant', 'Не удалось связаться с ChatClaud: ' + e.message);
  })
  .then(function(){
    aiBusy = false;
    $('aiSend').disabled = false;
    $('aiSt').textContent = 'готов';
  });
}

function getBrowserContext(){
  var t = getActive();
  if (!t) return { mode: 'home' };
  var ctx = { mode: t.mode, url: t.url || null, title: t.title || null, query: t.query || null };
  if (t.results && t.mode === 'search') ctx.topResults = (t.results.organic || t.results.all || []).slice(0, 5).map(function(x){ return { title:x.title, url:x.link }; });
  if (t.results && t.mode === 'videos') ctx.topResults = (t.results.videos || t.results.all || []).slice(0, 5).map(function(x){ return { title:x.title, url:x.link }; });
  return ctx;
}

function handleAIResponse(resp){
  var text = String(resp || '');
  var cmdRe = /\[NOVA:(\w+)=([^\]]+)\]/g;
  var cleanText = text.replace(cmdRe, '').trim();
  if (cleanText) addMsg('assistant', cleanText);
  else addMsg('assistant', '(выполняю)');
  var m;
  cmdRe.lastIndex = 0;
  while ((m = cmdRe.exec(text)) !== null){ executeNovaCommand(m[1], m[2]); }
}

function executeNovaCommand(action, value){
  switch (action){
    case 'search': $('q').value = value; currentFilter = 'search'; updateFilterBtns(); closeAI(); search(); break;
    case 'images': $('q').value = value; currentFilter = 'images'; updateFilterBtns(); closeAI(); doSearch(value, 'images'); break;
    case 'videos': $('q').value = value; currentFilter = 'videos'; updateFilterBtns(); closeAI(); doSearch(value, 'videos'); break;
    case 'news': $('q').value = value; currentFilter = 'news'; updateFilterBtns(); closeAI(); doSearch(value, 'news'); break;
    case 'open': closeAI(); openUrl(value); break;
    case 'video': closeAI(); var em = videoEmbedUrl(value); if (em) openPage(value, em); else openUrl(value); break;
    case 'bookmark': toggleBm(value, value); break;
    case 'home': closeAI(); goHome(); break;
    case 'notify': toast(value); break;
  }
}

// Мост для внешних вызовов
window.NovaBridge = {
  version: '3.0',
  search: function(q, type){ currentFilter = type || 'search'; updateFilterBtns(); doSearch(q, currentFilter); },
  open: function(url){ openUrl(url); },
  video: function(url){ var em = videoEmbedUrl(url); if (em) openPage(url, em); else openUrl(url); },
  bookmark: function(url, title){ toggleBm(url, title); },
  home: function(){ goHome(); },
  notify: function(m){ toast(m); },
  context: function(){ return getBrowserContext(); },
  command: function(a, v){ executeNovaCommand(a, v); }
};

window.addEventListener('message', function(e){
  var d = e.data;
  if (!d || typeof d !== 'object') return;
  if (d.type === 'nova-cmd' && d.action) executeNovaCommand(d.action, d.value || '');
});

/* ============================================
   ТЕМА
   ============================================ */
function toggleTheme(){
  var isLight = document.body.style.background === 'rgb(245, 245, 247)';
  toast(isLight ? 'Тёмная тема' : 'Светлая тема');
}

/* ============================================
   ГОЛОС
   ============================================ */
function voice(){
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR){ toast('Голос не поддерживается'); return; }
  var r = new SR();
  r.lang = 'ru-RU'; r.interimResults = false;
  toast('Слушаю...');
  r.onresult = function(e){ var t = e.results[0][0].transcript; $('q').value = t; toast('«' + t + '»'); setTimeout(search, 300); };
  r.onerror = function(e){ toast('Ошибка: ' + e.error); };
  try { r.start(); } catch(e){ toast('Микрофон недоступен'); }
}

/* ============================================
   ПРОГРЕСС
   ============================================ */
var progTid = null;
function startProg(){
  var p = $('prog'), b = $('progBar');
  p.classList.add('on');
  var w = 0; b.style.width = '0%';
  clearInterval(progTid);
  progTid = setInterval(function(){ w += Math.random() * 12; if (w > 88) w = 88; b.style.width = w + '%'; }, 180);
}
function endProg(){
  var p = $('prog'), b = $('progBar');
  clearInterval(progTid); b.style.width = '100%';
  setTimeout(function(){ p.classList.remove('on'); b.style.width = '0%'; }, 300);
}

/* ============================================
   ОБРАБОТЧИКИ
   ============================================ */
$('segL').addEventListener('click', function(){ setAuthMode('login'); });
$('segR').addEventListener('click', function(){ setAuthMode('reg'); });
$('btnGo').addEventListener('click', doAuth);
$('inPass').addEventListener('keydown', function(e){ if (e.key === 'Enter') doAuth(); });
$('inConf').addEventListener('keydown', function(e){ if (e.key === 'Enter') doAuth(); });
$('inNick').addEventListener('keydown', function(e){ if (e.key === 'Enter') $('inPass').focus(); });

$('btnHome').addEventListener('click', goHome);
$('btnBack').addEventListener('click', navBack);
$('btnFwd').addEventListener('click', navFwd);
$('btnRl').addEventListener('click', reloadTab);
$('btnBm').addEventListener('click', function(){ openDw('bookmarks'); });
$('btnMenu').addEventListener('click', function(){ openDw('settings'); });
$('btnUser').addEventListener('click', function(){ openDw('settings'); });
$('btnAI').addEventListener('click', openAI);
$('dwClose').addEventListener('click', closeDw);

$('mHome').addEventListener('click', goHome);
$('mAI').addEventListener('click', openAI);
$('mBm').addEventListener('click', function(){ openDw('bookmarks'); });
$('mHs').addEventListener('click', function(){ openDw('history'); });
$('mMenu').addEventListener('click', function(){ openDw('settings'); });

$('q').addEventListener('keydown', function(e){ if (e.key === 'Enter'){ e.preventDefault(); search(); } });
$('btnMic').addEventListener('click', voice);

$('aiClose').addEventListener('click', closeAI);
$('aiClr').addEventListener('click', clearAI);
$('aiSend').addEventListener('click', sendAI);
$('aiIn').addEventListener('keydown', function(e){
  if (e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); sendAI(); }
});
$('aiIn').addEventListener('input', function(){
  this.style.height = 'auto';
  this.style.height = Math.min(this.scrollHeight, 120) + 'px';
});

var fls = document.querySelectorAll('.fl');
for (var fi = 0; fi < fls.length; fi++){
  (function(btn){
    btn.addEventListener('click', function(){
      currentFilter = btn.getAttribute('data-t');
      updateFilterBtns();
      var t = getActive();
      if (t && t.query) doSearch(t.query, currentFilter);
    });
  })(fls[fi]);
}

/* ============================================
   ЗАПУСК
   ============================================ */
window.addEventListener('load', function(){
  console.log('%cNova Browser v3.0 · chatclaud','color:#a78bfa;font-family:monospace;font-size:14px');

  // Читаем ?q=...&type=... из URL
  var params = new URLSearchParams(window.location.search);
  var q = params.get('q');
  var type = params.get('type') || 'search';
  var allowed = ['search', 'images', 'videos', 'news'];
  if (allowed.indexOf(type) === -1) type = 'search';
  if (q) {
    window.__pendingSearch = { q: q, type: type };
    try { history.replaceState(null, '', window.location.pathname); } catch(e){}
  }

  // Автологин
  try {
    var cur = LS.get('nb_current', null);
    var users = getUsers();
    if (cur && users[cur]) enter(cur);
  } catch(e){}
});

})();
