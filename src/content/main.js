import { createPanel } from '../ui/panel.js';
import { renderThreads } from '../ui/render.js';
import { getMessageElements, runHealthCheck, getCurrentRoomId } from './selectors.js';
import { createScrapeContext, parseTimeline } from './scraper.js';
import { buildThreads } from '../core/threadTree.js';
import { createNameStore } from './nameStore.js';
import { resolveName } from '../core/threadNames.js';
import { startObserver } from './observer.js';
import { jumpToMessage } from './navigator.js';
import { TOGGLE_PANEL } from '../core/messages.js';

const state = {
  panel: null,
  hideEmpty: true,
  // スレッド名の読み書き。ストレージの形式は nameStore の中に閉じる。
  store: null,
  names: {},
  stopObserver: null,
  // 開いているスレッドの rootId。再描画をまたいで開閉状態を保つ。
  openIds: new Set(),
  // 健全でなくなった時刻。復旧すれば null に戻す。
  // 「一度描画に成功したか」を門にすると、起動時点で既に壊れている場合に
  // その条件自体がフラグの成立を妨げて永久に報告されない。時間で判断する。
  unhealthySince: null,
};

// 不調がこの時間続いたら故障として報告する。
// ルーム切替の一時的な欠落 (実測で最大 ~1.2 秒) を確実に跨ぐ長さにする。
const UNHEALTHY_GRACE_MS = 15000;

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
function shouldReportHealth(health, now = Date.now()) {
  if (health.ok) {
    state.unhealthySince = null;
    return false;
  }

  // タイムラインはあるが中身も空。まだ読めていないか、本当に投稿が無いルーム。
  // 中身が詰まっているのに 1 件も拾えない場合は素通りさせ、下の猶予判定に回す。
  const onlyMessages =
    health.failures.length === 1 && health.failures[0] === 'messages';
  if (onlyMessages && health.timelineChildCount === 0) {
    state.unhealthySince = null;
    return false;
  }

  // 起動直後もルーム切替直後も一時的に欠ける。続いたときだけ故障と見なす。
  if (state.unhealthySince === null) state.unhealthySince = now;
  return now - state.unhealthySince >= UNHEALTHY_GRACE_MS;
}

export function refresh() {
  if (!state.panel) return;

  // 名前を編集している間は描画をやり直さない。renderThreads は中身を作り直すため、
  // Chatwork に新着が来て observer が走るたびに入力欄ごと消え、書きかけが失われる。
  // 確定・取消のあとは目印が外れるので、次の変更で通常どおり描画される。
  if (state.panel.body.querySelector('[data-role="rename-input"]')) return;

  const messages = parseTimeline(getMessageElements(document), createScrapeContext());
  const health = runHealthCheck(messages, document);
  if (shouldReportHealth(health)) {
    state.panel.setCount(0);
    renderDiagnostic(health.failures);
    return;
  }

  const threads = buildThreads(messages);

  // root が入れ替わったスレッドの名前を新しい rootId へ寄せておく。
  // 放っておいても resolveName が子孫まで辿るので表示は壊れないが、
  // 毎回の探索が積み上がるのでここで正規化する。
  for (const thread of threads) {
    const resolved = state.store && resolveName(thread, state.names);
    if (resolved && resolved.key !== thread.rootId) {
      state.store.rekey(resolved.key, thread.rootId);
      state.names = state.store.getItems();
    }
  }

  state.panel.setCount(threads.filter((t) => t.replyCount > 0).length);
  renderThreads(state.panel.body, threads, {
    hideEmpty: state.hideEmpty,
    openIds: state.openIds,
    names: state.names,
    onRename: (key, name) => {
      state.names = state.store.setName(key, name, 'user');
      refresh();
    },
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

}

export function boot() {
  state.panel = createPanel();
  if (!state.panel) return;

  state.store = createNameStore();
  state.store.load(getCurrentRoomId()).then((items) => {
    state.names = items;
    refresh();
  });

  state.panel.onToggleHideEmpty((hideEmpty) => {
    state.hideEmpty = hideEmpty;
    refresh();
  });

  refresh();

  state.stopObserver = startObserver({
    onChange: refresh,
    onRoomChange: (roomId) => {
      // ルームが変わったら前ルームの表示も開閉状態も残さない。
      state.openIds.clear();
      state.names = {};
      state.store.load(roomId).then((items) => {
        state.names = items;
        refresh();
      });
      state.panel.clearNotice();
      state.panel.body.textContent = '';
      refresh();
    },
  });
}

/**
 * 監視を止めてパネルを外す (head に注入したスタイルは残る)。
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
  if (state.store) {
    state.store.flush();
    state.store.stop();
    state.store = null;
  }
  state.names = {};
  state.openIds.clear();
  state.hideEmpty = true;
  state.unhealthySince = null;
}

/**
 * ツールバーのアイコンからパネルを開閉できるようにする。
 * chrome が無い環境 (テスト) では何もしない。
 */
export function listenForToggle(runtime) {
  if (!runtime || !runtime.onMessage) return;
  runtime.onMessage.addListener((message) => {
    if (!message || message.type !== TOGGLE_PANEL) return;
    if (!state.panel) return;
    state.panel.setOpen(!state.panel.isOpen());
  });
}

export function getPanel() {
  return state.panel;
}

listenForToggle(typeof chrome !== 'undefined' ? chrome.runtime : null);

boot();
