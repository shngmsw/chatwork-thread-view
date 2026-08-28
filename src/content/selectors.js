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
