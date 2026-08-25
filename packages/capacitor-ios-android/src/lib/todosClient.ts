import { fetchDevalue, MochiFetchError } from 'mochi-framework';
import { getTodo, listTodos, type Todo } from './todos';

// The standalone app runs on its own origin (the dev server, or Capacitor's webview in production), so the web app's
// API is a cross-origin call — keep this absolute, and point it at your deployed web app for a release build.
export const API_ORIGIN = 'http://localhost:3339';

// Degradation pattern: every fetch resolves to data plus an `offline` flag. A MochiFetchError means the server
// answered (a 404 is a real "not found", not connectivity) — only a network-level failure counts as offline, and then
// the bundled sample data stands in for a local cache so the UI can show an offline notice instead of nothing.
export async function fetchTodos(): Promise<{ todos: Todo[]; offline: boolean }> {
  try {
    // No trailing slash: `trailingSlash` applies to page routes only, so an API route answers on exactly its declared
    // pattern — and a cross-origin caller has to hit that canonical URL anyway, since redirects carry no CORS headers.
    return { todos: await fetchDevalue<Todo[]>(`${API_ORIGIN}/api/todos`), offline: false };
  } catch (err) {
    if (err instanceof MochiFetchError) {
      return { todos: [], offline: false };
    }
    return { todos: listTodos(), offline: true };
  }
}

export async function fetchTodo(id: number): Promise<{ todo: Todo | null; offline: boolean }> {
  try {
    return { todo: await fetchDevalue<Todo>(`${API_ORIGIN}/api/todos/${id}`), offline: false };
  } catch (err) {
    if (err instanceof MochiFetchError) {
      return { todo: null, offline: false };
    }
    return { todo: getTodo(id), offline: true };
  }
}
