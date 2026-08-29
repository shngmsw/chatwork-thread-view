import { TOGGLE_PANEL } from './core/messages.js';

// ツールバーのアイコンが押されたら、そのタブのパネルを開閉する。
// ここでやるのはメッセージを 1 通送ることだけ。解析も保存も通信もしない。
chrome.action.onClicked.addListener((tab) => {
  if (!tab || typeof tab.id !== 'number') return;
  // Chatwork 以外のタブには content script が居ないので届かない。
  // それは異常ではないので、握りつぶして何もしない。
  chrome.tabs.sendMessage(tab.id, { type: TOGGLE_PANEL }).catch(() => {});
});
