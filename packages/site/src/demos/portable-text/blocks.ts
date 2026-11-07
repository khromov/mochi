import type { InputValue } from '@portabletext/svelte';

// Every block and span carries an explicit _key: the renderer mints Math.random() keys for
// missing ones, which would differ between the server render and the hydrated one.

export const playground = [
  {
    _type: 'block',
    _key: 'pg1',
    style: 'h3',
    children: [{ _type: 'span', _key: 'pg1s1', text: 'A rendered heading' }],
  },
  {
    _type: 'block',
    _key: 'pg2',
    style: 'normal',
    children: [
      { _type: 'span', _key: 'pg2s1', text: 'A paragraph with a ' },
      { _type: 'span', _key: 'pg2s2', text: 'highlighted', marks: ['highlight'] },
      { _type: 'span', _key: 'pg2s3', text: ' word.' },
    ],
  },
  { _type: 'callout', _key: 'pg3', text: 'And a custom callout block.' },
] satisfies InputValue;

export const playgroundJson = JSON.stringify(playground, null, 2);
