// Pinned to UTC so a 'YYYY-MM-DD' date never renders as the previous day on
// servers west of UTC.
const fmt = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });

export function formatPostDate(iso: string): string {
  return fmt.format(new Date(`${iso}T00:00:00Z`));
}
