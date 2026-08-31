import { describe, it, expect } from 'vitest';
import { buildReplyTag } from '../../src/content/replyTag.js';

const msg = (opts = {}) => ({
  id: '1122334455',
  roomId: '98765432',
  accountId: '1234567',
  userName: '山田太郎',
  avatarUrl: '',
  body: '本文',
  replyToId: null,
  replyToRoomId: null,
  timestamp: 1000,
  index: 0,
  ...opts,
});

describe('buildReplyTag', () => {
  it('Chatwork の返信記法を組み立てる', () => {
    expect(buildReplyTag(msg())).toBe(
      '[rp aid=1234567 to=98765432-1122334455] 山田太郎さん\n'
    );
  });

  // 送信者名は連投の継承に失敗すると「不明」になる。そのまま「不明さん」と
  // 書くと相手に失礼なので、名前が取れないときは記法だけを置く。
  it('送信者名が不明なら名前を付けない', () => {
    expect(buildReplyTag(msg({ userName: '不明' }))).toBe(
      '[rp aid=1234567 to=98765432-1122334455]\n'
    );
    expect(buildReplyTag(msg({ userName: '' }))).toBe(
      '[rp aid=1234567 to=98765432-1122334455]\n'
    );
  });

  // aid が欠けた記法を送ると Chatwork 上で壊れた文字列がそのまま投稿される。
  it('必要な ID が欠けていたら null を返す', () => {
    expect(buildReplyTag(msg({ accountId: '' }))).toBeNull();
    expect(buildReplyTag(msg({ roomId: '' }))).toBeNull();
    expect(buildReplyTag(msg({ id: '' }))).toBeNull();
    expect(buildReplyTag(null)).toBeNull();
  });

  // ID は 19 桁前後の数値文字列。数値化も含め、想定外の値を記法に混ぜない。
  it('ID が数値文字列でなければ null を返す', () => {
    expect(buildReplyTag(msg({ accountId: '12a' }))).toBeNull();
    expect(buildReplyTag(msg({ id: '11] [rp aid=9' }))).toBeNull();
  });
});
