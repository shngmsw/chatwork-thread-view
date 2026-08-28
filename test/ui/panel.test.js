import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createPanel } from '../../src/ui/panel.js';
import { renderThreads } from '../../src/ui/render.js';

let panel;

const noticeEl = () => panel.shadow.querySelector('[data-role="notice"]');

beforeEach(() => {
  vi.useFakeTimers();
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  document.documentElement.className = '';
  panel = createPanel();
});

afterEach(() => {
  if (panel) panel.destroy();
  panel = undefined;
  vi.useRealTimers();
});

describe('createPanel の通知領域', () => {
  it('通知は本文領域の外に置かれる', () => {
    panel.showNotice('通知テキスト');
    const notice = noticeEl();
    expect(notice.textContent).toBe('通知テキスト');
    expect(panel.body.contains(notice)).toBe(false);
  });

  it('本文を再描画しても通知は消えない', () => {
    panel.showNotice('通知テキスト');
    // 監視由来の再描画は body の中身を作り直す。通知がここに居ると巻き添えで消える。
    renderThreads(panel.body, [], { hideEmpty: true, onJump: () => {} });
    expect(noticeEl().textContent).toBe('通知テキスト');
  });

  it('通知は一定時間で消える', () => {
    panel.showNotice('通知テキスト');
    vi.advanceTimersByTime(4100);
    expect(noticeEl().textContent).toBe('');
    expect(noticeEl().hidden).toBe(true);
  });

  it('通知を続けて出しても積み上がらず最後の 1 件だけになる', () => {
    panel.showNotice('1 件目');
    vi.advanceTimersByTime(3000);
    panel.showNotice('2 件目');

    expect(panel.shadow.querySelectorAll('[data-role="notice"]')).toHaveLength(1);
    expect(noticeEl().textContent).toBe('2 件目');

    // 1 件目のタイマーが残っていると 2 件目がここで早く消える。
    vi.advanceTimersByTime(1500);
    expect(noticeEl().textContent).toBe('2 件目');
  });
});

describe('createPanel の返信ゼロ切替', () => {
  const toggleBtn = () => panel.shadow.querySelector('[data-role="toggle-empty"]');

  it('初期表示は「全件表示」', () => {
    expect(toggleBtn().textContent).toBe('全件表示');
  });

  it('押すたびにラベルとハンドラの引数が入れ替わる', () => {
    const handler = vi.fn();
    panel.onToggleHideEmpty(handler);

    toggleBtn().click();
    expect(handler).toHaveBeenLastCalledWith(false);
    expect(toggleBtn().textContent).toBe('返信ありのみ');

    toggleBtn().click();
    expect(handler).toHaveBeenLastCalledWith(true);
    expect(toggleBtn().textContent).toBe('全件表示');
  });

  it('setHideEmpty はラベルだけ変えてハンドラを呼ばない', () => {
    const handler = vi.fn();
    panel.onToggleHideEmpty(handler);

    panel.setHideEmpty(false);
    expect(toggleBtn().textContent).toBe('返信ありのみ');
    expect(handler).not.toHaveBeenCalled();
  });
});
