// Generates the raster branding from src/assets/logo.svg: the Open Graph share
// image, the GitHub social preview, and PNG logos for search engines and iOS.
// Run with: mise run docs:og
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(root, '..');

const background = '#1e293b';
const logoRaw = (await readFile(path.join(root, 'src/assets/logo.svg'), 'utf8')).trim();
const logoOpen = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">';

if (!logoRaw.startsWith(logoOpen)) throw new Error(`Expected logo.svg to start with ${logoOpen}`);

// Embed the logo as a nested SVG at a fixed position and size.
const logoAt = (x, y, size) =>
  logoRaw.replace(logoOpen, `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 128 128">`);

const fontStack = "Inter, 'Liberation Sans', 'DejaVu Sans', Arial, sans-serif";

// A share card: accent strip, logo on the left, title and tagline on the right.
const card = (width, height) => {
  const logoSize = 300;
  const logoX = Math.round(width * 0.09);
  const logoY = Math.round((height - logoSize) / 2);
  const textX = logoX + logoSize + 60;
  const top = Math.round(height / 2 - 25);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="${background}"/>
  <rect width="${width}" height="10" fill="#d97706"/>
  ${logoAt(logoX, logoY, logoSize)}
  <g font-family="${fontStack}" fill="#ffffff">
    <text x="${textX}" y="${top}" font-size="104" font-weight="700">Dotfiles</text>
    <text x="${textX + 4}" y="${top + 72}" font-size="38" fill-opacity="0.88">An agent-driven Omarchy setup for</text>
    <text x="${textX + 4}" y="${top + 120}" font-size="38" fill-opacity="0.88">development, desktop, and automation.</text>
    <text x="${textX + 4}" y="${top + 200}" font-size="30" fill="#f59e0b">dotfiles.timmo.dev</text>
  </g>
</svg>`;
};

// A square logo, on a solid background when the platform needs one.
const square = (size, fill) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  ${fill ? `<rect width="${size}" height="${size}" fill="${fill}"/>` : ''}
  ${fill ? logoAt(size * 0.1, size * 0.1, size * 0.8) : logoAt(0, 0, size)}
</svg>`;

const outputs = [
  // Open Graph fallback share image.
  { file: path.join(root, 'public/og.png'), svg: card(1200, 630) },
  // GitHub repository social preview (upload it in the repository settings).
  { file: path.join(repoRoot, '.github/social-preview.png'), svg: card(1280, 640) },
  // Organization logo for search engines.
  { file: path.join(root, 'public/logo.png'), svg: square(512) },
  // iOS home screen icon, which needs an opaque background.
  { file: path.join(root, 'public/apple-touch-icon.png'), svg: square(180, background) },
];

for (const { file, svg } of outputs) {
  await sharp(Buffer.from(svg)).png().toFile(file);
  console.log(`Wrote ${path.relative(repoRoot, file)}`);
}
