import { defineSyncQueries, t } from 'mochi-framework/sync';

export type Todo = { id: string; text: string; done: boolean };

export const queries = defineSyncQueries({
  todos: { row: t<Todo>() },
});
