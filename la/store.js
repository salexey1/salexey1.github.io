/*
 * Мой магазин расширений для Lampa
 * Подключение в Lampa: https://salexey1.github.io/la/store.js
 * Каталог:             https://salexey1.github.io/la/extensions.json
 *
 * Что делает: добавляет пункт «Мой магазин» в левое меню и в настройки,
 * читает каталог по ссылке и позволяет установить, включить/выключить
 * и удалить расширения из него. Код написан в стиле ES5 для старых ТВ-браузеров.
 */
(function () {
  'use strict';

  if (window.my_lampa_store_loaded) return;
  window.my_lampa_store_loaded = true;

  var CONFIG = {
    name: 'Мой магазин',
    catalog: 'https://lampaplugins.github.io/store/extensions.json',
    timeout: 15000
  };

  var ICON = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M4 7h16l-1.2 12.1a1 1 0 0 1-1 .9H6.2a1 1 0 0 1-1-.9L4 7z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>' +
    '<path d="M8 7V6a4 4 0 0 1 8 0v1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

  var catalogCache = null;   // последний успешно загруженный каталог
  var activeRequest = null;

  /* ---------- мелкие помощники ---------- */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function cut(s, n) {
    s = String(s || '');
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  function key(url) {
    return String(url || '').split('#')[0].split('?')[0].toLowerCase();
  }

  function noty(text) {
    try { Lampa.Noty.show(text); } catch (e) { /* без уведомления можно жить */ }
  }

  /* ---------- список установленных плагинов ---------- */

  function getPlugins() {
    var list = Lampa.Storage.get('plugins', '[]');
    if (typeof list === 'string') {
      try { list = JSON.parse(list); } catch (e) { list = []; }
    }
    return Array.isArray(list) ? list : [];
  }

  function savePlugins(list) {
    Lampa.Storage.set('plugins', list);
  }

  function findInstalled(url) {
    var k = key(url);
    var list = getPlugins();
    for (var i = 0; i < list.length; i++) {
      if (key(list[i].url) === k) return list[i];
    }
    return null;
  }

  function install(item) {
    if (findInstalled(item.url)) return true;
    var entry = { url: item.url, status: 1, name: item.name, author: item.author };
    try {
      if (Lampa.Plugins && typeof Lampa.Plugins.add === 'function') Lampa.Plugins.add(entry);
    } catch (e) { /* ниже есть запасной путь */ }
    if (!findInstalled(item.url)) {
      var list = getPlugins();
      list.push(entry);
      savePlugins(list);
    }
    return !!findInstalled(item.url);
  }

  function uninstall(item) {
    var found = findInstalled(item.url);
    if (!found) return true;
    try {
      if (Lampa.Plugins && typeof Lampa.Plugins.remove === 'function') Lampa.Plugins.remove(found);
    } catch (e) { /* ниже есть запасной путь */ }
    if (findInstalled(item.url)) {
      var k = key(item.url);
      savePlugins(getPlugins().filter(function (p) { return key(p.url) !== k; }));
    }
    return !findInstalled(item.url);
  }

  function toggle(item) {
    var k = key(item.url);
    var list = getPlugins();
    var state = null;
    list.forEach(function (p) {
      if (key(p.url) === k) { p.status = p.status ? 0 : 1; state = p.status; }
    });
    if (state !== null) savePlugins(list);
    return state;
  }

  /* ---------- каталог ---------- */

  function toItem(o) {
    if (!o || typeof o !== 'object') return null;
    var url = o.link || o.url || o.src;
    if (!url) return null;
    return {
      name: o.name || o.title || url,
      author: o.author || '',
      url: url,
      descr: o.descr || o.description || '',
      version: o.version || ''
    };
  }

  function itemsOf(list) {
    return (Array.isArray(list) ? list : []).map(toItem).filter(Boolean);
  }

  // Понимает несколько форм каталога:
  //  1) [{ "title": "Категория", "plugins": [ {name, author, link, descr, version} ] }]
  //  2) { "categories": [ ... ] } / { "results": [ ... ] } / { "extensions": [ ... ] }
  //  3) плоский список плагинов
  //  4) { "Категория": [ ...плагины... ] }
  function normalize(data) {
    var cats = [];
    var arr = data;
    if (!Array.isArray(data) && data && typeof data === 'object') {
      arr = data.categories || data.results || data.extensions || data.plugins || data.items || data.list || data.data;
      if (!Array.isArray(arr)) {
        arr = null;
        Object.keys(data).forEach(function (k) {
          if (Array.isArray(data[k])) {
            var items = itemsOf(data[k]);
            if (items.length) cats.push({ title: k, items: items });
          }
        });
        return cats;
      }
    }
    if (!Array.isArray(arr)) return cats;

    var flat = itemsOf(arr);
    if (flat.length && flat.length === arr.length) {
      cats.push({ title: 'Все', items: flat });
      return cats;
    }
    arr.forEach(function (c) {
      if (!c || typeof c !== 'object') return;
      var items = itemsOf(c.plugins || c.items || c.results || c.extensions || c.list);
      if (items.length) cats.push({ title: c.title || c.name || c.category || 'Без категории', items: items });
    });
    return cats;
  }

  function loadCatalog(ok, fail, force) {
    if (catalogCache && !force) return ok(catalogCache);
    var xhr = new XMLHttpRequest();
    activeRequest = xhr;
    var url = CONFIG.catalog + (CONFIG.catalog.indexOf('?') > -1 ? '&' : '?') + '_=' + Date.now();
    xhr.open('GET', url, true);
    xhr.timeout = CONFIG.timeout;
    xhr.onload = function () {
      activeRequest = null;
      if (xhr.status < 200 || xhr.status >= 300) return fail('HTTP ' + xhr.status);
      try {
        var cats = normalize(JSON.parse(xhr.responseText));
        if (!cats.length) return fail('каталог пуст или в неизвестном формате');
        catalogCache = cats;
        ok(cats);
      } catch (e) {
        fail('не удалось разобрать JSON: ' + e.message);
      }
    };
    xhr.onerror = function () { activeRequest = null; fail('нет соединения'); };
    xhr.ontimeout = function () { activeRequest = null; fail('превышено время ожидания'); };
    xhr.send();
  }

  /* ---------- интерфейс ---------- */

  function openStore(force) {
    var back = Lampa.Controller.enabled().name;
    Lampa.Loading.start(function () {
      if (activeRequest) activeRequest.abort();
      Lampa.Loading.stop();
      Lampa.Controller.toggle(back);
    });
    loadCatalog(function (cats) {
      Lampa.Loading.stop();
      showCategories(cats, back);
    }, function (err) {
      Lampa.Loading.stop();
      noty('Не удалось загрузить каталог: ' + err);
      Lampa.Controller.toggle(back);
    }, force === true);
  }

  function later(fn) { setTimeout(fn, 10); }

  function showCategories(cats, back) {
    var total = 0;
    var items = cats.map(function (c, i) {
      total += c.items.length;
      return { title: esc(c.title) + ' · ' + c.items.length, index: i };
    });
    items.push({ title: 'Другое', separator: true });
    items.push({ title: 'Обновить каталог', refresh: true });
    items.push({ title: 'Перезагрузить Lampa (применить изменения)', reload: true });

    Lampa.Select.show({
      title: esc(CONFIG.name) + ' · ' + total,
      items: items,
      onBack: function () { Lampa.Controller.toggle(back); },
      onSelect: function (a) {
        Lampa.Controller.toggle(back);
        if (a.refresh) { later(function () { openStore(true); }); return; }
        if (a.reload) { window.location.reload(); return; }
        later(function () { showPlugins(cats[a.index], cats, back); });
      }
    });
  }

  function showPlugins(cat, cats, back) {
    var items = cat.items.map(function (p, i) {
      var inst = findInstalled(p.url);
      var mark = inst ? (inst.status ? '✓ ' : '○ ') : '';
      var sub = [p.author, p.descr].filter(Boolean).join(' · ');
      return {
        title: mark + esc(p.name) + (p.version ? ' v' + esc(p.version) : ''),
        subtitle: esc(cut(sub, 120)),
        index: i
      };
    });

    Lampa.Select.show({
      title: esc(cat.title),
      items: items,
      onBack: function () {
        Lampa.Controller.toggle(back);
        later(function () { showCategories(cats, back); });
      },
      onSelect: function (a) {
        Lampa.Controller.toggle(back);
        later(function () { showActions(cat.items[a.index], cat, cats, back); });
      }
    });
  }

  function showActions(item, cat, cats, back) {
    var inst = findInstalled(item.url);
    var items = [];
    if (!inst) {
      items.push({ title: 'Установить', act: 'install' });
    } else {
      items.push({ title: inst.status ? 'Выключить' : 'Включить', act: 'toggle' });
      items.push({ title: 'Удалить', act: 'remove' });
    }
    if (item.descr) items.push({ title: 'Описание', subtitle: esc(cut(item.descr, 300)), act: 'info' });
    items.push({ title: 'Скопировать ссылку', subtitle: esc(cut(item.url, 100)), act: 'copy' });

    var again = function () { later(function () { showActions(item, cat, cats, back); }); };

    Lampa.Select.show({
      title: esc(item.name),
      items: items,
      onBack: function () {
        Lampa.Controller.toggle(back);
        later(function () { showPlugins(cat, cats, back); });
      },
      onSelect: function (a) {
        Lampa.Controller.toggle(back);
        try {
          if (a.act === 'install') {
            noty(install(item) ? 'Установлено. Перезагрузите Lampa, чтобы расширение заработало.' : 'Не удалось установить');
            again();
          } else if (a.act === 'remove') {
            noty(uninstall(item) ? 'Удалено. Перезагрузите Lampa.' : 'Не удалось удалить');
            again();
          } else if (a.act === 'toggle') {
            var s = toggle(item);
            noty(s === null ? 'Расширение не найдено в списке' : (s ? 'Включено' : 'Выключено') + '. Перезагрузите Lampa.');
            again();
          } else if (a.act === 'copy') {
            Lampa.Utils.copyTextToClipboard(item.url, function () {
              noty('Ссылка скопирована');
            }, function () {
              noty('Не удалось скопировать');
            });
            again();
          } else if (a.act === 'info') {
            noty(cut(item.descr, 300));
            again();
          }
        } catch (e) {
          noty('Ошибка: ' + e.message);
          again();
        }
      }
    });
  }

  /* ---------- точки входа: меню и настройки ---------- */

  function addMenuItem() {
    if ($('.menu .menu__list .my-store-item').length) return;
    var li = $('<li class="menu__item selector my-store-item"><div class="menu__ico">' + ICON +
      '</div><div class="menu__text">' + esc(CONFIG.name) + '</div></li>');
    li.on('hover:enter', function () { openStore(); });
    $('.menu .menu__list').eq(0).append(li);
  }

  function addSettings() {
    if (!Lampa.SettingsApi) return;
    Lampa.SettingsApi.addComponent({ component: 'my_store', name: CONFIG.name, icon: ICON });
    Lampa.SettingsApi.addParam({
      component: 'my_store',
      param: { name: 'my_store_open', type: 'button' },
      field: { name: 'Открыть каталог', description: CONFIG.catalog },
      onChange: function () { openStore(); }
    });
  }

  function init() {
    try { addMenuItem(); } catch (e) { /* меню может быть недоступно */ }
    try { addSettings(); } catch (e) { /* настройки необязательны */ }
  }

  if (window.appready) init();
  else Lampa.Listener.follow('app', function (e) { if (e.type === 'ready') init(); });
})();
