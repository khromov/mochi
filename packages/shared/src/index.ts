import type { Handle } from 'mochi-framework';

/**
 * Umami property covering every mochi.fast surface — the docs site, the demos
 * site, and the support form all report into the same dashboard.
 */
const ANALYTICS_SCRIPT = `<script defer src="https://u.khromov.se/u.js" data-performance="true" data-website-id="8dceb8f5-6533-4c03-9cd6-1ce74accd63a"></script>`;

/**
 * Fills the `{{mochi.analytics}}` shell placeholder, but only inside the
 * deployed container — `MOCHI_DOCKER` is set by the Dockerfiles, so local dev
 * and tests never report. Sites that use this must carry the placeholder in
 * their `shell.html`, otherwise the snippet has nowhere to land.
 *
 * Read at call time rather than module load so a test can set the env var.
 */
export const analytics: Handle = async ({ event, resolve }) => {
  return resolve(event, {
    transformPage({ html }) {
      const isDocker = process.env.MOCHI_DOCKER === 'true';
      return html.replace('{{mochi.analytics}}', isDocker ? ANALYTICS_SCRIPT : '');
    },
  });
};
