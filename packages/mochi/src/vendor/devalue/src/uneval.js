import {
	DevalueError,
	enumerable_symbols,
	escaped,
	get_type,
	is_plain_object,
	is_primitive,
	KEY_CACHE_LIMIT,
	KEY_CACHE_MAX_LENGTH,
	stringify_key,
	stringify_string,
	valid_array_indices
} from './utils.js';

const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_$';
const unsafe_chars = /[<\b\f\n\r\t\0\u2028\u2029]/g;
const reserved =
	/^(?:do|if|in|for|int|let|new|try|var|byte|case|char|else|enum|goto|long|this|void|with|await|break|catch|class|const|final|float|short|super|throw|while|yield|delete|double|export|import|native|return|switch|throws|typeof|boolean|default|extends|finally|package|private|abstract|continue|debugger|function|volatile|interface|protected|transient|implements|instanceof|synchronized)$/;

// See `stringify.js` — path segments are recorded raw and only turned into
// something human-readable if an error is actually thrown.
const KEY_INDEX = 0;
const KEY_PROP = 1;
const KEY_MAP = 2;

/**
 * Turn a value into the JavaScript that creates an equivalent value
 * @param {any} value
 * @param {(value: any, uneval: (value: any) => string) => string | void} [replacer]
 */
export function uneval(value, replacer) {
	const counts = new Map();

	/**
	 * The path to the value currently being walked, as flat `kind, key` pairs
	 * @type {any[]}
	 */
	const keys = [];

	/** How much of `keys` is in use */
	let depth = 0;

	const custom = new Map();

	/** Turns the `keys` stack into the segments `DevalueError` expects */
	function format_keys() {
		/** @type {string[]} */
		const formatted = [];

		for (let i = 0; i < depth; i += 2) {
			const kind = keys[i];
			const key = keys[i + 1];

			if (kind === KEY_INDEX) {
				formatted.push(`[${key}]`);
			} else if (kind === KEY_PROP) {
				formatted.push(stringify_key(key));
			} else {
				formatted.push(`.get(${is_primitive(key) ? stringify_primitive(key) : '...'})`);
			}
		}

		return formatted;
	}

	/** @param {any} thing */
	function walk(thing) {
		if (thing === null) return;

		const primitive_type = typeof thing;

		if (primitive_type !== 'object' && primitive_type !== 'function') {
			if (primitive_type === 'symbol') {
				throw new DevalueError(`Cannot stringify a Symbol primitive`, format_keys(), thing, value);
			}

			return;
		}

		const count = counts.get(thing);

		if (count !== undefined) {
			counts.set(thing, count + 1);
			return;
		}

		counts.set(thing, 1);

		if (replacer) {
			const str = replacer(thing, (value) => uneval(value, replacer));

			if (typeof str === 'string') {
				custom.set(thing, str);
				return;
			}
		}

		if (primitive_type === 'function') {
			throw new DevalueError(`Cannot stringify a function`, format_keys(), thing, value);
		}

		// as in `stringify`, `Object.prototype.toString` is only consulted for
		// the values that aren't arrays or ordinary objects
		let plain = false;

		/** @type {string} */
		let type;

		if (Array.isArray(thing)) {
			type = Symbol.toStringTag in thing ? get_type(thing) : 'Array';
		} else if (Object.getPrototypeOf(thing) === Object.prototype && !(Symbol.toStringTag in thing)) {
			type = 'Object';
			plain = true;
		} else {
			type = get_type(thing);
		}

		switch (type) {
			case 'Number':
			case 'BigInt':
			case 'String':
			case 'Boolean':
			case 'Date':
			case 'RegExp':
			case 'URL':
			case 'URLSearchParams':
				return;

			case 'Array': {
				const array = /** @type {any[]} */ (thing);
				const length = array.length;

				let i = 0;

				for (; i < length; i += 1) {
					const element = array[i];

					// a hole reads as `undefined`, so `hasOwn` only has to
					// settle the ambiguous case
					if (element === undefined && !Object.hasOwn(array, i)) break;

					keys[depth] = KEY_INDEX;
					keys[depth + 1] = i;
					depth += 2;
					walk(element);
					depth -= 2;
				}

				if (i < length) {
					// The array is sparse. Visiting every remaining slot would be
					// O(length) — the DoS that `arr[1000000] = 1` represents — so
					// from here on only the populated indices are visited. They
					// come back in ascending order, which keeps the traversal
					// order (and therefore the assignment of hoisted names)
					// identical to the dense path.
					const populated_keys = valid_array_indices(array);

					for (let j = 0; j < populated_keys.length; j += 1) {
						const key = populated_keys[j];
						const index = +key;

						if (index < i) continue;

						keys[depth] = KEY_INDEX;
						keys[depth + 1] = index;
						depth += 2;
						walk(array[index]);
						depth -= 2;
					}
				}

				break;
			}

			case 'Set':
				for (const item of /** @type {Set<any>} */ (thing)) {
					walk(item);
				}
				break;

			case 'Map':
				for (const [key, value] of /** @type {Map<any, any>} */ (thing)) {
					keys[depth] = KEY_MAP;
					keys[depth + 1] = key;
					depth += 2;
					walk(key);
					walk(value);
					depth -= 2;
				}
				break;

			case 'Int8Array':
			case 'Uint8Array':
			case 'Uint8ClampedArray':
			case 'Int16Array':
			case 'Uint16Array':
			case 'Float16Array':
			case 'Int32Array':
			case 'Uint32Array':
			case 'Float32Array':
			case 'Float64Array':
			case 'BigInt64Array':
			case 'BigUint64Array':
			case 'DataView':
				walk(thing.buffer);
				return;

			case 'ArrayBuffer':
				return;

			case 'Temporal.Duration':
			case 'Temporal.Instant':
			case 'Temporal.PlainDate':
			case 'Temporal.PlainTime':
			case 'Temporal.PlainDateTime':
			case 'Temporal.PlainMonthDay':
			case 'Temporal.PlainYearMonth':
			case 'Temporal.ZonedDateTime':
				return;

			default: {
				// `plain` already establishes that the prototype is `Object.prototype`
				if (!plain && !is_plain_object(thing)) {
					throw new DevalueError(
						`Cannot stringify arbitrary non-POJOs`,
						format_keys(),
						thing,
						value
					);
				}

				// objects with symbol keys are vanishingly rare, and asking
				// whether there are any is much cheaper than asking which of
				// them are enumerable
				if (
					Object.getOwnPropertySymbols(thing).length > 0 &&
					enumerable_symbols(thing).length > 0
				) {
					throw new DevalueError(
						`Cannot stringify POJOs with symbolic keys`,
						format_keys(),
						thing,
						value
					);
				}

				const object_keys = Object.keys(thing);

				for (let i = 0; i < object_keys.length; i += 1) {
					const key = object_keys[i];

					if (key === '__proto__') {
						throw new DevalueError(
							`Cannot stringify objects with __proto__ keys`,
							format_keys(),
							thing,
							value
						);
					}

					keys[depth] = KEY_PROP;
					keys[depth + 1] = key;
					depth += 2;
					walk(thing[key]);
					depth -= 2;
				}
			}
		}
	}

	walk(value);

	const names = new Map();

	/** @type {Array<[any, number]>} */
	const repeated = [];

	for (const entry of counts) {
		if (entry[1] > 1) repeated.push(entry);
	}

	repeated.sort((a, b) => b[1] - a[1]);

	for (let i = 0; i < repeated.length; i += 1) {
		names.set(repeated[i][0], get_name(i));
	}

	/**
	 * @param {any} thing
	 * @returns {string}
	 */
	function stringify(thing) {
		const name = names.get(thing);
		if (name !== undefined) return name;

		if (is_primitive(thing)) {
			return stringify_primitive(thing);
		}

		const replacement = custom.get(thing);
		if (replacement !== undefined) return replacement;

		/** @type {string} */
		let type;

		if (Array.isArray(thing)) {
			type = Symbol.toStringTag in thing ? get_type(thing) : 'Array';
		} else if (Object.getPrototypeOf(thing) === Object.prototype && !(Symbol.toStringTag in thing)) {
			type = 'Object';
		} else {
			type = get_type(thing);
		}

		switch (type) {
			case 'Number':
			case 'String':
			case 'Boolean':
			case 'BigInt':
				return `Object(${stringify(thing.valueOf())})`;

			case 'RegExp':
				const { source, flags } = thing;
				return flags
					? `new RegExp(${stringify_string(source)},"${flags}")`
					: `new RegExp(${stringify_string(source)})`;

			case 'Date':
				return `new Date(${thing.getTime()})`;

			case 'URL':
				return `new URL(${stringify_string(thing.toString())})`;

			case 'URLSearchParams':
				return `new URLSearchParams(${stringify_string(thing.toString())})`;

			case 'Array': {
				// For dense arrays (no holes), we iterate normally.
				// When we encounter the first hole, we call Object.keys
				// to determine the sparseness, then decide between:
				//   - Array literal with holes: [,"a",,] (default)
				//   - Object.assign: Object.assign(Array(n),{...}) (for very sparse arrays)
				// Only the Object.assign path avoids iterating every slot, which
				// is what protects against the DoS of e.g. `arr[1000000] = 1`.
				let has_holes = false;

				let result = '[';

				const length = thing.length;

				for (let i = 0; i < length; i += 1) {
					if (i > 0) result += ',';

					// a hole reads as `undefined`, so the comparatively expensive
					// `hasOwn` is only needed to tell a hole from a stored
					// `undefined`
					const element = thing[i];

					if (element !== undefined || Object.hasOwn(thing, i)) {
						result += stringify(element);
					} else if (!has_holes) {
						// Decide between array literal and Object.assign.
						//
						// Array literal: holes are consecutive commas.
						// For example, [, "a", ,] is written as [,"a",,].
						// Each hole costs 1 char (a comma).
						//
						// Object.assign: populated indices are listed explicitly.
						// For example, [, "a", ,] would be written as
						// Object.assign(Array(3),{1:"a"}). This avoids paying
						// per-hole, but has a large fixed overhead for the
						// "Object.assign(Array(n),{...})" wrapper, and each
						// element costs extra chars for its index and colon.
						//
						// The serialized values are the same size either way, so
						// the choice comes down to the structural overhead:
						//
						//   Array literal overhead:
						//     1 char per element or hole (comma separators)
						//     + 2 chars for "[" and "]"
						//     = L + 2
						//
						//   Object.assign overhead:
						//     "Object.assign(Array(" — 20 chars
						//     + length              — d chars
						//     + "),{"               — 3 chars
						//     + for each populated element:
						//       index + ":" + ","   — (d + 2) chars
						//     + "})"                — 2 chars
						//     = (25 + d) + P * (d + 2)
						//
						// where L is the array length, P is the number of
						// populated elements, and d is the number of digits
						// in L (an upper bound on the digits in any index).
						//
						// Object.assign is cheaper when:
						//   (25 + d) + P * (d + 2) < L + 2
						const populated_keys = valid_array_indices(/** @type {any[]} */ (thing));
						const population = populated_keys.length;
						const d = String(length).length;

						const hole_cost = length + 2;
						const sparse_cost = 25 + d + population * (d + 2);

						if (hole_cost > sparse_cost) {
							let entries = '';
							for (let j = 0; j < populated_keys.length; j += 1) {
								const key = populated_keys[j];
								if (j > 0) entries += ',';
								entries += key + ':' + stringify(thing[key]);
							}
							return `Object.assign(Array(${length}),{${entries}})`;
						}

						has_holes = true;
					}
					// else: already decided on array literal, hole is just an empty slot
					// (the comma separator is all we need — no content for this position)
				}

				const tail = length === 0 || length - 1 in thing ? '' : ',';
				return result + tail + ']';
			}

			case 'Set':
			case 'Map': {
				let result = `new ${type}([`;
				let started = false;

				for (const item of thing) {
					if (started) result += ',';
					started = true;
					result += stringify(item);
				}

				return result + '])';
			}

			case 'Int8Array':
			case 'Uint8Array':
			case 'Uint8ClampedArray':
			case 'Int16Array':
			case 'Uint16Array':
			case 'Float16Array':
			case 'Int32Array':
			case 'Uint32Array':
			case 'Float32Array':
			case 'Float64Array':
			case 'BigInt64Array':
			case 'BigUint64Array': {
				let str = `new ${type}`;

				if (!names.has(thing.buffer)) {
					str += `([${stringify_typed_array_elements(type, thing.buffer)}])`;
				} else {
					str += `(${stringify(thing.buffer)})`;
				}

				// handle subarrays
				if (thing.byteLength !== thing.buffer.byteLength) {
					const start = thing.byteOffset / thing.BYTES_PER_ELEMENT;
					const end = start + thing.length;
					str += `.subarray(${start},${end})`;
				}

				return str;
			}

			case 'DataView': {
				let str = `new DataView`;

				if (!names.has(thing.buffer)) {
					str += `(new Uint8Array([${new Uint8Array(thing.buffer)}]).buffer`;
				} else {
					str += `(${stringify(thing.buffer)}`;
				}

				// handle subviews
				if (thing.byteLength !== thing.buffer.byteLength) {
					str += `,${thing.byteOffset},${thing.byteLength}`;
				}

				return str + ')';
			}

			case 'ArrayBuffer': {
				const ui8 = new Uint8Array(thing);
				return `new Uint8Array([${ui8.toString()}]).buffer`;
			}

			case 'Temporal.Duration':
			case 'Temporal.Instant':
			case 'Temporal.PlainDate':
			case 'Temporal.PlainTime':
			case 'Temporal.PlainDateTime':
			case 'Temporal.PlainMonthDay':
			case 'Temporal.PlainYearMonth':
			case 'Temporal.ZonedDateTime':
				return `${type}.from(${stringify_string(thing.toString())})`;

			default: {
				const object_keys = Object.keys(thing);

				let result = '{';

				for (let i = 0; i < object_keys.length; i += 1) {
					const key = object_keys[i];
					if (i > 0) result += ',';
					result += safe_key(key) + ':' + stringify(thing[key]);
				}

				if (Object.getPrototypeOf(thing) === null) {
					return object_keys.length > 0 ? result + ',__proto__:null}' : '{__proto__:null}';
				}

				return result + '}';
			}
		}
	}

	const str = stringify(value);

	if (names.size) {
		/** @type {string[]} */
		const params = [];

		/** @type {string[]} */
		const statements = [];

		/** @type {string[]} */
		const values = [];

		// Reconstructions (e.g. `b = new Uint8Array(...)`) reassign a placeholder
		// parameter. They must run before the `statements` that reference them,
		// otherwise those statements capture the placeholder. They only depend on
		// IIFE arguments (never on each other), so emitting them first is safe.
		/** @type {string[]} */
		const reconstructions = [];

		names.forEach((name, thing) => {
			params.push(name);

			if (custom.has(thing)) {
				values.push(/** @type {string} */ (custom.get(thing)));
				return;
			}

			if (is_primitive(thing)) {
				values.push(stringify_primitive(thing));
				return;
			}

			const type = get_type(thing);

			switch (type) {
				case 'Number':
				case 'String':
				case 'Boolean':
				case 'BigInt':
					values.push(`Object(${stringify(thing.valueOf())})`);
					break;

				case 'RegExp':
					const { source, flags } = thing;
					const regexp = flags
						? `new RegExp(${stringify_string(source)},"${flags}")`
						: `new RegExp(${stringify_string(source)})`;
					values.push(regexp);
					break;

				case 'Date':
					values.push(`new Date(${thing.getTime()})`);
					break;

				case 'URL':
					values.push(`new URL(${stringify_string(thing.toString())})`);
					break;

				case 'URLSearchParams':
					values.push(`new URLSearchParams(${stringify_string(thing.toString())})`);
					break;

				case 'Array':
					values.push(`Array(${thing.length})`);
					/** @type {any[]} */ (thing).forEach((v, i) => {
						statements.push(`${name}[${i}]=${stringify(v)}`);
					});
					break;

				case 'Set': {
					values.push(`new Set`);
					const adds = Array.from(thing).map((v) => `.add(${stringify(v)})`);
					// An empty Set is fully built by `new Set`; a chained statement would
					// otherwise be a dangling `name.`.
					if (adds.length > 0) statements.push(name + adds.join(''));
					break;
				}

				case 'Map': {
					values.push(`new Map`);
					const sets = Array.from(thing).map(([k, v]) => `.set(${stringify(k)}, ${stringify(v)})`);
					if (sets.length > 0) statements.push(name + sets.join(''));
					break;
				}

				case 'Int8Array':
				case 'Uint8Array':
				case 'Uint8ClampedArray':
				case 'Int16Array':
				case 'Uint16Array':
				case 'Float16Array':
				case 'Int32Array':
				case 'Uint32Array':
				case 'Float32Array':
				case 'Float64Array':
				case 'BigInt64Array':
				case 'BigUint64Array': {
					let str = `new ${type}`;

					if (!names.has(thing.buffer)) {
						str += `([${stringify_typed_array_elements(type, thing.buffer)}])`;
					} else {
						str += `(${stringify(thing.buffer)})`;
					}

					// handle subarrays
					if (thing.byteLength !== thing.buffer.byteLength) {
						const start = thing.byteOffset / thing.BYTES_PER_ELEMENT;
						const end = start + thing.length;
						str += `.subarray(${start},${end})`;
					}

					values.push(`{}`);
					reconstructions.push(`${name}=${str}`);
					break;
				}

				case 'DataView': {
					let str = `new DataView`;

					if (!names.has(thing.buffer)) {
						str += `(new Uint8Array([${new Uint8Array(thing.buffer)}]).buffer`;
					} else {
						str += `(${stringify(thing.buffer)}`;
					}

					// handle subviews
					if (thing.byteLength !== thing.buffer.byteLength) {
						str += `,${thing.byteOffset},${thing.byteLength}`;
					}

					str += ')';

					values.push(`{}`);
					reconstructions.push(`${name}=${str}`);
					break;
				}

				case 'ArrayBuffer':
					values.push(`new Uint8Array([${new Uint8Array(thing)}]).buffer`);
					break;

				case 'Temporal.Duration':
				case 'Temporal.Instant':
				case 'Temporal.PlainDate':
				case 'Temporal.PlainTime':
				case 'Temporal.PlainDateTime':
				case 'Temporal.PlainMonthDay':
				case 'Temporal.PlainYearMonth':
				case 'Temporal.ZonedDateTime':
					values.push(`${type}.from(${stringify_string(thing.toString())})`);
					break;

				default:
					values.push(Object.getPrototypeOf(thing) === null ? 'Object.create(null)' : '{}');
					Object.keys(thing).forEach((key) => {
						statements.push(`${name}${safe_prop(key)}=${stringify(thing[key])}`);
					});
			}
		});

		statements.push(`return ${str}`);

		const body = [...reconstructions, ...statements].join(';');
		// A function may have at most 65535 parameters (and a call at most that
		// many arguments). For very large graphs, pass the hoisted values as a
		// single array argument and destructure them into the placeholder names,
		// so the emitted code stays within the engine limit (#93).
		if (params.length > 65534) {
			return `(function(){var[${params.join(',')}]=arguments[0];${body}}([${values.join(',')}]))`;
		}

		return `(function(${params.join(',')}){${body}}(${values.join(',')}))`;
	} else {
		return str;
	}
}

/**
 * Serialize the elements of `buffer`, read as `type`, as a comma-separated list.
 * The view is created from `type` rather than from the serialized value's own
 * constructor, which may be a subclass like Node's `Buffer` whose `toString`
 * decodes the bytes instead of listing them.
 * `BigInt64Array`/`BigUint64Array` elements are bigints and must be written
 * with an `n` suffix, otherwise the emitted `new BigInt64Array([...])` throws.
 * @param {string} type
 * @param {ArrayBufferLike} buffer
 */
function stringify_typed_array_elements(type, buffer) {
	const array = new (/** @type {any} */ (globalThis)[type])(buffer);

	if (type === 'BigInt64Array' || type === 'BigUint64Array') {
		return Array.from(array, (element) => `${element}n`).join(',');
	}

	// Float arrays can hold `-0`, which `toString()` collapses to `"0"`, silently
	// losing the sign on round-trip. Emit `-0` explicitly for those elements.
	if (
		array instanceof Float32Array ||
		array instanceof Float64Array ||
		(typeof Float16Array !== 'undefined' && array instanceof Float16Array)
	) {
		return Array.from(array, (element) => (Object.is(element, -0) ? '-0' : `${element}`)).join(',');
	}

	return array.toString();
}

/** @param {number} num */
function get_name(num) {
	let name = '';

	do {
		name = chars[num % chars.length] + name;
		num = ~~(num / chars.length) - 1;
	} while (num >= 0);

	return reserved.test(name) ? `${name}0` : name;
}

/** @param {string} c */
function escape_unsafe_char(c) {
	return escaped[c] || c;
}

/** @param {string} str */
function escape_unsafe_chars(str) {
	return str.replace(unsafe_chars, escape_unsafe_char);
}

const is_identifier = /^[_$a-zA-Z][_$a-zA-Z0-9]*$/;

/**
 * Object keys repeat heavily across a payload — every record of the same shape
 * shares them — so the identifier test and the escaping it guards are memoized,
 * under the same bounds as the `stringify` key cache.
 * @type {Map<string, string>}
 */
const key_cache = new Map();

/** @param {string} key */
function safe_key(key) {
	const cached = key_cache.get(key);
	if (cached !== undefined) return cached;

	const safe = is_identifier.test(key) ? key : escape_unsafe_chars(JSON.stringify(key));

	if (key.length <= KEY_CACHE_MAX_LENGTH && key_cache.size < KEY_CACHE_LIMIT) {
		key_cache.set(key, safe);
	}

	return safe;
}

/** @param {string} key */
function safe_prop(key) {
	return is_identifier.test(key) ? `.${key}` : `[${escape_unsafe_chars(JSON.stringify(key))}]`;
}

/** @param {any} thing */
function stringify_primitive(thing) {
	const type = typeof thing;

	if (type === 'string') return stringify_string(thing);

	if (type === 'number') {
		if (thing === 0 && 1 / thing < 0) return '-0';

		const str = String(thing);

		// a leading zero before the decimal point is redundant: `0.5` -> `.5`
		if (str.charCodeAt(0) === 48 /* 0 */ && str.charCodeAt(1) === 46 /* . */) {
			return str.slice(1);
		}

		if (
			str.charCodeAt(0) === 45 /* - */ &&
			str.charCodeAt(1) === 48 /* 0 */ &&
			str.charCodeAt(2) === 46 /* . */
		) {
			return '-' + str.slice(2);
		}

		return str;
	}

	if (thing === void 0) return 'void 0';
	if (type === 'bigint') return thing + 'n';

	return String(thing);
}
