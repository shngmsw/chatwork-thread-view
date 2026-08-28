import { getTimeline, getCurrentRoomId } from './selectors.js';

const DEFAULT_DEBOUNCE_MS = 150;
const RECONNECT_INTERVAL_MS = 1000;

/**
 * タイムラインの変更とルーム切替を監視する。
 * 解析は行わずコールバックで通知するだけ。
 * @param {{onChange: () => void, onRoomChange: (roomId: string|null) => void, debounceMs?: number}} options
 * @returns {() => void} 監視を止める関数
 */
export function startObserver(options) {
  const { onChange, onRoomChange, debounceMs = DEFAULT_DEBOUNCE_MS } = options;

  let timer = null;
  let observed = null;
  let stopped = false;
  let roomId = getCurrentRoomId();

  const observer = new MutationObserver(() => {
    if (stopped) return;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      onChange();
    }, debounceMs);
  });

  function connect() {
    if (stopped) return;
    const timeline = getTimeline();
    if (!timeline || timeline === observed) return;
    observer.disconnect();
    observer.observe(timeline, { childList: true, subtree: true });
    observed = timeline;
  }

  // Chatwork はルーム切替でタイムライン要素ごと差し替えることがあるため、
  // 切り離しを検知して再接続する。
  const reconnectTimer = setInterval(() => {
    if (stopped) return;
    if (!observed || !observed.isConnected) connect();
  }, RECONNECT_INTERVAL_MS);

  function handleHashChange() {
    if (stopped) return;
    const next = getCurrentRoomId();
    if (next === roomId) return;
    roomId = next;
    connect();
    onRoomChange(next);
  }

  window.addEventListener('hashchange', handleHashChange);
  connect();

  return function stop() {
    stopped = true;
    if (timer !== null) clearTimeout(timer);
    clearInterval(reconnectTimer);
    observer.disconnect();
    window.removeEventListener('hashchange', handleHashChange);
    observed = null;
  };
}
