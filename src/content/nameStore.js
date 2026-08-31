import { putName, rekeyName } from '../core/threadNames.js';

const KEY_PREFIX = 'names:';
const SCHEMA_VERSION = 1;
const WRITE_DEBOUNCE_MS = 300;

/**
 * ルームごとに 1 アイテム。スレッド 1 件 1 アイテムにするとアイテム数が
 * すぐ数千に達し、将来 chrome.storage.sync (512 アイテム上限) へ移せなくなる。
 * @param {string} roomId
 */
export function storageKey(roomId) {
  return `${KEY_PREFIX}${roomId}`;
}

function defaultStorage() {
  try {
    return chrome.storage.local;
  } catch {
    return null;
  }
}

/**
 * 名前の読み書きを担う。ストレージの形式を知っているのはこのファイルだけ。
 * @param {{get: Function, set: Function}|null} [storage]
 * @param {number} [debounceMs]
 */
export function createNameStore(storage = defaultStorage(), debounceMs = WRITE_DEBOUNCE_MS) {
  let roomId = null;
  let items = {};
  let timer = null;
  let dirty = false;

  async function write() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (!dirty || !roomId || !storage) return;
    const key = storageKey(roomId);
    const payload = { v: SCHEMA_VERSION, items };
    dirty = false;
    try {
      await storage.set({ [key]: payload });
    } catch {
      // 保存できなくても表示は続ける。次の変更でまた試みる。
    }
  }

  function schedule() {
    dirty = true;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => { write(); }, debounceMs);
  }

  return {
    async load(nextRoomId) {
      // 切り替える前に前ルームの保留を吐き出す。残したまま roomId を差し替えると
      // 新ルームのキーへ前ルームの名前を書き込む事故になる。
      await write();
      roomId = nextRoomId;
      items = {};
      if (!roomId || !storage) return items;
      try {
        const stored = await storage.get(storageKey(roomId));
        const record = stored && stored[storageKey(roomId)];
        if (record && record.v === SCHEMA_VERSION && record.items) items = record.items;
      } catch {
        items = {};
      }
      return items;
    },

    getItems() {
      return items;
    },

    setName(rootId, name, by) {
      items = putName(items, rootId, name, by);
      schedule();
      return items;
    },

    rekey(fromId, toId) {
      const next = rekeyName(items, fromId, toId);
      if (next === items) return;
      items = next;
      schedule();
    },

    flush() {
      return write();
    },

    stop() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
