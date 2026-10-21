/**
 * Every distro branch of the dotfiles publishes its own copy of these docs to
 * Cloudflare Workers. This list is shared by all of them: it drives the header
 * switcher and the Distros page, so add new distros here on the default branch
 * and merge it into the others.
 */

/** One distro branch and the docs site it publishes. */
export interface Distro {
  /** Stable ID, also the value `current-distro.ts` uses to pick this entry. */
  readonly id: string;
  /** Short name shown in the header switcher. */
  readonly label: string;
  /** One line on what the distro is for. */
  readonly description: string;
  /** Git branch the distro lives on and its docs deploy from. */
  readonly branch: string;
  /** Host name its docs Worker serves. */
  readonly site: string;
}

/** All distros, default branch first. */
export const distros = [
  {
    id: 'arch-omarchy-quattro',
    label: 'Omarchy desktop',
    description: 'Arch and Omarchy on the desktop and laptop',
    branch: 'distro/arch-omarchy-quattro',
    site: 'dotfiles.timmo.dev',
  },
  {
    id: 'ubuntu-server',
    label: 'Ubuntu server',
    description: 'Headless Ubuntu server and remote Herdr host',
    branch: 'distro/ubuntu-server',
    site: 'ubuntu-server.dotfiles.timmo.dev',
  },
  {
    id: 'cloud',
    label: 'Cloud',
    description: 'Cloud agent environments, starting with Claude Code',
    branch: 'distro/cloud',
    site: 'cloud.dotfiles.timmo.dev',
  },
] as const satisfies readonly Distro[];

/** Look up a distro by ID, failing the build on an unknown one. */
export const distroById = (id: string): Distro => {
  const distro = distros.find((entry) => entry.id === id);
  if (!distro) {
    throw new Error(`Unknown distro "${id}" in current-distro.ts`);
  }
  return distro;
};

/**
 * Header switcher between the distro sites. The current site links to its own
 * root, so Blume marks it active on every page; the others link out.
 */
export const distroSelector = (current: Distro) => ({
  kind: 'product' as const,
  label: 'Distro',
  items: distros.map((distro) => ({
    label: distro.label,
    description: distro.description,
    path: distro.id === current.id ? '/' : `https://${distro.site}/`,
  })),
});
