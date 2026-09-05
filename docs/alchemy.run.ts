import { Stack } from 'alchemy';
import { providers, state, Website } from 'alchemy/Cloudflare';
import { Effect } from 'effect';
import { fileURLToPath } from 'node:url';

const DocsWebsite = Website.Astro(
  'Website',
  Stack.useSync(({ stage }) => ({
    rootDir: fileURLToPath(new URL('./.blume', import.meta.url)),
    sessionKVBindingName: false,
    prerenderEnvironment: 'node',
    astro: {
      output: 'server',
      site: 'https://dotfiles.timmo.dev',
    },
    compatibility: {
      date: '2026-07-17',
    },
    name: stage === 'prod' ? 'dotfiles-docs' : undefined,
    domain: stage === 'prod' ? 'dotfiles.timmo.dev' : undefined,
    workersDev: true,
    observability: {
      enabled: true,
    },
  })),
);

export default Stack(
  'DotfilesDocs',
  {
    providers: providers(),
    state: state(),
  },
  Effect.gen(function* () {
    const website = yield* DocsWebsite;

    return { url: website.url };
  }),
);
