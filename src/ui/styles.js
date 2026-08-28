export const PANEL_CSS = `
:host {
  all: initial;
  display: block;
  height: 100%;
}
* { box-sizing: border-box; }
.panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #ffffff;
  border-left: 1px solid #d2dcdc;
  box-shadow: -2px 0 10px rgba(0, 0, 0, 0.08);
  font-family: "Hiragino Sans", "Yu Gothic", system-ui, sans-serif;
  font-size: 13px;
  line-height: 1.7;
  color: #101819;
}
.panel__head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid #d2dcdc;
  background: #f4f7f7;
  flex: 0 0 auto;
}
.panel__title { font-weight: 700; font-size: 13px; }
.panel__count { color: #5b6e70; font-size: 12px; }
.panel__spacer { flex: 1 1 auto; }
.panel__btn {
  border: 1px solid #d2dcdc;
  background: #ffffff;
  color: #33474a;
  border-radius: 3px;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  padding: 2px 8px;
}
.panel__btn:hover { background: #edf1f1; }
.panel__btn:focus-visible { outline: 2px solid #0c6b6b; outline-offset: 1px; }
.panel__body {
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 10px;
}
.panel__notice {
  flex: 0 0 auto;
  padding: 8px 12px;
  border-bottom: 1px solid #e5d3b0;
  background: #f7ecd8;
  color: #8a5a0b;
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
}
.panel__grip:hover { background: rgba(12, 107, 107, 0.18); }
.state {
  color: #5b6e70;
  font-size: 12px;
  padding: 16px 8px;
  text-align: center;
}
.state--error { color: #8a5a0b; text-align: left; }
.panel__reopen {
  display: none;
  position: absolute;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 22px;
  height: 64px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid #d2dcdc;
  border-right: none;
  border-radius: 4px 0 0 4px;
  background: #ffffff;
  color: #0c6b6b;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  box-shadow: -2px 0 6px rgba(0, 0, 0, 0.08);
}
.panel__reopen:hover { background: #edf1f1; }
.panel__reopen:focus-visible { outline: 2px solid #0c6b6b; outline-offset: 1px; }
.panel--closed { border-left: none; box-shadow: none; background: transparent; }
.panel--closed .panel__head,
.panel--closed .panel__body,
.panel--closed .panel__notice,
.panel--closed .panel__grip { display: none; }
.panel--closed .panel__reopen { display: flex; }
.thread-list { display: flex; flex-direction: column; gap: 8px; }
.thread {
  border: 1px solid #d2dcdc;
  border-radius: 4px;
  background: #ffffff;
  overflow: hidden;
}
.thread[open] { border-color: #0c6b6b; }
.thread__summary { cursor: pointer; padding: 8px 10px; list-style: none; }
.thread__summary::-webkit-details-marker { display: none; }
.thread__summary:focus-visible { outline: 2px solid #0c6b6b; outline-offset: -2px; }
.thread__name { font-weight: 700; margin-right: 6px; }
.thread__preview { color: #33474a; }
.thread__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 4px;
  color: #5b6e70;
  font-size: 11px;
}
.thread__badge {
  color: #8a5a0b;
  background: #f7ecd8;
  border-radius: 2px;
  padding: 0 4px;
}
.node__wrap { display: block; }
.node {
  display: flex;
  gap: 6px;
  align-items: baseline;
  padding: 4px 10px;
  border-top: 1px solid #edf1f1;
  cursor: pointer;
  font-size: 12px;
}
.node:hover { background: #f4f7f7; }
.node:focus-visible { outline: 2px solid #0c6b6b; outline-offset: -2px; }
.node__name { font-weight: 700; white-space: nowrap; }
.node__body {
  color: #33474a;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1 1 auto;
}
.node__time { color: #5b6e70; font-size: 11px; white-space: nowrap; }
.diagnostic {
  border: 1px solid #8a5a0b;
  background: #f7ecd8;
  color: #8a5a0b;
  padding: 10px;
  border-radius: 4px;
  font-size: 12px;
}
.diagnostic__code {
  font-family: Consolas, "Courier New", monospace;
  display: block;
  margin: 6px 0;
  word-break: break-all;
}
`;
