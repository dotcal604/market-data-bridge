// Probe v2: serves properly-sized solid-color PNGs
import http from 'http';
import { createCanvas } from '@napi-rs/canvas';

function generatePNG(width, height, color) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, width, height);
  // Add visible text so we KNOW it rendered
  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 48px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('IMAGE OK', width / 2, height / 2 + 16);
  return canvas.toBuffer('image/png');
}

const server = http.createServer((req, res) => {
  const ts = new Date().toISOString();
  const ua = req.headers['user-agent'] || 'none';
  const ip = req.socket.remoteAddress;
  console.log(`[${ts}] ${req.method} ${req.url} from ${ip} UA="${ua}"`);

  if (req.url === '/health') {
    res.writeHead(200, {'Content-Type': 'text/plain'});
    return res.end('ok');
  }

  // Generate solid red PNG at requested size (default 400x400)
  const url = new URL(req.url, 'http://localhost');
  const w = parseInt(url.searchParams.get('w') || '400');
  const h = parseInt(url.searchParams.get('h') || '400');
  const color = '#' + (url.searchParams.get('c') || 'FF0000');

  console.log(`  → Generating ${w}x${h} PNG, color=${color}`);
  const buf = generatePNG(w, h, color);
  console.log(`  → Serving ${buf.length} bytes`);

  res.writeHead(200, {
    'Content-Type': 'image/png',
    'Content-Length': buf.length,
    'Cache-Control': 'no-cache'
  });
  res.end(buf);
});

server.listen(9877, '0.0.0.0', () => {
  console.log('Probe v2 listening on port 9877 (with @napi-rs/canvas)');
});
