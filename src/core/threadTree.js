/**
 * 返信関係からスレッドツリーを構築する純関数。DOM に触れない。
 * @param {import('./types.js').ChatworkMessage[]} messages
 * @returns {import('./types.js').Thread[]}
 */
export function buildThreads(messages) {
  const byId = new Map();
  for (const m of messages) byId.set(m.id, m);

  /**
   * 起点メッセージの ID を求める。
   * 循環を検出した場合は、循環に含まれる ID のうち辞書順最小を root とする。
   * こうすると循環内のどのメッセージから辿っても同じ root に収束し、
   * root 自身が必ずそのグループの一員になる。
   */
  function findRoot(startId) {
    const seen = new Set();
    const path = [];
    let cur = byId.get(startId);
    if (!cur) return startId;
    for (;;) {
      if (seen.has(cur.id)) {
        const cycle = path.slice(path.indexOf(cur.id));
        return cycle.reduce((a, b) => (a < b ? a : b));
      }
      seen.add(cur.id);
      path.push(cur.id);
      if (!cur.replyToId) return cur.id;
      if (cur.replyToRoomId !== cur.roomId) return cur.id;
      const parent = byId.get(cur.replyToId);
      if (!parent) return cur.id;
      cur = parent;
    }
  }

  const groups = new Map();
  for (const m of messages) {
    const rootId = findRoot(m.id);
    let group = groups.get(rootId);
    if (!group) {
      group = [];
      groups.set(rootId, group);
    }
    group.push(m);
  }

  const threads = [];
  for (const [rootId, members] of groups) {
    const nodes = new Map();
    for (const m of members) {
      nodes.set(m.id, { message: m, children: [], depth: 0 });
    }
    const rootNode = nodes.get(rootId);

    for (const m of members) {
      if (m.id === rootId) continue;
      const parent = (m.replyToId && nodes.get(m.replyToId)) || rootNode;
      parent.children.push(nodes.get(m.id));
    }

    assignDepthAndSort(rootNode, 0);

    let updatedAt = 0;
    for (const m of members) {
      if (m.timestamp > updatedAt) updatedAt = m.timestamp;
    }

    threads.push({
      rootId,
      rootMessage: rootNode.message,
      tree: rootNode,
      replyCount: members.length - 1,
      updatedAt,
      rootIsSynthetic: Boolean(rootNode.message.replyToId),
    });
  }

  threads.sort(
    (a, b) => b.updatedAt - a.updatedAt || (a.rootId < b.rootId ? -1 : 1)
  );
  return threads;
}

function assignDepthAndSort(node, depth) {
  node.depth = depth;
  node.children.sort(
    (a, b) =>
      a.message.timestamp - b.message.timestamp ||
      a.message.index - b.message.index
  );
  for (const child of node.children) {
    assignDepthAndSort(child, depth + 1);
  }
}
