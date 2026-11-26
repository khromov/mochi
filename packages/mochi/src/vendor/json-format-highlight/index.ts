// Vendored from https://github.com/luyilin/json-format-highlight/tree/master 1.0.4
const defaultColors = {
  keyColor: 'dimgray',
  numberColor: 'lightskyblue',
  stringColor: 'lightcoral',
  trueColor: 'lightseagreen',
  falseColor: '#f66578',
  nullColor: 'cornflowerblue',
};

export default function (json: unknown, colorOptions = {}) {
  const valueType = typeof json;
  let str: string;
  if (valueType !== 'string') {
    str = JSON.stringify(json, null, 2) || valueType;
  } else {
    str = json as string;
  }
  const colors = Object.assign({}, defaultColors, colorOptions);
  // Upstream's escape pass replaced each character with itself, so keys reached {@html} raw.
  str = str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return str.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+]?\d+)?)/g, (match: string) => {
    let color = colors.numberColor;
    let style = '';
    if (/^"/.test(match)) {
      if (/:$/.test(match)) {
        color = colors.keyColor;
      } else {
        color = colors.stringColor;
        style = 'word-wrap:break-word;white-space:pre-wrap;';
      }
    } else {
      color = /true/.test(match) ? colors.trueColor : /false/.test(match) ? colors.falseColor : /null/.test(match) ? colors.nullColor : color;
    }
    return `<span style="${style}color:${color}">${match}</span>`;
  });
}
