// A fragment that carries hydratables leads with `<template data-mochi-bootstrap="<url>">`: the island endpoint
// writes it and `<mochi-server-island>` imports the named module, because a `<script>` inserted via `innerHTML`
// never runs. Shared here so the server and the inline client bundle agree on the attribute.
export const BOOTSTRAP_MARKER_ATTR = 'data-mochi-bootstrap';
