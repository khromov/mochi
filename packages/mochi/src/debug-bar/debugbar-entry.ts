/// <reference lib="dom" />
/// <reference lib="dom.iterable" />

import { mount } from 'svelte';
import MochiDebugBar from './MochiDebugBar.svelte';

const target = document.getElementById('mochi-dev-toolbar');
if (target) {
  mount(MochiDebugBar, { target });
}
