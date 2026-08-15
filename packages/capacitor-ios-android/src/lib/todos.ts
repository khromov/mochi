export interface Todo {
  id: number;
  title: string;
  due: Date;
  done: boolean;
}

// Isomorphic sample data: the web app's API serves it, and the standalone app bundles it as an offline fallback.
const TODOS: Todo[] = [
  { id: 1, title: 'Ship the web app', due: new Date('2026-09-01T09:00:00.000Z'), done: true },
  { id: 2, title: 'Wrap it with Capacitor', due: new Date('2026-09-15T09:00:00.000Z'), done: false },
  { id: 3, title: 'Release on the app stores', due: new Date('2026-10-01T09:00:00.000Z'), done: false },
];

export function listTodos(): Todo[] {
  return TODOS;
}

export function getTodo(id: number): Todo | null {
  return TODOS.find((todo) => todo.id === id) ?? null;
}
