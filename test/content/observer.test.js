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
});
