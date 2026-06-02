<script lang="ts">
  // Rendered as literal text, the way a docs page shows the placeholder name.
  // Svelte treats `{` as an expression delimiter, so it comes from a string.
  const placeholder = '{{mochi.script}}';

  // `$&`, `` $` ``, `$'`, `$$` are special replacement patterns for string-form
  // `String.prototype.replace`. Minified JS and serialized props can contain
  // them; the function-form replacer must emit them verbatim. Body slot text
  // flows through the replacer, so put the sequences here to exercise it.
  const dollars = "a$&b$`c$'d$$e";
</script>

<p>Use {placeholder} in your shell.</p>
<pre>{dollars}</pre>
