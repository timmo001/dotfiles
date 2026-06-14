// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import sitemap from '@astrojs/sitemap';
import icon from 'astro-icon';
import starlightLlmsTxt from 'starlight-llms-txt';
import starlightContextualMenu from 'starlight-contextual-menu';
import starlightLinksValidator from 'starlight-links-validator';
import rehypeExternalLinks from 'rehype-external-links';
import { unified } from '@astrojs/markdown-remark';

// https://astro.build/config
export default defineConfig({
  site: 'https://dotfiles.timmo.dev',
  markdown: {
    processor: unified({
      rehypePlugins: [
        [rehypeExternalLinks, { target: '_blank', rel: ['noopener', 'noreferrer'] }],
      ],
    }),
  },
  integrations: [
    icon(),
    sitemap(),
    starlight({
      title: 'Dotfiles',
      logo: {
        src: './src/assets/logo.svg',
        alt: 'Dotfiles logo',
      },
      favicon: '/favicon.svg',
      customCss: ['./src/styles/starlight.css'],
      editLink: {
        baseUrl: 'https://github.com/timmo001/dotfiles/edit/distro/arch-omarchy/docs/',
      },
      lastUpdated: true,
      head: [
        {
          tag: 'meta',
          attrs: { property: 'og:image', content: 'https://dotfiles.timmo.dev/og.png' },
        },
        {
          tag: 'meta',
          attrs: { property: 'og:image:width', content: '1200' },
        },
        {
          tag: 'meta',
          attrs: { property: 'og:image:height', content: '630' },
        },
        {
          tag: 'meta',
          attrs: { property: 'og:image:alt', content: 'Dotfiles' },
        },
        {
          tag: 'meta',
          attrs: { name: 'twitter:image', content: 'https://dotfiles.timmo.dev/og.png' },
        },
      ],
      plugins: [
        starlightLinksValidator(),
        starlightLlmsTxt({
          projectName: 'Dotfiles',
          description:
            'Public Omarchy dotfiles managed with GNU Stow and the dot command.',
          promote: ['index*'],
        }),
        starlightContextualMenu({
          actions: ['copy', 'view'],
        }),
      ],
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/timmo001/dotfiles' },
      ],
      sidebar: [
        { label: 'Overview', link: '/' },
        {
          label: 'Getting Started',
          items: [
            { label: 'Overview', slug: 'getting-started' },
            { label: 'Install', slug: 'getting-started/install' },
            { label: 'New Machine Checklist', slug: 'getting-started/new-machine' },
          ],
        },
        {
          label: 'The dot Command',
          items: [
            { label: 'Overview', slug: 'dot' },
            { label: 'Command Reference', slug: 'dot/commands' },
            { label: 'Stow Workflow', slug: 'dot/stow' },
            { label: 'Notes & Handoffs', slug: 'dot/notes' },
            { label: 'System Utilities', slug: 'dot/utilities' },
          ],
        },
        {
          label: 'Git & GitHub',
          items: [
            { label: 'Overview', slug: 'git' },
            { label: 'Status, Diff & Log', slug: 'git/status' },
            { label: 'Workflow Runs', slug: 'git/workflows' },
            { label: 'Notifications', slug: 'git/notifications' },
            { label: 'Bar Integrations', slug: 'git/bar-integrations' },
          ],
        },
        {
          label: 'Omarchy & Hyprland',
          items: [
            { label: 'Overview', slug: 'omarchy' },
            { label: 'Host Overrides', slug: 'omarchy/host-overrides' },
            { label: 'Controls', slug: 'omarchy/controls' },
          ],
        },
        {
          label: 'OpenCode & Agents',
          items: [
            { label: 'Overview', slug: 'opencode' },
            { label: 'Agents', slug: 'reference/agents' },
            { label: 'Commands', slug: 'reference/commands' },
            { label: 'Skills', slug: 'reference/skills' },
            { label: 'Plugins', slug: 'reference/plugins' },
          ],
        },
        {
          label: 'Configuration & Reference',
          items: [
            { label: 'Overview', slug: 'configuration' },
            { label: 'Environment Variables', slug: 'configuration/environment' },
            { label: 'Private Git Config', slug: 'configuration/private-git' },
            { label: 'Private Packages', slug: 'configuration/private-packages' },
          ],
        },
        { label: 'LLMs', slug: 'llms' },
      ],
    }),
  ],
});
