/** Component basenames of every `/_mochi/css/<Name>-<hash>.css` stylesheet linked in `html`, sorted. */
export function linkedCss(html: string): string[] {
  return [...html.matchAll(/<link rel="stylesheet" href="\/_mochi\/css\/([A-Za-z]+)-[a-z0-9]+\.css">/g)].map((m) => m[1]!).sort();
}
