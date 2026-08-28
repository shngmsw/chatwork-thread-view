import { getMessageElementById, findScrollContainer } from './selectors.js';

export const HIGHLIGHT_CLASS = 'ctv-flash-highlight';
const HIGHLIGHT_STYLE_ID = 'ctv-highlight-style';
const HIGHLIGHT_MS = 1500;

// 強調は常に 1 件だけ。連続ジャンプでタイマーが積み上がると、
// 古いタイマーが新しい強調を早期に消したり、複数が同時に光ったりする。
let pending = null;

// スクロール親が取れない状況はレイアウトの性質で決まるので、毎回同じ結果になる。
// ジャンプのたびに警告するとコンソールが埋まるだけなので 1 度で打ち切る。
let warnedNoScrollContainer = false;

function clearPendingHighlight() {
  if (!pending) return;
  clearTimeout(pending.timer);
  pending.node.classList.remove(HIGHLIGHT_CLASS);
  pending = null;
}

// 強調対象は Shadow DOM の外 (Chatwork 本体の DOM) なので
// document.head に最小限のスタイルを 1 つだけ注入する。
function ensureHighlightStyle() {
  if (document.getElementById(HIGHLIGHT_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = HIGHLIGHT_STYLE_ID;
  style.textContent = `
.${HIGHLIGHT_CLASS} {
  background-color: rgba(12, 107, 107, 0.14) !important;
  transition: background-color 0.3s ease-out;
}
`;
  document.head.appendChild(style);
}

/**
 * 指定メッセージまでタイムラインをスクロールし、一時的に強調する。
 * @param {string} messageId
 * @returns {boolean} 見つかって移動できたら true
 */
export function jumpToMessage(messageId) {
  const target = getMessageElementById(messageId);
  if (!target) return false;

  ensureHighlightStyle();

  // スクロール親の有無に関わらず scrollIntoView で足りるが、
  // 親が取れない場合はレイアウトが想定外なのでログに残す。
  if (!findScrollContainer(target) && !warnedNoScrollContainer) {
    warnedNoScrollContainer = true;
    console.warn('[ctv] scroll container not found; falling back to scrollIntoView');
  }

  target.scrollIntoView({ block: 'center', behavior: 'smooth' });

  clearPendingHighlight();
  target.classList.add(HIGHLIGHT_CLASS);
  pending = {
    node: target,
    timer: setTimeout(() => {
      pending = null;
      target.classList.remove(HIGHLIGHT_CLASS);
    }, HIGHLIGHT_MS),
  };

  return true;
}
