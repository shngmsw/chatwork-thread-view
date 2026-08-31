import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = readFileSync(resolve(here, '../fixtures/timeline.html'), 'utf8');

const REPLY_ID = '2141035123569991680';
const DIAGNOSTIC_TEXT = 'Chatwork の画面構造が変わった可能性があります。';

let main;

// main.js は読み込み時に boot() する。DOM を用意してから import する。
async function boot() {
  vi.resetModules();
  main = await import('../../src/content/main.js');
}

const panelText = () => main.getPanel().shadow.textContent;

beforeEach(() => {
  vi.useFakeTimers();
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  document.documentElement.className = '';
  window.location.hash = '#!rid211028552';
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  if (main) main.teardown();
  main = undefined;
  vi.useRealTimers();
  delete Element.prototype.scrollIntoView;
});

describe('健全性チェックの表示条件', () => {
  it('初回表示でメッセージが 0 件でも診断を出さない', async () => {
    document.body.innerHTML = '<div id="_timeLine"></div>';
    await boot();
    expect(panelText()).not.toContain(DIAGNOSTIC_TEXT);
    expect(panelText()).toContain('メッセージを読み込み中です');
  });

  it('一度も描画していない段階ではタイムラインが無くても診断を出さない', async () => {
    // Chatwork 本体の描画前に content script が走るとこの状態になる。
    // 起動直後に警告を出すと、正常な遅延を故障として見せてしまう。
    document.body.innerHTML = '';
    await boot();
    expect(panelText()).not.toContain(DIAGNOSTIC_TEXT);
  });

  it('起動時点で既に壊れている場合も、猶予を過ぎたら診断を出す', async () => {
    // セレクタが壊れると 1 件も描画できない。「描画に成功したか」を条件にすると
    // 故障そのものが条件の成立を妨げ、永久に報告されなくなる。
    document.body.innerHTML =
      '<div id="_renamedTimeLine"><div class="_msg" data-mid="1"></div></div>';
    await boot();
    expect(panelText()).not.toContain(DIAGNOSTIC_TEXT);

    vi.advanceTimersByTime(16000);
    main.refresh();

    expect(panelText()).toContain(DIAGNOSTIC_TEXT);
    expect(panelText()).toContain('timeline');
  });

  it('タイムラインに中身があるのに 1 件も拾えなければ診断を出す', async () => {
    // #_timeLine は残っているがメッセージ側のセレクタだけ壊れた状態。
    // 「投稿が無いだけのルーム」と区別できないと、この故障を見逃す。
    document.body.innerHTML =
      '<div id="_timeLine"><div class="_msg" data-mid="1"></div></div>';
    await boot();

    vi.advanceTimersByTime(16000);
    main.refresh();

    expect(panelText()).toContain(DIAGNOSTIC_TEXT);
    expect(panelText()).toContain('messages');
  });

  it('本当に投稿が無いルームでは、いくら待っても診断を出さない', async () => {
    document.body.innerHTML = '<div id="_timeLine"></div>';
    await boot();

    vi.advanceTimersByTime(120000);
    main.refresh();

    expect(panelText()).not.toContain(DIAGNOSTIC_TEXT);
    expect(panelText()).toContain('メッセージを読み込み中です');
  });

  it('一度描画したあとに DOM が壊れ、猶予を過ぎたら診断を出す', async () => {
    document.body.innerHTML = FIXTURE;
    await boot();
    expect(panelText()).not.toContain(DIAGNOSTIC_TEXT);

    document.getElementById('_timeLine').remove();
    main.refresh();
    // 壊れた直後はまだ出さない (ルーム切替の一瞬と区別がつかないため)。
    expect(panelText()).not.toContain(DIAGNOSTIC_TEXT);

    vi.advanceTimersByTime(16000);
    main.refresh();

    expect(panelText()).toContain(DIAGNOSTIC_TEXT);
    expect(panelText()).toContain('timeline');
  });

  it('ルーム切替でタイムラインごと差し替わる間は診断を出さない', async () => {
    document.body.innerHTML = FIXTURE;
    await boot();

    // 切替の瞬間はタイムライン要素そのものが一時的に居なくなる。
    document.getElementById('_timeLine').remove();
    vi.advanceTimersByTime(1200);
    main.refresh();
    expect(panelText()).not.toContain(DIAGNOSTIC_TEXT);

    // 新しいタイムラインが入れば回復し、以降も出ない。
    document.body.innerHTML = FIXTURE;
    main.refresh();
    vi.advanceTimersByTime(60000);
    main.refresh();
    expect(panelText()).not.toContain(DIAGNOSTIC_TEXT);
  });

  it('ルーム切替直後にメッセージが 0 件でも診断を出さない', async () => {
    document.body.innerHTML = FIXTURE;
    await boot();

    // 切替先のタイムラインはまだ空。これは故障ではない。
    document.getElementById('_timeLine').innerHTML = '';
    main.refresh();

    expect(panelText()).not.toContain(DIAGNOSTIC_TEXT);
  });
});

describe('未読み込みメッセージの通知', () => {
  it('通知は本文の再描画で消えない', async () => {
    document.body.innerHTML = FIXTURE;
    await boot();

    // ジャンプ先だけタイムラインから消えた状態を作る。
    document.getElementById(`_messageId${REPLY_ID}`).remove();
    main
      .getPanel()
      .shadow.querySelector(`[data-role="node"][data-message-id="${REPLY_ID}"] [data-role="jump"]`)
      .click();
    expect(panelText()).toContain('まだ読み込まれていません');

    // 監視由来の再描画が通知を巻き添えにしないこと。
    main.refresh();
    expect(panelText()).toContain('まだ読み込まれていません');
  });
});

describe('ツールバーのアイコンからの開閉', () => {
  it('開閉メッセージでパネルが開閉する', async () => {
    document.body.innerHTML = FIXTURE;
    await boot();

    // service worker からのメッセージを受ける口を、偽の runtime で差し込む。
    const listeners = [];
    main.listenForToggle({ onMessage: { addListener: (fn) => listeners.push(fn) } });
    expect(listeners).toHaveLength(1);

    const send = (type) => listeners[0]({ type });
    const opened = main.getPanel().isOpen();

    send('ctv:toggle-panel');
    expect(main.getPanel().isOpen()).toBe(!opened);

    send('ctv:toggle-panel');
    expect(main.getPanel().isOpen()).toBe(opened);
  });

  it('知らない種類のメッセージでは何も起きない', async () => {
    document.body.innerHTML = FIXTURE;
    await boot();

    const listeners = [];
    main.listenForToggle({ onMessage: { addListener: (fn) => listeners.push(fn) } });
    const before = main.getPanel().isOpen();

    listeners[0]({ type: 'ctv:something-else' });
    listeners[0](null);

    expect(main.getPanel().isOpen()).toBe(before);
  });

  it('runtime が無い環境では登録しない', async () => {
    document.body.innerHTML = FIXTURE;
    await boot();
    expect(() => main.listenForToggle(null)).not.toThrow();
    expect(() => main.listenForToggle({})).not.toThrow();
  });
});

describe('スレッド名の編集', () => {
  const shadowOf = () => main.getPanel().shadow;

  it('編集中の再描画で入力欄と書きかけの内容を壊さない', async () => {
    document.body.innerHTML = FIXTURE;
    await boot();
    shadowOf().querySelector('[data-role="rename"]').click();
    const input = shadowOf().querySelector('[data-role="rename-input"]');
    input.value = '書きかけの名前';

    // Chatwork の新着で observer が走った状況。
    main.refresh();

    expect(shadowOf().querySelector('[data-role="rename-input"]')).toBe(input);
    expect(input.value).toBe('書きかけの名前');
  });

  it('確定するとカード見出しに名前が出る', async () => {
    document.body.innerHTML = FIXTURE;
    await boot();
    shadowOf().querySelector('[data-role="rename"]').click();
    const input = shadowOf().querySelector('[data-role="rename-input"]');
    input.value = '請求書フォーマットの件';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(shadowOf().querySelector('.thread__name').textContent).toBe('請求書フォーマットの件');
  });
});

describe('返信ノードの全文展開', () => {
  it('展開した状態は再描画をまたいで残る', async () => {
    document.body.innerHTML = FIXTURE;
    await boot();
    const nodeOf = () =>
      main.getPanel().shadow.querySelector(`[data-role="node"][data-message-id="${REPLY_ID}"]`);

    nodeOf().click();
    expect(nodeOf().classList.contains('node--open')).toBe(true);

    main.refresh();
    expect(nodeOf().classList.contains('node--open')).toBe(true);
  });
});

describe('パネルからの返信', () => {
  const replyBtn = () =>
    main
      .getPanel()
      .shadow.querySelector(`[data-role="node"][data-message-id="${REPLY_ID}"] [data-role="reply"]`);

  it('返信ボタンで Chatwork の入力欄に返信記法が入る', async () => {
    document.body.innerHTML = `${FIXTURE}<textarea id="_chatText"></textarea>`;
    await boot();

    replyBtn().click();

    const input = document.getElementById('_chatText');
    expect(input.value).toMatch(new RegExp(`^\\[rp aid=\\d+ to=\\d+-${REPLY_ID}\\]`));
    expect(document.activeElement).toBe(input);
  });

  it('入力欄が無ければ通知を出す', async () => {
    document.body.innerHTML = FIXTURE;
    await boot();

    replyBtn().click();

    expect(panelText()).toContain('返信できませんでした');
  });
});
