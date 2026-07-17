// Generates the Open Graph share image at public/og.png.
// Run with: mise run docs:og
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const W = 1200;
const H = 630;

// Embed the logo as a nested SVG at a fixed position and size.
const logoRaw = (await readFile(path.join(root, 'src/assets/logo.svg'), 'utf8')).trim();
const logo = logoRaw.replace(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36">',
  '<svg x="120" y="175" width="280" height="280" viewBox="0 0 36 36">',
);

const fontStack = "Inter, 'Liberation Sans', 'DejaVu Sans', Arial, sans-serif";

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#1e293b"/>
  <rect width="${W}" height="10" fill="#d97706"/>
  ${logo}
  <g font-family="${fontStack}" fill="#ffffff">
    <text x="470" y="300" font-size="104" font-weight="700">Dotfiles</text>
    <text x="474" y="372" font-size="38" fill-opacity="0.88">An agent-driven Omarchy setup for</text>
    <text x="474" y="420" font-size="38" fill-opacity="0.88">development, desktop, and automation.</text>
    <text x="474" y="500" font-size="30" fill="#f59e0b">dotfiles.timmo.dev</text>
  </g>
</svg>`;

await sharp(Buffer.from(svg)).png().toFile(path.join(root, 'public/og.png'));
console.log('Wrote public/og.png');
