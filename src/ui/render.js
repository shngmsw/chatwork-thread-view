import { resolveName, MAX_NAME_LENGTH } from '../core/threadNames.js';

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

// アカウント ID から決まる色。同じ人はいつも同じ色になる。
// 彩度と明度を固定し、白文字とのコントラストを確保する。
function avatarColor(seed) {
  const key = String(seed || '');
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) % 360;
  }
  return `hsl(${hash}, 42%, 42%)`;
}

function initial(name) {
  const trimmed = (name || '').trim();
  return trimmed ? trimmed.slice(0, 1) : '?';
}

function buildAvatarBadge(message) {
  const node = el('div', 'avatar', initial(message.userName));
  node.style.background = avatarColor(message.accountId || message.userName);
  node.setAttribute('aria-hidden', 'true');
  return node;
}

/**
 * 本人のアイコン画像を出す。URL が取れないときだけ頭文字のバッジに落ちる。
 * バッジの色は accountId から決まるが、accountId は連続投稿で直前の送信者から
 * 継承する都合で取れたり取れなかったりするため、同じ人が別の色になることがある。
 * 画像が出せるならそちらが常に正しい。
 */
function buildAvatar(message) {
  if (!message.avatarUrl) return buildAvatarBadge(message);

  const img = el('img', 'avatar');
  img.src = message.avatarUrl;
  img.alt = '';
  img.decoding = 'async';
  img.setAttribute('aria-hidden', 'true');
  // CDN が落ちたり URL が古かったりしたときに、丸ごと消えて誰の発言か
  // 分からなくなるのを防ぐ。
  img.addEventListener(
    'error',
    () => {
      img.replaceWith(buildAvatarBadge(message));
    },
    { once: true }
  );
  return img;
}

// 開閉インジケータ。色は CSS のトークンから currentColor 経由で受け取る。
function buildChevron() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'thread__chevron');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', 'M6 3.5 L10.5 8 L6 12.5');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.6');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(path);
  return svg;
}

function stateMessage(text, modifier) {
  return el('div', modifier ? `state ${modifier}` : 'state', text);
}

function buildNode(node, onJump) {
  const row = el('div', 'node');
  row.dataset.role = 'node';
  row.dataset.messageId = node.message.id;
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
  // 入れ子構造そのものでインデントする。CSS のガイド線が各段の左端に乗る。
  // 深くなりすぎるとパネル幅を食うので 6 段で頭打ちにする。
  if (node.depth > 0 && node.depth <= 6) wrapper.style.marginLeft = '14px';
  wrapper.appendChild(row);
  for (const child of node.children) {
    wrapper.appendChild(buildNode(child, onJump));
  }
  return wrapper;
}

function buildCard(thread, onJump, openIds, onToggle, names, onRename) {
  const card = el('details', 'thread');
  card.dataset.role = 'thread';
  card.dataset.rootId = thread.rootId;
  // 再描画で DOM は作り直されるため、開閉状態は呼び出し側が持つ集合から復元する。
  if (openIds && openIds.has(thread.rootId)) card.open = true;
  card.addEventListener('toggle', () => onToggle(thread.rootId, card.open));

  const summary = el('summary', 'thread__summary');

  const resolved = resolveName(thread, names);

  const head = el('div', 'thread__head');
  head.append(
    el('span', 'thread__name', resolved ? resolved.name : thread.rootMessage.userName),
    el('span', 'thread__time', formatRelative(thread.updatedAt))
  );

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
      // 確定した時点で「編集中」の目印を外す。onRename は再描画を起こすが、
      // 呼び出し側は編集中の再描画を見送るため、外さないと結果が反映されない。
      input.dataset.role = 'rename-committed';
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

  const meta = el('div', 'thread__meta');
  meta.appendChild(el('span', 'thread__replies', `返信 ${thread.replyCount} 件`));
  // 名前をつけたら見出しの席は名前に譲り、送信者名はここへ降りる。
  if (resolved) meta.appendChild(el('span', 'thread__owner', thread.rootMessage.userName));
  if (thread.rootIsSynthetic) {
    meta.appendChild(el('span', 'thread__badge', '親メッセージ未読み込み'));
  }

  summary.append(
    buildAvatar(thread.rootMessage),
    head,
    buildChevron(),
    el('div', 'thread__preview', truncate(thread.rootMessage.body)),
    meta
  );

  card.appendChild(summary);
  card.appendChild(buildNode(thread.tree, onJump));
  return card;
}

/**
 * スレッド一覧を container に描画する。呼ぶたびに中身を作り直す。
 * @param {HTMLElement} container
 * @param {import('../core/types.js').Thread[]} threads
 * @param {{hideEmpty: boolean, onJump: (messageId: string) => void,
 *   openIds?: Set<string>, onToggle?: (rootId: string, open: boolean) => void,
 *   names?: import('../core/threadNames.js').NameItems|null,
 *   onRename?: (key: string, name: string) => void}} options
 */
export function renderThreads(container, threads, options) {
  const { hideEmpty, onJump, openIds = null, onToggle = () => {}, names = null,
    onRename = () => {} } = options;
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
    list.appendChild(buildCard(thread, onJump, openIds, onToggle, names, onRename));
  }
  container.appendChild(list);
}
