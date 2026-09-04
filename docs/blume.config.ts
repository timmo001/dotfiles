import { defineConfig } from 'blume';

export default defineConfig({
  title: 'Dotfiles',
  description: 'An agent-driven Omarchy setup for development, desktop, and automation.',
  logo: {
    image: '/favicon.svg',
    text: 'Dotfiles',
  },
  content: {
    root: 'src/content/docs',
  },
  github: {
    owner: 'timmo001',
    repo: 'dotfiles',
    branch: 'distro/arch-omarchy-quattro',
    dir: 'docs',
  },
  navigation: {
    repo: true,
    sidebar: [
      '/',
      '/getting-started',
      '/configuration',
      {
        label: 'dot',
        items: [
          '/dot/overview',
          '/dot/commands',
        ],
      },
      {
        label: 'Desktop',
        items: [
          '/desktop/hyprland',
          '/desktop/ghostty',
          '/desktop/herdr',
          '/desktop/uwsm',
          '/desktop/omarchy-shell',
        ],
      },
      '/stow',
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
      '/agents/pi',
      '/agents/cursor',
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
    { from: '/other-agents/pi', to: '/agents/pi', status: 301 },
    { from: '/other-agents/cursor', to: '/agents/cursor', status: 301 },
    { from: '/other-agents/agents-llms', to: '/', status: 301 },
    { from: '/agents/agents-llms', to: '/', status: 301 },
    { from: '/pi', to: '/agents/pi', status: 301 },
    { from: '/cursor', to: '/agents/cursor', status: 301 },
    { from: '/agents-llms', to: '/', status: 301 },
    { from: '/hyprland', to: '/desktop/hyprland', status: 301 },
    { from: '/ghostty', to: '/desktop/ghostty', status: 301 },
    { from: '/herdr', to: '/desktop/herdr', status: 301 },
    { from: '/uwsm', to: '/desktop/uwsm', status: 301 },
    { from: '/omarchy-shell', to: '/desktop/omarchy-shell', status: 301 },
  ],
  theme: {
    accent: {
      light: '#b45309',
      dark: '#d97706',
    },
  },
  ai: {
    ask: {
      enabled: false,
    },
    llmsTxt: true,
    mcp: {
      enabled: true,
      route: '/mcp',
    },
    webmcp: true,
  },
  deployment: {
    site: 'https://dotfiles.timmo.dev',
    output: 'server',
    adapter: null,
  },
  feedback: false,
  lastModified: true,
  seo: {
    agentReadability: true,
    contentSignals: {
      aiInput: true,
      aiTrain: false,
      search: true,
    },
    og: {
      enabled: true,
      logo: 'src/assets/logo.svg',
      site: 'dotfiles.timmo.dev',
    },
  },
});
