import { demos, categoryLabels, categoryOrder, type Demo, type DemoCategory } from '../lib/demos';

export interface DemoGroup {
  category: DemoCategory;
  label: string;
  items: Demo[];
}

export const demoGroups: DemoGroup[] = categoryOrder
  .map((category) => ({
    category,
    label: categoryLabels[category],
    items: demos.filter((d) => d.category === category),
  }))
  .filter((g) => g.items.length > 0);

export const demoCount = demos.length;
