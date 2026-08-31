import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createNameStore, storageKey } from '../../src/content/nameStore.js';

function fakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    get: vi.fn(async (key) => (key in data ? { [key]: data[key] } : {})),
    set: vi.fn(async (patch) => Object.assign(data, patch)),
  };
}

let store;
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => {
  if (store) store.stop();
  store = undefined;
  vi.useRealTimers();
});

describe('storageKey', () => {
  it('ルーム ID からキーを組み立てる', () => {
    expect(storageKey('12345678')).toBe('names:12345678');
  });
});

describe('createNameStore', () => {
  it('保存済みの名前を読み込む', async () => {
    const storage = fakeStorage({
      'names:R1': { v: 1, items: { 1: { name: '請求書の件', by: 'user', at: 10 } } },
    });
    store = createNameStore(storage, 300);
    const items = await store.load('R1');
    expect(items['1'].name).toBe('請求書の件');
    expect(store.getItems()['1'].name).toBe('請求書の件');
  });

  it('未保存のルームでは空を返す', async () => {
    store = createNameStore(fakeStorage(), 300);
    expect(await store.load('R9')).toEqual({});
  });

  it('setName は同期で新しい items を返す', async () => {
    store = createNameStore(fakeStorage(), 300);
    await store.load('R1');
    const items = store.setName('1', ' 請求書の件 ', 'user');
    expect(items['1'].name).toBe('請求書の件');
  });

  it('書き込みはデバウンスされ、1 回にまとまる', async () => {
    const storage = fakeStorage();
    store = createNameStore(storage, 300);
    await store.load('R1');
    store.setName('1', 'a', 'user');
    store.setName('2', 'b', 'user');
    expect(storage.set).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300);
    expect(storage.set).toHaveBeenCalledTimes(1);
    expect(storage.set.mock.calls[0][0]['names:R1'].v).toBe(1);
    expect(Object.keys(storage.set.mock.calls[0][0]['names:R1'].items)).toEqual(['1', '2']);
  });

  it('flush は保留中の書き込みを即座に実行する', async () => {
    const storage = fakeStorage();
    store = createNameStore(storage, 300);
    await store.load('R1');
    store.setName('1', 'a', 'user');
    await store.flush();
    expect(storage.set).toHaveBeenCalledTimes(1);
  });

  // ルーム切替の途中で前ルームの保留書き込みが残っていると、
  // 新ルームのキーへ前ルームの名前を書き込む事故になる。
  it('ルームを切り替える前に保留中の書き込みを吐き出す', async () => {
    const storage = fakeStorage();
    store = createNameStore(storage, 300);
    await store.load('R1');
    store.setName('1', 'a', 'user');
    await store.load('R2');
    expect(storage.set).toHaveBeenCalledTimes(1);
    expect(storage.set.mock.calls[0][0]).toHaveProperty('names:R1');
    expect(store.getItems()).toEqual({});
  });

  it('rekey で名前を新しいキーへ移す', async () => {
    const storage = fakeStorage({
      'names:R1': { v: 1, items: { 2: { name: '請求書の件', by: 'user', at: 10 } } },
    });
    store = createNameStore(storage, 300);
    await store.load('R1');
    store.rekey('2', '1');
    expect(store.getItems()['1'].name).toBe('請求書の件');
    expect(store.getItems()['2']).toBeUndefined();
  });

  it('storage が使えなくても例外を投げない', async () => {
    const broken = {
      get: vi.fn(async () => { throw new Error('no storage'); }),
      set: vi.fn(async () => { throw new Error('no storage'); }),
    };
    store = createNameStore(broken, 300);
    expect(await store.load('R1')).toEqual({});
    store.setName('1', 'a', 'user');
    await expect(store.flush()).resolves.toBeUndefined();
  });
});
