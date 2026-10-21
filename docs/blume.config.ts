import { docsConfig } from '@timmo001/docs-kit/blume';
import { defineConfig } from 'blume';
import { currentDistro } from './current-distro';
import { distroById, distroSelector } from './distros';

const distro = distroById(currentDistro);

export default defineConfig(
  docsConfig({
    title: 'Dotfiles',
    description: 'My dotfiles for cloud agent environments, starting with Claude Code cloud sessions.',
    site: distro.site,
    github: {
      owner: 'timmo001',
      repo: 'dotfiles',
      branch: distro.branch,
    },
    navigation: {
      selectors: [distroSelector(distro)],
      sidebar: [
        '/',
        '/getting-started',
        {
          label: 'Claude Code',
          items: [
            '/claude/overview',
          ],
        },
        '/configuration',
        '/distros',
        {
          label: 'dot',
          items: [
            '/dot/overview',
            '/dot/commands',
          ],
        },
        {
          label: 'Agents',
          items: [
            '/agents/overview',
            '/agents/skills',
          ],
        },
        {
          label: 'OpenCode',
          display: 'group',
          collapsed: false,
          items: [
            '/agents/opencode/overview',
            '/agents/opencode/agents',
            '/agents/opencode/commands',
            '/agents/opencode/plugins',
          ],
        },
        {
          label: 'This branch',
          items: [
            '/stow',
            '/changes',
          ],
        },
      ],
    },
    redirects: [
      { from: '/dot', to: '/dot/overview', status: 301 },
      { from: '/agents', to: '/agents/overview', status: 301 },
      { from: '/opencode', to: '/agents/opencode/overview', status: 301 },
      { from: '/opencode/overview', to: '/agents/opencode/overview', status: 301 },
      { from: '/opencode/agents', to: '/agents/opencode/agents', status: 301 },
      { from: '/opencode/profiles', to: '/agents/opencode/agents', status: 301 },
      { from: '/opencode/commands', to: '/agents/opencode/commands', status: 301 },
      { from: '/opencode/plugins', to: '/agents/opencode/plugins', status: 301 },
      { from: '/reference/agents', to: '/agents/opencode/agents', status: 301 },
      { from: '/reference/commands', to: '/agents/opencode/commands', status: 301 },
      { from: '/reference/plugins', to: '/agents/opencode/plugins', status: 301 },
      { from: '/other-agents/pi', to: '/agents/overview', status: 301 },
      { from: '/other-agents/cursor', to: '/distros', status: 301 },
      { from: '/other-agents/agents-llms', to: '/', status: 301 },
      { from: '/agents/agents-llms', to: '/', status: 301 },
      { from: '/pi', to: '/agents/overview', status: 301 },
      { from: '/cursor', to: '/distros', status: 301 },
      { from: '/agents/cursor', to: '/distros', status: 301 },
      { from: '/server', to: '/', status: 301 },
      { from: '/server/changes', to: '/changes', status: 301 },
      { from: '/agents-llms', to: '/', status: 301 },
      // Desktop pages only exist on the desktop build; the Distros page links there.
      { from: '/hyprland', to: '/distros', status: 301 },
      { from: '/ghostty', to: '/distros', status: 301 },
      { from: '/uwsm', to: '/distros', status: 301 },
      { from: '/omarchy-shell', to: '/distros', status: 301 },
      { from: '/desktop/hyprland', to: '/distros', status: 301 },
      { from: '/desktop/ghostty', to: '/distros', status: 301 },
      { from: '/desktop/uwsm', to: '/distros', status: 301 },
      { from: '/desktop/omarchy-shell', to: '/distros', status: 301 },
      { from: '/herdr', to: '/', status: 301 },
      { from: '/desktop/herdr', to: '/', status: 301 },
    ],
    seo: {
      og: {
        palette: {
          accent: '#d97706',
          background: '#18181b',
          border: '#3f3f46',
          foreground: '#fafafa',
          muted: '#a1a1aa',
        },
      },
    },
  }),
);
