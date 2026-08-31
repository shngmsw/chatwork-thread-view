/**
 * Chatwork の DOM に対する依存を集約したモジュール。
 * 依存してよいのは `_` 接頭辞クラス / data-* / data-testid のみ。
 * styled-components の生成クラス (sc-*, cqwzsM 等) には決して依存しない。
 * 2026-08-31 に Chatwork Web の実機 DOM で確認した。
 *
 * 送信者を指すセレクタは必ず _speaker の内側に限定する。
 * メッセージ本文にはメンションやタスクに紐づく「別人」のアバターが入り、
 * それらも img.userIconImage や button._profileUserIcon[data-aid] を持つ。
 * 限定しないと、連続投稿 (_speaker が省略される) で別人を送信者と取り違える。
 */
export const SEL = {
  timeline: '#_timeLine',
  message: '._message[data-mid]',
  replyChip: '._replyMessage',
  speaker: '._speaker',
  // 送信者のアカウント ID。_speaker > button > div[data-testid="user-icon"] にある。
  // この button に _profileUserIcon クラスは付かない (付くのは本文側の別人)。
  senderAid: '._speaker [data-aid]',
  // 送信者名は _speaker の外にある。1 メッセージに 1 つだけ。
  userName: '[data-testid="timeline_user-name"]',
  avatar: '._speaker img',
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

// scraper.js が送信者を特定できなかったときに入れる名前。
// scraper.js とここで別々に持つと、片方を変えたとき健全性チェックが
// 黙って無効になるので、この 1 箇所を共有する。
export const UNKNOWN_NAME = '不明';

// 送信者名の解決率を見るのに必要な最小件数。
// 読み込み窓が数件しかない瞬間は連投継続が混ざるだけで比率が振れるため。
const NAME_CHECK_MIN_SAMPLE = 5;

/**
 * セレクタが今も Chatwork の DOM に噛み合っているかを検査する。
 * 失敗した項目名の配列を返し、利用者への診断情報として使う。
 * @param {import('../core/types.js').ChatworkMessage[]} messages
 * @param {Document} [doc]
 * @returns {{ok: boolean, failures: string[], timelineChildCount: number}}
 */
export function runHealthCheck(messages, doc = document) {
  const failures = [];

  const timeline = getTimeline(doc);
  if (!timeline) failures.push('timeline');
  if (getMessageElements(doc).length === 0) failures.push('messages');

  if (messages.length >= NAME_CHECK_MIN_SAMPLE) {
    const resolved = messages.filter(
      (m) => m.userName && m.userName !== UNKNOWN_NAME
    ).length;
    if (resolved / messages.length < 0.5) failures.push('userName');
  }

  // 「まだ読めていない空のルーム」と「セレクタが噛み合わなくなった」の
  // 区別に使う。中身が詰まっているのに 1 件も拾えないなら後者。
  return {
    ok: failures.length === 0,
    failures,
    timelineChildCount: timeline ? timeline.children.length : 0,
  };
}

/**
 * Chatwork 側が今どちらのテーマで表示しているかを返す。
 * パネルの配色を本体に合わせるために使う。Chatwork のクラス名に触れる
 * 唯一の場所をここに閉じ、UI 側は自前の data-theme だけを見る。
 * @param {Document} [doc]
 * @returns {'dark'|'light'}
 */
export function getHostTheme(doc = document) {
  const root = doc.documentElement;
  if (root && root.classList.contains('dark')) return 'dark';
  if (root && root.classList.contains('light')) return 'light';
  const mq = doc.defaultView && doc.defaultView.matchMedia;
  if (mq && doc.defaultView.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

/**
 * Chatwork のテーマ切替を監視する。
 * @param {(theme: 'dark'|'light') => void} onChange
 * @param {Document} [doc]
 * @returns {() => void} 監視を止める関数
 */
export function watchHostTheme(onChange, doc = document) {
  let current = getHostTheme(doc);
  const observer = new MutationObserver(() => {
    const next = getHostTheme(doc);
    if (next === current) return;
    current = next;
    onChange(next);
  });
  observer.observe(doc.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
  });
  return () => observer.disconnect();
}
