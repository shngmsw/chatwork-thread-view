import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { jumpToMessage, HIGHLIGHT_CLASS } from '../../src/content/navigator.js';

let warnSpy;

beforeEach(() => {
  vi.useFakeTimers();
  // スクロール親を持たない jsdom では警告が必ず出る。テスト出力を汚さないよう受け止める。
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  document.head.innerHTML = '';
  document.body.innerHTML = `
    <div id="_timeLine">
      <div class="_message" data-mid="123" id="_messageId123"></div>
      <div class="_message" data-mid="456" id="_messageId456"></div>
    </div>
  `;
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  warnSpy.mockRestore();
  vi.useRealTimers();
  delete Element.prototype.scrollIntoView;
});

describe('jumpToMessage', () => {
  it('存在するメッセージへスクロールして true を返す', () => {
    expect(jumpToMessage('123')).toBe(true);
    const target = document.getElementById('_messageId123');
    expect(target.scrollIntoView).toHaveBeenCalledWith({
      block: 'center',
      behavior: 'smooth',
    });
  });

  it('強調クラスを付け、一定時間後に外す', () => {
    jumpToMessage('123');
    const target = document.getElementById('_messageId123');
    expect(target.classList.contains(HIGHLIGHT_CLASS)).toBe(true);
    vi.advanceTimersByTime(1600);
    expect(target.classList.contains(HIGHLIGHT_CLASS)).toBe(false);
  });

  it('強調用スタイルを document.head に 1 つだけ注入する', () => {
    jumpToMessage('123');
    jumpToMessage('123');
    expect(document.querySelectorAll('#ctv-highlight-style')).toHaveLength(1);
  });

  it('未ロードのメッセージでは false を返す', () => {
    expect(jumpToMessage('999')).toBe(false);
  });

  it('数値以外の ID では false を返す', () => {
    expect(jumpToMessage('"]><script>')).toBe(false);
  });

  it('別のメッセージへ続けてジャンプすると強調は 1 件だけになる', () => {
    jumpToMessage('123');
    jumpToMessage('456');

    expect(document.querySelectorAll(`.${HIGHLIGHT_CLASS}`)).toHaveLength(1);
    expect(document.getElementById('_messageId456').classList.contains(HIGHLIGHT_CLASS)).toBe(true);
    expect(document.getElementById('_messageId123').classList.contains(HIGHLIGHT_CLASS)).toBe(false);
  });

  it('同じメッセージへ再ジャンプすると強調時間が測り直される', () => {
    const target = document.getElementById('_messageId123');
    jumpToMessage('123');
    vi.advanceTimersByTime(1000);
    jumpToMessage('123');

    // 1 回目のタイマーが残っていると、ここ (1 回目から 1600ms) で消えてしまう。
    vi.advanceTimersByTime(600);
    expect(target.classList.contains(HIGHLIGHT_CLASS)).toBe(true);

    vi.advanceTimersByTime(1000);
    expect(target.classList.contains(HIGHLIGHT_CLASS)).toBe(false);
  });

  it('スクロール親が見つからない警告は 1 度しか出さない', async () => {
    // ジャンプのたびに警告を出すとコンソールが埋まる。状況は毎回同じなので 1 度で足りる。
    vi.resetModules();
    const fresh = await import('../../src/content/navigator.js');

    fresh.jumpToMessage('123');
    fresh.jumpToMessage('456');

    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});
