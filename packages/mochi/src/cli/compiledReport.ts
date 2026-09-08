import { styleText } from 'node:util';

/** A build-time module is invisible in the output bundle by design, so this report is the only place the work shows up. */
export function printBuildTimeModules(files: string[]): void {
  if (files.length === 0) {
    return;
  }

  console.log('');
  console.log(styleText('dim', '      Build-time modules'));

  const n = files.length;
  for (let i = 0; i < n; i++) {
    const char = styleText('dim', n === 1 ? '─' : i === 0 ? '┌' : i === n - 1 ? '└' : '├');
    console.log(`  ${char} ${styleText('magenta', '✦')} ${files[i]}`);
  }

  console.log(styleText('dim', `\n  ${n} build-time module${n === 1 ? '' : 's'} inlined`));
}
