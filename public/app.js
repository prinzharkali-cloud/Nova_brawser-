(function(){
'use strict';

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
    if (!saveUsers(users)){ err('Ошибка'); return; }
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
  closeDw();
}

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
      + '<button class="x" data-close="' + t.id + '">✕</button></div>';
  }
  h += '<button class="tp" id="tabPlus">＋</button>';
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
  var h = '<div class="hm">';
  h += '<div class="clk" id="clk"></div>';
  h += '<div class="dt" id="dt"></div>';

  h += '<div class="lb">Быстрый доступ</div><div class="gd">';
  var qs = [
    { n:'YouTube', u:'https://youtube.com', i:'▶' },
    { n:'GitHub', u:'https://github.com', i:'◆' },
    { n:'Wiki', u:'https://ru.wikipedia.org', i:'▤' },
    { n:'Habr', u:'https://habr.com', i:'◇' },
    { n:'ChatClaud', u:'https://chatclaud.onrender.com', i:'◈' }
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
  h += '<div style="text-align:center;margin-top:36px;color:var(--tx3);font-size:9px;letter-spacing:2px">© MILANMICHAIMILAN</div>';
  h += '</div>';

  $('ct').innerHTML = h;
  var tiles = $('ct').querySelectorAll('.tl[data-url]');
  for (var m = 0; m < tiles.length; m++){
    tiles[m].addEventListener('click', function(){ openUrl(this.getAttribute('data-url')); });
  }
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
  var items = (d && d.organic) || [];
  if (!items.length){ $('ct').innerHTML = '<div class="ep"><div class="ic">○</div><div class="tx">Ничего не найдено</div></div>'; return; }
  var h = '<div class="rs">';
  for (var i = 0; i < items.length; i++){
    h += '<div class="ri" data-url="' + escA(items[i].link) + '">'
      + '<div class="t">' + esc(items[i].title || '') + '</div>'
      + '<div class="u">' + esc(items[i].link || '') + '</div>'
      + '<div class="d">' + esc(items[i].snippet || '') + '</div></div>';
  }
  h += '</div>';
  $('ct').innerHTML = h;
  bindResults();
}

function renderImages(d){
  var items = (d && d.images) || [];
  if (!items.length){ $('ct').innerHTML = '<div class="ep"><div class="ic">▣</div><div class="tx">Нет картинок</div></div>'; return; }
  var h = '<div class="ig">';
  for (var i = 0; i < items.length; i++){
    h += '<div class="ii" data-url="' + escA(items[i].link) + '"><img src="' + escA(items[i].imageUrl) + '" loading="lazy"><div class="cp">' + esc(items[i].title || '') + '</div></div>';
  }
  h += '</div>';
  $('ct').innerHTML = h;
  bindResults();
}

function renderVideos(d){
  var items = (d && d.videos) || [];
  if (!items.length){ $('ct').innerHTML = '<div class="ep"><div class="ic">▶</div><div class="tx">Нет видео</div></div>'; return; }
  var h = '<div class="rs">';
  for (var i = 0; i < items.length; i++){
    var it = items[i];
    var canEmbed = videoEmbedUrl(it.link);
    h += '<div class="ri" data-url="' + escA(it.link) + '"' + (canEmbed ? ' data-embed="' + escA(canEmbed) + '"' : '') + '>'
      + '<div class="t">' + (canEmbed ? '▶ ' : '') + esc(it.title || '') + '</div>'
      + '<div class="u">' + esc(it.link || '') + '</div>'
      + '<div class="d">' + esc(it.snippet || '') + '</div></div>';
  }
  h += '</div>';
  $('ct').innerHTML = h;
  bindResults();
}

function renderNews(d){
  var items = (d && d.news) || [];
  if (!items.length){ $('ct').innerHTML = '<div class="ep"><div class="ic">▤</div><div class="tx">Нет новостей</div></div>'; return; }
  var h = '<div class="rs">';
  for (var i = 0; i < items.length; i++){
    h += '<div class="ri" data-url="' + escA(items[i].link) + '">'
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

function videoEmbedUrl(url){
  if (!url) return null;
  var m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([\w-]{11})/);
  if (m) return 'https://www.youtube.com/embed/' + m[1] + '?autoplay=1&rel=0';
  m = url.match(/rutube\.ru\/video\/([\w]+)/);
  if (m) return 'https://rutube.ru/play/embed/' + m[1];
  m = url.match(/vk\.com\/video(-?\d+)_(\d+)/);
  if (m) return 'https://vk.com/video_ext.php?oid=' + m[1] + '&id=' + m[2] + '&hd=2';
  return null;
}

function openUrl(url){
  var t = getActive();
  if (!t) t = newTab(url);
  t.url = url; t.mode = 'page';
  t.title = url.replace(/^https?:\/\//, '').split('/')[0];
  pushHistory(t, url);
  renderActive(); renderTabs();
  addHistory(url, t.title);
}

function openPage(embedUrl, originalUrl){
  var t = getActive();
  if (!t) t = newTab(originalUrl);
  t.url = originalUrl; t.mode = 'page';
  t.title = originalUrl.replace(/^https?:\/\//, '').split('/')[0];
  pushHistory(t, originalUrl);
  renderActive(); renderTabs();
  addHistory(originalUrl, t.title);
  setTimeout(function(){
    var fr = $('ct').querySelector('iframe');
    if (fr) fr.src = embedUrl;
  }, 100);
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
  h += '<button class="nb" id="pgHome">⌂</button>';
  h += '<button class="nb" id="pgBack">←</button>';
  h += '<span>' + (isH ? '⌂' : '!') + '</span>';
  h += '<span class="u">' + esc(url) + '</span>';
  h += '<button class="nb" id="pgBm">' + (isB ? '★' : '☆') + '</button>';
  h += '<a class="nb" href="' + escA(url) + '" target="_blank">↗</a>';
  h += '</div>';
  h += '<div class="frame-wrap">';
  h += '<iframe src="' + escA(srcUrl) + '" sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"></iframe>';
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

function toggleBm(url, title){
  var list = uGet('bookmarks', []);
  var i = -1;
  for (var k = 0; k < list.length; k++) if (list[k].url === url){ i = k; break; }
  if (i >= 0){ list.splice(i, 1); toast('Убрано'); }
  else { list.unshift({ url: url, title: title || url, ts: now() }); toast('★ Добавлено'); }
  uSet('bookmarks', list);
  renderActive();
}

function addHistory(url, title){
  var l = uGet('history', []);
  l.unshift({ url: url, title: title || url, ts: now() });
  uSet('history', l.slice(0, 300));
}

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
    if (hs.length) hh += '<button class="btn" id="clrHs" style="margin-bottom:14px">Очистить</button>';
    if (hs.length){
      for (var j = 0; j < hs.length; j++){
        hh += '<div class="di"><div class="inf" data-url="' + escA(hs[j].url) + '"><div class="t">' + esc(hs[j].title) + '</div><div class="s">' + fmt(hs[j].ts) + '</div></div><button class="dl" data-hdel="' + j + '">✕</button></div>';
      }
    } else hh = '<div class="emp">История пуста</div>';
    b.innerHTML = hh; bindDw();
    var cb = $('clrHs');
    if (cb) cb.addEventListener('click', function(){
      if (confirm('Очистить?')){ uSet('history', []); openDw('history'); }
    });
  }
  else if (type === 'settings'){
    var sh = '<div style="text-align:center;padding:10px 0 20px"><div class="ava" style="width:60px;height:60px;font-size:22px;margin:0 auto 12px">' + esc(currentUser[0].toUpperCase()) + '</div>'
      + '<div style="font-size:14px">' + esc(currentUser) + '</div></div>'
      + '<div style="font-size:11px;color:var(--tx3);line-height:1.9;padding:8px 0;text-align:center">NOVA · версия 1.2<br>© milanmichaimilan</div>'
      + '<button class="btn" id="outBtn" style="margin-top:14px;background:var(--bg3);color:var(--tx)">Выйти</button>';
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

function voice(){
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR){ toast('Голос не поддерживается'); return; }
  var r = new SR();
  r.lang = 'ru-RU'; r.interimResults = false;
  var b = $('btnMic');
  toast('Слушаю...');
  r.onresult = function(e){ var t = e.results[0][0].transcript; $('q').value = t; toast('«' + t + '»'); setTimeout(search, 300); };
  r.onerror = function(e){ toast('Ошибка: ' + e.error); };
  r.onend = function(){};
  try { r.start(); } catch(e){ toast('Микрофон недоступен'); }
}

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

/* ОБРАБОТЧИКИ */
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
$('btnHs').addEventListener('click', function(){ openDw('history'); });
$('btnMenu').addEventListener('click', function(){ openDw('settings'); });
$('btnUser').addEventListener('click', function(){ openDw('settings'); });
$('dwClose').addEventListener('click', closeDw);

$('q').addEventListener('keydown', function(e){ if (e.key === 'Enter'){ e.preventDefault(); search(); } });
$('btnMic').addEventListener('click', voice);

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

window.addEventListener('load', function(){
  console.log('%cNova Browser v1.2','color:#888;font-family:monospace');
  var params = new URLSearchParams(window.location.search);
  var q = params.get('q');
  var type = params.get('type') || 'search';
  var allowed = ['search', 'images', 'videos', 'news'];
  if (allowed.indexOf(type) === -1) type = 'search';
  if (q) {
    window.__pendingSearch = { q: q, type: type };
    try { history.replaceState(null, '', window.location.pathname); } catch(e){}
  }
  try {
    var cur = LS.get('nb_current', null);
    var users = getUsers();
    if (cur && users[cur]) enter(cur);
  } catch(e){}
});

})();
