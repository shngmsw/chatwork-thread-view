import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildThreads } from '../../src/core/threadTree.js';
import { renderThreads } from '../../src/ui/render.js';

const msg = (id, opts = {}) => ({
  id, roomId: 'R1', accountId: 'A1', userName: `user-${id}`, avatarUrl: '',
  body: `body of ${id}`, replyToId: null, replyToRoomId: null,
  timestamp: 1000, index: 0, ...opts,
});
const reply = (id, toId, opts = {}) =>
  msg(id, { replyToId: toId, replyToRoomId: 'R1', ...opts });

let container;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

describe('renderThreads', () => {
  it('返信のあるスレッドをカードとして描画する', () => {
    const threads = buildThreads([
      msg('1', { timestamp: 100 }),
      reply('2', '1', { timestamp: 200 }),
    ]);
    renderThreads(container, threads, { hideEmpty: true, onJump: () => {} });
    const cards = container.querySelectorAll('[data-role="thread"]');
    expect(cards).toHaveLength(1);
    expect(cards[0].getAttribute('data-root-id')).toBe('1');
    expect(container.textContent).toContain('返信 1 件');
  });

  it('hideEmpty が true なら返信ゼロのスレッドを描画しない', () => {
    const threads = buildThreads([msg('1'), msg('2')]);
    renderThreads(container, threads, { hideEmpty: true, onJump: () => {} });
    expect(container.querySelectorAll('[data-role="thread"]')).toHaveLength(0);
    expect(container.textContent).toContain('このルームにはまだ返信がありません');
  });

  it('hideEmpty が false なら返信ゼロのスレッドも描画する', () => {
    const threads = buildThreads([msg('1'), msg('2')]);
    renderThreads(container, threads, { hideEmpty: false, onJump: () => {} });
    expect(container.querySelectorAll('[data-role="thread"]')).toHaveLength(2);
  });

  it('スレッドが空なら読み込み中を表示する', () => {
    renderThreads(container, [], { hideEmpty: true, onJump: () => {} });
    expect(container.textContent).toContain('メッセージを読み込み中です');
  });

  it('ツリーのノードをクリックすると onJump がメッセージ ID で呼ばれる', () => {
    const onJump = vi.fn();
    const threads = buildThreads([
      msg('1', { timestamp: 100 }),
      reply('2', '1', { timestamp: 200 }),
    ]);
    renderThreads(container, threads, { hideEmpty: true, onJump });
    const nodes = container.querySelectorAll('[data-role="node"]');
    expect(nodes).toHaveLength(2);
    nodes[1].click();
    expect(onJump).toHaveBeenCalledWith('2');
  });

  it('代理 root のスレッドにバッジを出す', () => {
    const threads = buildThreads([reply('2', 'missing')]);
    renderThreads(container, threads, { hideEmpty: false, onJump: () => {} });
    expect(container.textContent).toContain('親メッセージ未読み込み');
  });

  it('本文と送信者名を HTML としてではなくテキストとして扱う', () => {
    const threads = buildThreads([
      msg('1', { timestamp: 100, userName: '<img src=x>', body: '<script>bad()</script>' }),
      reply('2', '1', { timestamp: 200 }),
    ]);
    renderThreads(container, threads, { hideEmpty: true, onJump: () => {} });
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toContain('<script>bad()</script>');
  });

  it('再描画で前回の内容が残らない', () => {
    const threads = buildThreads([
      msg('1', { timestamp: 100 }),
      reply('2', '1', { timestamp: 200 }),
    ]);
    renderThreads(container, threads, { hideEmpty: true, onJump: () => {} });
    renderThreads(container, threads, { hideEmpty: true, onJump: () => {} });
    expect(container.querySelectorAll('[data-role="thread"]')).toHaveLength(1);
  });
});
