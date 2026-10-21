// Тестовый плагин для проверки магазина: показывает уведомление при запуске Lampa.
(function () {
  'use strict';
  if (window.my_hello_plugin) return;
  window.my_hello_plugin = true;

  function run() { Lampa.Noty.show('Привет! Плагин из моего магазина работает'); }

  if (window.appready) run();
  else Lampa.Listener.follow('app', function (e) { if (e.type === 'ready') run(); });
})();
