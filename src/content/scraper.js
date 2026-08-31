import { SEL, UNKNOWN_NAME } from './selectors.js';

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
 * 返信チップの内側を除いて、最初に一致した要素を返す。
 *
 * チップには「返信先ユーザー」のアイコン・名前・data-aid が入っている。
 * 連続投稿では送信者ブロック (_speaker) ごと省略されるため、除外しないと
 * チップ内の返信先ユーザーがメッセージ内で唯一の候補になり、送信者として
 * 採用されてしまう。本文と同じく、送信者情報もチップを見てはいけない。
 */
function querySender(el, selector) {
  for (const found of el.querySelectorAll(selector)) {
    if (!found.closest(SEL.replyChip)) return found;
  }
  return null;
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

    // 送信者を指す要素はいずれも返信チップの外から取る (querySender)。
    let accountId = querySender(el, SEL.profileIcon)?.getAttribute('data-aid') || '';
    if (!accountId) {
      const avatarNode = querySender(el, SEL.avatarAidClass);
      const matched = avatarNode && AVATAR_AID.exec(avatarNode.getAttribute('class') || '');
      if (matched) accountId = matched[1];
    }
    if (!accountId) accountId = prevAccountId;

    const sameSenderAsPrev = Boolean(accountId) && accountId === prevAccountId;

    const avatarEl = querySender(el, SEL.avatar);
    let userName =
      textOf(querySender(el, SEL.userName)) ||
      (avatarEl?.getAttribute('alt') || '').trim();
    if (userName) {
      if (accountId) ctx.nameByAid.set(accountId, userName);
    } else {
      userName =
        (accountId && ctx.nameByAid.get(accountId)) ||
        (sameSenderAsPrev ? ctx.lastUserName : '') ||
        UNKNOWN_NAME;
    }

    const avatarUrl =
      avatarEl?.getAttribute('src') ||
      (sameSenderAsPrev ? ctx.lastAvatarUrl : '') ||
      '';

    const tmAttr = querySender(el, SEL.timeStamp)?.getAttribute('data-tm');
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
