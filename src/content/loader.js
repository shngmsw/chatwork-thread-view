// MV3 の content_scripts は ES Module を直接ロードできない。
// classic script として注入し、ここから ESM エントリを動的 import する。
(() => {
  const url = chrome.runtime.getURL('src/content/main.js');
  import(url).catch((error) => {
    console.error('[ctv] failed to load main module', error);
  });
})();
