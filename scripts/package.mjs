// Chrome Web Store へアップロードする ZIP を作る。
// 配布に不要なもの (テスト・ドキュメント・開発設定) を持ち込まないよう、
// 除外ではなく「含めるものを列挙する」方式にしている。
import { mkdtempSync, rmSync, mkdirSync, cpSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const INCLUDE = ['manifest.json', 'icons', 'src'];

const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
const outName = `chatwork-thread-view-${manifest.version}.zip`;
const outPath = join(ROOT, 'dist', outName);

for (const entry of INCLUDE) {
  if (!existsSync(join(ROOT, entry))) {
    console.error(`missing: ${entry}`);
    process.exit(1);
  }
}

const stage = mkdtempSync(join(tmpdir(), 'ctv-pkg-'));
for (const entry of INCLUDE) {
  cpSync(join(ROOT, entry), join(stage, entry), { recursive: true });
}

mkdirSync(join(ROOT, 'dist'), { recursive: true });
rmSync(outPath, { force: true });

// Windows 標準の Compress-Archive を使う (依存を増やさないため)
execFileSync(
  'powershell',
  [
    '-NoProfile',
    '-Command',
    `Compress-Archive -Path '${join(stage, '*')}' -DestinationPath '${outPath}' -Force`,
  ],
  { stdio: 'inherit' }
);

rmSync(stage, { recursive: true, force: true });
console.log(`packaged: dist/${outName}`);
console.log(`contents: ${INCLUDE.join(', ')}`);
