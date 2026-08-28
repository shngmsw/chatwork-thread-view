import { describe, it, expect, beforeEach } from 'vitest';
import { runHealthCheck } from '../../src/content/selectors.js';

const message = (userName) => ({
  id: '1', roomId: 'R1', accountId: 'A1', userName, avatarUrl: '',
  body: '', replyToId: null, replyToRoomId: null, timestamp: 1, index: 0,
});

beforeEach(() => {
  document.body.innerHTML = '<div id="_timeLine"><div class="_message" data-mid="1"></div></div>';
});

describe('runHealthCheck', () => {
  it('タイムラインとメッセージがあり名前が解決できていれば ok', () => {
    const result = runHealthCheck([message('佐藤'), message('鈴木')], document);
    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it('タイムラインが無ければ失敗する', () => {
    document.body.innerHTML = '';
    const result = runHealthCheck([], document);
    expect(result.ok).toBe(false);
    expect(result.failures).toContain('timeline');
  });

  it('メッセージ要素が 0 件なら失敗する', () => {
    document.body.innerHTML = '<div id="_timeLine"></div>';
    const result = runHealthCheck([], document);
    expect(result.ok).toBe(false);
    expect(result.failures).toContain('messages');
  });

  it('名前解決の成功率が 50% 以下なら失敗する', () => {
    const result = runHealthCheck(
      [message('不明'), message('不明'), message('佐藤')],
      document
    );
    expect(result.ok).toBe(false);
    expect(result.failures).toContain('userName');
  });
});
