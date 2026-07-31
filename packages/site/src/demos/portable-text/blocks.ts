import type { InputValue } from '@portabletext/svelte';

// Every block and span carries an explicit _key: the renderer mints Math.random() keys for
// missing ones, which would differ between the server render and the hydrated one.

export const basics = [
  {
    _type: 'block',
    _key: 'ba1',
    style: 'h2',
    children: [{ _type: 'span', _key: 'ba1s1', text: 'Portable Text is just JSON' }],
  },
  {
    _type: 'block',
    _key: 'ba2',
    style: 'normal',
    markDefs: [{ _type: 'link', _key: 'ba2l1', href: 'https://portabletext.org' }],
    children: [
      { _type: 'span', _key: 'ba2s1', text: 'Text lives in spans, and ' },
      { _type: 'span', _key: 'ba2s2', text: 'strong', marks: ['strong'] },
      { _type: 'span', _key: 'ba2s3', text: ', ' },
      { _type: 'span', _key: 'ba2s4', text: 'emphasis', marks: ['em'] },
      { _type: 'span', _key: 'ba2s5', text: ', ' },
      { _type: 'span', _key: 'ba2s6', text: 'code', marks: ['code'] },
      { _type: 'span', _key: 'ba2s7', text: ' and ' },
      { _type: 'span', _key: 'ba2s8', text: 'links', marks: ['ba2l1'] },
      { _type: 'span', _key: 'ba2s9', text: ' render with no configuration at all.' },
    ],
  },
  {
    _type: 'block',
    _key: 'ba3',
    style: 'blockquote',
    children: [{ _type: 'span', _key: 'ba3s1', text: 'Styles, decorators and annotations all have sensible defaults.' }],
  },
  {
    _type: 'block',
    _key: 'ba4',
    listItem: 'bullet',
    level: 1,
    children: [{ _type: 'span', _key: 'ba4s1', text: 'Bulleted lists' }],
  },
  {
    _type: 'block',
    _key: 'ba5',
    listItem: 'bullet',
    level: 1,
    children: [{ _type: 'span', _key: 'ba5s1', text: '…nest by level' }],
  },
  {
    _type: 'block',
    _key: 'ba6',
    listItem: 'number',
    level: 1,
    children: [{ _type: 'span', _key: 'ba6s1', text: 'And numbered ones too' }],
  },
] satisfies InputValue;

export const customTypes = [
  {
    _type: 'callout',
    _key: 'ct1',
    tone: 'info',
    text: 'A block-level callout — a type the Portable Text spec knows nothing about.',
  },
  {
    _type: 'block',
    _key: 'ct2',
    style: 'normal',
    children: [
      { _type: 'span', _key: 'ct2s1', text: 'The same type can also sit inline between spans — ' },
      { _type: 'callout', _key: 'ct2c1', tone: 'note', text: 'like this' },
      { _type: 'span', _key: 'ct2s2', text: ' — and the component tells the two apart with isInline.' },
    ],
  },
] satisfies InputValue;

export const customMarks = [
  {
    _type: 'block',
    _key: 'cm1',
    style: 'normal',
    markDefs: [{ _type: 'absUrl', _key: 'cm1a1', url: 'https://portabletext.org', newWindow: true }],
    children: [
      { _type: 'span', _key: 'cm1s1', text: 'An annotation carries data, so ' },
      { _type: 'span', _key: 'cm1s2', text: 'this link', marks: ['cm1a1'] },
      { _type: 'span', _key: 'cm1s3', text: ' knows its own URL. A decorator carries none, so ' },
      { _type: 'span', _key: 'cm1s4', text: 'this highlight', marks: ['highlight'] },
      { _type: 'span', _key: 'cm1s5', text: ' only wraps its children.' },
    ],
  },
] satisfies InputValue;

export const customStyles = [
  {
    _type: 'block',
    _key: 'cs1',
    style: 'h2',
    children: [{ _type: 'span', _key: 'cs1s1', text: 'A heading' }],
  },
  {
    _type: 'block',
    _key: 'cs2',
    style: 'h3',
    children: [{ _type: 'span', _key: 'cs2s1', text: 'Directly under another heading' }],
  },
  {
    _type: 'block',
    _key: 'cs3',
    style: 'normal',
    children: [{ _type: 'span', _key: 'cs3s1', text: 'A paragraph breaks the run.' }],
  },
  {
    _type: 'block',
    _key: 'cs4',
    style: 'h3',
    children: [{ _type: 'span', _key: 'cs4s1', text: 'So this one gets more room above' }],
  },
] satisfies InputValue;

export const checklist = [
  {
    _type: 'block',
    _key: 'cl1',
    listItem: 'checklist',
    level: 1,
    checked: true,
    children: [{ _type: 'span', _key: 'cl1s1', text: 'Register a list component' }],
  },
  {
    _type: 'block',
    _key: 'cl2',
    listItem: 'checklist',
    level: 1,
    checked: true,
    children: [{ _type: 'span', _key: 'cl2s1', text: 'Register a listItem component' }],
  },
  {
    _type: 'block',
    _key: 'cl3',
    listItem: 'checklist',
    level: 1,
    checked: false,
    children: [{ _type: 'span', _key: 'cl3s1', text: 'Invent a list type the spec never had' }],
  },
] satisfies InputValue;

export interface Footnote {
  _key: string;
  _type: 'footnote';
  note: InputValue;
}

export const annotated = [
  {
    _type: 'block',
    _key: 'fn1',
    style: 'normal',
    markDefs: [
      {
        _type: 'footnote',
        _key: 'fnA',
        note: [
          {
            _type: 'block',
            _key: 'fnAn1',
            style: 'normal',
            markDefs: [{ _type: 'link', _key: 'fnAl1', href: 'https://www.sanity.io/docs/presenting-block-text' }],
            children: [
              { _type: 'span', _key: 'fnAn1s1', text: 'Portable Text was designed at Sanity — ' },
              { _type: 'span', _key: 'fnAn1s2', text: 'see the spec', marks: ['fnAl1'] },
              { _type: 'span', _key: 'fnAn1s3', text: '.' },
            ],
          },
        ],
      },
      {
        _type: 'footnote',
        _key: 'fnB',
        note: [
          {
            _type: 'block',
            _key: 'fnBn1',
            style: 'normal',
            children: [{ _type: 'span', _key: 'fnBn1s1', text: 'Numbering is a front-end concern, so editors never touch it.' }],
          },
        ],
      },
    ],
    children: [
      { _type: 'span', _key: 'fn1s1', text: 'Editors annotate a phrase ' },
      { _type: 'span', _key: 'fn1s2', text: 'with a footnote', marks: ['fnA'] },
      { _type: 'span', _key: 'fn1s3', text: ' and write only its contents. ' },
      { _type: 'span', _key: 'fn1s4', text: 'A second one', marks: ['fnB'] },
      { _type: 'span', _key: 'fn1s5', text: ' picks up the next number automatically.' },
    ],
  },
] satisfies InputValue;

export const unknown = [
  {
    _type: 'block',
    _key: 'un1',
    style: 'legalese',
    children: [{ _type: 'span', _key: 'un1s1', text: 'An unregistered block style still renders its text.' }],
  },
  { _type: 'chart', _key: 'un2', dataset: 'q3-revenue' },
  {
    _type: 'block',
    _key: 'un3',
    listItem: 'todo',
    level: 1,
    children: [{ _type: 'span', _key: 'un3s1', text: 'An unregistered list style falls back to a plain list.' }],
  },
] satisfies InputValue;

export const playground = [
  {
    _type: 'block',
    _key: 'pg1',
    style: 'h3',
    children: [{ _type: 'span', _key: 'pg1s1', text: 'Edit me' }],
  },
  {
    _type: 'block',
    _key: 'pg2',
    style: 'normal',
    children: [
      { _type: 'span', _key: 'pg2s1', text: 'Change the JSON and the ' },
      { _type: 'span', _key: 'pg2s2', text: 'output', marks: ['highlight'] },
      { _type: 'span', _key: 'pg2s3', text: ' follows.' },
    ],
  },
  { _type: 'callout', _key: 'pg3', tone: 'info', text: 'Try adding another block.' },
] satisfies InputValue;

export const playgroundJson = JSON.stringify(playground, null, 2);

export function collectFootnotes(value: InputValue): Footnote[] {
  const blocks = Array.isArray(value) ? value : [value];
  return blocks.flatMap((block) => (block._type === 'block' && Array.isArray(block.markDefs) ? (block.markDefs.filter((def) => def._type === 'footnote') as Footnote[]) : []));
}
