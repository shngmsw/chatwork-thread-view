import { SEL, UNKNOWN_NAME } from './selectors.js';

/**
 * jsdom は innerText を実装しないため textContent を使う。
 * ノーブレークスペースは通常の空白に寄せてから trim する。
 */
function textOf(el) {
  if (!el) return '';
  return (el.textContent || '').replace(/\u00a0/g, ' ').trim();
}

/**
 * 本文 (pre) の外側で最初に一致した要素を返す。
 *
 * 送信者名はヘッダにあり、本文の中には入らない。一方、メンション・タスク・
 * 返信チップといった「別人を指す要素」はすべて本文の内側にある。
 * この境界で絞ると、別人の名前を送信者名として拾わずに済む。
 */
function queryHeader(el, selector) {
  for (const found of el.querySelectorAll(selector)) {
    if (!found.closest(SEL.body)) return found;
  }
  return null;
}

/**
 * 連続投稿では送信者情報が DOM から省略される。直前の解析結果を持ち回るための状態。
 *
 * 名前もアイコンも「直前の 1 件」ではなくアカウント ID ごとに持つ。直前の 1 件で
 * 持つと、アイコンを取れない送信者を挟んだときに別人のアイコンが引き継がれる。
 * @returns {{nameByAid: Map<string,string>, avatarByAid: Map<string,string>,
 *   lastAccountId: string, lastUserName: string}}
 */
export function createScrapeContext() {
  return {
    nameByAid: new Map(),
    avatarByAid: new Map(),
    lastAccountId: '',
    lastUserName: '',
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

    // 送信者は _speaker の内側からだけ取る。本文にはメンションやタスクの
    // 別人のアバターが入っており、限定しないとそれを送信者と取り違える。
    let accountId = el.querySelector(SEL.senderAid)?.getAttribute('data-aid') || '';
    if (!accountId) accountId = prevAccountId;

    const sameSenderAsPrev = Boolean(accountId) && accountId === prevAccountId;

    const avatarEl = el.querySelector(SEL.avatar);
    let userName =
      textOf(queryHeader(el, SEL.userName)) ||
      (avatarEl?.getAttribute('alt') || '').trim();
    if (userName) {
      if (accountId) ctx.nameByAid.set(accountId, userName);
    } else {
      userName =
        (accountId && ctx.nameByAid.get(accountId)) ||
        (sameSenderAsPrev ? ctx.lastUserName : '') ||
        UNKNOWN_NAME;
    }

    // アイコンはアカウント ID に紐づけて覚える。連続投稿で DOM から消えても、
    // 同じアカウントの過去の投稿から引ける。取れなければバッジに落とす。
    const scrapedAvatar = avatarEl?.getAttribute('src') || '';
    if (scrapedAvatar && accountId) ctx.avatarByAid.set(accountId, scrapedAvatar);
    const avatarUrl =
      scrapedAvatar || (accountId && ctx.avatarByAid.get(accountId)) || '';

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
