# スレッド命名 (手動 + AI) 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** スレッドに名前をつけられるようにする。手動命名を無料機能として出し (Phase 1)、AI による自動命名を有料機能として重ねる (Phase 2)。

**Architecture:** 名前の解決・正規化・破棄は DOM もストレージも触らない純関数 (`src/core/threadNames.js`) に置く。永続化は `chrome.storage.local` のルーム単位1アイテムを扱うラッパ (`src/content/nameStore.js`) に隔離する。AI 命名の通信は service worker (`src/background.js`) にのみ書き、content script には `fetch` を一切書かない。

**Tech Stack:** Vanilla JS (ESM, ビルドなし) / Chrome Manifest V3 / Shadow DOM / Vitest + jsdom

**Spec:** `docs/superpowers/specs/2026-08-31-thread-naming.md`

## Global Constraints

前提設計 (`docs/superpowers/specs/2026-08-29-threadswork-design.md`) の制約を引き継ぐ。以下は全タスクの要件に暗黙に含まれる。

- メッセージ ID (`data-mid`) とルーム ID (`data-rid`) は 19 桁前後の数値文字列。**絶対に `Number()` 化しない。** 比較・オブジェクトのキーは常に文字列。
- ビルドツールを導入しない。`devDependencies` は `vitest` と `jsdom` のみ。新しい実行時依存を追加しない。
- DOM に注入する id / クラス / CSS 変数は `ctv-` 接頭辞。
- styled-components の生成クラス (`sc-*` 等) に依存しない。依存してよいのは `_` 接頭辞クラス、`data-*`、`data-testid` のみ。
- `jsdom` は `innerText` を実装しない。テキスト取得は `textContent` ベース。
- 単一メッセージ・単一スレッドの処理失敗で全体の描画を止めない。
- **content script (`src/content/**`, `src/ui/**`) に `fetch` / `XMLHttpRequest` を書かない。** Phase 2 の通信は `src/background.js` のみ。
- **`src/content/main.js` から (推移的に) import される新規ファイルは、必ず `manifest.json` の `web_accessible_resources` に追加する。** 追加を忘れると動的 import が実行時に失敗し、テストは緑のまま実機だけ壊れる。
- Phase 1 の間は `permissions` を `["storage"]` のまま変えない。`host_permissions` も変えない。
- 名前の最大長は 40 文字 (`MAX_NAME_LENGTH`)、1ルームあたりの保存上限は 200 件 (`MAX_NAMES_PER_ROOM`)。
- ヒューリスティックによる自動命名を**実装しない** (spec §2.1)。AI 失敗時もフォールバックしない。

## テストの実行

```bash
npm test                      # 全件
npx vitest run test/core/threadNames.test.js -t "テスト名"   # 単体
```

---

# Phase 1 — 手動命名 (v0.2.0 / 通信なし)

Phase 1 だけで単体で出荷できる。プライバシーポリシーもストア掲載文も変更不要。

---

### Task 1: 名前の純ロジック (`threadNames.js`)

名前の正規化、スレッドからの名前解決、上限による破棄。DOM もストレージも触らないので、このタスクだけで完結して検証できる。

spec §4.2 の「rootId が変化する問題」をここで解く。これが本機能で最も壊れやすい箇所。

**Files:**
- Create: `src/core/threadNames.js`
- Test: `test/core/threadNames.test.js`

**Interfaces:**
- Consumes: `Thread` / `ThreadNode` 型 (`src/core/types.js`)、`buildThreads` (`src/core/threadTree.js`) — テストでスレッドを組み立てるため
- Produces (すべて `src/core/threadNames.js` からの名前付きエクスポート):
  - `MAX_NAME_LENGTH: number` = 40
  - `MAX_NAMES_PER_ROOM: number` = 200
  - `normalizeName(raw: unknown): string`
  - `collectIdsByDepth(node: ThreadNode): string[]` — 根に近い順のメッセージ ID 配列
  - `resolveName(thread: Thread, items: NameItems): { name: string, key: string } | null`
  - `putName(items: NameItems, rootId: string, name: string, by: 'user'|'ai', now?: number): NameItems`
  - `rekeyName(items: NameItems, fromId: string, toId: string): NameItems`
  - `pruneNames(items: NameItems, max?: number): NameItems`
  - 型 `NameItems` = `Record<string, { name: string, by: 'user'|'ai', at: number }>` (JSDoc)

すべて**元のオブジェクトを変更せず新しいオブジェクトを返す**。呼び出し側が差分を検知できるようにするため。

- [ ] **Step 1: 失敗するテストを書く**

`test/core/threadNames.test.js` を新規作成する。

```js
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
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npx vitest run test/core/threadNames.test.js`
Expected: FAIL — `Failed to resolve import "../../src/core/threadNames.js"`

- [ ] **Step 3: 実装する**

`src/core/threadNames.js` を新規作成する。

```js
/**
 * スレッド名の正規化・解決・破棄を行う純関数群。
 * DOM にもストレージにも触らない。
 *
 * @typedef {{ name: string, by: 'user'|'ai', at: number }} NameEntry
 * @typedef {Record<string, NameEntry>} NameItems
 */

export const MAX_NAME_LENGTH = 40;
export const MAX_NAMES_PER_ROOM = 200;

/**
 * 表示・保存する形に整える。改行と連続空白は空白 1 つに潰す。
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeName(raw) {
  if (raw === null || raw === undefined) return '';
  return String(raw).replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH);
}

/**
 * スレッド内のメッセージ ID を根に近い順 (幅優先) で返す。
 * 深さ優先だと「最初の子の子孫」が「2 番目の子」より先に来てしまい、
 * 「根に一番近い名前」を選べない。
 * @param {import('./types.js').ThreadNode} node
 * @returns {string[]}
 */
export function collectIdsByDepth(node) {
  const ids = [];
  let level = node ? [node] : [];
  while (level.length > 0) {
    const next = [];
    for (const current of level) {
      ids.push(current.message.id);
      for (const child of current.children) next.push(child);
    }
    level = next;
  }
  return ids;
}

/**
 * スレッドに紐づく名前を探す。
 *
 * rootId だけを見てはいけない。findRoot が返す root は「その時点で DOM に
 * 読み込まれている中での最上位」でしかなく、利用者が上にスクロールして親が
 * 読み込まれると root が入れ替わる。名前は古い root (今は子孫) に残っているため、
 * 子孫まで辿って拾い、呼び出し側が新しい root へ付け替える。
 *
 * @param {import('./types.js').Thread} thread
 * @param {NameItems|null} items
 * @returns {{name: string, key: string}|null}
 */
export function resolveName(thread, items) {
  if (!items || !thread) return null;
  for (const id of collectIdsByDepth(thread.tree)) {
    const entry = items[id];
    if (entry && entry.name) return { name: entry.name, key: id };
  }
  return null;
}

/**
 * 名前を設定する。空文字なら削除。常に新しいオブジェクトを返す。
 * @param {NameItems} items
 * @param {string} rootId
 * @param {string} name
 * @param {'user'|'ai'} by
 * @param {number} [now] UNIX 秒
 * @returns {NameItems}
 */
export function putName(items, rootId, name, by, now = Math.floor(Date.now() / 1000)) {
  const next = { ...(items || {}) };
  const normalized = normalizeName(name);
  if (!normalized) {
    delete next[rootId];
    return next;
  }
  next[rootId] = { name: normalized, by, at: now };
  return pruneNames(next);
}

/**
 * 名前を別のキーへ移す (root が入れ替わったとき)。
 * @param {NameItems} items
 * @param {string} fromId
 * @param {string} toId
 * @returns {NameItems}
 */
export function rekeyName(items, fromId, toId) {
  const source = items && items[fromId];
  if (!source || fromId === toId) return items || {};
  const next = { ...items };
  delete next[fromId];
  next[toId] = source;
  return next;
}

/**
 * 上限を超えた分を古い順に捨てる。
 * @param {NameItems} items
 * @param {number} [max]
 * @returns {NameItems}
 */
export function pruneNames(items, max = MAX_NAMES_PER_ROOM) {
  const ids = Object.keys(items || {});
  if (ids.length <= max) return items || {};
  const sorted = ids.sort((a, b) => (items[b].at || 0) - (items[a].at || 0));
  const kept = {};
  for (const id of sorted.slice(0, max)) kept[id] = items[id];
  return kept;
}
```

- [ ] **Step 4: テストを実行して通ることを確認する**

Run: `npx vitest run test/core/threadNames.test.js`
Expected: PASS (16 tests)

- [ ] **Step 5: コミット**

```bash
git add src/core/threadNames.js test/core/threadNames.test.js
git commit -m "feat: スレッド名の正規化と解決を行う純ロジックを追加"
```

---

### Task 2: 永続化ラッパ (`nameStore.js`)

`chrome.storage.local` をルーム単位 1 アイテムで読み書きする層。ストレージの形式を知っているのはこのファイルだけにする。

**Files:**
- Create: `src/content/nameStore.js`
- Test: `test/content/nameStore.test.js`
- Modify: `manifest.json` (`web_accessible_resources` に 2 ファイル追加)

**Interfaces:**
- Consumes: `putName` / `rekeyName` (`src/core/threadNames.js`)
- Produces (`src/content/nameStore.js`):
  - `storageKey(roomId: string): string` — `"names:{roomId}"`
  - `createNameStore(storage?, debounceMs?): NameStore`
  - `NameStore` = `{ load(roomId: string): Promise<NameItems>, getItems(): NameItems, setName(rootId: string, name: string, by: 'user'|'ai'): NameItems, rekey(fromId: string, toId: string): void, flush(): Promise<void>, stop(): void }`
  - `setName` は**同期で**更新後の `NameItems` を返す (描画を待たせないため)。書き込みは裏でデバウンスされる。

- [ ] **Step 1: 失敗するテストを書く**

`test/content/nameStore.test.js` を新規作成する。

```js
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
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npx vitest run test/content/nameStore.test.js`
Expected: FAIL — `Failed to resolve import "../../src/content/nameStore.js"`

- [ ] **Step 3: 実装する**

`src/content/nameStore.js` を新規作成する。

```js
import { putName, rekeyName } from '../core/threadNames.js';

const KEY_PREFIX = 'names:';
const SCHEMA_VERSION = 1;
const WRITE_DEBOUNCE_MS = 300;

/**
 * ルームごとに 1 アイテム。スレッド 1 件 1 アイテムにするとアイテム数が
 * すぐ数千に達し、将来 chrome.storage.sync (512 アイテム上限) へ移せなくなる。
 * @param {string} roomId
 */
export function storageKey(roomId) {
  return `${KEY_PREFIX}${roomId}`;
}

function defaultStorage() {
  try {
    return chrome.storage.local;
  } catch {
    return null;
  }
}

/**
 * 名前の読み書きを担う。ストレージの形式を知っているのはこのファイルだけ。
 * @param {{get: Function, set: Function}|null} [storage]
 * @param {number} [debounceMs]
 */
export function createNameStore(storage = defaultStorage(), debounceMs = WRITE_DEBOUNCE_MS) {
  let roomId = null;
  let items = {};
  let timer = null;
  let dirty = false;

  async function write() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (!dirty || !roomId || !storage) return;
    const key = storageKey(roomId);
    const payload = { v: SCHEMA_VERSION, items };
    dirty = false;
    try {
      await storage.set({ [key]: payload });
    } catch {
      // 保存できなくても表示は続ける。次の変更でまた試みる。
    }
  }

  function schedule() {
    dirty = true;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => { write(); }, debounceMs);
  }

  return {
    async load(nextRoomId) {
      // 切り替える前に前ルームの保留を吐き出す。残したまま roomId を差し替えると
      // 新ルームのキーへ前ルームの名前を書き込む事故になる。
      await write();
      roomId = nextRoomId;
      items = {};
      if (!roomId || !storage) return items;
      try {
        const stored = await storage.get(storageKey(roomId));
        const record = stored && stored[storageKey(roomId)];
        if (record && record.v === SCHEMA_VERSION && record.items) items = record.items;
      } catch {
        items = {};
      }
      return items;
    },

    getItems() {
      return items;
    },

    setName(rootId, name, by) {
      items = putName(items, rootId, name, by);
      schedule();
      return items;
    },

    rekey(fromId, toId) {
      const next = rekeyName(items, fromId, toId);
      if (next === items) return;
      items = next;
      schedule();
    },

    flush() {
      return write();
    },

    stop() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
```

- [ ] **Step 4: テストを実行して通ることを確認する**

Run: `npx vitest run test/content/nameStore.test.js`
Expected: PASS (9 tests)

- [ ] **Step 5: `manifest.json` に新しいモジュールを登録する**

`main.js` から推移的に import されるため、ここに無いと実機で動的 import が失敗する。
`web_accessible_resources[0].resources` の配列に 2 行足す。

```json
        "src/core/threadNames.js",
        "src/content/nameStore.js",
```

- [ ] **Step 6: 全テストを実行する**

Run: `npm test`
Expected: PASS (既存テストを含め全件)

- [ ] **Step 7: コミット**

```bash
git add src/content/nameStore.js test/content/nameStore.test.js manifest.json
git commit -m "feat: スレッド名を chrome.storage へ保存する層を追加"
```

---

### Task 3: 名前の表示 (`render.js`)

名前があればカード見出しを名前に差し替え、送信者名をメタ行へ降ろす。まだ編集はしない。

**Files:**
- Modify: `src/ui/render.js:106-137` (`buildCard`)
- Modify: `src/ui/styles.js` (`.thread__owner` の追加)
- Test: `test/ui/render.test.js` (末尾に describe を追加)

**Interfaces:**
- Consumes: `resolveName` (`src/core/threadNames.js`)
- Produces: `renderThreads(container, threads, options)` の `options` に `names?: NameItems` を追加 (省略時は `null` = 全スレッド無名として描画)。既存の呼び出しは変更不要。

- [ ] **Step 1: 失敗するテストを書く**

`test/ui/render.test.js` の末尾に追記する。

```js
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
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npx vitest run test/ui/render.test.js -t "スレッド名の表示"`
Expected: FAIL — `.thread__name` の内容が `三沢慎吾` のまま (1 件目)

- [ ] **Step 3: 実装する**

`src/ui/render.js` の先頭に import を足す。

```js
import { resolveName } from '../core/threadNames.js';
```

`buildCard` のシグネチャを `buildCard(thread, onJump, openIds, onToggle, names)` に変え、`head` と `meta` の組み立てを差し替える。

```js
  const resolved = resolveName(thread, names);

  const head = el('div', 'thread__head');
  head.append(
    el('span', 'thread__name', resolved ? resolved.name : thread.rootMessage.userName),
    el('span', 'thread__time', formatRelative(thread.updatedAt))
  );

  const meta = el('div', 'thread__meta');
  meta.appendChild(el('span', 'thread__replies', `返信 ${thread.replyCount} 件`));
  // 名前をつけたら見出しの席は名前に譲り、送信者名はここへ降りる。
  if (resolved) meta.appendChild(el('span', 'thread__owner', thread.rootMessage.userName));
  if (thread.rootIsSynthetic) {
    meta.appendChild(el('span', 'thread__badge', '親メッセージ未読み込み'));
  }
```

`renderThreads` で `names` を受けて渡す。

```js
  const { hideEmpty, onJump, openIds = null, onToggle = () => {}, names = null } = options;
```

```js
    list.appendChild(buildCard(thread, onJump, openIds, onToggle, names));
```

- [ ] **Step 4: `styles.js` に `.thread__owner` を足す**

`.thread__badge` の定義の直前に追記する。

```css
.thread__owner {
  color: var(--text-dim);
  max-width: 10em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

- [ ] **Step 5: テストを実行して通ることを確認する**

Run: `npm test`
Expected: PASS (全件。既存の `renderThreads` テストは `names` 未指定で従来どおり通る)

- [ ] **Step 6: コミット**

```bash
git add src/ui/render.js src/ui/styles.js test/ui/render.test.js
git commit -m "feat: スレッド名をカード見出しに表示する"
```

---

### Task 4: 名前の編集 UI と配線

鉛筆ボタン → その場で `<input>` → Enter 確定 / Esc 取消。`main.js` で `nameStore` と繋いで実際に保存されるようにする。

**Files:**
- Modify: `src/ui/render.js` (`buildCard` に編集ボタンとインライン編集を追加)
- Modify: `src/ui/styles.js` (`.thread__rename` / `.thread__input`)
- Modify: `src/content/main.js:9-21` (state), `:97-119` (refresh), `:121-145` (boot), `:156-168` (teardown)
- Test: `test/ui/render.test.js` (describe 追加)

**Interfaces:**
- Consumes: `createNameStore` (`src/content/nameStore.js`)、`resolveName` (`src/core/threadNames.js`)
- Produces: `renderThreads` の `options` に `onRename?: (key: string, name: string) => void` を追加。`key` は `resolveName` が返したキー、無名なら `thread.rootId`。

- [ ] **Step 1: 失敗するテストを書く**

`test/ui/render.test.js` の末尾に追記する。

```js
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
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npx vitest run test/ui/render.test.js -t "スレッド名の編集"`
Expected: FAIL — `container.querySelector('[data-role="rename"]')` が `null`

- [ ] **Step 3: `render.js` に編集 UI を実装する**

`buildCard` のシグネチャに `onRename` を足し (`buildCard(thread, onJump, openIds, onToggle, names, onRename)`)、`head` の組み立て直後に以下を追加する。

```js
  const nameEl = head.querySelector('.thread__name');
  const nameKey = resolved ? resolved.key : thread.rootId;

  const renameBtn = el('button', 'thread__rename', '✎');
  renameBtn.type = 'button';
  renameBtn.dataset.role = 'rename';
  renameBtn.setAttribute('aria-label', 'スレッド名を編集');

  function startRename() {
    if (head.querySelector('[data-role="rename-input"]')) return;
    const input = el('input', 'thread__input');
    input.dataset.role = 'rename-input';
    input.type = 'text';
    input.maxLength = MAX_NAME_LENGTH;
    input.value = resolved ? resolved.name : '';
    input.placeholder = 'スレッド名';

    let settled = false;
    const commit = () => {
      if (settled) return;
      settled = true;
      onRename(nameKey, input.value);
    };
    const cancel = () => {
      if (settled) return;
      settled = true;
      input.replaceWith(nameEl);
    };

    input.addEventListener('keydown', (event) => {
      // details の中なので、Enter/Space をそのまま通すとカードが開閉する。
      event.stopPropagation();
      if (event.key === 'Enter') {
        event.preventDefault();
        commit();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        cancel();
      }
    });
    input.addEventListener('click', (event) => event.preventDefault());
    input.addEventListener('blur', commit);

    nameEl.replaceWith(input);
    input.focus();
    input.select();
  }

  renameBtn.addEventListener('click', (event) => {
    // summary 内のクリックは details の開閉を起こす。ここで止める。
    event.preventDefault();
    event.stopPropagation();
    startRename();
  });

  head.appendChild(renameBtn);
```

`MAX_NAME_LENGTH` の import を先頭に足す。

```js
import { resolveName, MAX_NAME_LENGTH } from '../core/threadNames.js';
```

`renderThreads` の分割代入と `buildCard` 呼び出しに `onRename` を通す。

```js
  const { hideEmpty, onJump, openIds = null, onToggle = () => {}, names = null,
    onRename = () => {} } = options;
```

```js
    list.appendChild(buildCard(thread, onJump, openIds, onToggle, names, onRename));
```

- [ ] **Step 4: テストを実行して通ることを確認する**

Run: `npx vitest run test/ui/render.test.js`
Expected: PASS

- [ ] **Step 5: `styles.js` にスタイルを足す**

`.thread__time` の定義の直後に追記する。

```css
.thread__rename {
  border: none;
  background: transparent;
  color: var(--text-faint);
  font: inherit;
  font-size: 11px;
  line-height: 1;
  padding: 2px 4px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  opacity: 0;
  transition: opacity var(--ease), color var(--ease), background var(--ease);
}
.thread__summary:hover .thread__rename,
.thread__rename:focus-visible { opacity: 1; }
.thread__rename:hover { color: var(--accent-text); background: var(--accent-weak); }
.thread__rename:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.thread__input {
  font: inherit;
  font-weight: 600;
  color: var(--text);
  background: var(--surface-2);
  border: 1px solid var(--accent);
  border-radius: var(--radius-sm);
  padding: 1px 6px;
  min-width: 0;
  flex: 1 1 auto;
}
.thread__input:focus { outline: none; }
```

- [ ] **Step 6: `main.js` に `nameStore` を配線する**

import を足す。`getCurrentRoomId` は**既存の `./selectors.js` の import 行に追記する** (同じモジュールから 2 回 import しない)。

```js
import { getMessageElements, runHealthCheck, getCurrentRoomId } from './selectors.js';
import { createNameStore } from './nameStore.js';
import { resolveName } from '../core/threadNames.js';
```

`state` に 2 つ足す。

```js
  store: null,
  names: {},
```

`refresh` の `renderThreads` 呼び出しに `names` と `onRename` を渡し、root 入れ替わりの付け替えを行う。`buildThreads` の直後に挿入する。

```js
  // root が入れ替わったスレッドの名前を新しい rootId へ寄せておく。
  // 放っておいても resolveName が子孫まで辿るので表示は壊れないが、
  // 毎回の探索が積み上がるのでここで正規化する。
  for (const thread of threads) {
    const resolved = resolveName(thread, state.names);
    if (resolved && resolved.key !== thread.rootId) {
      state.store.rekey(resolved.key, thread.rootId);
      state.names = state.store.getItems();
    }
  }
```

```js
    names: state.names,
    onRename: (key, name) => {
      state.names = state.store.setName(key, name, 'user');
      refresh();
    },
```

`boot` を非同期の読み込みに対応させる。`createPanel()` の直後、`refresh()` の前に置く。

```js
  state.store = createNameStore();
  state.store.load(getCurrentRoomId()).then((items) => {
    state.names = items;
    refresh();
  });
```

`onRoomChange` の中で読み直す。`state.openIds.clear()` の直後に足す。

```js
      state.names = {};
      state.store.load(roomId).then((items) => {
        state.names = items;
        refresh();
      });
```

`teardown` に後始末を足す。

```js
  if (state.store) {
    state.store.flush();
    state.store.stop();
    state.store = null;
  }
  state.names = {};
```

- [ ] **Step 7: 全テストを実行する**

Run: `npm test`
Expected: PASS 全件

`test/content/main.test.js` が `chrome.storage` を持たない環境で `boot` を呼ぶ場合、`createNameStore` は `defaultStorage()` が `null` を返して no-op になるため落ちない。落ちる場合は `main.test.js` の `chrome` スタブに `storage.local.get` / `set` を足す (返り値は `Promise.resolve({})`)。

- [ ] **Step 8: 実機で確認する**

`npm run package` して Chrome に読み込み、Chatwork で以下を確認する。

1. 鉛筆ボタンで名前をつけられる
2. リロードしても名前が残る
3. 別ルームへ切り替えて戻っても残る
4. 名前をつけたスレッドの親メッセージが読み込まれるまで上にスクロールしても、名前が消えない (§4.2 の回帰確認。**ここが最重要**)

- [ ] **Step 9: コミット**

```bash
git add src/ui/render.js src/ui/styles.js src/content/main.js test/ui/render.test.js
git commit -m "feat: スレッド名を編集して保存できるようにした"
```

---

# Phase 2 — AI 命名 (v0.3.0 / サーバー前提)

**着手条件:** サーバー (別リポジトリ) が spec §7 の契約で動いていること。サーバー側の実装計画はこの計画に含めない。

**リリース条件:** spec §3.2 の書類変更が完了していること (Task 10)。先にコードを出すと虚偽申告になる。

---

### Task 5: 送信ペイロードの組み立て (`namePayload.js`)

何をサーバーへ送るかを決める純関数。通信しないのでテストしやすく、かつプライバシー上いちばん重要な箇所。

**Files:**
- Create: `src/core/namePayload.js`
- Test: `test/core/namePayload.test.js`

**Interfaces:**
- Consumes: `Thread` / `ThreadNode` 型
- Produces (`src/core/namePayload.js`):
  - `MAX_ROOT_CHARS` = 400 / `MAX_REPLY_CHARS` = 200 / `MAX_REPLIES` = 10 / `MAX_THREADS_PER_REQUEST` = 20
  - `flattenMessages(node: ThreadNode): ChatworkMessage[]` — 根に近い順
  - `buildThreadPayload(thread: Thread, ref: string): {ref: string, messages: {speaker: string, text: string}[]}`
  - `buildRequest(threads: Thread[], licenseKey: string): {licenseKey: string, threads: [...]}`

- [ ] **Step 1: 失敗するテストを書く**

`test/core/namePayload.test.js` を新規作成する。

```js
import { describe, it, expect } from 'vitest';
import { buildThreads } from '../../src/core/threadTree.js';
import { buildRequest, buildThreadPayload, MAX_ROOT_CHARS, MAX_REPLY_CHARS }
  from '../../src/core/namePayload.js';

const msg = (id, opts = {}) => ({
  id, roomId: 'R1', accountId: 'A1', userName: `user-${id}`, avatarUrl: '',
  body: `body of ${id}`, replyToId: null, replyToRoomId: null,
  timestamp: 1000, index: 0, ...opts,
});
const reply = (id, toId, opts = {}) =>
  msg(id, { replyToId: toId, replyToRoomId: 'R1', ...opts });

describe('buildThreadPayload', () => {
  // spec §6.2: 氏名・アカウント ID・メッセージ ID を外へ出さない。
  it('話者を A / B へ匿名化し、氏名もアカウント ID も含めない', () => {
    const [thread] = buildThreads([
      msg('1', { accountId: '111', userName: '三沢慎吾', body: '請求書の件です', timestamp: 100 }),
      reply('2', '1', { accountId: '222', userName: '山田太郎', body: '確認しました', timestamp: 200 }),
      reply('3', '1', { accountId: '111', userName: '三沢慎吾', body: 'お願いします', timestamp: 300 }),
    ]);
    const payload = buildThreadPayload(thread, '0');
    expect(payload).toEqual({
      ref: '0',
      messages: [
        { speaker: 'A', text: '請求書の件です' },
        { speaker: 'B', text: '確認しました' },
        { speaker: 'A', text: 'お願いします' },
      ],
    });
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain('三沢慎吾');
    expect(serialized).not.toContain('111');
  });

  it('起点メッセージと返信をそれぞれの上限で切り詰める', () => {
    const [thread] = buildThreads([
      msg('1', { body: 'あ'.repeat(600), timestamp: 100 }),
      reply('2', '1', { body: 'い'.repeat(300), timestamp: 200 }),
    ]);
    const payload = buildThreadPayload(thread, '0');
    expect(payload.messages[0].text).toHaveLength(MAX_ROOT_CHARS);
    expect(payload.messages[1].text).toHaveLength(MAX_REPLY_CHARS);
  });

  it('返信は先頭 10 件までしか含めない', () => {
    const messages = [msg('1', { timestamp: 100 })];
    for (let i = 2; i <= 20; i += 1) {
      messages.push(reply(String(i), '1', { timestamp: 100 + i }));
    }
    const [thread] = buildThreads(messages);
    expect(buildThreadPayload(thread, '0').messages).toHaveLength(11);
  });
});

describe('buildRequest', () => {
  it('ref は 0 から始まる連番になる', () => {
    const threads = buildThreads([
      msg('1', { timestamp: 100 }), reply('2', '1', { timestamp: 200 }),
      msg('3', { timestamp: 300 }), reply('4', '3', { timestamp: 400 }),
    ]);
    const request = buildRequest(threads, 'KEY');
    expect(request.licenseKey).toBe('KEY');
    expect(request.threads.map((t) => t.ref)).toEqual(['0', '1']);
  });

  it('1 回のリクエストは 20 スレッドまで', () => {
    const messages = [];
    for (let i = 1; i <= 60; i += 2) {
      messages.push(msg(String(i), { timestamp: i }));
      messages.push(reply(String(i + 1), String(i), { timestamp: i + 1 }));
    }
    const request = buildRequest(buildThreads(messages), 'KEY');
    expect(request.threads).toHaveLength(20);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npx vitest run test/core/namePayload.test.js`
Expected: FAIL — `Failed to resolve import "../../src/core/namePayload.js"`

- [ ] **Step 3: 実装する**

`src/core/namePayload.js` を新規作成する。

```js
/**
 * AI 命名でサーバーへ送るペイロードを組み立てる純関数。
 * ここが「何を外へ出すか」を決める唯一の場所。
 * 氏名・アカウント ID・メッセージ ID・ルーム ID は絶対に含めない (spec §6.2)。
 */

export const MAX_ROOT_CHARS = 400;
export const MAX_REPLY_CHARS = 200;
export const MAX_REPLIES = 10;
export const MAX_THREADS_PER_REQUEST = 20;

/**
 * 根に近い順 (幅優先) にメッセージを並べる。
 * @param {import('./types.js').ThreadNode} node
 * @returns {import('./types.js').ChatworkMessage[]}
 */
export function flattenMessages(node) {
  const messages = [];
  let level = node ? [node] : [];
  while (level.length > 0) {
    const next = [];
    for (const current of level) {
      messages.push(current.message);
      for (const child of current.children) next.push(child);
    }
    level = next;
  }
  return messages;
}

/**
 * 1 スレッド分のペイロード。
 * 話者ラベルは A から順に振る。含めるのは最大 11 件 (起点 + 返信 10) なので
 * Z を超えることはない。
 * @param {import('./types.js').Thread} thread
 * @param {string} ref リクエスト内でのみ有効な対応キー
 */
export function buildThreadPayload(thread, ref) {
  const labels = new Map();
  const labelOf = (accountId) => {
    const key = accountId || '';
    if (!labels.has(key)) labels.set(key, String.fromCharCode(65 + labels.size));
    return labels.get(key);
  };

  const flat = flattenMessages(thread.tree).slice(0, MAX_REPLIES + 1);
  const messages = flat.map((message, index) => ({
    speaker: labelOf(message.accountId),
    text: String(message.body || '').slice(0, index === 0 ? MAX_ROOT_CHARS : MAX_REPLY_CHARS),
  }));

  return { ref, messages };
}

/**
 * @param {import('./types.js').Thread[]} threads
 * @param {string} licenseKey
 */
export function buildRequest(threads, licenseKey) {
  return {
    licenseKey,
    threads: threads
      .slice(0, MAX_THREADS_PER_REQUEST)
      .map((thread, index) => buildThreadPayload(thread, String(index))),
  };
}
```

- [ ] **Step 4: テストを実行して通ることを確認する**

Run: `npx vitest run test/core/namePayload.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: コミット**

```bash
git add src/core/namePayload.js test/core/namePayload.test.js
git commit -m "feat: AI 命名の送信ペイロードを組み立てる純関数を追加"
```

---

### Task 6: 設定の保存 (`settings.js`)

AI 命名の有効/無効とライセンスキー。既定は無効 (spec §3.1)。

**Files:**
- Create: `src/content/settings.js`
- Test: `test/content/settings.test.js`
- Modify: `manifest.json` (`web_accessible_resources` に `src/content/settings.js` と `src/core/namePayload.js`)

**Interfaces:**
- Produces (`src/content/settings.js`):
  - `AI_DEFAULTS` = `{ aiNaming: false, licenseKey: '' }`
  - `loadAiSettings(storage?): Promise<{aiNaming: boolean, licenseKey: string}>`
  - `saveAiSettings(patch, storage?): Promise<void>`

- [ ] **Step 1: 失敗するテストを書く**

`test/content/settings.test.js` を新規作成する。

```js
import { describe, it, expect, vi } from 'vitest';
import { loadAiSettings, saveAiSettings, AI_DEFAULTS } from '../../src/content/settings.js';

function fakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    get: vi.fn(async (defaults) => ({ ...defaults, ...data })),
    set: vi.fn(async (patch) => Object.assign(data, patch)),
  };
}

describe('loadAiSettings', () => {
  it('既定では AI 命名は無効', async () => {
    expect(await loadAiSettings(fakeStorage())).toEqual(AI_DEFAULTS);
    expect(AI_DEFAULTS.aiNaming).toBe(false);
  });

  it('保存済みの値を読む', async () => {
    const storage = fakeStorage({ aiNaming: true, licenseKey: 'KEY' });
    expect(await loadAiSettings(storage)).toEqual({ aiNaming: true, licenseKey: 'KEY' });
  });

  it('storage が壊れていても既定値を返す', async () => {
    const broken = { get: vi.fn(async () => { throw new Error('x'); }), set: vi.fn() };
    expect(await loadAiSettings(broken)).toEqual(AI_DEFAULTS);
  });
});

describe('saveAiSettings', () => {
  it('部分更新を保存する', async () => {
    const storage = fakeStorage();
    await saveAiSettings({ aiNaming: true }, storage);
    expect(storage.set).toHaveBeenCalledWith({ aiNaming: true });
  });

  it('保存に失敗しても例外を投げない', async () => {
    const broken = { get: vi.fn(), set: vi.fn(async () => { throw new Error('x'); }) };
    await expect(saveAiSettings({ aiNaming: true }, broken)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npx vitest run test/content/settings.test.js`
Expected: FAIL — `Failed to resolve import "../../src/content/settings.js"`

- [ ] **Step 3: 実装する**

`src/content/settings.js` を新規作成する。

```js
/**
 * AI 命名に関する設定。既定は無効 (spec §3.1)。
 * 有効化されるまで、この拡張は一度も外部へ通信しない。
 */
export const AI_DEFAULTS = { aiNaming: false, licenseKey: '' };

function defaultStorage() {
  try {
    return chrome.storage.local;
  } catch {
    return null;
  }
}

export async function loadAiSettings(storage = defaultStorage()) {
  if (!storage) return { ...AI_DEFAULTS };
  try {
    const stored = await storage.get({ ...AI_DEFAULTS });
    return {
      aiNaming: stored.aiNaming === true,
      licenseKey: String(stored.licenseKey || ''),
    };
  } catch {
    return { ...AI_DEFAULTS };
  }
}

export async function saveAiSettings(patch, storage = defaultStorage()) {
  if (!storage) return;
  try {
    await storage.set(patch);
  } catch {
    // 保存できなくても動作は継続する
  }
}
```

- [ ] **Step 4: テストを実行して通ることを確認する**

Run: `npx vitest run test/content/settings.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: `manifest.json` に 2 ファイル追加する**

```json
        "src/core/namePayload.js",
        "src/content/settings.js",
```

- [ ] **Step 6: コミット**

```bash
git add src/content/settings.js test/content/settings.test.js manifest.json
git commit -m "feat: AI 命名の設定を保存できるようにした"
```

---

### Task 7: オプションページ (有効化とライセンスキー入力)

Task 6 で設定を保存できるようにしたが、**利用者がそれを有効にする手段がまだ無い。** ここで作る。

パネル内には置かない (spec §5.4)。パネルは Chatwork の画面上に出るため、ライセンスキーの
入力欄をそこに置くと画面共有中に映る。

**Files:**
- Create: `src/options/options.html`
- Create: `src/options/options.js`
- Test: `test/options/options.test.js`
- Modify: `manifest.json` (`options_page` の追加)

`scripts/package.mjs` は `INCLUDE = ['manifest.json', 'icons', 'src']` を再帰的に収集するため、
`src/options/` は自動で ZIP に入る。パッケージスクリプトの変更は不要。

**Interfaces:**
- Consumes: `loadAiSettings` / `saveAiSettings` (`src/content/settings.js`)
- Produces: `bindOptionsForm(root: ParentNode, deps?: {load?: Function, save?: Function}): Promise<void>` を `src/options/options.js` から名前付きエクスポート。DOM を渡せるようにして jsdom でテストする。

- [ ] **Step 1: 失敗するテストを書く**

`test/options/options.test.js` を新規作成する。

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { bindOptionsForm } from '../../src/options/options.js';

const HTML = `
  <form data-role="ai-form">
    <input type="checkbox" data-role="ai-enabled">
    <input type="text" data-role="license-key">
    <button type="submit">保存</button>
    <span data-role="status"></span>
  </form>
`;

let root;
beforeEach(() => {
  root = document.createElement('div');
  root.innerHTML = HTML;
  document.body.appendChild(root);
});

const q = (role) => root.querySelector(`[data-role="${role}"]`);

describe('bindOptionsForm', () => {
  it('保存済みの設定をフォームに反映する', async () => {
    const load = vi.fn(async () => ({ aiNaming: true, licenseKey: 'KEY-123' }));
    await bindOptionsForm(root, { load, save: vi.fn() });
    expect(q('ai-enabled').checked).toBe(true);
    expect(q('license-key').value).toBe('KEY-123');
  });

  it('送信すると入力値を保存する', async () => {
    const save = vi.fn(async () => {});
    await bindOptionsForm(root, { load: async () => ({ aiNaming: false, licenseKey: '' }), save });
    q('ai-enabled').checked = true;
    q('license-key').value = '  KEY-999  ';
    q('ai-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await Promise.resolve();
    // 前後の空白は落とす。コピー & ペーストで混入しやすい。
    expect(save).toHaveBeenCalledWith({ aiNaming: true, licenseKey: 'KEY-999' });
  });

  it('保存後に状態を表示する', async () => {
    await bindOptionsForm(root, {
      load: async () => ({ aiNaming: false, licenseKey: '' }),
      save: async () => {},
    });
    q('ai-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();
    expect(q('status').textContent).toBe('保存しました');
  });

  it('ページ遷移を起こさない', async () => {
    await bindOptionsForm(root, {
      load: async () => ({ aiNaming: false, licenseKey: '' }),
      save: async () => {},
    });
    const event = new Event('submit', { bubbles: true, cancelable: true });
    q('ai-form').dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npx vitest run test/options/options.test.js`
Expected: FAIL — `Failed to resolve import "../../src/options/options.js"`

- [ ] **Step 3: 実装する**

`src/options/options.js` を新規作成する。

```js
import { loadAiSettings, saveAiSettings } from '../content/settings.js';

/**
 * オプションページのフォームを設定に繋ぐ。
 * DOM と依存を引数で受けるのは jsdom でテストするため。
 * @param {ParentNode} root
 * @param {{load?: Function, save?: Function}} [deps]
 */
export async function bindOptionsForm(root, deps = {}) {
  const load = deps.load || loadAiSettings;
  const save = deps.save || saveAiSettings;

  const form = root.querySelector('[data-role="ai-form"]');
  const enabled = root.querySelector('[data-role="ai-enabled"]');
  const key = root.querySelector('[data-role="license-key"]');
  const status = root.querySelector('[data-role="status"]');
  if (!form || !enabled || !key) return;

  const settings = await load();
  enabled.checked = settings.aiNaming === true;
  key.value = settings.licenseKey || '';

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const patch = { aiNaming: enabled.checked, licenseKey: key.value.trim() };
    save(patch).then(
      () => {
        if (status) status.textContent = '保存しました';
      },
      () => {
        if (status) status.textContent = '保存できませんでした';
      }
    );
  });
}

// 拡張のオプションページとして開かれたときだけ自動で繋ぐ。
// テストからの import では document に対象が無いので何も起きない。
if (typeof document !== 'undefined' && document.querySelector('[data-role="ai-form"]')) {
  bindOptionsForm(document);
}
```

`src/options/options.html` を新規作成する。

```html
<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>スレッドビュー for Chatwork — 設定</title>
<style>
  body {
    font-family: "Meiryo", "Hiragino Sans", system-ui, sans-serif;
    font-size: 14px; line-height: 1.7; color: #0e1a1b;
    max-width: 640px; margin: 0 auto; padding: 32px 20px;
  }
  h1 { font-size: 18px; }
  .row { margin: 16px 0; }
  .note { color: #5c7173; font-size: 13px; }
  input[type="text"] { width: 100%; padding: 6px 8px; font: inherit; }
  button { font: inherit; padding: 6px 16px; }
  [data-role="status"] { margin-left: 12px; color: #0b6f69; }
</style>
</head>
<body>
  <h1>スレッドビュー for Chatwork — 設定</h1>

  <form data-role="ai-form">
    <div class="row">
      <label>
        <input type="checkbox" data-role="ai-enabled">
        AI でスレッド名を自動生成する（有料）
      </label>
      <p class="note">
        有効にすると、スレッドごとに「AI」ボタンを押したときにだけ、そのスレッドの本文が
        当社サーバーを経由して生成 AI へ送信されます。送信者名・アカウント ID・
        メッセージ ID は送信されません。無効の間、この拡張は外部と一切通信しません。
      </p>
    </div>

    <div class="row">
      <label for="license">ライセンスキー</label>
      <input id="license" type="text" data-role="license-key" placeholder="CTV-XXXX-XXXX-XXXX">
    </div>

    <div class="row">
      <button type="submit">保存</button>
      <span data-role="status" role="status" aria-live="polite"></span>
    </div>
  </form>

  <script type="module" src="./options.js"></script>
</body>
</html>
```

- [ ] **Step 4: テストを実行して通ることを確認する**

Run: `npx vitest run test/options/options.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: `manifest.json` に登録する**

`"options_page"` を `"action"` の直前に追加する。オプションページは拡張自身のページなので
`web_accessible_resources` への追加は**不要**。

```json
  "options_page": "src/options/options.html",
```

- [ ] **Step 6: 実機で確認する**

`npm run package` して Chrome に読み込み、拡張の詳細から「拡張機能のオプション」を開いて
チェックとキーが保存され、再度開いたときに復元されることを確認する。

- [ ] **Step 7: コミット**

```bash
git add src/options test/options manifest.json
git commit -m "feat: AI 命名を有効化するオプションページを追加"
```

---

### Task 8: service worker の通信ハンドラ

**この拡張で唯一 `fetch` を書くファイル。** content script からは `chrome.runtime.sendMessage` で依頼する。

**`host_permissions` を増やさない。** service worker からの cross-origin fetch は、サーバー側が
`Access-Control-Allow-Origin: chrome-extension://<拡張 ID>` を返す形で通す。host permission を
足すとインストール時に「サイトのデータの読み取り」警告が増え、審査も重くなる。
**Step 6 の実機検証で通らなかった場合のみ**、`host_permissions` に API ドメインを追加する
方針へ切り替える (spec §3.1 の要確認事項)。

**Files:**
- Modify: `src/core/messages.js` (メッセージ種別の追加)
- Modify: `src/background.js` (ハンドラの追加)
- Test: `test/background.test.js`

**Interfaces:**
- Consumes: なし (ペイロードは呼び出し側が `buildRequest` で組み立て済みのものを渡す)
- Produces:
  - `src/core/messages.js`: `REQUEST_NAMES = 'ctv:request-names'`
  - `src/background.js`: `requestNames(payload, deps?): Promise<{ok: true, names: Record<string,string>, remaining: number} | {ok: false, code: string}>` を名前付きエクスポート (テスト用に `deps = { fetch, apiUrl, timeoutMs }` を差し込めるようにする)

- [ ] **Step 1: 失敗するテストを書く**

`test/background.test.js` を新規作成する。

```js
import { describe, it, expect, vi } from 'vitest';
import { requestNames } from '../src/background.js';

const payload = { licenseKey: 'KEY', threads: [{ ref: '0', messages: [] }] };
const deps = (fetchImpl) => ({ fetch: fetchImpl, apiUrl: 'https://api.example/v1/name', timeoutMs: 20000 });

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

describe('requestNames', () => {
  it('成功したら名前と残数を返す', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { names: { 0: '請求書の件' }, remaining: 183 }));
    const result = await requestNames(payload, deps(fetchImpl));
    expect(result).toEqual({ ok: true, names: { 0: '請求書の件' }, remaining: 183 });
  });

  it('POST に JSON を送る', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { names: {}, remaining: 0 }));
    await requestNames(payload, deps(fetchImpl));
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.example/v1/name');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual(payload);
  });

  it('401 は invalid_license を返す', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(401, { code: 'invalid_license' }));
    expect(await requestNames(payload, deps(fetchImpl))).toEqual({ ok: false, code: 'invalid_license' });
  });

  it('402 は quota_exceeded を返す', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(402, { code: 'quota_exceeded' }));
    expect(await requestNames(payload, deps(fetchImpl))).toEqual({ ok: false, code: 'quota_exceeded' });
  });

  it('500 は server_error を返す', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(500, {}));
    expect(await requestNames(payload, deps(fetchImpl))).toEqual({ ok: false, code: 'server_error' });
  });

  it('通信自体が失敗したら network_error を返す', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('offline'); });
    expect(await requestNames(payload, deps(fetchImpl))).toEqual({ ok: false, code: 'network_error' });
  });
});
```

**注意:** `src/background.js` はトップレベルで `chrome.action.onClicked.addListener` を呼ぶため、そのまま import するとテストが落ちる。Step 3 で `chrome` が無い環境を弾くガードを入れる。

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npx vitest run test/background.test.js`
Expected: FAIL — `chrome is not defined` または `requestNames is not a function`

- [ ] **Step 3: 実装する**

`src/core/messages.js` に 1 行足す。

```js
// AI 命名の依頼。content script から service worker へ送る。
export const REQUEST_NAMES = 'ctv:request-names';
```

`src/background.js` を書き換える。既存の `chrome.action.onClicked` 登録はガードで包む。

```js
import { TOGGLE_PANEL, REQUEST_NAMES } from './core/messages.js';

// TODO(サーバー稼働時): 実ドメインに差し替える
const API_URL = 'https://api.example.com/v1/name';
const TIMEOUT_MS = 20000;

const STATUS_CODES = {
  401: 'invalid_license',
  402: 'quota_exceeded',
  429: 'rate_limited',
};

/**
 * AI 命名をサーバーへ依頼する。
 * この拡張で fetch を呼ぶのはここだけ。content script からは呼ばない。
 * @param {{licenseKey: string, threads: object[]}} payload
 * @param {{fetch?: Function, apiUrl?: string, timeoutMs?: number}} [deps] テスト用の差し込み口
 */
export async function requestNames(payload, deps = {}) {
  const doFetch = deps.fetch || globalThis.fetch;
  const apiUrl = deps.apiUrl || API_URL;
  const timeoutMs = deps.timeoutMs || TIMEOUT_MS;

  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    const response = await doFetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller ? controller.signal : undefined,
    });

    if (!response.ok) {
      const mapped = STATUS_CODES[response.status];
      if (mapped) return { ok: false, code: mapped };
      let body = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
      return { ok: false, code: (body && body.code) || 'server_error' };
    }

    const body = await response.json();
    return {
      ok: true,
      names: body.names || {},
      remaining: typeof body.remaining === 'number' ? body.remaining : 0,
    };
  } catch {
    // タイムアウトも回線断も利用者から見れば同じ「つながらない」。区別しない。
    return { ok: false, code: 'network_error' };
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

// テスト環境では chrome が存在しない。リスナ登録だけを条件付きにする。
if (typeof chrome !== 'undefined' && chrome.action) {
  // ツールバーのアイコンが押されたら、そのタブのパネルを開閉する。
  chrome.action.onClicked.addListener((tab) => {
    if (!tab || typeof tab.id !== 'number') return;
    // Chatwork 以外のタブには content script が居ないので届かない。
    // それは異常ではないので、握りつぶして何もしない。
    chrome.tabs.sendMessage(tab.id, { type: TOGGLE_PANEL }).catch(() => {});
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.type !== REQUEST_NAMES) return undefined;
    requestNames(message.payload).then(sendResponse);
    return true; // 非同期で応答する
  });
}
```

- [ ] **Step 4: テストを実行して通ることを確認する**

Run: `npx vitest run test/background.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: 全テストを実行する**

Run: `npm test`
Expected: PASS 全件

- [ ] **Step 6: CORS を実機で検証する**

サーバーが稼働している場合のみ実施する。稼働前ならこのステップを未チェックのまま残し、
稼働後に必ず戻ってくる。

Chrome に読み込み、service worker の DevTools コンソールで実行する。

```js
await requestNames({ licenseKey: 'テスト用キー', threads: [{ ref: '0', messages: [{ speaker: 'A', text: 'テスト' }] }] });
```

Expected: `{ ok: true, ... }` が返る。`network_error` が返り、コンソールに CORS のエラーが
出る場合は、サーバーの `Access-Control-Allow-Origin` に拡張 ID が入っていないか、
`host_permissions` が必要な状況。まずサーバー側の設定を直す。

- [ ] **Step 7: コミット**

```bash
git add src/background.js src/core/messages.js test/background.test.js
git commit -m "feat: AI 命名の通信を service worker に実装"
```

---

### Task 9: AI 命名の UI 配線

カードのボタンと、パネルヘッダの一括命名。

**Files:**
- Modify: `src/ui/render.js` (カードに `data-role="ai-name"` ボタン)
- Modify: `src/ui/panel.js` (ヘッダに一括命名ボタン、残数表示)
- Modify: `src/ui/styles.js`
- Modify: `src/content/main.js` (`chrome.runtime.sendMessage` で依頼、結果を `nameStore` へ)
- Test: `test/ui/render.test.js` / `test/ui/panel.test.js`

**Interfaces:**
- Consumes: `buildRequest` (`src/core/namePayload.js`)、`loadAiSettings` (`src/content/settings.js`)、`REQUEST_NAMES` (`src/core/messages.js`)、`NameStore.setName`
- Produces:
  - `renderThreads` の `options` に `onAiName?: (thread: Thread) => void` と `aiEnabled?: boolean` を追加
  - `panel.setRemaining(n: number|null): void`
  - `panel.setAiEnabled(enabled: boolean): void` — 無効なら一括命名ボタンごと隠す (spec §5.3)
  - `panel.setAiBusy(busy: boolean): void` — 実行中は一括命名ボタンを `disabled` にする
  - `panel.onBulkName(handler: () => void): void`

- [ ] **Step 1: 失敗するテストを書く**

`test/ui/render.test.js` の末尾に追記する。

```js
describe('AI 命名ボタン', () => {
  const withReply = () =>
    buildThreads([msg('1', { timestamp: 100 }), reply('2', '1', { timestamp: 200 })]);

  it('aiEnabled が false ならボタンを描画しない', () => {
    renderThreads(container, withReply(), { hideEmpty: true, onJump: () => {}, aiEnabled: false });
    expect(container.querySelector('[data-role="ai-name"]')).toBeNull();
  });

  it('aiEnabled が true ならボタンを描画する', () => {
    renderThreads(container, withReply(), {
      hideEmpty: true, onJump: () => {}, aiEnabled: true, onAiName: () => {},
    });
    expect(container.querySelector('[data-role="ai-name"]')).not.toBeNull();
  });

  it('押すと該当スレッドで onAiName が呼ばれ、カードは開閉しない', () => {
    const onAiName = vi.fn();
    const threads = withReply();
    renderThreads(container, threads, {
      hideEmpty: true, onJump: () => {}, aiEnabled: true, onAiName,
    });
    const card = container.querySelector('[data-role="thread"]');
    const before = card.open;
    container.querySelector('[data-role="ai-name"]').click();
    expect(onAiName).toHaveBeenCalledWith(threads[0]);
    expect(card.open).toBe(before);
  });
});
```

`test/ui/panel.test.js` の末尾に追記する。

```js
describe('AI 命名のヘッダ UI', () => {
  const bulkBtn = () => panel.shadow.querySelector('[data-role="bulk-name"]');

  it('数値を渡すと残数を表示し、null で消える', () => {
    panel.setRemaining(183);
    const el = panel.shadow.querySelector('[data-role="remaining"]');
    expect(el.textContent).toBe('残り 183');
    panel.setRemaining(null);
    expect(el.textContent).toBe('');
  });

  // spec §5.3: 無効な間は関連 UI を一切出さない。
  it('既定では一括命名ボタンを隠す', () => {
    expect(bulkBtn().hidden).toBe(true);
  });

  it('setAiEnabled(true) で一括命名ボタンが出る', () => {
    panel.setAiEnabled(true);
    expect(bulkBtn().hidden).toBe(false);
    panel.setAiEnabled(false);
    expect(bulkBtn().hidden).toBe(true);
  });

  it('押すと onBulkName のハンドラが呼ばれる', () => {
    const handler = vi.fn();
    panel.setAiEnabled(true);
    panel.onBulkName(handler);
    bulkBtn().click();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('setAiBusy(true) の間はボタンを押せない', () => {
    panel.setAiEnabled(true);
    panel.setAiBusy(true);
    expect(bulkBtn().disabled).toBe(true);
    panel.setAiBusy(false);
    expect(bulkBtn().disabled).toBe(false);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npx vitest run test/ui/render.test.js -t "AI 命名ボタン" && npx vitest run test/ui/panel.test.js -t "残り生成回数の表示"`
Expected: FAIL — ボタンが `null` / `panel.setRemaining is not a function`

- [ ] **Step 3: `render.js` にボタンを足す**

`buildCard` のシグネチャを `buildCard(thread, onJump, openIds, onToggle, names, onRename, aiEnabled, onAiName)` に変え、`renameBtn` の追加直後に置く。

```js
  if (aiEnabled) {
    const aiBtn = el('button', 'thread__ai', 'AI');
    aiBtn.type = 'button';
    aiBtn.dataset.role = 'ai-name';
    aiBtn.setAttribute('aria-label', 'AI でスレッド名をつける');
    aiBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      onAiName(thread);
    });
    head.appendChild(aiBtn);
  }
```

`renderThreads` の分割代入と呼び出しに `aiEnabled = false` / `onAiName = () => {}` を通す。

- [ ] **Step 4: `panel.js` にヘッダ UI を足す**

`panel.innerHTML` のヘッダを書き換える。`panel__count` の直後に残数を、`panel__spacer` の
直後に一括命名ボタンを置く。`hidden` を初期値にするのは、AI 命名が無効な間は
UI を出さないため (spec §5.3)。

```html
    <header class="panel__head">
      <span class="panel__title">スレッド</span>
      <span class="panel__count" data-role="count"></span>
      <span class="panel__remaining" data-role="remaining"></span>
      <span class="panel__spacer"></span>
      <button class="panel__btn" data-role="bulk-name" type="button" hidden>まとめて命名</button>
      <button class="panel__btn" data-role="toggle-empty" type="button">全件表示</button>
      <button class="panel__btn" data-role="close" type="button">閉じる</button>
    </header>
```

参照とハンドラの保持を、既存の `toggleEmptyBtn` の宣言の隣に足す。

```js
  const remaining = shadow.querySelector('[data-role="remaining"]');
  const bulkBtn = shadow.querySelector('[data-role="bulk-name"]');
```

```js
  let bulkNameHandler = () => {};
  bulkBtn.addEventListener('click', () => bulkNameHandler());
```

返り値のオブジェクトに 4 つ足す。

```js
    setRemaining(n) {
      remaining.textContent = typeof n === 'number' ? `残り ${n}` : '';
    },
    setAiEnabled(enabled) {
      bulkBtn.hidden = !enabled;
      if (!enabled) remaining.textContent = '';
    },
    setAiBusy(busy) {
      bulkBtn.disabled = Boolean(busy);
      bulkBtn.textContent = busy ? '命名中…' : 'まとめて命名';
    },
    onBulkName(handler) {
      bulkNameHandler = handler;
    },
```

- [ ] **Step 5: `styles.js` にスタイルを足す**

`.thread__rename` の定義の直後に追記する。

```css
.thread__ai {
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-faint);
  font: inherit;
  font-size: 10px;
  font-weight: 600;
  line-height: 1;
  padding: 2px 5px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  opacity: 0;
  transition: opacity var(--ease), color var(--ease), border-color var(--ease);
}
.thread__summary:hover .thread__ai,
.thread__ai:focus-visible { opacity: 1; }
.thread__ai:hover { color: var(--accent-text); border-color: var(--accent); }
.thread__ai[disabled] { opacity: 0.5; cursor: progress; }
.panel__remaining {
  color: var(--text-faint);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.panel__remaining:empty { display: none; }
.panel__btn[hidden] { display: none; }
.panel__btn[disabled] { opacity: 0.6; cursor: progress; }
```

- [ ] **Step 6: `main.js` を配線する**

import を足す。

```js
import { buildRequest } from '../core/namePayload.js';
import { loadAiSettings } from './settings.js';
import { TOGGLE_PANEL, REQUEST_NAMES } from '../core/messages.js';
```

`state` に足す。

```js
  ai: { aiNaming: false, licenseKey: '' },
  // 命名の実行中フラグ。二重送信を防ぐ。
  aiBusy: false,
  // 直近の refresh が組み立てたスレッド。一括命名の対象選びに使う。
  threads: [],
```

`refresh` の `buildThreads` の直後 (Task 4 で足した rekey ループの前) に 1 行足す。

```js
  state.threads = threads;
```

`boot` で読み込む。`createPanel()` より後、`state.stopObserver` の設定より前に置く。

```js
  loadAiSettings().then((ai) => {
    state.ai = ai;
    state.panel.setAiEnabled(ai.aiNaming);
    refresh();
  });

  state.panel.onBulkName(() => {
    // 対象は「返信があり、まだ名前が無い」スレッドだけ。20 件の上限は buildRequest が切る。
    // 解析をやり直さず、直近の refresh が積んだ結果を使う。
    const targets = state.threads.filter(
      (thread) => thread.replyCount > 0 && !resolveName(thread, state.names)
    );
    nameWithAi(targets);
  });

`refresh` の `renderThreads` オプションに足す。

```js
    aiEnabled: state.ai.aiNaming,
    onAiName: (thread) => nameWithAi([thread]),
```

`refresh` の外にハンドラを置く。

```js
const ERROR_TEXT = {
  invalid_license: 'ライセンスキーが正しくありません',
  quota_exceeded: '今月の生成回数を使い切りました',
  rate_limited: '混み合っています。少し待って再実行してください',
  server_error: '生成に失敗しました。時間をおいて再実行してください',
  network_error: 'サーバーに接続できませんでした',
};

/**
 * AI 命名を service worker へ依頼する。
 * 失敗してもヒューリスティックへフォールバックしない (spec §2.1)。
 * @param {import('../core/types.js').Thread[]} threads
 */
async function nameWithAi(threads) {
  if (!state.ai.aiNaming || state.aiBusy) return;
  if (threads.length === 0) {
    state.panel.showNotice('名前の無いスレッドはありません');
    return;
  }

  state.aiBusy = true;
  state.panel.setAiBusy(true);
  const payload = buildRequest(threads, state.ai.licenseKey);

  try {
    let result;
    try {
      result = await chrome.runtime.sendMessage({ type: REQUEST_NAMES, payload });
    } catch {
      result = { ok: false, code: 'network_error' };
    }

    if (!result || !result.ok) {
      state.panel.showNotice(ERROR_TEXT[result && result.code] || ERROR_TEXT.server_error);
      return;
    }

    // ref はリクエスト内の連番。payload.threads の並びと 1 対 1 で対応する。
    payload.threads.forEach((entry, index) => {
      const name = result.names[entry.ref];
      if (name) state.names = state.store.setName(threads[index].rootId, name, 'ai');
    });
    state.panel.setRemaining(result.remaining);
  } finally {
    state.aiBusy = false;
    state.panel.setAiBusy(false);
    refresh();
  }
}
```

`teardown` の後始末に足す。

```js
  state.ai = { aiNaming: false, licenseKey: '' };
  state.aiBusy = false;
  state.threads = [];
```

- [ ] **Step 7: 全テストを実行する**

Run: `npm test`
Expected: PASS 全件

- [ ] **Step 8: コミット**

```bash
git add src/ui/render.js src/ui/panel.js src/ui/styles.js src/content/main.js test/ui/
git commit -m "feat: AI 命名を UI から実行できるようにした"
```

---

### Task 10: ストア書類の更新 (リリース前必須)

**コードより先に、あるいは同時にやる。** 現在の掲載文とプライバシーポリシーは「外部と一切通信しない」を明示しており、Task 5〜9 を出荷した時点でこれが虚偽になる。

**Files:**
- Modify: `docs/store/privacy-policy.md`
- Modify: `docs/store/listing.md:68-72`, `:130`, `:153-172`
- Modify: `manifest.json` (`version` を `0.3.0` へ)

- [ ] **Step 1: プライバシーポリシーを改訂する**

「結論」節を書き換える。既定では通信しないことを維持したまま、例外を明記する。

```markdown
## 結論

**本拡張は、既定の状態では、いかなる情報も外部へ送信しません。**

例外は「AI スレッド命名」機能だけです。この機能は既定で無効です。
利用者が設定で有効にし、かつスレッドごとに実行を指示したときにのみ、
**そのスレッドの本文** を当社のサーバーを経由して Google の Gemini API へ送信します。

送信するもの: メッセージ本文 (起点 1 件と返信 10 件まで、それぞれ字数上限あり)
送信しないもの: 送信者名、アカウント ID、メッセージ ID、ルーム ID、添付ファイルの実体、
Chatwork の認証情報

送信時、発言者は A / B / C … に匿名化され、誰の発言かはサーバーへ渡りません。
当社サーバーは受け取った本文を保存せず、ログにも記録しません。
```

「3. ブラウザに保存する情報」に、スレッド名とライセンスキーを追記する。

- [ ] **Step 2: 掲載文を書き換える**

`docs/store/listing.md:68-72` の「外部のサーバーと一切通信しません」を、上と同じ趣旨の
「既定では通信しない / AI 命名を有効にしたときだけ本文を送る」に差し替える。
`:153-172` のデータ申告表で、「個人的な通信内容」「ウェブサイトのコンテンツ」を
**送信する (AI 命名が有効な場合のみ)** に変更する。

- [ ] **Step 3: 申告内容と実装の一致を確認する**

以下をコードで確認し、掲載文の記述と食い違わないことを検証する。

```bash
grep -rn "fetch\|XMLHttpRequest" src/content src/ui   # 0 件であること
grep -rn "fetch" src/background.js                    # requestNames の中だけであること
```

Expected: content script 側は 0 件。`fetch` は `src/background.js` の `requestNames` 内のみ。

- [ ] **Step 4: コミット**

```bash
git add docs/store/privacy-policy.md docs/store/listing.md manifest.json
git commit -m "docs: AI 命名の追加にあわせてストア掲載文とプライバシーポリシーを改訂"
```

---

## この計画に含まれないもの

- **サーバーの実装** (別リポジトリ・別計画)。Stripe 連携、ライセンスキー発行、Gemini 呼び出し、レート制限、CORS 設定。
- **ピン留め。** Task 2 の `nameStore` と同じ構造 (`pins:{roomId}`) で作れるが、別計画にする。
- **フォント・可読性の改善、全文展開、アバター画像** — 先行する別ブランチの作業。
- 名前による検索・絞り込み、名前のチーム共有、`chrome.storage.sync` への移行。
