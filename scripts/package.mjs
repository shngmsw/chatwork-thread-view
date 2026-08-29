// Chrome Web Store へアップロードする ZIP を作る。
//
// 配布に不要なもの (テスト・ドキュメント・開発設定) を持ち込まないよう、
// 除外ではなく「含めるものを列挙する」方式にしている。
//
// ZIP は自前で書き出す。Windows の Compress-Archive はエントリのパス区切りに
// バックスラッシュを使うことがあり、ZIP 仕様 (スラッシュ) に反するため。
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const INCLUDE = ['manifest.json', 'icons', 'src'];

// ---- CRC32 ----
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---- 収集 (ZIP 内のパスは常にスラッシュ区切り) ----
function collect(rel, out = []) {
  const abs = join(ROOT, rel);
  if (statSync(abs).isDirectory()) {
    for (const name of readdirSync(abs).sort()) collect(`${rel}/${name}`, out);
  } else {
    out.push(rel);
  }
  return out;
}

// ---- ZIP 書き出し ----
function buildZip(files, date = new Date()) {
  const dosTime =
    ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | ((date.getSeconds() / 2) & 0x1f);
  const dosDate =
    (((date.getFullYear() - 1980) & 0x7f) << 9) | (((date.getMonth() + 1) & 0x0f) << 5) | (date.getDate() & 0x1f);

  const locals = [];
  const central = [];
  let offset = 0;

  for (const rel of files) {
    const name = Buffer.from(rel, 'utf8');
    const raw = readFileSync(join(ROOT, rel));
    const deflated = deflateRawSync(raw, { level: 9 });
    // 圧縮して大きくなるなら無圧縮で入れる
    const useStore = deflated.length >= raw.length;
    const data = useStore ? raw : deflated;
    const method = useStore ? 0 : 8;
    const crc = crc32(raw);

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);       // version needed
    lh.writeUInt16LE(0x0800, 6);   // UTF-8 のファイル名
    lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(dosTime, 10);
    lh.writeUInt16LE(dosDate, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(name.length, 26);
    lh.writeUInt16LE(0, 28);
    locals.push(lh, name, data);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);       // version made by
    cd.writeUInt16LE(20, 6);       // version needed
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(dosTime, 12);
    cd.writeUInt16LE(dosDate, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt32LE(0, 38);       // external attributes
    cd.writeUInt32LE(offset, 42);
    central.push(cd, name);

    offset += lh.length + name.length + data.length;
  }

  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cdBuf.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, cdBuf, end]);
}

// ---- 実行 ----
const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));

for (const entry of INCLUDE) {
  if (!existsSync(join(ROOT, entry))) {
    console.error(`missing: ${entry}`);
    process.exit(1);
  }
}

const files = INCLUDE.flatMap((e) => collect(e));
const zip = buildZip(files);

mkdirSync(join(ROOT, 'dist'), { recursive: true });
const outName = `chatwork-thread-view-${manifest.version}.zip`;
writeFileSync(join(ROOT, 'dist', outName), zip);

console.log(`packaged: dist/${outName} (${zip.length} bytes, ${files.length} files)`);
for (const f of files) console.log(`  ${f}`);
