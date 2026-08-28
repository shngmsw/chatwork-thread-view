import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getMessageElements, getMessageElementById } from '../../src/content/selectors.js';
import { createScrapeContext, parseMessage, parseTimeline } from '../../src/content/scraper.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = readFileSync(resolve(here, '../fixtures/timeline.html'), 'utf8');

const PARENT_ID = '2141030437437706240';
const REPLY_ID = '2141035123569991680';
const CONSECUTIVE_ID = '2141041104525852672';
const DELETED_ID = '2141074034216284160';
const CROSS_ROOM_ID = '2141077809647722496';

beforeEach(() => {
  document.body.innerHTML = FIXTURE;
});

describe('selectors', () => {
  it('タイムライン内のメッセージ要素を DOM 順に返す', () => {
    const els = getMessageElements(document);
    expect(els.map((e) => e.getAttribute('data-mid'))).toEqual([
      PARENT_ID, REPLY_ID, CONSECUTIVE_ID, DELETED_ID, CROSS_ROOM_ID,
    ]);
  });

  it('メッセージ ID から要素を引ける', () => {
    expect(getMessageElementById(PARENT_ID, document)?.getAttribute('data-mid')).toBe(PARENT_ID);
  });

  it('数値以外の ID では null を返す', () => {
    expect(getMessageElementById('"]><script>', document)).toBeNull();
  });
});

describe('parseTimeline', () => {
  it('削除済みメッセージを除外する', () => {
    const ids = parseTimeline(getMessageElements(document)).map((m) => m.id);
    expect(ids).not.toContain(DELETED_ID);
    expect(ids).toHaveLength(4);
  });

  it('通常メッセージから全フィールドを取得する', () => {
    const m = parseTimeline(getMessageElements(document))[0];
    expect(m).toMatchObject({
      id: PARENT_ID,
      roomId: '211028552',
      accountId: '2227949',
      userName: '羽瀬 由理',
      avatarUrl: 'https://appdata.chatwork.com/avatar/aaa.rsz',
      body: '親メッセージの本文です。',
      replyToId: null,
      replyToRoomId: null,
      timestamp: 1786935026,
      index: 0,
    });
  });

  it('返信メッセージから親 ID と親ルーム ID を取得する', () => {
    const m = parseTimeline(getMessageElements(document))[1];
    expect(m.id).toBe(REPLY_ID);
    expect(m.replyToId).toBe(PARENT_ID);
    expect(m.replyToRoomId).toBe('211028552');
  });

  it('本文に返信チップの文言が混入しない', () => {
    const m = parseTimeline(getMessageElements(document))[1];
    expect(m.body).toBe('これは返信の本文です。');
    expect(m.body).not.toContain('返信元');
  });

  it('連続投稿では直前のメッセージから送信者を継承する', () => {
    const m = parseTimeline(getMessageElements(document))[2];
    expect(m.id).toBe(CONSECUTIVE_ID);
    expect(m.accountId).toBe('3261434');
    expect(m.userName).toBe('佐藤 太郎');
    expect(m.avatarUrl).toBe('https://appdata.chatwork.com/avatar/bbb.rsz');
  });

  it('別ルーム返信では replyToRoomId が自ルームと異なる', () => {
    const m = parseTimeline(getMessageElements(document))[3];
    expect(m.id).toBe(CROSS_ROOM_ID);
    expect(m.roomId).toBe('211028552');
    expect(m.replyToRoomId).toBe('999999999');
  });

  it('19 桁 ID を文字列のまま保持し精度を落とさない', () => {
    const m = parseTimeline(getMessageElements(document))[0];
    expect(typeof m.id).toBe('string');
    expect(m.id).toBe(PARENT_ID);
    expect(String(Number(m.id))).not.toBe(m.id);
  });
});

describe('parseMessage', () => {
  it('data-mid が無い要素では null を返す', () => {
    const el = document.createElement('div');
    expect(parseMessage(el, createScrapeContext(), 0)).toBeNull();
  });

  it('例外を投げず null を返す (壊れた要素)', () => {
    const broken = { getAttribute: () => { throw new Error('boom'); } };
    expect(parseMessage(broken, createScrapeContext(), 0)).toBeNull();
  });
});
