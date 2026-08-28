import { createPanel } from '../ui/panel.js';

function boot() {
  const panel = createPanel();
  if (!panel) return;
  panel.body.innerHTML = '<div class="state">読み込み中です</div>';
}

boot();
