// アイコンを生成する。スレッドの木構造を図案にしている。
//
// 依存を増やしたくないので PNG は自前で書き出す (zlib は Node 標準)。
// 出力は 2 種類:
//   icons/*.png                       拡張機能用。canvas いっぱいに描く
//   docs/store/assets/store-icon-128.png  ストア用。中身を 96x96 に収め、
//     周囲 16px を余白にする (ストア側で影などが付くため、Google の案内に従う)
import { writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SS = 4; // スーパーサンプリング倍率 (アンチエイリアス用)

// ---- PNG encoder ----
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
const crc32 = (b) => {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i += 1) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePNG(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y += 1) {
    raw[y * (w * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- 形状 (単位正方形 0..1 で定義) ----
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
function sdRoundedRect(px, py, r) {
  const qx = Math.abs(px - 0.5) - (0.5 - r);
  const qy = Math.abs(py - 0.5) - (0.5 - r);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r;
}
const sdCircle = (px, py, cx, cy, r) => Math.hypot(px - cx, py - cy) - r;
function sdSegment(px, py, ax, ay, bx, by, r) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const t = clamp01((wx * vx + wy * vy) / (vx * vx + vy * vy));
  return Math.hypot(wx - vx * t, wy - vy * t) - r;
}

const BG_TOP = [0x14, 0x9d, 0x94];
const BG_BOT = [0x0c, 0x6f, 0x69];
const FG = [0xff, 0xff, 0xff];

// 親ノードから縦の幹が伸び、2 本の枝が子ノードへつながる
const ROOT_N = [0.30, 0.235, 0.105];
const KID1 = [0.70, 0.50, 0.088];
const KID2 = [0.70, 0.755, 0.088];
const STROKE = 0.036;
const SPINE_END = 0.755;
const ELBOW = 0.56;

function isForeground(px, py) {
  let d = Math.min(
    sdCircle(px, py, ROOT_N[0], ROOT_N[1], ROOT_N[2]),
    sdCircle(px, py, KID1[0], KID1[1], KID1[2]),
    sdCircle(px, py, KID2[0], KID2[1], KID2[2]),
    sdSegment(px, py, ROOT_N[0], ROOT_N[1], ROOT_N[0], SPINE_END, STROKE),
    sdSegment(px, py, ROOT_N[0], KID1[1], ELBOW, KID1[1], STROKE),
    sdSegment(px, py, ROOT_N[0], KID2[1], ELBOW, KID2[1], STROKE)
  );
  // 枝とノードの間をわずかに空け、小さいサイズでも粒が見えるようにする
  const gap = Math.min(
    sdCircle(px, py, KID1[0], KID1[1], KID1[2] + 0.026),
    sdCircle(px, py, KID2[0], KID2[1], KID2[2] + 0.026)
  );
  const onNode =
    Math.min(
      sdCircle(px, py, KID1[0], KID1[1], KID1[2]),
      sdCircle(px, py, KID2[0], KID2[1], KID2[2])
    ) < 0;
  if (!onNode && gap < 0) d = Math.max(d, -gap);
  return d < 0;
}

/**
 * @param {number} size 出力の一辺
 * @param {number} pad  図案の外に空ける余白 (px)。ストア用は 16
 */
function render(size, pad = 0) {
  const inner = size - pad * 2;
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let bgA = 0;
      let fgA = 0;
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          // 図案の座標系は内側の正方形で 0..1
          const px = (x * SS + sx + 0.5) / SS - pad;
          const py = (y * SS + sy + 0.5) / SS - pad;
          const ux = px / inner;
          const uy = py / inner;
          if (ux < 0 || ux > 1 || uy < 0 || uy > 1) continue;
          if (sdRoundedRect(ux, uy, 0.225) < 0) bgA += 1;
          if (isForeground(ux, uy)) fgA += 1;
        }
      }
      const n = SS * SS;
      const bg = bgA / n;
      const fg = (fgA / n) * bg; // 背景の外へは描かない
      const t = inner > 1 ? clamp01((y - pad) / (inner - 1)) : 0;
      const i = (y * size + x) * 4;
      for (let c = 0; c < 3; c += 1) {
        const base = BG_TOP[c] + (BG_BOT[c] - BG_TOP[c]) * t;
        buf[i + c] = Math.round(base * (1 - fg) + FG[c] * fg);
      }
      buf[i + 3] = Math.round(bg * 255);
    }
  }
  return encodePNG(size, size, buf);
}

function write(path, buf) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buf);
  console.log(`  ${path.replace(ROOT + '\\', '').replace(/\\/g, '/')}  ${statSync(path).size} bytes`);
}

console.log('拡張機能用 (canvas いっぱい):');
for (const size of [16, 32, 48, 128]) {
  write(join(ROOT, 'icons', `${size}.png`), render(size));
}

console.log('ストア用 (128 の中に 96 で描き、周囲 16px を余白に):');
write(join(ROOT, 'docs/store/assets/store-icon-128.png'), render(128, 16));
