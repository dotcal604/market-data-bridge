// Multi-format probe: serves GIF, BMP, minimal PNG, and JPEG
// Routes: /test.gif, /test.bmp, /test.png, /test.jpg
// All serve 400x400 solid bright-green images
import http from 'http';

// === Minimal 1x1 GIF (bright green #00FF00) ===
// GIF89a, 1x1, global color table (2 colors), green pixel
function make1x1GIF(r, g, b) {
  return Buffer.from([
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61, // GIF89a
    0x01, 0x00, 0x01, 0x00,             // 1x1
    0x80, 0x00, 0x00,                   // GCT flag, 2 colors, no sort, no bg
    r, g, b,                            // color 0
    0x00, 0x00, 0x00,                   // color 1 (black)
    0x2C, 0x00, 0x00, 0x00, 0x00,       // image descriptor
    0x01, 0x00, 0x01, 0x00, 0x00,       // 1x1, no local color table
    0x02, 0x02, 0x44, 0x01, 0x00,       // LZW min code 2, data
    0x3B                                 // trailer
  ]);
}

// === BMP: 24-bit uncompressed, WxH solid color ===
function makeBMP(w, h, r, g, b) {
  const rowSize = Math.ceil((w * 3) / 4) * 4; // rows padded to 4-byte boundary
  const pixelDataSize = rowSize * h;
  const fileSize = 54 + pixelDataSize; // 14 file header + 40 DIB header + pixels

  const buf = Buffer.alloc(fileSize);
  // File header
  buf.write('BM', 0);
  buf.writeUInt32LE(fileSize, 2);
  buf.writeUInt32LE(0, 6);       // reserved
  buf.writeUInt32LE(54, 10);     // pixel data offset
  // DIB header (BITMAPINFOHEADER)
  buf.writeUInt32LE(40, 14);     // header size
  buf.writeInt32LE(w, 18);       // width
  buf.writeInt32LE(h, 22);       // height (positive = bottom-up)
  buf.writeUInt16LE(1, 26);      // planes
  buf.writeUInt16LE(24, 28);     // bits per pixel
  buf.writeUInt32LE(0, 30);      // compression (none)
  buf.writeUInt32LE(pixelDataSize, 34);
  buf.writeInt32LE(2835, 38);    // X ppi
  buf.writeInt32LE(2835, 42);    // Y ppi
  buf.writeUInt32LE(0, 46);      // colors
  buf.writeUInt32LE(0, 50);      // important colors
  // Pixel data (BGR order for BMP)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const offset = 54 + y * rowSize + x * 3;
      buf[offset] = b;     // Blue
      buf[offset + 1] = g; // Green
      buf[offset + 2] = r; // Red
    }
  }
  return buf;
}

const server = http.createServer((req, res) => {
  const ts = new Date().toISOString();
  const ip = req.socket.remoteAddress;
  const ua = req.headers['user-agent'] || 'none';
  console.log(`[${ts}] ${req.method} ${req.url} from ${ip} UA="${ua}"`);

  if (req.url === '/health') {
    res.writeHead(200, {'Content-Type': 'text/plain'});
    return res.end('ok');
  }

  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;

  if (path === '/test.gif') {
    const buf = make1x1GIF(0x00, 0xFF, 0x00);
    console.log(`  → Serving 1x1 GIF: ${buf.length} bytes`);
    res.writeHead(200, {
      'Content-Type': 'image/gif',
      'Content-Length': buf.length,
      'Cache-Control': 'no-cache'
    });
    return res.end(buf);
  }

  if (path === '/test.bmp') {
    const w = parseInt(url.searchParams.get('w') || '400');
    const h = parseInt(url.searchParams.get('h') || '400');
    const buf = makeBMP(w, h, 0x00, 0xFF, 0x00);
    console.log(`  → Serving ${w}x${h} BMP: ${buf.length} bytes`);
    res.writeHead(200, {
      'Content-Type': 'image/bmp',
      'Content-Length': buf.length,
      'Cache-Control': 'no-cache'
    });
    return res.end(buf);
  }

  // Default: list available routes
  const body = 'Routes: /test.gif, /test.bmp?w=400&h=400, /health\n';
  res.writeHead(200, {'Content-Type': 'text/plain'});
  res.end(body);
});

server.listen(9879, '0.0.0.0', () => {
  console.log('Multi-format probe on port 9879');
});
