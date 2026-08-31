export const PANEL_CSS = `
:host {
  all: initial;
  display: block;
  height: 100%;
}
* { box-sizing: border-box; }

/*
 * 配色はトークンに集約する。テーマは panel[data-theme] で切り替える。
 * Chatwork 側のクラス名を CSS から直接見ないのは、DOM の知識を
 * selectors.js の 1 箇所に閉じるため。
 */
.panel {
  --bg: #ffffff;
  --surface: #ffffff;
  --surface-2: #f5f8f8;
  --surface-3: #eaf0f0;
  --border: #e3eaea;
  --border-strong: #cfdada;
  --text: #0e1a1b;
  --text-dim: #3f5254;
  --text-faint: #5c7275;
  --accent: #0f8a83;
  --accent-text: #0b6f69;
  --accent-weak: rgba(15, 138, 131, 0.10);
  --warn-bg: #fdf3e0;
  --warn-border: #e8d3a8;
  --warn-text: #8a5a0b;
  --shadow: 0 1px 2px rgba(16, 32, 33, 0.05);
  --shadow-lift: 0 2px 10px rgba(16, 32, 33, 0.10);
  --radius: 10px;
  --radius-sm: 7px;
  --ease: 140ms cubic-bezier(0.2, 0, 0.2, 1);

  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  border-left: 1px solid var(--border);
  font-family: -apple-system, "Segoe UI", "Hiragino Sans", "Meiryo", sans-serif;
  font-size: 14px;
  line-height: 1.7;
  color: var(--text);
}
.panel[data-theme="dark"] {
  --bg: #10151800;
  --surface: #171d21;
  --surface-2: #1c2429;
  --surface-3: #232c31;
  --border: #262f35;
  --border-strong: #35434a;
  --text: #e4ecee;
  --text-dim: #96a8ab;
  --text-faint: #7e9296;
  --accent: #34b6ab;
  --accent-text: #57c9bf;
  --accent-weak: rgba(52, 182, 171, 0.14);
  --warn-bg: #2c2416;
  --warn-border: #4c3d1d;
  --warn-text: #e0b968;
  --shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
  --shadow-lift: 0 2px 12px rgba(0, 0, 0, 0.5);
  background: #10151a;
}

/* ---- header ---- */
.panel__head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
  flex: 0 0 auto;
}
.panel__title {
  font-weight: 600;
  font-size: 13px;
  letter-spacing: 0.02em;
}
.panel__count {
  color: var(--accent-text);
  background: var(--accent-weak);
  font-size: 11px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  padding: 1px 7px;
  border-radius: 999px;
}
.panel__count:empty { display: none; }
.panel__spacer { flex: 1 1 auto; }
.panel__btn {
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-dim);
  border-radius: var(--radius-sm);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  padding: 3px 9px;
  transition: background var(--ease), color var(--ease), border-color var(--ease);
}
.panel__btn:hover {
  background: var(--surface-2);
  color: var(--text);
  border-color: var(--border);
}
.panel__btn[aria-pressed="true"] {
  background: var(--accent-weak);
  color: var(--accent-text);
  border-color: transparent;
}
.panel__btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

/* ---- body ---- */
.panel__body {
  flex: 1 1 auto;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 12px;
  scrollbar-width: thin;
  scrollbar-color: var(--border-strong) transparent;
}
.panel__body::-webkit-scrollbar { width: 10px; }
.panel__body::-webkit-scrollbar-track { background: transparent; }
.panel__body::-webkit-scrollbar-thumb {
  background: var(--border-strong);
  border-radius: 999px;
  border: 3px solid transparent;
  background-clip: content-box;
}
.panel__body::-webkit-scrollbar-thumb:hover { background-clip: padding-box; }

.panel__notice {
  flex: 0 0 auto;
  padding: 9px 14px;
  border-bottom: 1px solid var(--warn-border);
  background: var(--warn-bg);
  color: var(--warn-text);
  font-size: 12px;
}
.panel__notice[hidden] { display: none; }

.panel__grip {
  position: absolute;
  left: 0;
  top: 0;
  width: 6px;
  height: 100%;
  cursor: col-resize;
  transition: background var(--ease);
}
.panel__grip:hover { background: var(--accent-weak); }

.state {
  color: var(--text-faint);
  font-size: 12px;
  padding: 40px 12px;
  text-align: center;
}
.state--error { color: var(--warn-text); text-align: left; }

/* ---- closed / reopen ---- */
.panel__reopen {
  display: none;
  position: absolute;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 24px;
  height: 72px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid var(--border);
  border-right: none;
  border-radius: var(--radius) 0 0 var(--radius);
  background: var(--surface);
  color: var(--accent-text);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  box-shadow: var(--shadow-lift);
  transition: background var(--ease), color var(--ease);
}
.panel__reopen:hover { background: var(--surface-2); }
.panel__reopen:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.panel--closed { border-left: none; box-shadow: none; background: transparent; }
.panel--closed .panel__head,
.panel--closed .panel__body,
.panel--closed .panel__notice,
.panel--closed .panel__grip { display: none; }
.panel--closed .panel__reopen { display: flex; }

/* ---- thread cards ---- */
.thread-list { display: flex; flex-direction: column; gap: 8px; }
.thread {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  box-shadow: var(--shadow);
  overflow: hidden;
  transition: border-color var(--ease), box-shadow var(--ease);
}
.thread:hover { border-color: var(--border-strong); box-shadow: var(--shadow-lift); }
.thread[open] { border-color: var(--accent); }

.thread__summary {
  cursor: pointer;
  padding: 10px 12px 10px 10px;
  list-style: none;
  display: grid;
  grid-template-columns: 26px 1fr 14px;
  grid-template-areas: "avatar head chevron" ". preview ." ". meta .";
  column-gap: 9px;
  row-gap: 2px;
  align-items: start;
}
.thread__summary::-webkit-details-marker { display: none; }
.thread__summary:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }

.avatar {
  grid-area: avatar;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  color: #ffffff;
  user-select: none;
  flex: 0 0 auto;
  /* img と div の両方がこのクラスを使う。画像は円に切り抜く。 */
  object-fit: cover;
  background-color: var(--surface-3);
}
.thread__head {
  grid-area: head;
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}
.thread__name {
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.thread__time {
  color: var(--text-faint);
  font-size: 11px;
  white-space: nowrap;
  margin-left: auto;
  font-variant-numeric: tabular-nums;
}
.thread__rename {
  border: none;
  background: transparent;
  color: var(--text-faint);
  font: inherit;
  font-size: 11px;
  line-height: 1;
  padding: 2px 4px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  opacity: 0;
  transition: opacity var(--ease), color var(--ease), background var(--ease);
}
.thread__summary:hover .thread__rename,
.thread__rename:focus-visible { opacity: 1; }
.thread__rename:hover { color: var(--accent-text); background: var(--accent-weak); }
.thread__rename:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.thread__input {
  font: inherit;
  font-weight: 600;
  color: var(--text);
  background: var(--surface-2);
  border: 1px solid var(--accent);
  border-radius: var(--radius-sm);
  padding: 1px 6px;
  min-width: 0;
  flex: 1 1 auto;
}
.thread__input:focus { outline: none; }
.thread__preview {
  grid-area: preview;
  color: var(--text-dim);
  font-size: 13px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.thread__meta {
  grid-area: meta;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 3px;
  color: var(--text-faint);
  font-size: 11px;
}
.thread__replies {
  color: var(--accent-text);
  background: var(--accent-weak);
  border-radius: 999px;
  padding: 0 7px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.thread__owner {
  color: var(--text-dim);
  max-width: 10em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.thread__badge {
  color: var(--warn-text);
  background: var(--warn-bg);
  border: 1px solid var(--warn-border);
  border-radius: 999px;
  padding: 0 7px;
}
.thread__chevron {
  grid-area: chevron;
  width: 14px;
  height: 14px;
  margin-top: 5px;
  color: var(--text-faint);
  transition: transform var(--ease), color var(--ease);
  flex: 0 0 auto;
}
.thread[open] .thread__chevron { transform: rotate(90deg); color: var(--accent-text); }
.thread__summary:hover .thread__chevron { color: var(--text-dim); }

/* ---- tree ---- */
.thread > .node__wrap {
  border-top: 1px solid var(--border);
  background: var(--surface-2);
  padding: 4px 0;
}
.node__wrap { display: block; position: relative; }
/* 入れ子の階層に沿ってガイド線を引く。深さのインデントは JS 側で付ける。 */
.node__wrap .node__wrap::before {
  content: "";
  position: absolute;
  left: 0;
  top: 0;
  bottom: 6px;
  border-left: 1px solid var(--border-strong);
  opacity: 0.6;
}
.node {
  display: flex;
  gap: 8px;
  align-items: baseline;
  padding: 5px 12px;
  cursor: pointer;
  font-size: 13px;
  border-radius: var(--radius-sm);
  transition: background var(--ease);
}
.node:hover { background: var(--surface-3); }
.node:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.node__name {
  font-weight: 600;
  white-space: nowrap;
  color: var(--text);
  /* 縮ませない。縮むと「鈴…」のように 1 文字まで潰れて誰の発言か分からなくなる。
     長すぎる名前だけを max-width で省略する。 */
  flex: 0 0 auto;
  max-width: 7em;
  overflow: hidden;
  text-overflow: ellipsis;
}
.node__body {
  color: var(--text-dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1 1 auto;
}
.node__time {
  color: var(--text-faint);
  font-size: 11px;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

/* ---- diagnostic ---- */
.diagnostic {
  border: 1px solid var(--warn-border);
  background: var(--warn-bg);
  color: var(--warn-text);
  padding: 12px;
  border-radius: var(--radius);
  font-size: 12px;
}
.diagnostic__code {
  font-family: ui-monospace, Consolas, "Courier New", monospace;
  display: block;
  margin: 8px 0;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  background: rgba(0, 0, 0, 0.06);
  word-break: break-all;
}
.panel[data-theme="dark"] .diagnostic__code { background: rgba(0, 0, 0, 0.3); }

@media (prefers-reduced-motion: reduce) {
  .panel *, .panel *::before { transition: none !important; }
}
`;
