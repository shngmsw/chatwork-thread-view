import { createPanel } from '../ui/panel.js';
import { renderThreads } from '../ui/render.js';
import { getMessageElements, runHealthCheck } from './selectors.js';
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
  // 一度でも実データを描画したか。起動直後の空タイムラインを故障と誤認しないための門番。
  hasRenderedOnce: false,
};

function renderDiagnostic(failures) {
  const box = document.createElement('div');
  box.className = 'diagnostic';
  box.append(
    Object.assign(document.createElement('p'), {
      textContent: 'Chatwork の画面構造が変わった可能性があります。',
    })
  );
  const code = document.createElement('code');
  code.className = 'diagnostic__code';
  code.textContent = `failed: ${failures.join(', ')}`;
  box.appendChild(code);

  const copyBtn = document.createElement('button');
  copyBtn.className = 'panel__btn';
  copyBtn.type = 'button';
  copyBtn.textContent = '診断情報をコピー';
  copyBtn.addEventListener('click', () => {
    const report = [
      'chatwork-thread-view diagnostic',
      `url: ${location.origin}${location.pathname}`,
      `failed: ${failures.join(', ')}`,
      `userAgent: ${navigator.userAgent}`,
    ].join('\n');
    const write = navigator.clipboard?.writeText(report);
    if (!write) {
      copyBtn.textContent = 'コピーできませんでした';
      return;
    }
    write.then(
      () => {
        copyBtn.textContent = 'コピーしました';
      },
      () => {
        copyBtn.textContent = 'コピーできませんでした';
      }
    );
  });
  box.appendChild(copyBtn);

  state.panel.body.textContent = '';
  state.panel.body.appendChild(box);
}

/**
 * 健全性チェックの失敗を利用者に見せてよいかを判断する。
 * 「まだ読めていない」だけの状態を故障として見せないための門。
 */
function shouldReportHealth(health) {
  if (health.ok) return false;
  // 起動直後は Chatwork 側の描画がまだ終わっていないことがある。
  // 一度も実データを描画していない間は、何が欠けていても待つ。
  if (!state.hasRenderedOnce) return false;
  // ルーム切替直後は一時的にメッセージが 0 件になる。これも故障ではない。
  if (health.failures.length === 1 && health.failures[0] === 'messages') return false;
  return true;
}

export function refresh() {
  if (!state.panel) return;

  const messages = parseTimeline(getMessageElements(document), createScrapeContext());
  const health = runHealthCheck(messages, document);
  if (shouldReportHealth(health)) {
    state.panel.setCount(0);
    renderDiagnostic(health.failures);
    return;
  }

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
      // 通知はパネルが本文の外に持つ領域へ出す。本文に出すと次の再描画で消える。
      state.panel.showNotice(
        'このメッセージはまだ読み込まれていません。タイムラインを上にスクロールしてください。'
      );
    },
  });

  if (messages.length > 0) state.hasRenderedOnce = true;
}

export function boot() {
  state.panel = createPanel();
  if (!state.panel) return;

  state.panel.onToggleHideEmpty((hideEmpty) => {
    state.hideEmpty = hideEmpty;
    refresh();
  });

  refresh();

  state.stopObserver = startObserver({
    onChange: refresh,
    onRoomChange: () => {
      // ルームが変わったら前ルームの表示も開閉状態も残さない。
      state.openIds.clear();
      state.panel.clearNotice();
      state.panel.body.textContent = '';
      refresh();
    },
  });
}

/**
 * 監視とパネルを止めて注入前の状態に戻す。
 * 拡張のリロードでは隔離ワールドが孤立するだけで pagehide も走らないため、
 * これは「その場合の後始末」ではない。決定的に停止できる口を 1 つ用意しておくもの。
 */
export function teardown() {
  if (state.stopObserver) {
    state.stopObserver();
    state.stopObserver = null;
  }
  if (state.panel) {
    state.panel.destroy();
    state.panel = null;
  }
  state.openIds.clear();
  state.hideEmpty = true;
  state.hasRenderedOnce = false;
}

export function getPanel() {
  return state.panel;
}

boot();
