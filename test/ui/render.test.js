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

  it('再描画しても開いていたスレッドは開いたままになる', () => {
    const threads = buildThreads([
      msg('1', { timestamp: 100 }),
      reply('2', '1', { timestamp: 200 }),
    ]);
    const openIds = new Set();
    const onToggle = (rootId, open) => {
      if (open) openIds.add(rootId);
      else openIds.delete(rootId);
    };

    renderThreads(container, threads, { hideEmpty: true, onJump: () => {}, openIds, onToggle });
    const card = container.querySelector('[data-role="thread"]');
    expect(card.open).toBe(false);

    // ユーザーが開く。details の toggle イベントで状態が記録される。
    card.open = true;
    card.dispatchEvent(new Event('toggle'));
    expect(openIds.has('1')).toBe(true);

    // 新着メッセージなどで再描画が走る。
    renderThreads(container, threads, { hideEmpty: true, onJump: () => {}, openIds, onToggle });
    expect(container.querySelector('[data-role="thread"]').open).toBe(true);
  });

  it('閉じたスレッドは再描画後も閉じたままになる', () => {
    const threads = buildThreads([
      msg('1', { timestamp: 100 }),
      reply('2', '1', { timestamp: 200 }),
    ]);
    const openIds = new Set(['1']);
    const onToggle = (rootId, open) => {
      if (open) openIds.add(rootId);
      else openIds.delete(rootId);
    };

    renderThreads(container, threads, { hideEmpty: true, onJump: () => {}, openIds, onToggle });
    const card = container.querySelector('[data-role="thread"]');
    expect(card.open).toBe(true);

    card.open = false;
    card.dispatchEvent(new Event('toggle'));
    expect(openIds.has('1')).toBe(false);

    renderThreads(container, threads, { hideEmpty: true, onJump: () => {}, openIds, onToggle });
    expect(container.querySelector('[data-role="thread"]').open).toBe(false);
  });
});

describe('スレッド名の表示', () => {
  it('名前があれば見出しに名前を出し、送信者名をメタ行へ降ろす', () => {
    const threads = buildThreads([
      msg('1', { userName: '三沢慎吾', timestamp: 100 }),
      reply('2', '1', { timestamp: 200 }),
    ]);
    renderThreads(container, threads, {
      hideEmpty: true,
      onJump: () => {},
      names: { 1: { name: '請求書フォーマットの件', by: 'user', at: 10 } },
    });
    expect(container.querySelector('.thread__name').textContent).toBe('請求書フォーマットの件');
    expect(container.querySelector('.thread__owner').textContent).toBe('三沢慎吾');
  });

  it('名前が無ければ従来どおり送信者名を見出しにする', () => {
    const threads = buildThreads([
      msg('1', { userName: '三沢慎吾', timestamp: 100 }),
      reply('2', '1', { timestamp: 200 }),
    ]);
    renderThreads(container, threads, { hideEmpty: true, onJump: () => {} });
    expect(container.querySelector('.thread__name').textContent).toBe('三沢慎吾');
    expect(container.querySelector('.thread__owner')).toBeNull();
  });

  it('root が入れ替わっても子孫に残った名前を見出しに出す', () => {
    const threads = buildThreads([
      msg('1', { timestamp: 100 }),
      reply('2', '1', { timestamp: 200 }),
      reply('3', '2', { timestamp: 300 }),
    ]);
    renderThreads(container, threads, {
      hideEmpty: true,
      onJump: () => {},
      names: { 2: { name: '請求書の件', by: 'user', at: 10 } },
    });
    expect(container.querySelector('.thread__name').textContent).toBe('請求書の件');
  });
});

describe('スレッド名の編集', () => {
  const withReply = () =>
    buildThreads([msg('1', { userName: '三沢慎吾', timestamp: 100 }), reply('2', '1', { timestamp: 200 })]);

  it('鉛筆ボタンを押すと入力欄に変わり、現在の名前が入る', () => {
    renderThreads(container, withReply(), {
      hideEmpty: true,
      onJump: () => {},
      names: { 1: { name: '請求書の件', by: 'user', at: 10 } },
      onRename: () => {},
    });
    container.querySelector('[data-role="rename"]').click();
    const input = container.querySelector('[data-role="rename-input"]');
    expect(input).not.toBeNull();
    expect(input.value).toBe('請求書の件');
  });

  it('Enter で onRename が呼ばれる', () => {
    const onRename = vi.fn();
    renderThreads(container, withReply(), { hideEmpty: true, onJump: () => {}, onRename });
    container.querySelector('[data-role="rename"]').click();
    const input = container.querySelector('[data-role="rename-input"]');
    input.value = '請求書の件';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onRename).toHaveBeenCalledWith('1', '請求書の件');
  });

  it('Esc では onRename を呼ばない', () => {
    const onRename = vi.fn();
    renderThreads(container, withReply(), { hideEmpty: true, onJump: () => {}, onRename });
    container.querySelector('[data-role="rename"]').click();
    const input = container.querySelector('[data-role="rename-input"]');
    input.value = '書きかけ';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onRename).not.toHaveBeenCalled();
  });

  it('名前があるスレッドでは resolveName が返したキーを渡す', () => {
    const onRename = vi.fn();
    const threads = buildThreads([
      msg('1', { timestamp: 100 }),
      reply('2', '1', { timestamp: 200 }),
      reply('3', '2', { timestamp: 300 }),
    ]);
    renderThreads(container, threads, {
      hideEmpty: true,
      onJump: () => {},
      names: { 2: { name: '古いキーの名前', by: 'user', at: 10 } },
      onRename,
    });
    container.querySelector('[data-role="rename"]').click();
    const input = container.querySelector('[data-role="rename-input"]');
    input.value = '新しい名前';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onRename).toHaveBeenCalledWith('2', '新しい名前');
  });

  // summary の中のボタンなので、止めないと details が開閉してしまう。
  it('鉛筆ボタンのクリックはカードの開閉を起こさない', () => {
    renderThreads(container, withReply(), { hideEmpty: true, onJump: () => {}, onRename: () => {} });
    const card = container.querySelector('[data-role="thread"]');
    const before = card.open;
    container.querySelector('[data-role="rename"]').click();
    expect(card.open).toBe(before);
  });
});
