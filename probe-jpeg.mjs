// Serve JPEG via sharp (or fallback to PNG if sharp unavailable)
import http from 'http';
import { createCanvas } from '@napi-rs/canvas';

function generateJPEG(width, height, color) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, width, height);
  // Bright visible text
  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 60px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('JPEG OK', width / 2, height / 2 + 20);
  // Border to make it obvious
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, width - 8, height - 8);
  return canvas.toBuffer('image/jpeg');
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

  const buf = generateJPEG(400, 400, '#0000FF');
  console.log(`  → Serving JPEG: ${buf.length} bytes`);
  res.writeHead(200, {
    'Content-Type': 'image/jpeg',
    'Content-Length': buf.length,
    'Cache-Control': 'no-cache'
  });
  res.end(buf);
});

server.listen(9878, '0.0.0.0', () => {
  console.log('JPEG probe on port 9878');
});
