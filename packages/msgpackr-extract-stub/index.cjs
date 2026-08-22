// Falsy export, not `{}`: msgpackr does `extractor = require('msgpackr-extract')`
// then `if (extractor) setExtractor(extractor.extractStrings)`. A truthy `{}`
// would pass that guard and call setExtractor(undefined), enabling native
// acceleration with a missing extractStrings and crashing on string decode.
// Returning a falsy value takes the same path as the module being absent:
// msgpackr stays on its pure-JS fallback.
module.exports = false;
