export async function delay(min: number, max?: number): Promise<void> {
  const ms = max === undefined ? min : Math.floor(min + Math.random() * (max - min));
  await new Promise((resolve) => setTimeout(resolve, ms));
}
