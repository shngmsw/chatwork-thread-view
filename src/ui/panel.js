import { PANEL_CSS } from './styles.js';
import { SEL, getHostTheme, watchHostTheme } from '../content/selectors.js';

export const PANEL_ID = 'ctv-root';
const LAYOUT_STYLE_ID = 'ctv-layout-style';
const OPEN_CLASS = 'ctv-open';
const MIN_WIDTH = 280;
const MAX_WIDTH = 640;
const DEFAULT_WIDTH = 360;
const NOTICE_MS = 4000;

function clampWidth(value) {
  if (!Number.isFinite(value)) return DEFAULT_WIDTH;
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(value)));
}

function ensureLayoutStyle() {
  const existing = document.getElementById(LAYOUT_STYLE_ID);
  if (existing) return existing;
  const style = document.createElement('style');
  style.id = LAYOUT_STYLE_ID;
  style.textContent = `
:root { --ctv-w: ${DEFAULT_WIDTH}px; }
#${PANEL_ID} {
  position: fixed;
  top: 0;
  right: 0;
  height: 100vh;
  width: var(--ctv-w);
  z-index: 2147483000;
}
html.${OPEN_CLASS} ${SEL.appRoot} { width: calc(100% - var(--ctv-w)) !important; }
html:not(.${OPEN_CLASS}) #${PANEL_ID} { width: 0; }
`;
  document.head.appendChild(style);
  return style;
}

async function loadSettings() {
  try {
    const stored = await chrome.storage.local.get({ width: DEFAULT_WIDTH, open: true });
    return { width: clampWidth(Number(stored.width)), open: stored.open !== false };
  } catch {
    return { width: DEFAULT_WIDTH, open: true };
  }
}

function saveSettings(settings) {
  try {
    chrome.storage.local.set(settings);
  } catch {
    // storage が使えなくても動作は継続する
  }
}

/**
 * Shadow DOM パネルを生成して body 直下に置く。
 * 既に生成済みなら null を返す (多重注入防止)。
 */
export function createPanel() {
  if (document.getElementById(PANEL_ID)) return null;

  ensureLayoutStyle();

  const host = document.createElement('div');
  host.id = PANEL_ID;
  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = PANEL_CSS;

  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.innerHTML = `
    <button class="panel__reopen" data-role="reopen" type="button" aria-label="スレッドパネルを開く">«</button>
    <div class="panel__grip" data-role="grip" role="separator" aria-orientation="vertical"></div>
    <header class="panel__head">
      <span class="panel__title">スレッド</span>
      <span class="panel__count" data-role="count"></span>
      <span class="panel__spacer"></span>
      <button class="panel__btn" data-role="toggle-empty" type="button">全件表示</button>
      <button class="panel__btn" data-role="close" type="button">閉じる</button>
    </header>
    <div class="panel__notice" data-role="notice" role="status" aria-live="polite" hidden></div>
    <div class="panel__body" data-role="body"></div>
  `;

  // 配色は Chatwork 本体のテーマに合わせる。CSS は自前の data-theme だけを見る。
  panel.dataset.theme = getHostTheme();
  const stopThemeWatch = watchHostTheme((theme) => {
    panel.dataset.theme = theme;
  });

  shadow.append(style, panel);
  document.body.appendChild(host);

  const body = shadow.querySelector('[data-role="body"]');
  const count = shadow.querySelector('[data-role="count"]');
  const closeBtn = shadow.querySelector('[data-role="close"]');
  const grip = shadow.querySelector('[data-role="grip"]');
  const reopenBtn = shadow.querySelector('[data-role="reopen"]');
  const notice = shadow.querySelector('[data-role="notice"]');
  const toggleEmptyBtn = shadow.querySelector('[data-role="toggle-empty"]');

  let width = DEFAULT_WIDTH;
  let noticeTimer = null;
  let hideEmpty = true;
  let hideEmptyHandler = () => {};

  // 通知は本文の外に置く。renderThreads は body を毎回作り直すため、
  // 本文の中に出すと直後の再描画で黙って消える。
  function clearNotice() {
    if (noticeTimer !== null) {
      clearTimeout(noticeTimer);
      noticeTimer = null;
    }
    notice.textContent = '';
    notice.hidden = true;
  }

  function showNotice(text) {
    // 先に出ている通知は必ず片付ける。積み上げると古いタイマーが新しい通知を消す。
    clearNotice();
    notice.textContent = text;
    notice.hidden = false;
    noticeTimer = setTimeout(clearNotice, NOTICE_MS);
  }

  function setHideEmpty(next) {
    hideEmpty = next;
    toggleEmptyBtn.textContent = hideEmpty ? '全件表示' : '返信ありのみ';
    // 「全件表示中」を押し込み状態として見せる。
    toggleEmptyBtn.setAttribute('aria-pressed', String(!hideEmpty));
  }

  toggleEmptyBtn.addEventListener('click', () => {
    setHideEmpty(!hideEmpty);
    hideEmptyHandler(hideEmpty);
  });

  setHideEmpty(true);

  function applyWidth(next) {
    width = clampWidth(next);
    document.documentElement.style.setProperty('--ctv-w', `${width}px`);
  }

  function setOpen(open, persist = true) {
    document.documentElement.classList.toggle(OPEN_CLASS, open);
    panel.classList.toggle('panel--closed', !open);
    if (persist) saveSettings({ open });
  }

  function isOpen() {
    return document.documentElement.classList.contains(OPEN_CLASS);
  }

  closeBtn.addEventListener('click', () => setOpen(false));
  reopenBtn.addEventListener('click', () => setOpen(true));

  grip.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    grip.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = width;

    const onMove = (moveEvent) => {
      applyWidth(startWidth + (startX - moveEvent.clientX));
    };
    const onUp = () => {
      grip.removeEventListener('pointermove', onMove);
      grip.removeEventListener('pointerup', onUp);
      saveSettings({ width });
    };
    grip.addEventListener('pointermove', onMove);
    grip.addEventListener('pointerup', onUp);
  });

  loadSettings().then((settings) => {
    applyWidth(settings.width);
    setOpen(settings.open, false);
  });

  return {
    host,
    shadow,
    body,
    setCount(n) {
      count.textContent = n > 0 ? `${n} 件` : '';
    },
    setOpen,
    isOpen,
    showNotice,
    clearNotice,
    setHideEmpty,
    onToggleHideEmpty(handler) {
      hideEmptyHandler = handler;
    },
    destroy() {
      clearNotice();
      stopThemeWatch();
      host.remove();
      document.documentElement.classList.remove(OPEN_CLASS);
    },
  };
}
