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

  it('名前解決の成功率が 50% 未満なら失敗する', () => {
    const result = runHealthCheck(
      [message('不明'), message('不明'), message('不明'), message('佐藤'), message('鈴木')],
      document
    );
    expect(result.ok).toBe(false);
    expect(result.failures).toContain('userName');
  });

  it('ちょうど 50% では失敗しない', () => {
    const result = runHealthCheck(
      [message('不明'), message('不明'), message('佐藤'), message('鈴木')],
      document
    );
    expect(result.failures).not.toContain('userName');
  });

  it('件数が少なすぎるときは名前解決率を判定しない', () => {
    // 読み込み窓が数件しかない瞬間は連投継続が混ざるだけで比率が振れる。
    const result = runHealthCheck([message('不明'), message('不明')], document);
    expect(result.failures).not.toContain('userName');
  });

  it('タイムラインの子要素数を返す (空のルームと故障の区別に使う)', () => {
    expect(runHealthCheck([], document).timelineChildCount).toBe(1);
    document.body.innerHTML = '<div id="_timeLine"></div>';
    expect(runHealthCheck([], document).timelineChildCount).toBe(0);
  });
});
