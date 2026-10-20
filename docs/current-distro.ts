/**
 * The distro this branch's docs describe. Each distro branch sets its own ID
 * from `distros.ts` here, alongside the Worker name and route in
 * `wrangler.jsonc`. The default branch never changes this file again, so
 * merging it into a distro branch keeps that branch's value.
 */
export const currentDistro = 'cloud';
