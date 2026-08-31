import { describe, it, expect } from 'vitest';
import { buildThreads } from '../../src/core/threadTree.js';
import {
  normalizeName,
  collectIdsByDepth,
  resolveName,
  putName,
  rekeyName,
  pruneNames,
  MAX_NAME_LENGTH,
} from '../../src/core/threadNames.js';

const msg = (id, opts = {}) => ({
  id, roomId: 'R1', accountId: 'A1', userName: `user-${id}`, avatarUrl: '',
  body: `body of ${id}`, replyToId: null, replyToRoomId: null,
  timestamp: 1000, index: 0, ...opts,
});
const reply = (id, toId, opts = {}) =>
  msg(id, { replyToId: toId, replyToRoomId: 'R1', ...opts });

describe('normalizeName', () => {
  it('前後の空白を落とし、連続空白と改行を空白1つに潰す', () => {
    expect(normalizeName('  請求書  の\n件  ')).toBe('請求書 の 件');
  });

  it('最大長で切り詰める', () => {
    expect(normalizeName('あ'.repeat(60))).toHaveLength(MAX_NAME_LENGTH);
  });

  it('null や undefined は空文字になる', () => {
    expect(normalizeName(null)).toBe('');
    expect(normalizeName(undefined)).toBe('');
  });
});

describe('collectIdsByDepth', () => {
  it('根に近い順に ID を返す', () => {
    const [thread] = buildThreads([
      msg('1', { timestamp: 100 }),
      reply('2', '1', { timestamp: 200 }),
      reply('3', '2', { timestamp: 300 }),
      reply('4', '1', { timestamp: 400 }),
    ]);
    // 深さ 0: 1 / 深さ 1: 2, 4 / 深さ 2: 3
    expect(collectIdsByDepth(thread.tree)).toEqual(['1', '2', '4', '3']);
  });
});

describe('resolveName', () => {
  it('rootId に名前があればそれを返す', () => {
    const [thread] = buildThreads([msg('1'), reply('2', '1')]);
    const items = { 1: { name: '請求書の件', by: 'user', at: 10 } };
    expect(resolveName(thread, items)).toEqual({ name: '請求書の件', key: '1' });
  });

  // spec §4.2: 親メッセージが後から読み込まれると rootId が変わる。
  // 名前は古い rootId (= 今は子孫) に残っているので、そこから拾えないといけない。
  it('rootId が変わっても子孫に残った名前を拾う', () => {
    const [thread] = buildThreads([
      msg('1', { timestamp: 100 }),
      reply('2', '1', { timestamp: 200 }),
      reply('3', '2', { timestamp: 300 }),
    ]);
    const items = { 2: { name: '請求書の件', by: 'user', at: 10 } };
    expect(resolveName(thread, items)).toEqual({ name: '請求書の件', key: '2' });
  });

  it('複数の子孫に名前があれば根に近いほうを採る', () => {
    const [thread] = buildThreads([
      msg('1', { timestamp: 100 }),
      reply('2', '1', { timestamp: 200 }),
      reply('3', '2', { timestamp: 300 }),
    ]);
    const items = {
      2: { name: '近いほう', by: 'user', at: 10 },
      3: { name: '遠いほう', by: 'user', at: 20 },
    };
    expect(resolveName(thread, items).name).toBe('近いほう');
  });

  it('名前が無ければ null を返す', () => {
    const [thread] = buildThreads([msg('1'), reply('2', '1')]);
    expect(resolveName(thread, {})).toBeNull();
    expect(resolveName(thread, null)).toBeNull();
  });
});

describe('putName', () => {
  it('名前を追加する', () => {
    const next = putName({}, '1', ' 請求書の件 ', 'user', 100);
    expect(next).toEqual({ 1: { name: '請求書の件', by: 'user', at: 100 } });
  });

  it('空文字を渡すと削除する', () => {
    const items = { 1: { name: '請求書の件', by: 'user', at: 100 } };
    expect(putName(items, '1', '   ', 'user', 200)).toEqual({});
  });

  it('元のオブジェクトを変更しない', () => {
    const items = {};
    putName(items, '1', '名前', 'user', 100);
    expect(items).toEqual({});
  });
});

describe('pruneNames', () => {
  it('上限を超えたら at の古い順に捨てる', () => {
    const items = {
      1: { name: 'a', by: 'user', at: 100 },
      2: { name: 'b', by: 'user', at: 300 },
      3: { name: 'c', by: 'user', at: 200 },
    };
    expect(Object.keys(pruneNames(items, 2)).sort()).toEqual(['2', '3']);
  });

  it('上限以下なら同じ内容を返す', () => {
    const items = { 1: { name: 'a', by: 'user', at: 100 } };
    expect(pruneNames(items, 2)).toEqual(items);
  });
});

describe('rekeyName', () => {
  it('名前を新しいキーへ付け替え、古いキーを消す', () => {
    const items = { 2: { name: '請求書の件', by: 'user', at: 100 } };
    expect(rekeyName(items, '2', '1')).toEqual({
      1: { name: '請求書の件', by: 'user', at: 100 },
    });
  });

  it('付け替え元が無ければ何もしない', () => {
    const items = { 1: { name: 'a', by: 'user', at: 100 } };
    expect(rekeyName(items, '9', '8')).toEqual(items);
  });
});
