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
    branch: 'distro/arch-omarchy',
    dir: 'docs',
  },
  navigation: {
    repo: true,
  },
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
    adapter: 'cloudflare',
  },
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
