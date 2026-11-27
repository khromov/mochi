export function watchAll(values: string[]): void {
  $effect.pre(() => {
    encodeURIComponent(values as unknown as string);
  });
}
