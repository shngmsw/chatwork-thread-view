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

function buildCard(thread, onJump, openIds, onToggle) {
  const card = el('details', 'thread');
  card.dataset.role = 'thread';
  card.dataset.rootId = thread.rootId;
  // 再描画で DOM は作り直されるため、開閉状態は呼び出し側が持つ集合から復元する。
  if (openIds && openIds.has(thread.rootId)) card.open = true;
  card.addEventListener('toggle', () => onToggle(thread.rootId, card.open));

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
 * @param {{hideEmpty: boolean, onJump: (messageId: string) => void,
 *   openIds?: Set<string>, onToggle?: (rootId: string, open: boolean) => void}} options
 */
export function renderThreads(container, threads, options) {
  const { hideEmpty, onJump, openIds = null, onToggle = () => {} } = options;
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
    list.appendChild(buildCard(thread, onJump, openIds, onToggle));
  }
  container.appendChild(list);
}
