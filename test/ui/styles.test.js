import { describe, it, expect } from 'vitest';
import { PANEL_CSS } from '../../src/ui/styles.js';

/** `セレクタ {` から最初の `}` までを取り出す。 */
function block(selector) {
  const start = PANEL_CSS.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`ブロックが見つからない: ${selector}`);
  const end = PANEL_CSS.indexOf('}', start);
  return PANEL_CSS.slice(start, end);
}

function tokenOf(selector, name) {
  const matched = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})`).exec(block(selector));
  if (!matched) throw new Error(`トークンが見つからない: --${name} in ${selector}`);
  return matched[1];
}

/** WCAG 2.x の相対輝度。 */
function luminance(hex) {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(fg, bg) {
  const a = luminance(fg);
  const b = luminance(bg);
  const [light, dark] = a > b ? [a, b] : [b, a];
  return (light + 0.05) / (dark + 0.05);
}

const LIGHT = '.panel';
const DARK = '.panel[data-theme="dark"]';

// 本文プレビューと返信ノードの本文は --text-dim、時刻や補足は --text-faint。
// どちらもカード (--surface) とツリー (--surface-2) の上に乗る。
describe.each([
  ['ライトテーマ', LIGHT],
  ['ダークテーマ', DARK],
])('%s の文字コントラスト', (_label, selector) => {
  it.each([
    ['text-dim', 'surface'],
    ['text-dim', 'surface-2'],
    ['text-faint', 'surface'],
    ['text-faint', 'surface-2'],
  ])('--%s は --%s の上で 4.5:1 以上', (fg, bg) => {
    const ratio = contrast(tokenOf(selector, fg), tokenOf(selector, bg));
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});

describe('フォント指定', () => {
  // Windows では Hiragino が無く游ゴシック Regular に落ちる。小さい字で細く滲む。
  it('游ゴシックへ落ちない', () => {
    expect(PANEL_CSS).not.toContain('Yu Gothic');
  });

  // macOS で意図的に字を細らせる指定。読みづらさの訴えに対して逆行する。
  it('font-smoothing で字を細らせない', () => {
    expect(PANEL_CSS).not.toContain('-webkit-font-smoothing');
  });
});
