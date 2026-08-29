// 画面写真の一部を塗りつぶす。実際の Chatwork を撮ったものを公開する前に、
// 個人名・顔写真・ルーム名・顧客名を消すために使う。
//
// 依存は増やさない。PNG の読み書きは自前で行う (zlib は Node 標準)。
// 対応するのは 8bit・非インターレースの RGB / RGBA だけ。Windows と Chrome の
// スクリーンショットはこの形式で出る。
//
// 使い方:
//   node scripts/redact.mjs 入力.png 出力.png 指定.json
//
// 指定.json の形:
//   {
//     "blocks": [
//       { "x": 0, "y": 100, "w": 280, "h": 1080 },                  // 既定はモザイク
//       { "x": 350, "y": 60, "w": 540, "h": 32, "size": 20 },       // 粗さを指定
//       { "x": 10, "y": 10, "w": 100, "h": 20, "mode": "fill" },    // 単色で塗る
//       { "x": 10, "y": 40, "w": 100, "h": 20, "mode": "fill", "color": "#1b282d" }
//     ]
//   }
//
// x/y/w/h はピクセル。画像からはみ出す指定は自動で切り詰める。
import { readFileSync, writeFileSync } from 'node:fs';
import { inflateSync, deflateSync } from 'node:zlib';

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
const crc32 = (b) => {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i += 1) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

// ---- 読み込み ----
function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('PNG ではありません');

  let pos = 8;
  let ihdr = null;
  const idat = [];

  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      ihdr = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        depth: data[8],
        color: data[9],
        interlace: data[12],
      };
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + len;
  }

  if (!ihdr) throw new Error('IHDR が見つかりません');
  if (ihdr.depth !== 8) throw new Error(`bit depth ${ihdr.depth} には対応していません (8 のみ)`);
  if (ihdr.interlace !== 0) throw new Error('インターレース PNG には対応していません');
  if (ihdr.color !== 2 && ihdr.color !== 6) {
    throw new Error(`color type ${ihdr.color} には対応していません (2 か 6 のみ)`);
  }

  const bpp = ihdr.color === 6 ? 4 : 3;
  const stride = ihdr.width * bpp;
  const raw = inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(stride * ihdr.height);

  // フィルタを外す。前の行は out の中にできあがっているものを参照する。
  let src = 0;
  for (let y = 0; y < ihdr.height; y += 1) {
    const filter = raw[src];
    src += 1;
    const row = y * stride;
    const prev = row - stride;
    for (let i = 0; i < stride; i += 1) {
      const x = raw[src + i];
      const a = i >= bpp ? out[row + i - bpp] : 0;
      const b = y > 0 ? out[prev + i] : 0;
      const c = y > 0 && i >= bpp ? out[prev + i - bpp] : 0;
      let v;
      switch (filter) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error(`未知のフィルタ ${filter} (行 ${y})`);
      }
      out[row + i] = v & 0xff;
    }
    src += stride;
  }

  return { ...ihdr, bpp, stride, pixels: out };
}

// ---- 書き出し ----
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function encodePNG(img) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.width, 0);
  ihdr.writeUInt32BE(img.height, 4);
  ihdr[8] = 8;
  ihdr[9] = img.color;

  // 書き戻しはフィルタなし (0)。読み手はどのフィルタでも解釈できる。
  const raw = Buffer.alloc((img.stride + 1) * img.height);
  for (let y = 0; y < img.height; y += 1) {
    raw[y * (img.stride + 1)] = 0;
    img.pixels.copy(raw, y * (img.stride + 1) + 1, y * img.stride, (y + 1) * img.stride);
  }

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- 加工 ----
function clampBlock(img, b) {
  const x0 = Math.max(0, Math.round(b.x));
  const y0 = Math.max(0, Math.round(b.y));
  const x1 = Math.min(img.width, Math.round(b.x + b.w));
  const y1 = Math.min(img.height, Math.round(b.y + b.h));
  return { x0, y0, x1, y1 };
}

// モザイク。ブロックごとに平均色で塗る。
// 文字が読めなくなるよう、既定の粗さは文字の高さより大きめに取る。
function pixelate(img, b) {
  const { x0, y0, x1, y1 } = clampBlock(img, b);
  const size = Math.max(2, Math.round(b.size ?? 14));
  const { bpp, stride, pixels } = img;

  for (let by = y0; by < y1; by += size) {
    for (let bx = x0; bx < x1; bx += size) {
      const ex = Math.min(bx + size, x1);
      const ey = Math.min(by + size, y1);
      const sum = [0, 0, 0, 0];
      let n = 0;
      for (let y = by; y < ey; y += 1) {
        for (let x = bx; x < ex; x += 1) {
          const i = y * stride + x * bpp;
          for (let c = 0; c < bpp; c += 1) sum[c] += pixels[i + c];
          n += 1;
        }
      }
      if (!n) continue;
      const avg = sum.map((v) => Math.round(v / n));
      for (let y = by; y < ey; y += 1) {
        for (let x = bx; x < ex; x += 1) {
          const i = y * stride + x * bpp;
          for (let c = 0; c < bpp; c += 1) pixels[i + c] = avg[c];
        }
      }
    }
  }
}

function fill(img, b) {
  const { x0, y0, x1, y1 } = clampBlock(img, b);
  const { bpp, stride, pixels } = img;
  const hex = (b.color ?? '#8c9698').replace('#', '');
  const rgb = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = y * stride + x * bpp;
      pixels[i] = rgb[0];
      pixels[i + 1] = rgb[1];
      pixels[i + 2] = rgb[2];
      if (bpp === 4) pixels[i + 3] = 255;
    }
  }
}

// ---- 実行 ----
const [input, output, spec] = process.argv.slice(2);
if (!input || !output || !spec) {
  console.error('使い方: node scripts/redact.mjs 入力.png 出力.png 指定.json');
  process.exit(1);
}

const img = decodePNG(readFileSync(input));
const { blocks = [] } = JSON.parse(readFileSync(spec, 'utf8'));

for (const b of blocks) {
  if (b.mode === 'fill') fill(img, b);
  else pixelate(img, b);
}

writeFileSync(output, encodePNG(img));
console.log(`${output}  ${img.width}x${img.height}  ${blocks.length} 箇所を処理`);
