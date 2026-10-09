// Release label for the login-page version badge. The deploy workflow bakes
// the release tag in at build time as VITE_RELEASE_TAG (e.g. "familyhub-v0.9.0");
// a local dev build has no tag and reads "familyhub dev".
export const MODULE = 'familyhub';

export function releaseLabel(tag: string | undefined, module: string = MODULE): string {
  if (!tag) return `${module} dev`;
  const cut = tag.indexOf('-');
  return cut === -1 ? `${module} ${tag}` : `${tag.slice(0, cut)} ${tag.slice(cut + 1)}`;
}

export const RELEASE_LABEL = releaseLabel(import.meta.env.VITE_RELEASE_TAG);
