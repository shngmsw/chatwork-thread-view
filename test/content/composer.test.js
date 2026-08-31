import { describe, it, expect, beforeEach, vi } from 'vitest';
import { insertReply } from '../../src/content/composer.js';

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

const TAG = '[rp aid=1234567 to=98765432-1122334455] 山田太郎さん\n';

let input;
beforeEach(() => {
  document.body.innerHTML = '<textarea id="_chatText"></textarea>';
  input = document.getElementById('_chatText');
});

describe('insertReply', () => {
  it('入力欄に返信記法を入れる', () => {
    expect(insertReply(msg(), document)).toBe(true);
    expect(input.value).toBe(TAG);
  });

  // Chatwork の入力欄は React 制御下にある。value を書き換えるだけでは
  // React の内部 state が更新されず、送信しても空が飛ぶ。
  it('input イベントを発火して React に変更を知らせる', () => {
    const seen = [];
    input.addEventListener('input', (event) => seen.push(event.bubbles));
    insertReply(msg(), document);
    expect(seen).toEqual([true]);
  });

  it('入力欄にフォーカスし、カーソルを末尾に置く', () => {
    insertReply(msg(), document);
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(TAG.length);
    expect(input.selectionEnd).toBe(TAG.length);
  });

  // 書きかけを消すと、拡張が原因で文章を失ったように見える。絶対に潰さない。
  it('書きかけの下書きを潰さず、その前に差し込む', () => {
    input.value = '書きかけの本文';
    expect(insertReply(msg(), document)).toBe(true);
    expect(input.value).toBe(`${TAG}書きかけの本文`);
  });

  it('末尾が改行で終わる下書きでも改行を増やさない', () => {
    input.value = '書きかけ\n';
    insertReply(msg(), document);
    expect(input.value).toBe(`${TAG}書きかけ\n`);
  });

  it('入力欄が無ければ false を返す', () => {
    document.body.innerHTML = '';
    expect(insertReply(msg(), document)).toBe(false);
  });

  it('返信記法を組み立てられなければ false を返し、入力欄を触らない', () => {
    input.value = '書きかけ';
    expect(insertReply(msg({ accountId: '' }), document)).toBe(false);
    expect(input.value).toBe('書きかけ');
  });

  // 送信は必ず利用者に押させる。誤爆の被害が業務チャットでは大きすぎる。
  it('送信ボタンを押さない', () => {
    const send = document.createElement('button');
    send.setAttribute('data-testid', 'timeline_send-message-button');
    const clicked = vi.fn();
    send.addEventListener('click', clicked);
    document.body.appendChild(send);

    insertReply(msg(), document);

    expect(clicked).not.toHaveBeenCalled();
  });
});
