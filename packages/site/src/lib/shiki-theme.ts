import type { ThemeRegistrationRaw } from 'shiki';

export const mochiTheme: ThemeRegistrationRaw = {
  name: 'mochi',
  type: 'dark',
  settings: [],
  colors: {
    'editor.background': '#10140f',
    'editor.foreground': '#e8e6dd',
  },
  tokenColors: [
    {
      scope: ['comment', 'punctuation.definition.comment'],
      settings: { foreground: '#72786c', fontStyle: 'italic' },
    },
    {
      scope: ['keyword', 'storage.type', 'storage.modifier', 'constant.language', 'support.type.builtin'],
      settings: { foreground: '#a7c9a8' },
    },
    {
      scope: ['string', 'string.quoted', 'string.template'],
      settings: { foreground: '#d5b982' },
    },
    {
      scope: ['constant.numeric', 'constant.character'],
      settings: { foreground: '#e9a89a' },
    },
    {
      scope: ['entity.name.function', 'support.function', 'meta.function-call'],
      settings: { foreground: '#e8e6dd' },
    },
    {
      scope: ['entity.name.type', 'entity.name.class', 'support.class', 'entity.other.inherited-class'],
      settings: { foreground: '#c7e0cd' },
    },
    {
      scope: ['variable', 'variable.other', 'entity.other.attribute-name', 'meta.object-literal.key'],
      settings: { foreground: '#b8d5be' },
    },
    {
      scope: ['entity.name.tag', 'support.type.property-name.css'],
      settings: { foreground: '#8fb097' },
    },
    {
      scope: ['punctuation', 'meta.brace', 'meta.delimiter'],
      settings: { foreground: '#e8e6dd' },
    },
    {
      scope: ['keyword.operator'],
      settings: { foreground: '#a7c9a8' },
    },
    {
      scope: ['constant.other.placeholder', 'string.interpolated'],
      settings: { foreground: '#e9a89a' },
    },
    {
      scope: ['markup.deleted', 'punctuation.definition.deleted'],
      settings: { foreground: '#e9a89a' },
    },
    {
      scope: ['markup.inserted', 'punctuation.definition.inserted'],
      settings: { foreground: '#d5b982' },
    },
    {
      scope: ['markup.italic'],
      settings: { fontStyle: 'italic' },
    },
    {
      scope: ['markup.bold'],
      settings: { fontStyle: 'bold' },
    },
  ],
};
