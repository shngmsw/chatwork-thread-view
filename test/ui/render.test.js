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

  it('ジャンプボタンを押すと onJump がメッセージ ID で呼ばれる', () => {
    const onJump = vi.fn();
    const threads = buildThreads([
      msg('1', { timestamp: 100 }),
      reply('2', '1', { timestamp: 200 }),
    ]);
    renderThreads(container, threads, { hideEmpty: true, onJump });
    const nodes = container.querySelectorAll('[data-role="node"]');
    expect(nodes).toHaveLength(2);
    nodes[1].querySelector('[data-role="jump"]').click();
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

describe('アバター', () => {
  const withAvatar = (avatarUrl, userName = '三沢慎吾') =>
    buildThreads([
      msg('1', { userName, avatarUrl, timestamp: 100 }),
      reply('2', '1', { timestamp: 200 }),
    ]);

  it('avatarUrl があれば本人の画像を出す', () => {
    renderThreads(container, withAvatar('https://example.com/a.png'), {
      hideEmpty: true,
      onJump: () => {},
    });
    const img = container.querySelector('img.avatar');
    expect(img).not.toBeNull();
    expect(img.getAttribute('src')).toBe('https://example.com/a.png');
  });

  it('avatarUrl が無ければ頭文字のバッジを出す', () => {
    renderThreads(container, withAvatar(''), { hideEmpty: true, onJump: () => {} });
    expect(container.querySelector('img.avatar')).toBeNull();
    expect(container.querySelector('div.avatar').textContent).toBe('三');
  });

  // 画像は Chatwork の CDN 頼み。落ちたときに丸ごと消えると誰の発言か分からなくなる。
  it('画像の読み込みに失敗したら頭文字のバッジに戻す', () => {
    renderThreads(container, withAvatar('https://example.com/broken.png'), {
      hideEmpty: true,
      onJump: () => {},
    });
    container.querySelector('img.avatar').dispatchEvent(new Event('error'));
    expect(container.querySelector('img.avatar')).toBeNull();
    expect(container.querySelector('div.avatar').textContent).toBe('三');
  });
});

describe('返信ノードの全文表示', () => {
  const LONG = 'あ'.repeat(200);
  const withLongReply = () =>
    buildThreads([
      msg('1', { timestamp: 100 }),
      reply('2', '1', { body: LONG, timestamp: 200 }),
    ]);
  const nodeOf = (id) => container.querySelector(`[data-role="node"][data-message-id="${id}"]`);

  it('本文を切り詰めずに全文を持つ', () => {
    renderThreads(container, withLongReply(), { hideEmpty: true, onJump: () => {} });
    expect(nodeOf('2').querySelector('.node__body').textContent).toBe(LONG);
  });

  it('クリックで開き、もう一度クリックで閉じる', () => {
    const onExpand = vi.fn();
    renderThreads(container, withLongReply(), { hideEmpty: true, onJump: () => {}, onExpand });
    const node = nodeOf('2');

    node.click();
    expect(node.classList.contains('node--open')).toBe(true);
    expect(onExpand).toHaveBeenLastCalledWith('2', true);

    node.click();
    expect(node.classList.contains('node--open')).toBe(false);
    expect(onExpand).toHaveBeenLastCalledWith('2', false);
  });

  it('本文クリックでは onJump を呼ばない', () => {
    const onJump = vi.fn();
    renderThreads(container, withLongReply(), { hideEmpty: true, onJump });
    nodeOf('2').querySelector('.node__body').click();
    expect(onJump).not.toHaveBeenCalled();
  });

  // 再描画で DOM は作り直される。開閉状態はスレッドカードと同じく呼び出し側が持つ。
  it('expandedIds に入っていれば最初から開いている', () => {
    renderThreads(container, withLongReply(), {
      hideEmpty: true,
      onJump: () => {},
      expandedIds: new Set(['2']),
    });
    expect(nodeOf('2').classList.contains('node--open')).toBe(true);
  });

  it('ジャンプボタンを押しても開閉しない', () => {
    const onJump = vi.fn();
    renderThreads(container, withLongReply(), { hideEmpty: true, onJump });
    const node = nodeOf('2');
    node.querySelector('[data-role="jump"]').click();
    expect(onJump).toHaveBeenCalledWith('2');
    expect(node.classList.contains('node--open')).toBe(false);
  });
});

describe('返信ボタン', () => {
  const threads = () =>
    buildThreads([msg('1', { timestamp: 100 }), reply('2', '1', { timestamp: 200 })]);
  const nodeOf = (id) => container.querySelector(`[data-role="node"][data-message-id="${id}"]`);

  it('押すと onReply がそのメッセージで呼ばれる', () => {
    const onReply = vi.fn();
    renderThreads(container, threads(), { hideEmpty: true, onJump: () => {}, onReply });
    nodeOf('2').querySelector('[data-role="reply"]').click();
    expect(onReply).toHaveBeenCalledTimes(1);
    expect(onReply.mock.calls[0][0].id).toBe('2');
  });

  it('押しても全文は開閉しない', () => {
    renderThreads(container, threads(), { hideEmpty: true, onJump: () => {}, onReply: () => {} });
    const node = nodeOf('2');
    node.querySelector('[data-role="reply"]').click();
    expect(node.classList.contains('node--open')).toBe(false);
  });
});
