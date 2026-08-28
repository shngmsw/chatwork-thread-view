import { createPanel } from '../ui/panel.js';
import { renderThreads } from '../ui/render.js';
import { getMessageElements } from './selectors.js';
import { createScrapeContext, parseTimeline } from './scraper.js';
import { buildThreads } from '../core/threadTree.js';
import { startObserver } from './observer.js';
import { jumpToMessage } from './navigator.js';

const state = {
  panel: null,
  hideEmpty: true,
  stopObserver: null,
  // 開いているスレッドの rootId。再描画をまたいで開閉状態を保つ。
  openIds: new Set(),
};

function showNotice(text) {
  if (!state.panel) return;
  const notice = document.createElement('div');
  notice.className = 'state state--error';
  notice.textContent = text;
  state.panel.body.prepend(notice);
  setTimeout(() => notice.remove(), 4000);
}

function refresh() {
  if (!state.panel) return;
  const messages = parseTimeline(getMessageElements(document), createScrapeContext());
  const threads = buildThreads(messages);
  state.panel.setCount(threads.filter((t) => t.replyCount > 0).length);
  renderThreads(state.panel.body, threads, {
    hideEmpty: state.hideEmpty,
    openIds: state.openIds,
    onToggle: (rootId, open) => {
      if (open) state.openIds.add(rootId);
      else state.openIds.delete(rootId);
    },
    onJump: (messageId) => {
      if (jumpToMessage(messageId)) return;
      showNotice(
        'このメッセージはまだ読み込まれていません。タイムラインを上にスクロールしてください。'
      );
    },
  });
}

function boot() {
  state.panel = createPanel();
  if (!state.panel) return;
  refresh();
  state.stopObserver = startObserver({
    onChange: refresh,
    onRoomChange: () => {
      // ルームが変わったら前ルームの表示も開閉状態も残さない。
      state.openIds.clear();
      state.panel.body.textContent = '';
      refresh();
    },
  });
}

boot();
