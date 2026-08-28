# スレッドビュー for Chatwork 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chatwork のタイムラインから返信関係を解析し、スレッドツリーとして右側の常駐パネルに表示する Chrome 拡張 (MV3) の MVP を作る。

**Architecture:** content script のみで完結する。DOM から抽出したメッセージを純関数でツリー化し、Shadow DOM のパネルに描画する。バックエンド・ネットワーク通信・認証情報は一切扱わない。Chatwork DOM への依存は `selectors.js` 1 ファイルに閉じる。

**Tech Stack:** Vanilla JS (ESM, ビルドなし) / Chrome Manifest V3 / Shadow DOM / Vitest + jsdom

**Spec:** `docs/superpowers/specs/2026-08-29-threadswork-design.md`

## Global Constraints

- 製品名は **スレッドビュー for Chatwork**。内部識別子は `chatwork-thread-view`。DOM に注入する id / クラス / CSS 変数は必ず `ctv-` 接頭辞。
- メッセージ ID (`data-mid`) とルーム ID (`data-rid`) は **19 桁前後の数値文字列。絶対に `Number()` 化しない。** 比較・Map のキーは常に文字列。
- ビルドツールを導入しない。`devDependencies` は `vitest` と `jsdom` のみ。
- ネットワーク通信を行うコードを書かない。`fetch` / `XMLHttpRequest` / `window.ACCESS_TOKEN` / `/gateway/*` を使わない。
- `permissions` は `["storage"]` のみ。`tabs` / `scripting` を追加しない。service worker を作らない。
- styled-components の生成クラス (`sc-*`, `cqwzsM`, `iOFFuf` 等) に依存しない。依存してよいのは `_` 接頭辞クラス、`data-*`、`data-testid` のみ。
- `jsdom` は `innerText` を実装しない。テキスト取得は必ず `textContent` ベースのヘルパ経由。
- 単一メッセージのパース失敗は例外を投げず `null` を返す。1 件の異常で全体の描画を止めない。
- spec §3.4 の React fiber フォールバックは **実装しない**。

## Git について

このプロジェクトはまだ git 管理下にない (`F:\threadswork` は git リポジトリではない)。
各タスク末尾のコミット手順は、**Task 1 の Step 1 で `git init` を実行した場合のみ**有効。
git を使わない方針であれば、全タスクのコミット手順を飛ばしてよい。それ以外の手順に影響はない。

---

### Task 1: プロジェクト基盤と threadTree.js

スレッド構築の純ロジックを TDD で作る。DOM に一切触れないため、このタスクだけで完結して検証できる。

**Files:**
- Create: `package.json`
- Create: `vitest.config.js`
- Create: `.gitignore`
- Create: `src/core/types.js`
- Create: `src/core/threadTree.js`
- Test: `test/core/threadTree.test.js`

**Interfaces:**
- Consumes: なし (最初のタスク)
- Produces:
  - `buildThreads(messages: ChatworkMessage[]): Thread[]` — `src/core/threadTree.js` からの名前付きエクスポート
  - 型 `ChatworkMessage` / `ThreadNode` / `Thread` の JSDoc 定義 (`src/core/types.js`)。フィールドは spec §4 と完全一致

- [ ] **Step 1: リポジトリ初期化と依存導入**

git を使う場合のみ `git init` を実行する。

```bash
cd F:/threadswork
git init
npm init -y
npm install --save-dev vitest@^2.1.8 jsdom@^25.0.1
```

- [ ] **Step 2: package.json / vitest.config.js / .gitignore を書く**

`package.json` を次の内容で**上書き**する (`npm init -y` の生成物を置き換える)。

```json
{
  "name": "chatwork-thread-view",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Chatwork の返信をスレッド形式で構造化表示する Chrome 拡張",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "vitest": "^2.1.8",
    "jsdom": "^25.0.1"
  }
}
```

`vitest.config.js`:

```js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.js'],
  },
});
```

`.gitignore`:

```
node_modules/
*.log
.DS_Store
```

- [ ] **Step 3: 型定義を書く**

`src/core/types.js` — 実行時コードを持たない JSDoc 専用ファイル。

```js
/**
 * @typedef {Object} ChatworkMessage
 * @property {string} id            メッセージ ID (data-mid)。文字列のまま扱う
 * @property {string} roomId        ルーム ID (data-rid)
 * @property {string} accountId     送信者アカウント ID
 * @property {string} userName      送信者表示名
 * @property {string} avatarUrl     アバター画像 URL
 * @property {string} body          本文 (返信チップのテキストを除去済み)
 * @property {string|null} replyToId      親メッセージ ID
 * @property {string|null} replyToRoomId  親メッセージのルーム ID
 * @property {number} timestamp     投稿時刻 (UNIX 秒)
 * @property {number} index         タイムライン上の並び順
 */

/**
 * @typedef {Object} ThreadNode
 * @property {ChatworkMessage} message
 * @property {ThreadNode[]} children
 * @property {number} depth
 */

/**
 * @typedef {Object} Thread
 * @property {string} rootId
 * @property {ChatworkMessage} rootMessage
 * @property {ThreadNode} tree
 * @property {number} replyCount
 * @property {number} updatedAt
 * @property {boolean} rootIsSynthetic
 */

export {};
```

- [ ] **Step 4: 失敗するテストを書く**

`test/core/threadTree.test.js`:

```js
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
```

- [ ] **Step 5: テストが失敗することを確認する**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "../../src/core/threadTree.js"`

- [ ] **Step 6: threadTree.js を実装する**

`src/core/threadTree.js`:

```js
/**
 * 返信関係からスレッドツリーを構築する純関数。DOM に触れない。
 * @param {import('./types.js').ChatworkMessage[]} messages
 * @returns {import('./types.js').Thread[]}
 */
export function buildThreads(messages) {
  const byId = new Map();
  for (const m of messages) byId.set(m.id, m);

  /**
   * 起点メッセージの ID を求める。
   * 循環を検出した場合は、循環に含まれる ID のうち辞書順最小を root とする。
   * こうすると循環内のどのメッセージから辿っても同じ root に収束し、
   * root 自身が必ずそのグループの一員になる。
   */
  function findRoot(startId) {
    const seen = new Set();
    const path = [];
    let cur = byId.get(startId);
    if (!cur) return startId;
    for (;;) {
      if (seen.has(cur.id)) {
        const cycle = path.slice(path.indexOf(cur.id));
        return cycle.reduce((a, b) => (a < b ? a : b));
      }
      seen.add(cur.id);
      path.push(cur.id);
      if (!cur.replyToId) return cur.id;
      if (cur.replyToRoomId !== cur.roomId) return cur.id;
      const parent = byId.get(cur.replyToId);
      if (!parent) return cur.id;
      cur = parent;
    }
  }

  const groups = new Map();
  for (const m of messages) {
    const rootId = findRoot(m.id);
    let group = groups.get(rootId);
    if (!group) {
      group = [];
      groups.set(rootId, group);
    }
    group.push(m);
  }

  const threads = [];
  for (const [rootId, members] of groups) {
    const nodes = new Map();
    for (const m of members) {
      nodes.set(m.id, { message: m, children: [], depth: 0 });
    }
    const rootNode = nodes.get(rootId);

    for (const m of members) {
      if (m.id === rootId) continue;
      const parent = (m.replyToId && nodes.get(m.replyToId)) || rootNode;
      parent.children.push(nodes.get(m.id));
    }

    reparentUnreachable(rootNode, nodes);
    assignDepthAndSort(rootNode, 0);

    let updatedAt = 0;
    for (const m of members) {
      if (m.timestamp > updatedAt) updatedAt = m.timestamp;
    }

    threads.push({
      rootId,
      rootMessage: rootNode.message,
      tree: rootNode,
      replyCount: members.length - 1,
      updatedAt,
      rootIsSynthetic: Boolean(rootNode.message.replyToId),
    });
  }

  threads.sort(
    (a, b) => b.updatedAt - a.updatedAt || (a.rootId < b.rootId ? -1 : 1)
  );
  return threads;
}

function collectReachable(rootNode) {
  const reached = new Set([rootNode.message.id]);
  const stack = [rootNode];
  while (stack.length > 0) {
    const node = stack.pop();
    for (const child of node.children) {
      if (reached.has(child.message.id)) continue;
      reached.add(child.message.id);
      stack.push(child);
    }
  }
  return reached;
}

/**
 * root から到達できないノードを root 直下に付け替える。
 * 「出力ノード総数 == 入力メッセージ数」の不変条件を保証する安全弁。
 */
function reparentUnreachable(rootNode, nodes) {
  let reached = collectReachable(rootNode);
  if (reached.size === nodes.size) return;
  for (const [id, node] of nodes) {
    if (reached.has(id)) continue;
    const parentId = node.message.replyToId;
    const parent = parentId ? nodes.get(parentId) : null;
    if (parent) {
      parent.children = parent.children.filter((c) => c !== node);
    }
    rootNode.children.push(node);
    reached = collectReachable(rootNode);
    if (reached.size === nodes.size) return;
  }
}

function assignDepthAndSort(node, depth) {
  node.depth = depth;
  node.children.sort(
    (a, b) =>
      a.message.timestamp - b.message.timestamp ||
      a.message.index - b.message.index
  );
  for (const child of node.children) {
    assignDepthAndSort(child, depth + 1);
  }
}
```

- [ ] **Step 7: テストが通ることを確認する**

Run: `npm test`
Expected: PASS — 11 tests passed

- [ ] **Step 8: コミット** (git を使う場合のみ)

```bash
git add package.json package-lock.json vitest.config.js .gitignore src/core test/core
git commit -m "feat: スレッドツリー構築の純ロジックを追加"
```

---

### Task 2: selectors.js と scraper.js

Chatwork DOM からメッセージを抽出する。実機から採取したフィクスチャに対して TDD で作る。

**Files:**
- Create: `test/fixtures/timeline.html`
- Create: `src/content/selectors.js`
- Create: `src/content/scraper.js`
- Test: `test/content/scraper.test.js`

**Interfaces:**
- Consumes: `src/core/types.js` の型定義 (Task 1)
- Produces:
  - `SEL` — セレクタ定数オブジェクト (`src/content/selectors.js`)
  - `getTimeline(doc?)` / `getMessageElements(doc?)` / `getMessageElementById(mid, doc?)` / `findScrollContainer(el)` / `getCurrentRoomId()`
  - `createScrapeContext(): ScrapeContext` / `parseMessage(el, ctx, fallbackIndex?): ChatworkMessage|null` / `parseTimeline(elements, ctx?): ChatworkMessage[]` (`src/content/scraper.js`)

- [ ] **Step 1: フィクスチャ HTML を書く**

`test/fixtures/timeline.html` — 実機の構造を再現した最小 DOM。styled-components のハッシュクラスも実機同様に混ぜ、それらに依存していないことを保証する。

```html
<div id="_timeLine">
  <div id="_messageId2141030437437706240" class="sc-hWmCAe cqwzsM _message default"
       data-rid="211028552" data-mid="2141030437437706240" data-index="0"
       data-deleted="0" data-bookmarked="0">
    <div class="sc-jDfjYv cHNVzO">
      <div class="sc-fSjEuY bbVOhw _speaker">
        <button class="sc-x gfgOUK _profileUserIcon" data-aid="2227949"></button>
        <img class="sc-y rGzLa userIconImage _avatarAid2227949"
             src="https://appdata.chatwork.com/avatar/aaa.rsz" alt="羽瀬 由理">
        <p class="sc-z dqBdeC" data-testid="timeline_user-name">羽瀬 由理</p>
      </div>
      <div class="sc-l izQjKC _timeStamp" data-tm="1786935026">2026年8月20日 10:30</div>
      <pre class="sc-xyOoZ fhgsfc"><span>親メッセージの本文です。</span></pre>
    </div>
  </div>

  <div id="_messageId2141035123569991680" class="sc-hWmCAe cqwzsM _message default"
       data-rid="211028552" data-mid="2141035123569991680" data-index="1"
       data-deleted="0" data-bookmarked="0">
    <div class="sc-jDfjYv cHNVzO">
      <div class="sc-fSjEuY bbVOhw _speaker">
        <button class="sc-x gfgOUK _profileUserIcon" data-aid="3261434"></button>
        <img class="sc-y rGzLa userIconImage _avatarAid3261434"
             src="https://appdata.chatwork.com/avatar/bbb.rsz" alt="佐藤 太郎">
        <p class="sc-z dqBdeC" data-testid="timeline_user-name">佐藤 太郎</p>
      </div>
      <div class="sc-l izQjKC _timeStamp" data-tm="1786935034">2026年8月20日 10:31</div>
      <pre class="sc-xyOoZ fhgsfc"><div class="sc-a hxSJcZ _replyMessage chatTimeLineReply"
             aria-label="返信元を見る" data-rid="211028552"
             data-mid="2141030437437706240"><div class="sc-b ctLkmg"><p class="sc-c idvIFd">返信元</p></div></div><span>これは返信の本文です。</span></pre>
    </div>
  </div>

  <div id="_messageId2141041104525852672" class="sc-hWmCAe cqwzsM _message default"
       data-rid="211028552" data-mid="2141041104525852672" data-index="2"
       data-deleted="0" data-bookmarked="0">
    <div class="sc-jDfjYv cHNVzO">
      <div class="sc-l izQjKC _timeStamp" data-tm="1786935099">2026年8月20日 10:32</div>
      <pre class="sc-xyOoZ fhgsfc"><span>連続投稿。アイコンも名前も無い。</span></pre>
    </div>
  </div>

  <div id="_messageId2141074034216284160" class="sc-hWmCAe cqwzsM _message default"
       data-rid="211028552" data-mid="2141074034216284160" data-index="3"
       data-deleted="1" data-bookmarked="0">
    <div class="sc-jDfjYv cHNVzO">
      <pre class="sc-xyOoZ fhgsfc"><span>削除済みメッセージ</span></pre>
    </div>
  </div>

  <div id="_messageId2141077809647722496" class="sc-hWmCAe cqwzsM _message default"
       data-rid="211028552" data-mid="2141077809647722496" data-index="4"
       data-deleted="0" data-bookmarked="0">
    <div class="sc-jDfjYv cHNVzO">
      <div class="sc-fSjEuY bbVOhw _speaker">
        <button class="sc-x gfgOUK _profileUserIcon" data-aid="2227949"></button>
        <img class="sc-y rGzLa userIconImage _avatarAid2227949"
             src="https://appdata.chatwork.com/avatar/aaa.rsz" alt="羽瀬 由理">
        <p class="sc-z dqBdeC" data-testid="timeline_user-name">羽瀬 由理</p>
      </div>
      <div class="sc-l izQjKC _timeStamp" data-tm="1786935200">2026年8月20日 10:33</div>
      <pre class="sc-xyOoZ fhgsfc"><div class="sc-a hxSJcZ _replyMessage chatTimeLineReply"
             aria-label="返信元を見る" data-rid="999999999"
             data-mid="2100000000000000000"><div class="sc-b ctLkmg"><p class="sc-c idvIFd">返信元</p></div></div><span>別ルームへの返信です。</span></pre>
    </div>
  </div>
</div>
```

> 4 件目は `data-deleted="1"`、5 件目は `data-rid` が自ルーム (`211028552`) と異なる別ルーム返信。3 件目はアイコン・名前・アバターがすべて欠落した連続投稿。

- [ ] **Step 2: 失敗するテストを書く**

`test/content/scraper.test.js`:

```js
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getMessageElements, getMessageElementById } from '../../src/content/selectors.js';
import { createScrapeContext, parseMessage, parseTimeline } from '../../src/content/scraper.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = readFileSync(resolve(here, '../fixtures/timeline.html'), 'utf8');

const PARENT_ID = '2141030437437706240';
const REPLY_ID = '2141035123569991680';
const CONSECUTIVE_ID = '2141041104525852672';
const DELETED_ID = '2141074034216284160';
const CROSS_ROOM_ID = '2141077809647722496';

beforeEach(() => {
  document.body.innerHTML = FIXTURE;
});

describe('selectors', () => {
  it('タイムライン内のメッセージ要素を DOM 順に返す', () => {
    const els = getMessageElements(document);
    expect(els.map((e) => e.getAttribute('data-mid'))).toEqual([
      PARENT_ID, REPLY_ID, CONSECUTIVE_ID, DELETED_ID, CROSS_ROOM_ID,
    ]);
  });

  it('メッセージ ID から要素を引ける', () => {
    expect(getMessageElementById(PARENT_ID, document)?.getAttribute('data-mid')).toBe(PARENT_ID);
  });

  it('数値以外の ID では null を返す', () => {
    expect(getMessageElementById('"]><script>', document)).toBeNull();
  });
});

describe('parseTimeline', () => {
  it('削除済みメッセージを除外する', () => {
    const ids = parseTimeline(getMessageElements(document)).map((m) => m.id);
    expect(ids).not.toContain(DELETED_ID);
    expect(ids).toHaveLength(4);
  });

  it('通常メッセージから全フィールドを取得する', () => {
    const m = parseTimeline(getMessageElements(document))[0];
    expect(m).toMatchObject({
      id: PARENT_ID,
      roomId: '211028552',
      accountId: '2227949',
      userName: '羽瀬 由理',
      avatarUrl: 'https://appdata.chatwork.com/avatar/aaa.rsz',
      body: '親メッセージの本文です。',
      replyToId: null,
      replyToRoomId: null,
      timestamp: 1786935026,
      index: 0,
    });
  });

  it('返信メッセージから親 ID と親ルーム ID を取得する', () => {
    const m = parseTimeline(getMessageElements(document))[1];
    expect(m.id).toBe(REPLY_ID);
    expect(m.replyToId).toBe(PARENT_ID);
    expect(m.replyToRoomId).toBe('211028552');
  });

  it('本文に返信チップの文言が混入しない', () => {
    const m = parseTimeline(getMessageElements(document))[1];
    expect(m.body).toBe('これは返信の本文です。');
    expect(m.body).not.toContain('返信元');
  });

  it('連続投稿では直前のメッセージから送信者を継承する', () => {
    const m = parseTimeline(getMessageElements(document))[2];
    expect(m.id).toBe(CONSECUTIVE_ID);
    expect(m.accountId).toBe('3261434');
    expect(m.userName).toBe('佐藤 太郎');
    expect(m.avatarUrl).toBe('https://appdata.chatwork.com/avatar/bbb.rsz');
  });

  it('別ルーム返信では replyToRoomId が自ルームと異なる', () => {
    const m = parseTimeline(getMessageElements(document))[3];
    expect(m.id).toBe(CROSS_ROOM_ID);
    expect(m.roomId).toBe('211028552');
    expect(m.replyToRoomId).toBe('999999999');
  });

  it('19 桁 ID を文字列のまま保持し精度を落とさない', () => {
    const m = parseTimeline(getMessageElements(document))[0];
    expect(typeof m.id).toBe('string');
    expect(m.id).toBe(PARENT_ID);
    expect(String(Number(m.id))).not.toBe(m.id);
  });
});

describe('parseMessage', () => {
  it('data-mid が無い要素では null を返す', () => {
    const el = document.createElement('div');
    expect(parseMessage(el, createScrapeContext(), 0)).toBeNull();
  });

  it('例外を投げず null を返す (壊れた要素)', () => {
    const broken = { getAttribute: () => { throw new Error('boom'); } };
    expect(parseMessage(broken, createScrapeContext(), 0)).toBeNull();
  });
});
```

- [ ] **Step 3: テストが失敗することを確認する**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "../../src/content/selectors.js"`

- [ ] **Step 4: selectors.js を実装する**

`src/content/selectors.js` — **Chatwork DOM への依存はこのファイルにのみ存在する。** 構造が変わったらここだけ直す。

```js
/**
 * Chatwork の DOM に対する依存を集約したモジュール。
 * 依存してよいのは `_` 接頭辞クラス / data-* / data-testid のみ。
 * styled-components の生成クラス (sc-*, cqwzsM 等) には決して依存しない。
 * 2026-08-29 に Chatwork Web (_v=1.80a) の実機で確認した。
 */
export const SEL = {
  timeline: '#_timeLine',
  message: '._message[data-mid]',
  replyChip: '._replyMessage',
  profileIcon: 'button._profileUserIcon[data-aid]',
  avatarAidClass: '[class*="_avatarAid"]',
  userName: '[data-testid="timeline_user-name"]',
  avatar: 'img.userIconImage',
  timeStamp: '._timeStamp',
  body: 'pre',
  appRoot: '#root.root',
  chatInput: '#_chatText',
  sendButton: '[data-testid="timeline_send-message-button"]',
};

export function getTimeline(doc = document) {
  return doc.querySelector(SEL.timeline);
}

export function getMessageElements(doc = document) {
  const timeline = getTimeline(doc);
  return timeline ? Array.from(timeline.querySelectorAll(SEL.message)) : [];
}

export function getMessageElementById(mid, doc = document) {
  const id = String(mid);
  // data-mid は数値文字列。属性セレクタに埋め込む前に必ず検証する。
  if (!/^\d+$/.test(id)) return null;
  return (
    doc.getElementById(`_messageId${id}`) ||
    doc.querySelector(`${SEL.message}[data-mid="${id}"]`)
  );
}

/**
 * スクロールコンテナのクラス名は不安定なため、セレクタではなく
 * 「祖先を辿って最初のスクロール可能要素」で解決する。
 */
export function findScrollContainer(el) {
  let node = el && el.parentElement;
  while (node && node !== document.body) {
    const style = window.getComputedStyle(node);
    if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

export function getCurrentRoomId() {
  const matched = window.location.hash.match(/#!rid(\d+)/);
  return matched ? matched[1] : null;
}
```

- [ ] **Step 5: scraper.js を実装する**

`src/content/scraper.js`:

```js
import { SEL } from './selectors.js';

const AVATAR_AID = /(?:^|\s)_avatarAid(\d+)(?:\s|$)/;

/**
 * jsdom は innerText を実装しないため textContent を使う。
 * ノーブレークスペースは通常の空白に寄せてから trim する。
 */
function textOf(el) {
  if (!el) return '';
  return (el.textContent || '').replace(/\u00a0/g, ' ').trim();
}

/**
 * 連続投稿では送信者情報が DOM から省略される。直前の解析結果を持ち回るための状態。
 * @returns {{nameByAid: Map<string,string>, lastAccountId: string, lastUserName: string, lastAvatarUrl: string}}
 */
export function createScrapeContext() {
  return {
    nameByAid: new Map(),
    lastAccountId: '',
    lastUserName: '',
    lastAvatarUrl: '',
  };
}

/**
 * メッセージ要素 1 件を ChatworkMessage に変換する。
 * 失敗しても例外を投げず null を返す (1 件の異常で全体を止めない)。
 * @returns {import('../core/types.js').ChatworkMessage|null}
 */
export function parseMessage(el, ctx, fallbackIndex = 0) {
  try {
    const id = el.getAttribute('data-mid');
    if (!id) return null;
    if (el.getAttribute('data-deleted') === '1') return null;

    const roomId = el.getAttribute('data-rid') || '';
    const prevAccountId = ctx.lastAccountId;

    // 先頭の [data-aid] は返信チップ内の「返信先ユーザー」を指すことがあるため使わない。
    let accountId = el.querySelector(SEL.profileIcon)?.getAttribute('data-aid') || '';
    if (!accountId) {
      const avatarNode = el.querySelector(SEL.avatarAidClass);
      const matched = avatarNode && AVATAR_AID.exec(avatarNode.getAttribute('class') || '');
      if (matched) accountId = matched[1];
    }
    if (!accountId) accountId = prevAccountId;

    const sameSenderAsPrev = Boolean(accountId) && accountId === prevAccountId;

    const avatarEl = el.querySelector(SEL.avatar);
    let userName =
      textOf(el.querySelector(SEL.userName)) ||
      (avatarEl?.getAttribute('alt') || '').trim();
    if (userName) {
      if (accountId) ctx.nameByAid.set(accountId, userName);
    } else {
      userName =
        (accountId && ctx.nameByAid.get(accountId)) ||
        (sameSenderAsPrev ? ctx.lastUserName : '') ||
        '不明';
    }

    const avatarUrl =
      avatarEl?.getAttribute('src') ||
      (sameSenderAsPrev ? ctx.lastAvatarUrl : '') ||
      '';

    const tmAttr = el.querySelector(SEL.timeStamp)?.getAttribute('data-tm');
    const timestamp = tmAttr ? Number(tmAttr) : 0;

    // 親メッセージ ID は返信チップの data-mid にある。本文には [rp] が残らない。
    const chip = el.querySelector(SEL.replyChip);
    const replyToId = chip?.getAttribute('data-mid') || null;
    const replyToRoomId = chip?.getAttribute('data-rid') || null;

    // 返信チップは pre の内側にある。除去しないと本文に「返信元」が混入する。
    const bodyEl = el.querySelector(SEL.body);
    let body = '';
    if (bodyEl) {
      const clone = bodyEl.cloneNode(true);
      clone.querySelectorAll(SEL.replyChip).forEach((node) => node.remove());
      body = textOf(clone);
    }

    const dataIndex = el.getAttribute('data-index');
    const index =
      dataIndex !== null && dataIndex !== '' ? Number(dataIndex) : fallbackIndex;

    ctx.lastAccountId = accountId;
    ctx.lastUserName = userName;
    if (avatarUrl) ctx.lastAvatarUrl = avatarUrl;

    return {
      id,
      roomId,
      accountId,
      userName,
      avatarUrl,
      body,
      replyToId,
      replyToRoomId,
      timestamp,
      index,
    };
  } catch {
    return null;
  }
}

/**
 * タイムライン順に走査する。連続投稿の送信者継承はこの順序に依存する。
 * @returns {import('../core/types.js').ChatworkMessage[]}
 */
export function parseTimeline(elements, ctx = createScrapeContext()) {
  const messages = [];
  elements.forEach((el, i) => {
    const message = parseMessage(el, ctx, i);
    if (message) messages.push(message);
  });
  return messages;
}
```

- [ ] **Step 6: テストが通ることを確認する**

Run: `npm test`
Expected: PASS — 全 23 tests passed (Task 1 の 11 件 + 本タスクの 12 件)

- [ ] **Step 7: コミット** (git を使う場合のみ)

```bash
git add src/content test/content test/fixtures
git commit -m "feat: Chatwork DOM からのメッセージ抽出を追加"
```

---

### Task 3: 拡張の骨格 — manifest / loader / パネル

ここまでで初めて「Chrome に読み込める拡張」になる。実機で右側に空パネルが出るところまでを作り、拡張としての土台を早期に検証する。

**Files:**
- Create: `manifest.json`
- Create: `icons/16.png`, `icons/48.png`, `icons/128.png`
- Create: `src/content/loader.js`
- Create: `src/ui/styles.js`
- Create: `src/ui/panel.js`
- Create: `src/content/main.js`

**Interfaces:**
- Consumes: `SEL` (Task 2)
- Produces:
  - `PANEL_CSS: string` (`src/ui/styles.js`)
  - `PANEL_ID = 'ctv-root'`、`createPanel(): PanelHandle | null`（`src/ui/panel.js`）
  - `PanelHandle` = `{ host, shadow, body, setCount(n), setOpen(bool), isOpen(), destroy() }`

- [ ] **Step 1: アイコンを用意する**

`icons/` に 16 / 48 / 128 px の PNG を置く。デザインは問わない (MVP の目的は拡張が読み込めること)。
手元に画像が無ければ、次のコマンドでアクセント色 `#0C6B6B` の単色 PNG を生成する。

```bash
cd F:/threadswork && python -c "
import struct, zlib, os
os.makedirs('icons', exist_ok=True)
def png(path, size, rgb=(12,107,107)):
    raw=b''.join(b'\x00'+bytes(rgb)*size for _ in range(size))
    def chunk(t,d):
        c=t+d
        return struct.pack('>I',len(d))+c+struct.pack('>I',zlib.crc32(c)&0xffffffff)
    ihdr=struct.pack('>IIBBBBB',size,size,8,2,0,0,0)
    open(path,'wb').write(b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',ihdr)+chunk(b'IDAT',zlib.compress(raw))+chunk(b'IEND',b''))
for s in (16,48,128): png(f'icons/{s}.png', s)
print('icons written')
"
```

- [ ] **Step 2: manifest.json を書く**

`manifest.json` — `web_accessible_resources` は glob の解釈がバージョンで揺れるため、**実ファイルを列挙する**。

```json
{
  "manifest_version": 3,
  "name": "スレッドビュー for Chatwork",
  "version": "0.1.0",
  "description": "Chatwork の返信をスレッド形式で構造化表示します。Chatwork株式会社の公式製品ではありません。",
  "permissions": ["storage"],
  "host_permissions": [
    "https://www.chatwork.com/*",
    "https://kcw.kddi.ne.jp/*"
  ],
  "content_scripts": [
    {
      "matches": [
        "https://www.chatwork.com/*",
        "https://kcw.kddi.ne.jp/*"
      ],
      "js": ["src/content/loader.js"],
      "run_at": "document_idle"
    }
  ],
  "web_accessible_resources": [
    {
      "resources": [
        "src/content/main.js",
        "src/content/selectors.js",
        "src/content/scraper.js",
        "src/content/observer.js",
        "src/content/navigator.js",
        "src/core/threadTree.js",
        "src/core/types.js",
        "src/ui/panel.js",
        "src/ui/render.js",
        "src/ui/styles.js"
      ],
      "matches": [
        "https://www.chatwork.com/*",
        "https://kcw.kddi.ne.jp/*"
      ]
    }
  ],
  "icons": { "16": "icons/16.png", "48": "icons/48.png", "128": "icons/128.png" }
}
```

> `observer.js` / `navigator.js` / `render.js` は Task 4〜6 で作る。先に列挙しておいてよい (存在しないリソースがあっても manifest は有効)。

- [ ] **Step 3: loader.js を書く**

`src/content/loader.js` — MV3 の content script は ESM を直接ロードできないため、classic script から動的 import する。

```js
// MV3 の content_scripts は ES Module を直接ロードできない。
// classic script として注入し、ここから ESM エントリを動的 import する。
(() => {
  const url = chrome.runtime.getURL('src/content/main.js');
  import(url).catch((error) => {
    console.error('[ctv] failed to load main module', error);
  });
})();
```

- [ ] **Step 4: styles.js を書く**

`src/ui/styles.js` — Shadow root に注入する CSS。外部からの継承を遮断し、ライト固定とする。

```js
export const PANEL_CSS = `
:host {
  all: initial;
  display: block;
  height: 100%;
}
* { box-sizing: border-box; }
.panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #ffffff;
  border-left: 1px solid #d2dcdc;
  box-shadow: -2px 0 10px rgba(0, 0, 0, 0.08);
  font-family: "Hiragino Sans", "Yu Gothic", system-ui, sans-serif;
  font-size: 13px;
  line-height: 1.7;
  color: #101819;
}
.panel__head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid #d2dcdc;
  background: #f4f7f7;
  flex: 0 0 auto;
}
.panel__title { font-weight: 700; font-size: 13px; }
.panel__count { color: #5b6e70; font-size: 12px; }
.panel__spacer { flex: 1 1 auto; }
.panel__btn {
  border: 1px solid #d2dcdc;
  background: #ffffff;
  color: #33474a;
  border-radius: 3px;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  padding: 2px 8px;
}
.panel__btn:hover { background: #edf1f1; }
.panel__btn:focus-visible { outline: 2px solid #0c6b6b; outline-offset: 1px; }
.panel__body {
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 10px;
}
.panel__grip {
  position: absolute;
  left: 0;
  top: 0;
  width: 6px;
  height: 100%;
  cursor: col-resize;
}
.panel__grip:hover { background: rgba(12, 107, 107, 0.18); }
.state {
  color: #5b6e70;
  font-size: 12px;
  padding: 16px 8px;
  text-align: center;
}
.state--error { color: #8a5a0b; text-align: left; }
`;
```

- [ ] **Step 5: panel.js を書く**

`src/ui/panel.js`:

```js
import { PANEL_CSS } from './styles.js';
import { SEL } from '../content/selectors.js';

export const PANEL_ID = 'ctv-root';
const LAYOUT_STYLE_ID = 'ctv-layout-style';
const OPEN_CLASS = 'ctv-open';
const MIN_WIDTH = 280;
const MAX_WIDTH = 640;
const DEFAULT_WIDTH = 360;

function clampWidth(value) {
  if (!Number.isFinite(value)) return DEFAULT_WIDTH;
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(value)));
}

function ensureLayoutStyle() {
  const existing = document.getElementById(LAYOUT_STYLE_ID);
  if (existing) return existing;
  const style = document.createElement('style');
  style.id = LAYOUT_STYLE_ID;
  style.textContent = `
:root { --ctv-w: ${DEFAULT_WIDTH}px; }
#${PANEL_ID} {
  position: fixed;
  top: 0;
  right: 0;
  height: 100vh;
  width: var(--ctv-w);
  z-index: 2147483000;
}
html.${OPEN_CLASS} ${SEL.appRoot} { width: calc(100% - var(--ctv-w)) !important; }
html:not(.${OPEN_CLASS}) #${PANEL_ID} { display: none; }
`;
  document.head.appendChild(style);
  return style;
}

async function loadSettings() {
  try {
    const stored = await chrome.storage.local.get({ width: DEFAULT_WIDTH, open: true });
    return { width: clampWidth(Number(stored.width)), open: stored.open !== false };
  } catch {
    return { width: DEFAULT_WIDTH, open: true };
  }
}

function saveSettings(settings) {
  try {
    chrome.storage.local.set(settings);
  } catch {
    // storage が使えなくても動作は継続する
  }
}

/**
 * Shadow DOM パネルを生成して body 直下に置く。
 * 既に生成済みなら null を返す (多重注入防止)。
 */
export function createPanel() {
  if (document.getElementById(PANEL_ID)) return null;

  ensureLayoutStyle();

  const host = document.createElement('div');
  host.id = PANEL_ID;
  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = PANEL_CSS;

  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.innerHTML = `
    <div class="panel__grip" data-role="grip" role="separator" aria-orientation="vertical"></div>
    <header class="panel__head">
      <span class="panel__title">スレッド</span>
      <span class="panel__count" data-role="count"></span>
      <span class="panel__spacer"></span>
      <button class="panel__btn" data-role="close" type="button">閉じる</button>
    </header>
    <div class="panel__body" data-role="body"></div>
  `;

  shadow.append(style, panel);
  document.body.appendChild(host);

  const body = shadow.querySelector('[data-role="body"]');
  const count = shadow.querySelector('[data-role="count"]');
  const closeBtn = shadow.querySelector('[data-role="close"]');
  const grip = shadow.querySelector('[data-role="grip"]');

  let width = DEFAULT_WIDTH;

  function applyWidth(next) {
    width = clampWidth(next);
    document.documentElement.style.setProperty('--ctv-w', `${width}px`);
  }

  function setOpen(open) {
    document.documentElement.classList.toggle(OPEN_CLASS, open);
    saveSettings({ open });
  }

  function isOpen() {
    return document.documentElement.classList.contains(OPEN_CLASS);
  }

  closeBtn.addEventListener('click', () => setOpen(false));

  grip.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    grip.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = width;

    const onMove = (moveEvent) => {
      applyWidth(startWidth + (startX - moveEvent.clientX));
    };
    const onUp = () => {
      grip.removeEventListener('pointermove', onMove);
      grip.removeEventListener('pointerup', onUp);
      saveSettings({ width });
    };
    grip.addEventListener('pointermove', onMove);
    grip.addEventListener('pointerup', onUp);
  });

  loadSettings().then((settings) => {
    applyWidth(settings.width);
    setOpen(settings.open);
  });

  applyWidth(DEFAULT_WIDTH);
  setOpen(true);

  return {
    host,
    shadow,
    body,
    setCount(n) {
      count.textContent = n > 0 ? `${n} 件` : '';
    },
    setOpen,
    isOpen,
    destroy() {
      host.remove();
      document.documentElement.classList.remove(OPEN_CLASS);
    },
  };
}
```

- [ ] **Step 6: main.js の最小版を書く**

`src/content/main.js`:

```js
import { createPanel } from '../ui/panel.js';

function boot() {
  const panel = createPanel();
  if (!panel) return;
  panel.body.innerHTML = '<div class="state">読み込み中です</div>';
}

boot();
```

- [ ] **Step 7: 実機で読み込んで確認する**

1. Chrome で `chrome://extensions` を開く
2. 右上の「デベロッパー モード」を ON にする
3. 「パッケージ化されていない拡張機能を読み込む」で `F:\threadswork` を選ぶ
4. Chatwork (`https://www.chatwork.com/`) を開く / リロードする

Expected:
- 画面右側に幅 360px の白いパネルが出て、ヘッダーに「スレッド」、本文に「読み込み中です」が表示される
- Chatwork 本体が 360px ぶん詰まり、パネルに隠れていない
- パネル左端をドラッグすると幅が変わる
- 「閉じる」でパネルが消え、Chatwork が全幅に戻る
- DevTools のコンソールに `[ctv]` のエラーが出ていない

うまくいかない場合は DevTools のコンソールと `chrome://extensions` のエラー欄を確認する。よくある原因は `web_accessible_resources` の列挙漏れ。

- [ ] **Step 8: ユニットテストが壊れていないことを確認する**

Run: `npm test`
Expected: PASS — 23 tests passed (このタスクはテストを追加しない)

- [ ] **Step 9: コミット** (git を使う場合のみ)

```bash
git add manifest.json icons src/content/loader.js src/content/main.js src/ui
git commit -m "feat: MV3 の骨格と Shadow DOM パネルを追加"
```

---

### Task 4: render.js — スレッド一覧とツリー描画

パネルに実際のスレッドを描く。ここで初めて拡張が「動くもの」になる。

**Files:**
- Create: `src/ui/render.js`
- Modify: `src/ui/styles.js` (スレッドカードのスタイルを追記)
- Modify: `src/content/main.js` (抽出 → ツリー化 → 描画を配線)
- Test: `test/ui/render.test.js`

**Interfaces:**
- Consumes: `buildThreads` (Task 1)、`parseTimeline` / `getMessageElements` (Task 2)、`createPanel` (Task 3)
- Produces: `renderThreads(container, threads, options): void` (`src/ui/render.js`)
  - `options` = `{ hideEmpty: boolean, onJump: (messageId: string) => void }`

- [ ] **Step 1: 失敗するテストを書く**

`test/ui/render.test.js`:

```js
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
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "../../src/ui/render.js"`

- [ ] **Step 3: render.js を実装する**

`src/ui/render.js` — **`innerHTML` を使わず DOM API で組み立てる。** 本文は Chatwork 上の他人の入力であり、文字列連結すると XSS になる。

```js
const MAX_PREVIEW = 80;

function truncate(text, max = MAX_PREVIEW) {
  const normalized = (text || '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max)}…`;
}

function formatRelative(timestampSeconds, now = Date.now()) {
  if (!timestampSeconds) return '';
  const diffMinutes = Math.floor((now - timestampSeconds * 1000) / 60000);
  if (diffMinutes < 1) return 'たった今';
  if (diffMinutes < 60) return `${diffMinutes} 分前`;
  const hours = Math.floor(diffMinutes / 60);
  if (hours < 24) return `${hours} 時間前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 日前`;
  const date = new Date(timestampSeconds * 1000);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function stateMessage(text, modifier) {
  return el('div', modifier ? `state ${modifier}` : 'state', text);
}

function buildNode(node, onJump) {
  const row = el('div', 'node');
  row.dataset.role = 'node';
  row.dataset.messageId = node.message.id;
  row.style.paddingLeft = `${Math.min(node.depth, 6) * 14}px`;
  row.setAttribute('role', 'button');
  row.setAttribute('tabindex', '0');

  row.append(
    el('span', 'node__name', node.message.userName),
    el('span', 'node__body', truncate(node.message.body, 60)),
    el('span', 'node__time', formatRelative(node.message.timestamp))
  );

  const jump = () => onJump(node.message.id);
  row.addEventListener('click', jump);
  row.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      jump();
    }
  });

  const wrapper = el('div', 'node__wrap');
  wrapper.appendChild(row);
  for (const child of node.children) {
    wrapper.appendChild(buildNode(child, onJump));
  }
  return wrapper;
}

function buildCard(thread, onJump) {
  const card = el('details', 'thread');
  card.dataset.role = 'thread';
  card.dataset.rootId = thread.rootId;

  const summary = el('summary', 'thread__summary');
  summary.append(
    el('span', 'thread__name', thread.rootMessage.userName),
    el('span', 'thread__preview', truncate(thread.rootMessage.body))
  );

  const meta = el('div', 'thread__meta');
  meta.append(
    el('span', null, `返信 ${thread.replyCount} 件`),
    el('span', null, formatRelative(thread.updatedAt))
  );
  if (thread.rootIsSynthetic) {
    meta.appendChild(el('span', 'thread__badge', '親メッセージ未読み込み'));
  }
  summary.appendChild(meta);

  card.appendChild(summary);
  card.appendChild(buildNode(thread.tree, onJump));
  return card;
}

/**
 * スレッド一覧を container に描画する。呼ぶたびに中身を作り直す。
 * @param {HTMLElement} container
 * @param {import('../core/types.js').Thread[]} threads
 * @param {{hideEmpty: boolean, onJump: (messageId: string) => void}} options
 */
export function renderThreads(container, threads, options) {
  const { hideEmpty, onJump } = options;
  container.textContent = '';

  if (!threads || threads.length === 0) {
    container.appendChild(stateMessage('メッセージを読み込み中です'));
    return;
  }

  const visible = hideEmpty ? threads.filter((t) => t.replyCount > 0) : threads;
  if (visible.length === 0) {
    container.appendChild(stateMessage('このルームにはまだ返信がありません'));
    return;
  }

  const list = el('div', 'thread-list');
  for (const thread of visible) {
    list.appendChild(buildCard(thread, onJump));
  }
  container.appendChild(list);
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npm test`
Expected: PASS — 31 tests passed

- [ ] **Step 5: スレッドカードのスタイルを styles.js に追記する**

`src/ui/styles.js` の `PANEL_CSS` テンプレートリテラルの**末尾** (閉じバッククォートの直前) に追記する。

```css
.thread-list { display: flex; flex-direction: column; gap: 8px; }
.thread {
  border: 1px solid #d2dcdc;
  border-radius: 4px;
  background: #ffffff;
  overflow: hidden;
}
.thread[open] { border-color: #0c6b6b; }
.thread__summary { cursor: pointer; padding: 8px 10px; list-style: none; }
.thread__summary::-webkit-details-marker { display: none; }
.thread__summary:focus-visible { outline: 2px solid #0c6b6b; outline-offset: -2px; }
.thread__name { font-weight: 700; margin-right: 6px; }
.thread__preview { color: #33474a; }
.thread__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 4px;
  color: #5b6e70;
  font-size: 11px;
}
.thread__badge {
  color: #8a5a0b;
  background: #f7ecd8;
  border-radius: 2px;
  padding: 0 4px;
}
.node__wrap { display: block; }
.node {
  display: flex;
  gap: 6px;
  align-items: baseline;
  padding: 4px 10px;
  border-top: 1px solid #edf1f1;
  cursor: pointer;
  font-size: 12px;
}
.node:hover { background: #f4f7f7; }
.node:focus-visible { outline: 2px solid #0c6b6b; outline-offset: -2px; }
.node__name { font-weight: 700; white-space: nowrap; }
.node__body {
  color: #33474a;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1 1 auto;
}
.node__time { color: #5b6e70; font-size: 11px; white-space: nowrap; }
```

- [ ] **Step 6: main.js を配線する**

`src/content/main.js` を次の内容で置き換える。

```js
import { createPanel } from '../ui/panel.js';
import { renderThreads } from '../ui/render.js';
import { getMessageElements } from './selectors.js';
import { createScrapeContext, parseTimeline } from './scraper.js';
import { buildThreads } from '../core/threadTree.js';

const state = {
  panel: null,
  hideEmpty: true,
};

function refresh() {
  if (!state.panel) return;
  const messages = parseTimeline(getMessageElements(document), createScrapeContext());
  const threads = buildThreads(messages);
  state.panel.setCount(threads.filter((t) => t.replyCount > 0).length);
  renderThreads(state.panel.body, threads, {
    hideEmpty: state.hideEmpty,
    onJump: (messageId) => {
      console.log('[ctv] jump requested', messageId);
    },
  });
}

function boot() {
  state.panel = createPanel();
  if (!state.panel) return;
  refresh();
  // Task 5 で MutationObserver に置き換える暫定の再描画。
  window.setInterval(refresh, 3000);
}

boot();
```

> `setInterval` と `console.log` は Task 5 / Task 6 で置き換える暫定実装。ここで残しておくと実機確認ができる。

- [ ] **Step 7: 実機で確認する**

`chrome://extensions` で拡張の再読み込みボタンを押し、Chatwork をリロードして返信のあるルームを開く。

Expected:
- パネルに返信のあるスレッドがカードとして並ぶ
- ヘッダーにスレッド件数が出る
- カードをクリックすると展開し、インデント付きのツリーが出る
- ツリーのノードをクリックするとコンソールに `[ctv] jump requested <mid>` が出る
- 返信の無いルームでは「このルームにはまだ返信がありません」が出る

- [ ] **Step 8: コミット** (git を使う場合のみ)

```bash
git add src/ui/render.js src/ui/styles.js src/content/main.js test/ui
git commit -m "feat: スレッド一覧とツリーの描画を追加"
```

---

### Task 5: observer.js — 更新検知とルーム切替

`setInterval` を捨て、DOM 変更とルーム切替に正しく追従させる。

**Files:**
- Create: `src/content/observer.js`
- Modify: `src/content/main.js`
- Test: `test/content/observer.test.js`

**Interfaces:**
- Consumes: `getTimeline` / `getCurrentRoomId` (Task 2)
- Produces: `startObserver({ onChange, onRoomChange, debounceMs? }): () => void`
  - 戻り値は監視を止める関数
  - `onChange()` — タイムラインに変更があった (デバウンス済み)
  - `onRoomChange(roomId: string|null)` — ルームが切り替わった

- [ ] **Step 1: 失敗するテストを書く**

`test/content/observer.test.js`:

```js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { startObserver } from '../../src/content/observer.js';

let stop;

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<div id="_timeLine"></div>';
  window.location.hash = '#!rid111';
});

afterEach(() => {
  if (stop) stop();
  stop = undefined;
  vi.useRealTimers();
});

describe('startObserver', () => {
  it('タイムラインへの追加で onChange が呼ばれる', async () => {
    const onChange = vi.fn();
    stop = startObserver({ onChange, onRoomChange: () => {}, debounceMs: 50 });

    document.getElementById('_timeLine').appendChild(document.createElement('div'));
    await Promise.resolve();
    vi.advanceTimersByTime(60);

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('連続した変更を 1 回にまとめる', async () => {
    const onChange = vi.fn();
    stop = startObserver({ onChange, onRoomChange: () => {}, debounceMs: 50 });

    const timeline = document.getElementById('_timeLine');
    for (let i = 0; i < 5; i += 1) {
      timeline.appendChild(document.createElement('div'));
    }
    await Promise.resolve();
    vi.advanceTimersByTime(60);

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('hashchange でルーム変更が通知される', () => {
    const onRoomChange = vi.fn();
    stop = startObserver({ onChange: () => {}, onRoomChange, debounceMs: 50 });

    window.location.hash = '#!rid222';
    window.dispatchEvent(new HashChangeEvent('hashchange'));

    expect(onRoomChange).toHaveBeenCalledWith('222');
  });

  it('同じルームへの hashchange では通知しない', () => {
    const onRoomChange = vi.fn();
    stop = startObserver({ onChange: () => {}, onRoomChange, debounceMs: 50 });

    window.dispatchEvent(new HashChangeEvent('hashchange'));

    expect(onRoomChange).not.toHaveBeenCalled();
  });

  it('停止後は onChange が呼ばれない', async () => {
    const onChange = vi.fn();
    stop = startObserver({ onChange, onRoomChange: () => {}, debounceMs: 50 });
    stop();
    stop = undefined;

    document.getElementById('_timeLine').appendChild(document.createElement('div'));
    await Promise.resolve();
    vi.advanceTimersByTime(60);

    expect(onChange).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "../../src/content/observer.js"`

- [ ] **Step 3: observer.js を実装する**

`src/content/observer.js`:

```js
import { getTimeline, getCurrentRoomId } from './selectors.js';

const DEFAULT_DEBOUNCE_MS = 150;
const RECONNECT_INTERVAL_MS = 1000;

/**
 * タイムラインの変更とルーム切替を監視する。
 * 解析は行わずコールバックで通知するだけ。
 * @param {{onChange: () => void, onRoomChange: (roomId: string|null) => void, debounceMs?: number}} options
 * @returns {() => void} 監視を止める関数
 */
export function startObserver(options) {
  const { onChange, onRoomChange, debounceMs = DEFAULT_DEBOUNCE_MS } = options;

  let timer = null;
  let observed = null;
  let stopped = false;
  let roomId = getCurrentRoomId();

  const observer = new MutationObserver(() => {
    if (stopped) return;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      onChange();
    }, debounceMs);
  });

  function connect() {
    if (stopped) return;
    const timeline = getTimeline();
    if (!timeline || timeline === observed) return;
    observer.disconnect();
    observer.observe(timeline, { childList: true, subtree: true });
    observed = timeline;
  }

  // Chatwork はルーム切替でタイムライン要素ごと差し替えることがあるため、
  // 切り離しを検知して再接続する。
  const reconnectTimer = setInterval(() => {
    if (stopped) return;
    if (!observed || !observed.isConnected) connect();
  }, RECONNECT_INTERVAL_MS);

  function handleHashChange() {
    if (stopped) return;
    const next = getCurrentRoomId();
    if (next === roomId) return;
    roomId = next;
    connect();
    onRoomChange(next);
  }

  window.addEventListener('hashchange', handleHashChange);
  connect();

  return function stop() {
    stopped = true;
    if (timer !== null) clearTimeout(timer);
    clearInterval(reconnectTimer);
    observer.disconnect();
    window.removeEventListener('hashchange', handleHashChange);
    observed = null;
  };
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npm test`
Expected: PASS — 36 tests passed

- [ ] **Step 5: main.js を observer に切り替える**

`src/content/main.js` の `boot()` と、`state` への `stopObserver` 追加を変更する。`refresh()` はそのまま。

```js
import { createPanel } from '../ui/panel.js';
import { renderThreads } from '../ui/render.js';
import { getMessageElements } from './selectors.js';
import { createScrapeContext, parseTimeline } from './scraper.js';
import { buildThreads } from '../core/threadTree.js';
import { startObserver } from './observer.js';

const state = {
  panel: null,
  hideEmpty: true,
  stopObserver: null,
};

function refresh() {
  if (!state.panel) return;
  const messages = parseTimeline(getMessageElements(document), createScrapeContext());
  const threads = buildThreads(messages);
  state.panel.setCount(threads.filter((t) => t.replyCount > 0).length);
  renderThreads(state.panel.body, threads, {
    hideEmpty: state.hideEmpty,
    onJump: (messageId) => {
      console.log('[ctv] jump requested', messageId);
    },
  });
}

function boot() {
  state.panel = createPanel();
  if (!state.panel) return;
  refresh();
  state.stopObserver = startObserver({
    onChange: refresh,
    onRoomChange: () => {
      // ルームが変わったら前ルームの表示を残さない。
      state.panel.body.textContent = '';
      refresh();
    },
  });
}

boot();
```

> スクレイプの context は `refresh()` ごとに作り直す。タイムライン全体を毎回頭から走査するため、ルームをまたいだ名前の混入が起きない。

- [ ] **Step 6: 実機で確認する**

拡張を再読み込みして Chatwork をリロードする。

Expected:
- 新しいメッセージを投稿するとパネルが 1 秒以内に更新される
- タイムラインを上にスクロールして過去ログを読み込むと、スレッドが増える
- 別のルームをクリックするとパネルの内容が切り替わり、前のルームのスレッドが残らない
- パネルがちらつき続けたり、CPU が張り付いたりしない

- [ ] **Step 7: コミット** (git を使う場合のみ)

```bash
git add src/content/observer.js src/content/main.js test/content/observer.test.js
git commit -m "feat: タイムライン監視とルーム切替の追従を追加"
```

---

### Task 6: navigator.js — ジャンプと一時強調

ツリーのクリックでタイムラインの該当位置へ移動させる。

**Files:**
- Create: `src/content/navigator.js`
- Modify: `src/content/main.js`
- Test: `test/content/navigator.test.js`

**Interfaces:**
- Consumes: `getMessageElementById` / `findScrollContainer` (Task 2)
- Produces: `jumpToMessage(messageId: string): boolean` — 見つかって移動したら `true`、未ロードなら `false`

- [ ] **Step 1: 失敗するテストを書く**

`test/content/navigator.test.js`:

```js
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
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "../../src/content/navigator.js"`

- [ ] **Step 3: navigator.js を実装する**

`src/content/navigator.js`:

```js
import { getMessageElementById, findScrollContainer } from './selectors.js';

export const HIGHLIGHT_CLASS = 'ctv-flash-highlight';
const HIGHLIGHT_STYLE_ID = 'ctv-highlight-style';
const HIGHLIGHT_MS = 1500;

// 強調対象は Shadow DOM の外 (Chatwork 本体の DOM) なので
// document.head に最小限のスタイルを 1 つだけ注入する。
function ensureHighlightStyle() {
  if (document.getElementById(HIGHLIGHT_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = HIGHLIGHT_STYLE_ID;
  style.textContent = `
.${HIGHLIGHT_CLASS} {
  background-color: rgba(12, 107, 107, 0.14) !important;
  transition: background-color 0.3s ease-out;
}
`;
  document.head.appendChild(style);
}

/**
 * 指定メッセージまでタイムラインをスクロールし、一時的に強調する。
 * @param {string} messageId
 * @returns {boolean} 見つかって移動できたら true
 */
export function jumpToMessage(messageId) {
  const target = getMessageElementById(messageId);
  if (!target) return false;

  ensureHighlightStyle();

  // スクロール親の有無に関わらず scrollIntoView で足りるが、
  // 親が取れない場合はレイアウトが想定外なのでログに残す。
  if (!findScrollContainer(target)) {
    console.warn('[ctv] scroll container not found; falling back to scrollIntoView');
  }

  target.scrollIntoView({ block: 'center', behavior: 'smooth' });

  target.classList.add(HIGHLIGHT_CLASS);
  setTimeout(() => {
    target.classList.remove(HIGHLIGHT_CLASS);
  }, HIGHLIGHT_MS);

  return true;
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npm test`
Expected: PASS — 41 tests passed

- [ ] **Step 5: main.js を配線し、未ロード時の案内を出す**

`src/content/main.js` の `refresh()` 内の `onJump` を差し替え、`showNotice` を追加する。あわせて `import { jumpToMessage } from './navigator.js';` を追加する。

```js
function showNotice(text) {
  if (!state.panel) return;
  const notice = document.createElement('div');
  notice.className = 'state state--error';
  notice.textContent = text;
  state.panel.body.prepend(notice);
  setTimeout(() => notice.remove(), 4000);
}
```

`onJump` を次に置き換える。

```js
    onJump: (messageId) => {
      if (jumpToMessage(messageId)) return;
      showNotice(
        'このメッセージはまだ読み込まれていません。タイムラインを上にスクロールしてください。'
      );
    },
```

- [ ] **Step 6: 実機で確認する**

Expected:
- ツリーのノードをクリックするとタイムラインがそのメッセージへスムーズにスクロールする
- 対象メッセージが薄いティール色で 1.5 秒ほど光る
- 読み込まれていない過去メッセージのノードをクリックすると、パネル上部に案内が数秒表示される

- [ ] **Step 7: コミット** (git を使う場合のみ)

```bash
git add src/content/navigator.js src/content/main.js test/content/navigator.test.js
git commit -m "feat: スレッドからタイムラインへのジャンプを追加"
```

---

### Task 7: 健全性チェック、返信ゼロ切替、README、実機総合検証

セレクタ破損を検知して利用者に伝える。残る UI 要素を入れ、ドキュメントを書いて MVP を締める。

**Files:**
- Modify: `src/content/selectors.js` (`runHealthCheck` を追加)
- Modify: `src/ui/panel.js` (返信ゼロ切替ボタンを追加)
- Modify: `src/ui/styles.js` (エラー表示のスタイルを追記)
- Modify: `src/content/main.js` (健全性チェックと切替を配線)
- Create: `README.md`
- Test: `test/content/health.test.js`

**Interfaces:**
- Consumes: これまでの全モジュール
- Produces:
  - `runHealthCheck(messages, doc?): { ok: boolean, failures: string[] }` (`src/content/selectors.js`)
  - `PanelHandle` に `onToggleHideEmpty(handler)` と `setHideEmpty(bool)` を追加

- [ ] **Step 1: 失敗するテストを書く**

`test/content/health.test.js`:

```js
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
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npm test`
Expected: FAIL — `runHealthCheck is not a function`

- [ ] **Step 3: runHealthCheck を selectors.js に追加する**

`src/content/selectors.js` の末尾に追記する。

```js
const UNKNOWN_NAME = '不明';

/**
 * セレクタが今も Chatwork の DOM に噛み合っているかを検査する。
 * 失敗した項目名の配列を返し、利用者への診断情報として使う。
 * @param {import('../core/types.js').ChatworkMessage[]} messages
 * @returns {{ok: boolean, failures: string[]}}
 */
export function runHealthCheck(messages, doc = document) {
  const failures = [];

  if (!getTimeline(doc)) failures.push('timeline');
  if (getMessageElements(doc).length === 0) failures.push('messages');

  if (messages.length > 0) {
    const resolved = messages.filter((m) => m.userName && m.userName !== UNKNOWN_NAME).length;
    if (resolved / messages.length <= 0.5) failures.push('userName');
  }

  return { ok: failures.length === 0, failures };
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npm test`
Expected: PASS — 45 tests passed

- [ ] **Step 5: パネルに返信ゼロ切替を追加する**

`src/ui/panel.js` の `panel.innerHTML` のヘッダー部分、`<span class="panel__spacer"></span>` の直後に切替ボタンを挿入する。

```html
      <button class="panel__btn" data-role="toggle-empty" type="button">全件表示</button>
```

`closeBtn` の定義の下に次を追加する。

```js
  const toggleEmptyBtn = shadow.querySelector('[data-role="toggle-empty"]');
  let hideEmpty = true;
  let hideEmptyHandler = () => {};

  function setHideEmpty(next) {
    hideEmpty = next;
    toggleEmptyBtn.textContent = hideEmpty ? '全件表示' : '返信ありのみ';
  }

  toggleEmptyBtn.addEventListener('click', () => {
    setHideEmpty(!hideEmpty);
    hideEmptyHandler(hideEmpty);
  });

  setHideEmpty(true);
```

戻り値オブジェクトに次の 2 つを追加する。

```js
    setHideEmpty,
    onToggleHideEmpty(handler) {
      hideEmptyHandler = handler;
    },
```

- [ ] **Step 6: エラー表示のスタイルを追記する**

`src/ui/styles.js` の `PANEL_CSS` 末尾に追記する。

```css
.diagnostic {
  border: 1px solid #8a5a0b;
  background: #f7ecd8;
  color: #8a5a0b;
  padding: 10px;
  border-radius: 4px;
  font-size: 12px;
}
.diagnostic__code {
  font-family: Consolas, "Courier New", monospace;
  display: block;
  margin: 6px 0;
  word-break: break-all;
}
```

- [ ] **Step 7: main.js に健全性チェックと切替を配線する**

`src/content/main.js` を次の内容で置き換える。

```js
import { createPanel } from '../ui/panel.js';
import { renderThreads } from '../ui/render.js';
import { getMessageElements, runHealthCheck } from './selectors.js';
import { createScrapeContext, parseTimeline } from './scraper.js';
import { buildThreads } from '../core/threadTree.js';
import { startObserver } from './observer.js';
import { jumpToMessage } from './navigator.js';

const state = {
  panel: null,
  hideEmpty: true,
  stopObserver: null,
};

function showNotice(text) {
  if (!state.panel) return;
  const notice = document.createElement('div');
  notice.className = 'state state--error';
  notice.textContent = text;
  state.panel.body.prepend(notice);
  setTimeout(() => notice.remove(), 4000);
}

function renderDiagnostic(failures) {
  const box = document.createElement('div');
  box.className = 'diagnostic';
  box.append(
    Object.assign(document.createElement('p'), {
      textContent: 'Chatwork の画面構造が変わった可能性があります。',
    })
  );
  const code = document.createElement('code');
  code.className = 'diagnostic__code';
  code.textContent = `failed: ${failures.join(', ')}`;
  box.appendChild(code);

  const copyBtn = document.createElement('button');
  copyBtn.className = 'panel__btn';
  copyBtn.type = 'button';
  copyBtn.textContent = '診断情報をコピー';
  copyBtn.addEventListener('click', () => {
    const report = [
      'chatwork-thread-view diagnostic',
      `url: ${location.origin}${location.pathname}`,
      `failed: ${failures.join(', ')}`,
      `userAgent: ${navigator.userAgent}`,
    ].join('\n');
    navigator.clipboard.writeText(report).then(
      () => { copyBtn.textContent = 'コピーしました'; },
      () => { copyBtn.textContent = 'コピーできませんでした'; }
    );
  });
  box.appendChild(copyBtn);

  state.panel.body.textContent = '';
  state.panel.body.appendChild(box);
}

function refresh() {
  if (!state.panel) return;

  const messages = parseTimeline(getMessageElements(document), createScrapeContext());
  const health = runHealthCheck(messages, document);
  if (!health.ok) {
    // メッセージがまだ 1 件も無い初期表示は異常ではないので通常描画に任せる。
    if (!(health.failures.length === 1 && health.failures[0] === 'messages')) {
      state.panel.setCount(0);
      renderDiagnostic(health.failures);
      return;
    }
  }

  const threads = buildThreads(messages);
  state.panel.setCount(threads.filter((t) => t.replyCount > 0).length);
  renderThreads(state.panel.body, threads, {
    hideEmpty: state.hideEmpty,
    onJump: (messageId) => {
      if (jumpToMessage(messageId)) return;
      showNotice(
        'このメッセージはまだ読み込まれていません。タイムラインを上にスクロールしてください。'
      );
    },
  });
}

function boot() {
  state.panel = createPanel();
  if (!state.panel) return;

  state.panel.onToggleHideEmpty((hideEmpty) => {
    state.hideEmpty = hideEmpty;
    refresh();
  });

  refresh();

  state.stopObserver = startObserver({
    onChange: refresh,
    onRoomChange: () => {
      state.panel.body.textContent = '';
      refresh();
    },
  });
}

boot();
```

- [ ] **Step 8: README.md を書く**

```markdown
# スレッドビュー for Chatwork

Chatwork の返信をスレッド形式で構造化表示する Chrome 拡張です。

**本拡張は Chatwork株式会社の公式製品ではありません。**

## できること

- タイムライン上の返信関係を解析し、スレッドツリーとして右側パネルに表示
- スレッドを展開してツリーを閲覧
- ツリーのメッセージをクリックしてタイムラインの該当位置へジャンプ
- ルーム切替と過去ログの追加読み込みに追従

## 設計方針

- バックエンドを持たず、ネットワーク通信を一切行いません
- API トークンなどの認証情報を一切扱いません
- 読み取るのは表示中のページの DOM だけです
- UI は Shadow DOM に閉じており、Chatwork 本体の CSS / JS と干渉しません

## インストール (開発版)

1. Chrome で `chrome://extensions` を開く
2. 「デベロッパー モード」を ON にする
3. 「パッケージ化されていない拡張機能を読み込む」でこのフォルダを選ぶ
4. Chatwork を開く / リロードする

## 制約

- **DOM に読み込まれているメッセージのみが対象です。** Chatwork は履歴を遅延読み込みするため、
  上にスクロールして読み込んだ範囲でスレッドが復元されます。
  読み込み済み範囲外に親がある返信は「親メッセージ未読み込み」バッジ付きで単独表示されます。
- 別ルームへの返信は、そのルームを開いたときのみ親子として解決されます。
- Chatwork の画面構造が変わると動作しなくなる可能性があります。その場合はパネルに
  「Chatwork の画面構造が変わった可能性があります」と診断情報が表示されます。
- ライトテーマ固定です。

## 開発

```bash
npm install
npm test        # 一度だけ実行
npm run test:watch
```

Chatwork DOM への依存は `src/content/selectors.js` にのみ存在します。
画面構造が変わった場合はこのファイルを修正してください。
```

- [ ] **Step 9: 全テストが通ることを確認する**

Run: `npm test`
Expected: PASS — 45 tests passed

- [ ] **Step 10: 実機での総合検証**

拡張を再読み込みし、Chatwork で次をすべて確認する。**1 つでも失敗したら修正してから完了とする。**

- [ ] 返信の多いグループルームでスレッドが正しくツリー化されている (親子が実際の返信関係と一致)
- [ ] 「全件表示」を押すと返信ゼロのメッセージも並び、もう一度押すと返信ありのみに戻る
- [ ] ツリーのノードをクリックして正しいメッセージへ飛び、そのメッセージが光る
- [ ] 未ロードの親を持つスレッドに「親メッセージ未読み込み」バッジが出ている
- [ ] 上にスクロールして過去ログを読み込むとスレッドが増え、バッジが消えるものがある
- [ ] ルームを 3 つ以上切り替えても前のルームの内容が残らない
- [ ] 連続投稿のメッセージで送信者名が「不明」になっていない
- [ ] 本文に「返信元」の文字が混入していない
- [ ] パネルを閉じると Chatwork が全幅に戻り、リロード後も閉じたままになる
- [ ] 幅を変えてリロードすると幅が保持される
- [ ] DevTools のコンソールにエラーが出ていない
- [ ] しばらく放置しても CPU 使用率が上がり続けない

- [ ] **Step 11: コミット** (git を使う場合のみ)

```bash
git add -A
git commit -m "feat: 健全性チェック・表示切替・README を追加して MVP を完成"
```

---

## 完成時の状態

- `npm test` が 45 件パスする
- `chrome://extensions` から読み込むと Chatwork でスレッドパネルが動作する
- ネットワーク通信コードと認証情報の取り扱いがゼロ
- Chatwork DOM への依存が `src/content/selectors.js` 1 ファイルに閉じている
