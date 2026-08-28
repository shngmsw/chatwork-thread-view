import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { jumpToMessage, HIGHLIGHT_CLASS } from '../../src/content/navigator.js';

beforeEach(() => {
  vi.useFakeTimers();
  document.head.innerHTML = '';
  document.body.innerHTML = `
    <div id="_timeLine">
      <div class="_message" data-mid="123" id="_messageId123"></div>
    </div>
  `;
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
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
});
