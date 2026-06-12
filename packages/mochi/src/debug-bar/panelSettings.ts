export const HIDDEN_PANELS_KEY = 'mochi:debug:hidden-panels';

export const CONFIGURABLE_PANELS = ['info', 'request', 'islands', 'warnings', 'bundles'] as const;

export type ConfigurablePanel = (typeof CONFIGURABLE_PANELS)[number];

export const PANEL_LABELS: Record<ConfigurablePanel, string> = {
  info: 'Info',
  request: 'Request',
  islands: 'Islands',
  warnings: 'Warnings',
  bundles: 'JS Bundles',
};

export function parseHiddenPanels(raw: string | null): ConfigurablePanel[] {
  if (!raw) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  const hidden = [...new Set(parsed)].filter((p): p is ConfigurablePanel => CONFIGURABLE_PANELS.includes(p as ConfigurablePanel));
  // At least one panel must stay enabled — an all-hidden value is treated as corrupt and reset.
  return hidden.length === CONFIGURABLE_PANELS.length ? [] : hidden;
}

export function canToggle(hidden: ConfigurablePanel[], panel: ConfigurablePanel): boolean {
  if (hidden.includes(panel)) {
    return true;
  }
  return hidden.length < CONFIGURABLE_PANELS.length - 1;
}
