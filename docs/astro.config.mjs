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
            'An agent-driven Omarchy setup for development, desktop, and automation.',
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
          items: [{ autogenerate: { directory: 'getting-started' } }],
        },
        {
          label: 'The dot Command',
          items: [{ autogenerate: { directory: 'dot' } }],
        },
        {
          label: 'Configuration',
          items: [{ autogenerate: { directory: 'configuration' } }],
        },
        {
          label: 'Git & GitHub',
          items: [{ autogenerate: { directory: 'git' } }],
        },
        {
          label: 'Omarchy & Hyprland',
          items: [
            { label: 'Overview', slug: 'omarchy' },
            { label: 'Host Overrides', slug: 'omarchy/host-overrides' },
            { label: 'Shell (Quickshell)', slug: 'omarchy/shell' },
            { label: 'Controls', slug: 'omarchy/controls' },
          ],
        },
        { label: 'Bar Integrations', slug: 'bar-integrations' },
        { label: 'Cleanup', slug: 'cleanup' },
        {
          label: 'Knowledge base',
          items: [{ autogenerate: { directory: 'knowledge-base' } }],
        },
        {
          label: 'OpenCode & Agents',
          items: [
            { slug: 'opencode' },
            { autogenerate: { directory: 'reference' } },
            { slug: 'opencode/mcp' },
          ],
        },
        { label: 'Agents / LLMs', slug: 'agents-llms' },
      ],
    }),
  ],
});
