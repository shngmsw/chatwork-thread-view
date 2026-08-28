import { describe, it, expect } from 'vitest';
import { buildThreads } from '../../src/core/threadTree.js';

const msg = (id, opts = {}) => ({
  id,
  roomId: 'R1',
  accountId: 'A1',
  userName: 'user',
  avatarUrl: '',
  body: `body-${id}`,
  replyToId: null,
  replyToRoomId: null,
  timestamp: 1000,
  index: 0,
  ...opts,
});

const reply = (id, toId, opts = {}) =>
  msg(id, { replyToId: toId, replyToRoomId: 'R1', ...opts });

const countNodes = (node) =>
  1 + node.children.reduce((sum, c) => sum + countNodes(c), 0);

const totalNodes = (threads) =>
  threads.reduce((sum, t) => sum + countNodes(t.tree), 0);

const findThread = (threads, rootId) => threads.find((t) => t.rootId === rootId);

describe('buildThreads', () => {
  it('返信が無ければ各メッセージが独立したスレッドになる', () => {
    const threads = buildThreads([msg('1'), msg('2'), msg('3')]);
    expect(threads).toHaveLength(3);
    expect(threads.every((t) => t.replyCount === 0)).toBe(true);
    expect(threads.every((t) => t.rootIsSynthetic === false)).toBe(true);
  });

  it('1 親 + 2 子が 1 スレッドにまとまる', () => {
    const threads = buildThreads([
      msg('1', { timestamp: 100 }),
      reply('2', '1', { timestamp: 200 }),
      reply('3', '1', { timestamp: 300 }),
    ]);
    expect(threads).toHaveLength(1);
    expect(threads[0].rootId).toBe('1');
    expect(threads[0].replyCount).toBe(2);
    expect(threads[0].tree.children.map((c) => c.message.id)).toEqual(['2', '3']);
  });

  it('多階層 A <- B <- C が深さ 2 のツリーになる', () => {
    const threads = buildThreads([
      msg('A', { timestamp: 100 }),
      reply('B', 'A', { timestamp: 200 }),
      reply('C', 'B', { timestamp: 300 }),
    ]);
    const root = threads[0].tree;
    expect(root.depth).toBe(0);
    expect(root.children[0].message.id).toBe('B');
    expect(root.children[0].depth).toBe(1);
    expect(root.children[0].children[0].message.id).toBe('C');
    expect(root.children[0].children[0].depth).toBe(2);
  });

  it('兄弟は timestamp 昇順、同値なら index 昇順に並ぶ', () => {
    const threads = buildThreads([
      msg('1', { timestamp: 100 }),
      reply('late', '1', { timestamp: 500 }),
      reply('early', '1', { timestamp: 200 }),
      reply('tieB', '1', { timestamp: 200, index: 9 }),
      reply('tieA', '1', { timestamp: 200, index: 4 }),
    ]);
    expect(threads[0].tree.children.map((c) => c.message.id)).toEqual([
      'early',
      'tieA',
      'tieB',
      'late',
    ]);
  });

  it('親が未ロードなら自身が root になり rootIsSynthetic が true', () => {
    const threads = buildThreads([reply('2', 'missing-parent')]);
    expect(threads).toHaveLength(1);
    expect(threads[0].rootId).toBe('2');
    expect(threads[0].rootIsSynthetic).toBe(true);
  });

  it('別ルームへの返信は root 扱いになる', () => {
    const threads = buildThreads([
      msg('1'),
      msg('2', { replyToId: '1', replyToRoomId: 'R-OTHER' }),
    ]);
    expect(threads).toHaveLength(2);
    expect(findThread(threads, '2').rootIsSynthetic).toBe(true);
  });

  it('循環参照 A -> B -> A でも終了し全メッセージを保持する', () => {
    const input = [
      msg('A', { replyToId: 'B', replyToRoomId: 'R1', timestamp: 100 }),
      msg('B', { replyToId: 'A', replyToRoomId: 'R1', timestamp: 200 }),
    ];
    const threads = buildThreads(input);
    expect(totalNodes(threads)).toBe(2);
    expect(threads).toHaveLength(1);
  });

  it('自己参照 A -> A でも終了する', () => {
    const threads = buildThreads([
      msg('A', { replyToId: 'A', replyToRoomId: 'R1' }),
    ]);
    expect(threads).toHaveLength(1);
    expect(totalNodes(threads)).toBe(1);
  });

  it('3 要素の循環に尾が付いた形状でも全ノードを保持し木構造になる', () => {
    // A -> B -> C -> A の循環に、D -> B の尾が付く
    const input = [
      msg('A', { replyToId: 'B', replyToRoomId: 'R1', timestamp: 100 }),
      msg('B', { replyToId: 'C', replyToRoomId: 'R1', timestamp: 200 }),
      msg('C', { replyToId: 'A', replyToRoomId: 'R1', timestamp: 300 }),
      reply('D', 'B', { timestamp: 400 }),
    ];
    const threads = buildThreads(input);
    expect(threads).toHaveLength(1);
    expect(threads[0].rootId).toBe('A');
    expect(totalNodes(threads)).toBe(4);
  });

  it('不変条件: 出力ノード総数が入力メッセージ数と等しい', () => {
    const input = [
      msg('1', { timestamp: 100 }),
      reply('2', '1', { timestamp: 200 }),
      reply('3', '2', { timestamp: 300 }),
      msg('4', { timestamp: 400 }),
      reply('5', 'missing', { timestamp: 500 }),
      msg('6', { replyToId: '1', replyToRoomId: 'R-OTHER', timestamp: 600 }),
    ];
    expect(totalNodes(buildThreads(input))).toBe(input.length);
  });

  it('スレッドは updatedAt の降順で返る', () => {
    const threads = buildThreads([
      msg('old', { timestamp: 100 }),
      msg('new', { timestamp: 900 }),
      msg('mid', { timestamp: 500 }),
    ]);
    expect(threads.map((t) => t.rootId)).toEqual(['new', 'mid', 'old']);
  });

  it('updatedAt はスレッド内の最大 timestamp', () => {
    const threads = buildThreads([
      msg('1', { timestamp: 100 }),
      reply('2', '1', { timestamp: 700 }),
    ]);
    expect(threads[0].updatedAt).toBe(700);
  });
});
