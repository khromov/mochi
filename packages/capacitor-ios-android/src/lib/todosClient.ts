import { fetchDevalue } from 'mochi-framework';
import { getTodo, type Todo } from './todos';

// The standalone app runs on its own origin (the dev server, or Capacitor's webview in production), so the web app's
// API is a cross-origin call — keep this absolute, and point it at your deployed web app for a release build.
export const API_ORIGIN = 'http://localhost:3339';

export async function fetchTodo(id: number): Promise<Todo | null> {
  try {
    // Trailing slash: the web app serves with `trailingSlash: 'always'`, and a cross-origin caller must hit the
    // canonical URL directly — the 301 a slashless path gets carries no CORS headers.
    return await fetchDevalue<Todo>(`${API_ORIGIN}/api/todos/${id}/`);
  } catch (err) {
    console.warn(`Falling back to bundled sample data (is the web app running on ${API_ORIGIN}?)`, err);
    return getTodo(id);
  }
}
