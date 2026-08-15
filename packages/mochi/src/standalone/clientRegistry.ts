import type { Component } from 'svelte';

// Route descriptors carry the authored component path string; the generated standalone entry imports each `.svelte`
// and registers it here before app.ts runs, so the router can look components up by that same string.
const registry = new Map<string, Component>();

export function registerRouteComponent(componentPath: string, component: Component): void {
  registry.set(componentPath, component);
}

export function getRouteComponent(componentPath: string): Component | undefined {
  return registry.get(componentPath);
}
