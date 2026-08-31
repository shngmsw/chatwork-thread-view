import { UNKNOWN_NAME } from './selectors.js';

// メッセージ ID・ルーム ID・アカウント ID はいずれも数値文字列。
// 記法に埋める前に必ず検証する。想定外の値が混ざると、壊れた記法が
// そのまま相手のタイムラインに投稿される。
const NUMERIC = /^\d+$/;

/**
 * Chatwork の返信記法を組み立てる。DOM に触れない。
 *
 * 生成する形は Chatwork 本体の「返信」と同じ:
 *   [rp aid=<accountId> to=<roomId>-<messageId>] <送信者名>さん
 * 末尾に改行を付け、本文を次の行から書けるようにする。
 *
 * @param {import('../core/types.js').ChatworkMessage|null} message
 * @returns {string|null} 組み立てられないときは null
 */
export function buildReplyTag(message) {
  if (!message) return null;

  const { accountId, roomId, id, userName } = message;
  if (!NUMERIC.test(String(accountId))) return null;
  if (!NUMERIC.test(String(roomId))) return null;
  if (!NUMERIC.test(String(id))) return null;

  const tag = `[rp aid=${accountId} to=${roomId}-${id}]`;
  const name = String(userName || '').trim();
  if (!name || name === UNKNOWN_NAME) return `${tag}\n`;
  return `${tag} ${name}さん\n`;
}
