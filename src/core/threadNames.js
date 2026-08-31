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
