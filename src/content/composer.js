import { SEL } from './selectors.js';
import { buildReplyTag } from './replyTag.js';

/**
 * React 制御下の入力欄に値を入れる。
 *
 * `el.value = x` だけでは React の内部 state (_valueTracker) と噛み合わず、
 * 画面には出るのに送信すると空が飛ぶ。プロトタイプ側のネイティブ setter を
 * 直接呼び、そのうえで input イベントを流して React に変更を知らせる。
 *
 * ここがこの拡張で最も Chatwork の実装に依存している箇所。壊れるとしたら
 * ここなので、失敗しても例外を投げず false を返して呼び出し側に判断させる。
 */
function setControlledValue(el, value) {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
    if (descriptor && descriptor.set) descriptor.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  } catch {
    return false;
  }
}

/**
 * 返信記法をメッセージ入力欄へ差し込む。送信はしない。
 *
 * 送信まで自動化しない理由は 2 つ。誤爆したときの被害が業務チャットでは
 * 大きすぎること、「拡張が勝手に発言した」が信用を一撃で壊すこと。
 *
 * @param {import('../core/types.js').ChatworkMessage} message 返信先
 * @param {Document} [doc]
 * @returns {boolean} 差し込めたら true
 */
export function insertReply(message, doc = document) {
  const tag = buildReplyTag(message);
  if (!tag) return false;

  // 検索結果やマイタスクなど、入力欄が無い画面もある。異常ではない。
  const input = doc.querySelector(SEL.chatInput);
  if (!input) return false;

  // 書きかけがあれば消さず、その前に差し込む。返信記法は先頭に無いと
  // Chatwork が返信として解釈しない。
  const draft = input.value || '';
  if (!setControlledValue(input, `${tag}${draft}`)) return false;

  input.focus();
  // 記法の直後 (本文を書き始める位置) にカーソルを置く。
  try {
    input.setSelectionRange(tag.length, tag.length);
  } catch {
    // 入力欄の型によっては選択範囲を扱えない。位置が合わないだけで実害はない。
  }
  return true;
}
