# スレッドビュー for Chatwork — Chrome 拡張 設計書

- 日付: 2026-08-29
- ステータス: 設計承認済み / 実装計画待ち
- 対象バージョン: MVP (v0.1.0)

## 1. 目的

Chatwork のタイムラインは時系列フラットであり、返信 (`[rp]`) で構成される会話の枝分かれが追いにくい。
本拡張は、タイムライン上の返信関係を解析してスレッドツリーとして再構成し、画面右側の常駐パネルに表示する。

設計原則は 3 つ。

1. **完全クライアントサイド完結** — バックエンドを持たない。ネットワーク通信を一切行わない。認証情報を一切扱わない。
2. **相手側に導入を要求しない** — 送信されるメッセージは Chatwork 標準の書式のまま。拡張は表示のみを変える (MVP)。
3. **Chatwork 本体との完全分離** — UI は Shadow DOM に閉じ、本体の CSS / JS と干渉しない。

## 2. スコープ

### MVP に含む

- タイムライン上のメッセージ抽出
- 返信関係の解析とスレッドツリー構築
- 右側常駐パネルへのスレッド一覧表示 (起点メッセージ要約 + 返信件数)
- スレッド展開によるツリー表示
- ツリー上のメッセージクリックでタイムラインの該当位置へスクロール + 一時強調
- ルーム切替への追従、履歴の追加読み込みへの追従
- パネルの開閉トグルと幅のドラッグリサイズ

### MVP に含まない (将来拡張)

- スレッドからの直接返信
- 疑似チャンネル機能 (スレッドのタグ分類)
- 既読 / 未読管理、ブックマーク
- 複数ルーム横断のスレッド一覧
- Side Panel API 版 UI

## 3. 実機 DOM 調査結果 (2026-08-29 時点 / Chatwork Web `_v=1.80a`)

### 3.1 反証された前提

当初仕様は、メッセージ本文の innerText に対して `\[rp aid=(\d+)\s+to=(\d+)-(\d+)\]` を正規表現で適用し親 ID を得る想定だった。
**この前提は実機では成立しない。** Chatwork のレンダラは `[rp]` タグを消費して「返信元」チップ要素に置換するため、
`pre` の innerText には `[rp]` 文字列が残らない。

代替として、チップ要素自身が親メッセージの ID を data 属性で保持していることを確認した。
実サンプル 5 件すべてで、チップの `data-mid` が React fiber 上の生タグ `[rp aid=... to=<rid>-<mid>]` の `mid` と一致した。

### 3.2 確定セレクタ

| 取得対象 | セレクタ / 属性 | 備考 |
| --- | --- | --- |
| タイムライン根 | `#_timeLine` | MutationObserver の監視対象 |
| メッセージ要素 | `#_timeLine ._message[data-mid]` | `id` は `_messageId<mid>` |
| 自メッセージ ID | `data-mid` | 19 桁前後の数値文字列。**Number 化してはならない** |
| ルーム ID | `data-rid` | |
| 削除済みフラグ | `data-deleted` | `"1"` なら除外 |
| ブックマーク | `data-bookmarked` | MVP 未使用 |
| **親メッセージ ID** | **`._replyMessage[data-mid]`** | 要素は `._replyMessage.chatTimeLineReply` |
| **親ルーム ID** | **`._replyMessage[data-rid]`** | 自ルームと異なる場合あり |
| 送信者アカウント ID | `button._profileUserIcon[data-aid]` | **`[data-aid]` の先頭を取ってはならない。**先頭は返信チップ内の返信先ユーザーを指す (実測 40 件中 32 件で送信者と不一致)。アバターの `_avatarAid<aid>` クラスと 35 件一致 |
| 送信者名 | `[data-testid="timeline_user-name"]` | 連続投稿では**存在しない** |
| アバター | `img.userIconImage` の `src` / `alt` | `alt` は表示名。名前のフォールバックに使う |
| 投稿時刻 | `._timeStamp` の `data-tm` | UNIX 秒 |
| 本文 | `pre` | innerText。返信チップのテキストを除去する必要あり |
| 入力欄 | `#_chatText` | `textarea` |
| 送信ボタン | `[data-testid="timeline_send-message-button"]` | **`#_sendButton` は存在しない** |
| アプリ根 | `#root.root` | 幅を詰めてパネル領域を確保する |

### 3.3 依存してはならないもの

- styled-components の生成クラス (`sc-hWmCAe`, `cqwzsM`, `iOFFuf` 等)。ビルドごとに変わる。
  **禁止しているのは「生成された識別子」であって「`_` 接頭辞が付いていないクラス」ではない。**
  `userIconImage` のように意味のある固定名が付いたクラスは、`_message` / `_speaker` と同じく依存してよい
  (実機で `class="sc-gFqAkR rGzLa userIconImage"` を確認済み。ハッシュは前 2 つで、3 つ目は手書きの意味クラス)。
- スクロールコンテナのクラス名。**セレクタではなく「メッセージ要素から祖先を辿り、最初に `overflow-y: auto|scroll` かつ `scrollHeight > clientHeight` の要素」を探す関数で解決する。**
- `window.ACCESS_TOKEN` / `/gateway/*` 内部 API。認証情報を扱わない方針のため使用しない。

### 3.4 補助フォールバック

React fiber (`__reactFiber$*`) を遡ると、返信チップの祖先に `cwtag: "[rp aid=... to=<rid>-<mid>]"` を持つ `a` 要素、
および `reply: {toUserId, toRoomId, toMessageId}` を props に持つコンポーネントが存在する。
**MVP では実装しない。** フォールバックとして機能させるには fiber 探索の起点が必要だが、その起点は返信チップ要素そのものであり、
`._replyMessage` が取得できない状況では起点も同時に失われるため実効性がない。fiber キー名がビルド依存である点も併せ、
主経路にも代替経路にもしない。ここには「Chatwork が親 ID を保持している別経路が存在する」という調査事実の記録としてのみ残す。
セレクタ破損の検知は 9 章の健全性チェックが担う。

## 4. データモデル

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
 * @property {number} index         タイムライン上の並び順 (data-index、無ければ DOM 順)
 */

/**
 * @typedef {Object} ThreadNode
 * @property {ChatworkMessage} message
 * @property {ThreadNode[]} children   timestamp 昇順
 * @property {number} depth            root からの深さ (root は 0)
 */

/**
 * @typedef {Object} Thread
 * @property {string} rootId
 * @property {ChatworkMessage} rootMessage
 * @property {ThreadNode} tree         rootMessage を頂点とするツリー
 * @property {number} replyCount       root を除いた総ノード数
 * @property {number} updatedAt        スレッド内の最大 timestamp
 * @property {boolean} rootIsSynthetic 親が未ロードのため代理 root になっている場合 true
 */
```

## 5. アーキテクチャ

```
chatwork-thread-view/
├── manifest.json
├── icons/{16,48,128}.png
├── src/
│   ├── content/
│   │   ├── loader.js        # classic script。ESM エントリを dynamic import する
│   │   ├── main.js          # 起動・ライフサイクル・ルーム切替の統括
│   │   ├── selectors.js     # 全 DOM セレクタと DOM 依存ヘルパを集約
│   │   ├── scraper.js       # HTMLElement -> ChatworkMessage
│   │   ├── observer.js      # MutationObserver + デバウンス + ルーム変更検知
│   │   └── navigator.js     # 該当メッセージへスクロール + 一時強調
│   ├── core/
│   │   ├── threadTree.js    # 純関数: ChatworkMessage[] -> Thread[]
│   │   └── types.js         # JSDoc typedef 置き場
│   └── ui/
│       ├── panel.js         # Shadow DOM ホストの生成 / 開閉 / リサイズ / レイアウト調整
│       ├── render.js        # スレッド一覧とツリーの描画
│       └── styles.js        # Shadow root に注入する CSS 文字列
├── test/
│   ├── threadTree.test.js
│   ├── scraper.test.js
│   └── fixtures/timeline.html   # 実機から採取・匿名化した DOM
├── package.json             # devDependencies: vitest, jsdom のみ
└── README.md
```

### 5.1 ESM の読み込み方式

MV3 の `content_scripts` は ES Module を直接ロードできない。
`loader.js` を classic script として注入し、その中から動的 import する。

```js
import(chrome.runtime.getURL('src/content/main.js'));
```

`src/**` を `web_accessible_resources` に登録する。これによりビルドツールなしで ESM の分割を維持する。

### 5.2 モジュール責務

| モジュール | 責務 | 依存 |
| --- | --- | --- |
| `selectors.js` | Chatwork DOM への依存を全て内包。セレクタ定数と、`findScrollContainer(el)` / `getMessageElements()` / `isMessageElement(node)` 等の DOM ヘルパを公開 | DOM |
| `scraper.js` | 単一メッセージ要素を `ChatworkMessage` に変換。名前解決のフォールバック連鎖と、aid→名前キャッシュを保持 | `selectors.js` |
| `threadTree.js` | **純関数のみ。DOM に触れない。** `buildThreads(messages)` を公開 | なし |
| `observer.js` | `#_timeLine` の変更監視、150ms デバウンス、`hashchange` によるルーム切替検知。コールバックで通知するだけで、自身は解析しない | `selectors.js` |
| `navigator.js` | メッセージ ID を受け取り、対象要素へスクロールして一時的に強調 | `selectors.js` |
| `panel.js` | Shadow DOM ホストの生成・破棄、開閉トグル、幅リサイズ、`#root` の幅調整 | `styles.js` |
| `render.js` | `Thread[]` を受け取り Shadow root 内に描画。クリックイベントをコールバックで外に出す | なし (DOM 生成のみ) |
| `main.js` | 上記を配線。スクレイプ結果のキャッシュ管理と再描画のトリガ | 全て |

## 6. 主要ロジック仕様

### 6.1 `scraper.js` — メッセージ抽出

`parseMessage(el)` の手順。

1. `data-mid` が無い、または `data-deleted === "1"` なら `null` を返す。
2. `id` = `data-mid`、`roomId` = `data-rid`。**いずれも文字列のまま保持する** (19 桁は `Number` の安全整数範囲を超える)。
3. `accountId` を次の順で解決する。
   1. `button._profileUserIcon[data-aid]` の `data-aid`
   2. `[class*="_avatarAid"]` のクラス名から `_avatarAid(\d+)` を抽出
   3. 直前に解決したメッセージの `accountId` を継承する (連続投稿ではアイコン自体が省略される)
   4. 空文字
4. `userName` を次の順で解決する。
   1. `[data-testid="timeline_user-name"]` の innerText
   2. `img.userIconImage` の `alt`
   3. モジュール内の `aid -> userName` キャッシュ (同ルーム内の過去メッセージで解決済みの名前)
   4. 直前に解決したメッセージの `userName` を継承する
   5. `'不明'`

   解決できた場合はキャッシュを更新する。連続投稿では 1 と 2 が欠落するため 3 以降が効く。

   **この 2 つのフォールバックは直前のメッセージの解析結果を必要とするため、抽出はタイムライン順に走査する `parseTimeline(elements)` が担い、`parseMessage(el, ctx)` は直前の送信者を `ctx` で受け取る。**
5. `avatarUrl` = `img.userIconImage` の `src`。無ければ空文字。
6. `timestamp` = `._timeStamp` の `data-tm` を `Number` 化。無ければ `0`。
7. 返信解決: `el.querySelector('._replyMessage')` を取得し、あれば
   `replyToId` = その `data-mid`、`replyToRoomId` = その `data-rid`。
   取得できない場合のみ fiber フォールバック (`3.4`) を試す。どちらも失敗すれば両方 `null`。
8. `body`: `pre` を `cloneNode(true)` し、複製内の `._replyMessage` を除去してからテキストを取り trim する。
   **返信チップは `pre` の内側にあり、除去しないと本文に「返信元」が混入することを実機で確認済み。** メッセージあたり `pre` は必ず 1 個。
9. `index` = `data-index` があれば `Number` 化、無ければ呼び出し側が渡す DOM 順。

### 6.2 `threadTree.js` — ツリー構築 (純関数)

`buildThreads(messages) -> Thread[]`

```
byId = Map<id, message>

findRoot(id):
  visited = Set()
  cur = byId.get(id)
  loop:
    if cur.replyToId が null                     -> cur.id を返す
    if cur.replyToRoomId !== cur.roomId          -> cur.id を返す   # 別ルーム返信は root 扱い
    if byId に cur.replyToId が無い              -> cur.id を返す   # 親が未ロード
    if visited に cur.replyToId が含まれる       -> cur.id を返す   # 循環ガード
    visited.add(cur.id)
    cur = byId.get(cur.replyToId)
```

1. 全メッセージについて `findRoot` を求め、`rootId -> メッセージ集合` にグループ化する。
2. 各グループ内で `replyToId` を辿って親子リンクを張り、`ThreadNode` ツリーを構成する。
   親がグループ内に見つからないノードは root 直下に接続する (孤児の救済)。
3. 各ノードの `children` を `timestamp` 昇順、同値なら `index` 昇順で整列する。
4. `replyCount` は root を除くノード総数。`updatedAt` はスレッド内 `timestamp` の最大値。
5. 返信が 1 件も無いメッセージも `replyCount = 0` の Thread として含める。表示側でフィルタする。
6. 返却する配列は `updatedAt` の降順で整列する。

**不変条件**: 出力ノード総数は入力メッセージ数と等しい。テストで検証する。

### 6.3 `observer.js` — 更新検知

- `#_timeLine` を `{ childList: true, subtree: true }` で監視する。
- 通知は 150ms の trailing デバウンスでまとめる。
- 自身のパネル由来の変更を拾わないよう、パネルは `document.body` 直下に置き `#_timeLine` の外に出す。
- ルーム切替は `hashchange` で検知する (`#!rid<roomId>`)。`data-rid` の変化も併せて確認し、変わっていればキャッシュを破棄して全再スキャンする。
- `#_timeLine` が差し替えられた場合に備え、監視対象要素が `document` から切り離されたことを検知したら再接続する。

### 6.4 `navigator.js` — ジャンプ

1. `#_messageId<mid>` または `._message[data-mid="<mid>"]` で対象要素を取得する。
2. 見つからない場合 (未ロードの過去メッセージ) は、パネル上に「このメッセージはまだ読み込まれていません。タイムラインを上にスクロールしてください」と表示して終了する。
3. 見つかった場合は `findScrollContainer(el)` でスクロール親を求め、`scrollIntoView({ block: 'center', behavior: 'smooth' })` を実行する。
4. 対象要素に一時クラスを付与し 1.5 秒後に外す。強調スタイルは Shadow DOM の外になるため、`document.head` に最小限のスタイルを 1 つだけ注入する (クラス名は `ctv-flash-highlight` で衝突を避ける)。

### 6.5 `panel.js` — レイアウト

- `document.body` 直下に `div#ctv-root` を生成し `attachShadow({ mode: 'open' })`。
- パネルは `position: fixed; right: 0; top: 0; height: 100vh; z-index: 2147483000`。
- Chatwork 本体を潰さないため `#root.root` に `width: calc(100% - var(--ctv-w))` を設定する。パネルを閉じたら元に戻す。
- 幅はドラッグでリサイズ可能 (最小 280px / 最大 640px)。値は `chrome.storage.local` に保存する。
- 開閉状態も `chrome.storage.local` に保存し、次回起動時に復元する。

## 7. manifest.json

```json
{
  "manifest_version": 3,
  "name": "スレッドビュー for Chatwork",
  "version": "0.1.0",
  "description": "Chatwork の返信をスレッド形式で構造化表示します",
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
      "resources": ["src/*"],
      "matches": [
        "https://www.chatwork.com/*",
        "https://kcw.kddi.ne.jp/*"
      ]
    }
  ],
  "icons": { "16": "icons/16.png", "48": "icons/48.png", "128": "icons/128.png" }
}
```

`tabs` 権限も `scripting` 権限も不要。service worker も MVP では不要なため置かない。
`web_accessible_resources` の `resources` は実装時に実際のファイルパスを列挙して確定させる (glob の解釈が Chrome のバージョンで揺れるため)。

### 7.1 名称について

製品名「スレッドビュー for Chatwork」の `for Chatwork` は商標の指名的使用として記載する。
ストア説明文の冒頭に**「本拡張は Chatwork株式会社 の公式製品ではありません」**を明記すること。
内部識別子は `chatwork-thread-view`、DOM に注入する id / クラス / CSS 変数は `ctv-` を接頭辞とする。

## 8. UI 仕様

### 8.1 パネル構成

- ヘッダー: タイトル「スレッド」、スレッド件数、返信ゼロのスレッドを隠すトグル、閉じるボタン。
- 本体: スレッドカードの縦リスト。`updatedAt` 降順。
- スレッドカード (折りたたみ時): 起点メッセージの送信者名、本文冒頭 80 文字、返信件数、最終更新の相対時刻。
- スレッドカード (展開時): インデント付きツリー。各ノードは送信者名 + 本文冒頭 + 時刻。
- 各ノードはクリックでタイムラインの該当位置へジャンプする。
- 親が未ロードで代理 root になっているスレッドには「親メッセージ未読み込み」のバッジを付ける。
- パネル左端はドラッグでリサイズできる。

### 8.2 空状態とエラー状態

| 状態 | 表示 |
| --- | --- |
| メッセージ 0 件 | 「メッセージを読み込み中です」 |
| 返信ありスレッド 0 件 | 「このルームにはまだ返信がありません」 |
| セレクタ不整合を検知 | 「Chatwork の画面構造が変わった可能性があります」+ 診断情報のコピーボタン |

### 8.3 スタイル

すべて Shadow root 内の `styles.js` に閉じる。`:host` に基準フォントと色を定義し、外部からの継承を遮断する。Chatwork のダーク / ライトは MVP では追従せず、ライト固定とする。

## 9. エラー処理と劣化戦略

- **単一メッセージのパース失敗は握りつぶす。** 例外を投げず `null` を返し、そのメッセージだけを一覧から除外する。1 件の異常が全体の描画を止めてはならない。
- **セレクタ健全性チェック**: 起動時と再スキャン時に「`#_timeLine` が存在するか」「`._message[data-mid]` が 1 件以上あるか」「名前解決の成功率が 50% を超えるか」を検査する。いずれか失敗なら `8.2` のエラー状態を表示し、どのチェックが落ちたかを診断情報として出す。
- **多重注入防止**: `document.getElementById('ctv-root')` が既にあれば起動を中止する。
- **MutationObserver の暴走防止**: 再描画は必ずデバウンス経由。描画処理自体が `#_timeLine` を変更しないことを保証する (パネルは `#_timeLine` 外)。

## 10. テスト戦略

devDependencies は `vitest` と `jsdom` のみ。実行は `npm test`。

### 10.1 `threadTree.test.js` — 純ロジック (DOM 不要)

- 返信なし: 全メッセージが `replyCount = 0` の独立スレッドになる
- 単純な親子: 1 親 + 2 子が 1 スレッドにまとまる
- 多階層: A <- B <- C が深さ 2 のツリーになる
- 兄弟の整列: 同じ親を持つ子が timestamp 昇順に並ぶ
- 親未ロード: 親が集合に無い返信は自身が root になり `rootIsSynthetic = true`
- 別ルーム返信: `replyToRoomId !== roomId` なら root 扱い
- 循環参照: A -> B -> A で無限ループせず終了する
- 自己参照: A -> A で無限ループせず終了する
- 不変条件: 出力ノード総数 == 入力メッセージ数
- 整列: 返却配列が `updatedAt` 降順

### 10.2 `scraper.test.js` — フィクスチャベース

`test/fixtures/timeline.html` に実機から採取し匿名化した DOM を置き、jsdom 上で検証する。

- 通常メッセージから全フィールドが取れる
- 返信メッセージから `replyToId` / `replyToRoomId` が取れる
- 本文に「返信元」チップの文言が混入しない
- 連続投稿 (名前要素なし) で aid キャッシュから名前が解決される
- `data-deleted="1"` が除外される
- 19 桁 ID が文字列のまま保持され精度が落ちない

`jsdom` は `innerText` を実装しないため、`scraper.js` はテキスト取得を `textContent` ベースのヘルパ経由に統一する。改行の扱いが実ブラウザと異なる点は実機検証で確認する。

### 10.3 実機検証

実装完了後、拡張を読み込んだ状態で Chatwork を開き、パネルの表示・ツリーの正しさ・ジャンプ・ルーム切替・履歴追加読み込みを目視確認する。

## 11. 既知の制約

- **DOM に読み込まれているメッセージのみが対象。** Chatwork は履歴を遅延読み込みするため、上へスクロールして読み込んだ範囲でのみスレッドが復元される。読み込み済み範囲外の親を持つ返信は代理 root として表示され、その旨をバッジで示す。
- Chatwork の DOM 構造変更で動作しなくなる可能性がある。影響を `selectors.js` 1 ファイルに閉じ、健全性チェックで早期に検知できるようにしている。
- 別ルームへの返信は、そのルームを開いたときのみ親子として解決される。現ルームでは代理 root になる。
- ライトテーマ固定。

## 12. 将来拡張の足がかり

MVP では実装しないが、設計上の接続点だけ確保しておく。

- **スレッドからの直接返信**: `#_chatText` に `[rp aid=<aid> to=<rid>-<mid>] <本文>` を設定し、`[data-testid="timeline_send-message-button"]` を `click()` する。`textarea` のため React の value setter を経由した入力イベント発火が必要になる。`selectors.js` に入力欄と送信ボタンのセレクタを既に定義しておく。
- **疑似チャンネル**: `chrome.storage.local` に `rootMessageId -> channelTag` を保持し、パネル上部にタブを出してフィルタする。`Thread` に `channelTag` を後付けできるよう `render.js` はフィルタ済み配列を受け取る形にしておく。
- **既読 / 未読管理**: `chrome.storage.local` に `rootMessageId -> lastSeenTimestamp` を保持し、`Thread.updatedAt` と比較する。
