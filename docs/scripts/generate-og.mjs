// Generates the raster branding from src/assets/logo.svg: the Open Graph share
// image, the GitHub social preview, and PNG logos for search engines and iOS.
// Run with: mise run docs:og
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { writeBrandImages } from '@timmo001/docs-kit';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(root, '..');

const written = await writeBrandImages({
  logo: path.join(root, 'src/assets/logo.svg'),
  title: 'Dotfiles',
  tagline: ['An agent-driven Omarchy setup for', 'development, desktop, and automation.'],
  site: 'dotfiles.timmo.dev',
  background: '#1e293b',
  accent: '#d97706',
  outputs: {
    og: path.join(root, 'public/og.png'),
    socialPreview: path.join(repoRoot, '.github/social-preview.png'),
    logo: path.join(root, 'public/logo.png'),
    appleTouchIcon: path.join(root, 'public/apple-touch-icon.png'),
  },
});

for (const file of written) console.log(`Wrote ${path.relative(repoRoot, file)}`);
