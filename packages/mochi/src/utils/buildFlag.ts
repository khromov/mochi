// A live-binding flag so `import { isBuilding }` reflects the value at access
// time. `markBuilding()` is called by the build CLI (extractServeOptions) before
// it executes the app entry, letting server-setup code skip real-boot side
// effects during a `mochi-framework build`.
export let isBuilding = false;

export function markBuilding(): void {
  isBuilding = true;
}
