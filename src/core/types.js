/**
 * @typedef {Object} ChatworkMessage
 * @property {string} id            メッセージ ID (data-mid)。文字列のまま扱う
 * @property {string} roomId        ルーム ID (data-rid)
 * @property {string} accountId     送信者アカウント ID
 * @property {string} userName      送信者表示名
 * @property {string} avatarUrl     アバター画像 URL
 * @property {string} body          本文 (返信チップのテキストを除去済み)
 * @property {string|null} replyToId      親メッセージ ID
 * @property {string|null} replyToRoomId  親メッセージのルーム ID
 * @property {number} timestamp     投稿時刻 (UNIX 秒)
 * @property {number} index         タイムライン上の並び順
 */

/**
 * @typedef {Object} ThreadNode
 * @property {ChatworkMessage} message
 * @property {ThreadNode[]} children
 * @property {number} depth
 */

/**
 * @typedef {Object} Thread
 * @property {string} rootId
 * @property {ChatworkMessage} rootMessage
 * @property {ThreadNode} tree
 * @property {number} replyCount
 * @property {number} updatedAt
 * @property {boolean} rootIsSynthetic
 */

export {};
