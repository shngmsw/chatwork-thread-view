// 拡張内部でやり取りするメッセージの種類。
// service worker (src/background.js) と content script (src/content/main.js) の
// 両方から参照するので、綴りをここ 1 箇所に置く。
export const TOGGLE_PANEL = 'ctv:toggle-panel';
