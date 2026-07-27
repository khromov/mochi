// Client-safe constants. The island needs these, and `lib/ci.ts` can't supply them —
// importing a value from it would pull node:path and FileStorage into the browser bundle.

export const CI_REPO = 'khromov/mochi';
export const CI_BRANCH = 'main';
export const CI_ACTIONS_URL = `https://github.com/${CI_REPO}/actions`;
