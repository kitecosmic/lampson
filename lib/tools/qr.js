// qr.js <texto> — dibuja un QR en la terminal (lampson --pair): medio bloque por fila de módulos (▀ ▄ █), con
// colores FORZADOS (negro sobre blanco) para que la cámara lo lea igual con tema claro u oscuro. Usa la misma
// librería que el QR de la web (public/vendor/qrcode.js).
const path = require('path');
const qrcode = require(path.join(__dirname, '..', '..', 'public', 'vendor', 'qrcode.js'));

const text = process.argv[2];
if (!text) { console.error('uso: node qr.js <texto>'); process.exit(2); }
const qr = qrcode(0, 'M');
qr.addData(text);
qr.make();

const n = qr.getModuleCount();
const quiet = 3; // margen claro alrededor (la cámara lo necesita para encontrar el código)
const dark = (r, c) => r >= 0 && c >= 0 && r < n && c < n && qr.isDark(r, c);
const ON = '\x1b[30;107m', OFF = '\x1b[0m'; // texto negro, fondo blanco brillante
const lines = [];
for (let r = -quiet; r < n + quiet; r += 2) {
  let line = '  ' + ON;
  for (let c = -quiet; c < n + quiet; c++) {
    const top = dark(r, c), bottom = dark(r + 1, c);
    line += top && bottom ? '█' : top ? '▀' : bottom ? '▄' : ' ';
  }
  lines.push(line + OFF);
}
process.stdout.write(lines.join('\n') + '\n');
