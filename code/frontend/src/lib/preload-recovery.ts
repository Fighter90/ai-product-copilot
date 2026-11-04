/**
 * Самовосстановление после деплоя (REG-15 × lazy-чанки): открытая вкладка держит старый
 * `index.html` и лениво догружает чанки прошлых билдов — их на сервере больше нет
 * («Failed to fetch dynamically imported module: /assets/FunnelLive-*.js», «Не удалось
 * загрузить раздел»). Vite на такой сбой шлёт `vite:preloadError` — перезагружаем страницу,
 * чтобы взять новый `index.html` с актуальными хэшами чанков. Одна перезагрузка на сессию
 * (sessionStorage-страж), иначе сломанный деплой зациклил бы reload.
 */
export function installPreloadRecovery(opts?: {
  /** Куда слушать событие (по умолчанию window). */
  target?: EventTarget;
  /** Перезагрузка (инъектится в тестах). */
  reload?: () => void;
  /** sessionStorage-подобное хранилище стража (инъектится в тестах). */
  session?: Pick<Storage, 'getItem' | 'setItem'>;
}): void {
  const target = opts?.target ?? window;
  const reload = opts?.reload ?? (() => window.location.reload());
  const session = opts?.session ?? window.sessionStorage;
  const KEY = 'pca.preload-reload';
  target.addEventListener('vite:preloadError', (e: Event) => {
    e.preventDefault();
    if (session.getItem(KEY)) return;
    session.setItem(KEY, '1');
    reload();
  });
}
