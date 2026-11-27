export const lazyValue = `loaded at ${import.meta.url}`;
export default function describe(): string {
  return lazyValue;
}
