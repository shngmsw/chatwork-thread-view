import { createPanel } from '../ui/panel.js';
import { renderThreads } from '../ui/render.js';
import { getMessageElements } from './selectors.js';
import { createScrapeContext, parseTimeline } from './scraper.js';
import { buildThreads } from '../core/threadTree.js';
import { startObserver } from './observer.js';

const state = {
  panel: null,
  hideEmpty: true,
  stopObserver: null,
};

function refresh() {
  if (!state.panel) return;
  const messages = parseTimeline(getMessageElements(document), createScrapeContext());
  const threads = buildThreads(messages);
  state.panel.setCount(threads.filter((t) => t.replyCount > 0).length);
  renderThreads(state.panel.body, threads, {
    hideEmpty: state.hideEmpty,
    onJump: (messageId) => {
      console.log('[ctv] jump requested', messageId);
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
      // ルームが変わったら前ルームの表示を残さない。
      state.panel.body.textContent = '';
      refresh();
    },
  });
}

boot();
