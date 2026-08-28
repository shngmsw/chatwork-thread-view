import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { startObserver } from '../../src/content/observer.js';

let stop;

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<div id="_timeLine"></div>';
  window.location.hash = '#!rid111';
});

afterEach(() => {
  if (stop) stop();
  stop = undefined;
  vi.useRealTimers();
});

describe('startObserver', () => {
  it('タイムラインへの追加で onChange が呼ばれる', async () => {
    const onChange = vi.fn();
    stop = startObserver({ onChange, onRoomChange: () => {}, debounceMs: 50 });

    document.getElementById('_timeLine').appendChild(document.createElement('div'));
    await Promise.resolve();
    vi.advanceTimersByTime(60);

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('連続した変更を 1 回にまとめる', async () => {
    const onChange = vi.fn();
    stop = startObserver({ onChange, onRoomChange: () => {}, debounceMs: 50 });

    const timeline = document.getElementById('_timeLine');
    for (let i = 0; i < 5; i += 1) {
      timeline.appendChild(document.createElement('div'));
    }
    await Promise.resolve();
    vi.advanceTimersByTime(60);

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('hashchange でルーム変更が通知される', () => {
    const onRoomChange = vi.fn();
    stop = startObserver({ onChange: () => {}, onRoomChange, debounceMs: 50 });

    window.location.hash = '#!rid222';
    window.dispatchEvent(new HashChangeEvent('hashchange'));

    expect(onRoomChange).toHaveBeenCalledWith('222');
  });

  it('同じルームへの hashchange では通知しない', () => {
    const onRoomChange = vi.fn();
    stop = startObserver({ onChange: () => {}, onRoomChange, debounceMs: 50 });

    window.dispatchEvent(new HashChangeEvent('hashchange'));

    expect(onRoomChange).not.toHaveBeenCalled();
  });

  it('停止後は onChange が呼ばれない', async () => {
    const onChange = vi.fn();
    stop = startObserver({ onChange, onRoomChange: () => {}, debounceMs: 50 });
    stop();
    stop = undefined;

    document.getElementById('_timeLine').appendChild(document.createElement('div'));
    await Promise.resolve();
    vi.advanceTimersByTime(60);

    expect(onChange).not.toHaveBeenCalled();
  });

  it('接続した時点で既に描画済みでも初回の onChange が呼ばれる', () => {
    // タイムラインが先に埋まっている状態で監視を開始する。
    // mutation は起きないので、connect() 自身が再解析を促さないと永久に更新されない。
    document.getElementById('_timeLine').innerHTML = '<div class="_message" data-mid="1"></div>';
    const onChange = vi.fn();
    stop = startObserver({ onChange, onRoomChange: () => {}, debounceMs: 50 });

    vi.advanceTimersByTime(60);

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('タイムライン要素が差し替わったら再接続して onChange を呼ぶ', () => {
    const onChange = vi.fn();
    stop = startObserver({ onChange, onRoomChange: () => {}, debounceMs: 50 });
    vi.advanceTimersByTime(60);
    onChange.mockClear();

    // Chatwork が #_timeLine ごと差し替えた状況を再現する。
    document.getElementById('_timeLine').remove();
    const fresh = document.createElement('div');
    fresh.id = '_timeLine';
    fresh.innerHTML = '<div class="_message" data-mid="9"></div>';
    document.body.appendChild(fresh);

    vi.advanceTimersByTime(1000); // 再接続チェックの間隔
    vi.advanceTimersByTime(60);   // デバウンス

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('デバウンス窓をまたぐ変更は 1 回にまとめる', async () => {
    // 同一 tick の連続変更は MutationObserver 自体がまとめてしまうため、
    // デバウンスの有無を区別するには窓をまたいで変更を起こす必要がある。
    const onChange = vi.fn();
    stop = startObserver({ onChange, onRoomChange: () => {}, debounceMs: 50 });
    vi.advanceTimersByTime(60); // 接続時の初回分
    onChange.mockClear();

    const timeline = document.getElementById('_timeLine');
    timeline.appendChild(document.createElement('div'));
    await Promise.resolve();
    vi.advanceTimersByTime(30);
    timeline.appendChild(document.createElement('div'));
    await Promise.resolve();
    vi.advanceTimersByTime(30);
    // 1 回目から 60ms 経つが再スケジュールされているのでまだ呼ばれない。
    // デバウンスしない実装ならここで既に 2 回呼ばれている。
    expect(onChange).toHaveBeenCalledTimes(0);

    vi.advanceTimersByTime(30);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('変更が途切れなくても最大待ち時間で必ず onChange が呼ばれる', async () => {
    // Chatwork がタイムラインを断続的に書き換え続けると、デバウンスだけの実装では
    // 再スケジュールが永久に続いて解析が一度も走らない (飢餓)。
    const onChange = vi.fn();
    stop = startObserver({ onChange, onRoomChange: () => {}, debounceMs: 50 });
    vi.advanceTimersByTime(60); // 接続時の初回分
    onChange.mockClear();

    const timeline = document.getElementById('_timeLine');
    for (let i = 0; i < 20; i += 1) {
      timeline.appendChild(document.createElement('div'));
      await Promise.resolve();
      vi.advanceTimersByTime(30); // デバウンス窓 (50ms) より短い間隔
    }

    expect(onChange).toHaveBeenCalled();
  });
});
