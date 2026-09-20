import {
	DevalueError,
	get_type,
	stringify_key,
	stringify_object_key,
	stringify_string
} from './utils.js';
import {
	HOLE,
	NAN,
	NEGATIVE_INFINITY,
	NEGATIVE_ZERO,
	POSITIVE_INFINITY,
	SPARSE,
	UNDEFINED
} from './constants.js';
import { encode64 } from './base64.js';
import { default_stringify_operations, merge_operations } from './operations.js';

// The kinds of segment that can appear in the path to the value being
// flattened. They are pushed onto the `keys` stack alongside the raw key, so
// that turning a path into something human-readable — which involves regexes,
// string building, and for `Map` keys serializing the key itself — only
// happens if an error is actually thrown.
const KEY_INDEX = 0;
const KEY_PROP = 1;
const KEY_MAP = 2;

/**
 * Turn a value into a JSON string that can be parsed with `devalue.parse`
 * @param {any} value
 * @param {Record<string, (value: any) => any>} [reducers]
 * @param {import('./types.js').StringifyOptions} [options]
 */
export function stringify(value, reducers, options) {
	const stringified = run(false, value, reducers, options);
	return typeof stringified === 'string' ? stringified : `[${stringified.join(',')}]`;
}

/**
 * Turn a value into a JSON string that can be parsed with `devalue.parse`
 * @param {any} value
 * @param {Record<string, (value: any) => any>} [reducers]
 * @param {import('./types.js').StringifyOptions} [options]
 */
export async function stringifyAsync(value, reducers, options) {
	const stringified = run(true, value, reducers, options);

	if (typeof stringified === 'string') {
		return stringified;
	}

	let out = '[';

	for (let i = 0; i < stringified.length; i += 1) {
		let value = stringified[i];

		if (typeof value !== 'string') {
			await value;
			value = stringified[i];

			if (i === 0 && value < 0) {
				return `${value}`;
			}
		}

		out += value;

		if (i < stringified.length - 1) {
			out += ',';
		}
	}

	out += ']';

	return out;
}

/**
 * @param {boolean} async
 * @param {any} value
 * @param {Record<string, (value: any) => any>} [reducers]
 * @param {import('./types.js').StringifyOptions} [options]
 */
function run(async, value, reducers, options) {
	const ops = merge_operations(default_stringify_operations, options?.operations);

	// When nothing is overridden, every operation is known to be the plain
	// host-JavaScript one, so the hot paths below inline those semantics rather
	// than paying for an indirect call per introspection. The `ops` object is
	// still consulted everywhere the inlined form wouldn't pay for itself.
	const native = ops === default_stringify_operations;

	/** @type {any[]} */
	const stringified = [];

	/** @type {Map<any, number>} */
	const indexes = new Map();

	/** @type {string[]} */
	const reducer_keys = [];

	/** @type {Array<(value: any) => any>} */
	const reducer_fns = [];

	if (reducers) {
		for (const key of Object.getOwnPropertyNames(reducers)) {
			reducer_keys.push(key);
			reducer_fns.push(reducers[key]);
		}
	}

	const reducer_count = reducer_keys.length;

	/**
	 * The path to the value currently being flattened, as flat `kind, key`
	 * pairs. Segments are stored raw — and written by index, rather than
	 * pushed and popped — so that descending into a property costs two stores.
	 * They are only formatted if an error is thrown.
	 * @type {any[]}
	 */
	const keys = [];

	/** How much of `keys` is in use */
	let depth = 0;

	/** The next unclaimed slot in `stringified` */
	let p = 0;

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
				const key_type = ops.typeOf(key);
				const key_is_primitive =
					key_type !== 'object' && key_type !== 'function' && key_type !== 'symbol';

				formatted.push(
					`.get(${key_is_primitive ? stringify_primitive(ops.toPrimitive(key)) : '...'})`
				);
			}
		}

		return formatted;
	}

	/**
	 * @param {any} thing
	 * @param {number} [index]
	 */
	function flatten(thing, index) {
		const type = native ? (thing === null ? 'null' : typeof thing) : ops.typeOf(thing);

		if (type === 'undefined') return UNDEFINED;

		/** @type {number | undefined} */
		let number;

		// `ops.toPrimitive` is the boundary between the value being serialized and
		// plain host JavaScript: everything below operates on the extracted host
		// primitive, so native comparisons and arithmetic are correct there.
		if (type === 'number') {
			number = /** @type {number} */ (native ? thing : ops.toPrimitive(thing));
			if (Number.isNaN(number)) return NAN;
			if (number === Infinity) return POSITIVE_INFINITY;
			if (number === -Infinity) return NEGATIVE_INFINITY;
			if (number === 0 && 1 / number < 0) return NEGATIVE_ZERO;
		}

		const id = native ? thing : ops.identify(thing);

		// indexes are always non-negative integers, so `undefined` is an
		// unambiguous "not seen yet" and one lookup does the work of two
		const seen = indexes.get(id);
		if (seen !== undefined) return seen;

		index ??= p++;

		indexes.set(id, index);

		for (let i = 0; i < reducer_count; i += 1) {
			const value = reducer_fns[i](thing);
			if (value) {
				stringified[index] = `["${reducer_keys[i]}",${flatten(value)}]`;
				return index;
			}
		}

		/** @type {string | Promise<any>} */
		let str = '';

		if (type !== 'object') {
			// neither of these is reachable for an object, so the checks live
			// on the branch that can actually see them
			if (type === 'function') {
				throw new DevalueError(`Cannot stringify a function`, format_keys(), thing, value);
			}

			if (type === 'symbol') {
				throw new DevalueError(`Cannot stringify a Symbol primitive`, format_keys(), thing, value);
			}

			str = stringify_primitive(type === 'number' ? number : native ? thing : ops.toPrimitive(thing));
		} else if (native ? typeof thing.then === 'function' : ops.isThenable(thing)) {
			if (!async) {
				throw new DevalueError(
					`Cannot stringify a Promise or thenable — use stringifyAsync instead`,
					format_keys(),
					thing,
					value
				);
			}

			str = ops.toPromise(thing).then((value) => {
				const i = flatten(value, index);
				if (i < 0) stringified[index] = i;
			});
		} else {
			/** @type {string} */
			let tag;

			// set when the fast dispatch below has already established that
			// `thing` is a plain object with `Object.prototype` as its prototype
			let plain = false;

			if (native) {
				// `Object.prototype.toString` allocates, and is only needed for
				// the values that aren't arrays or ordinary objects. Both of
				// those shortcuts have to defer to it when the value carries a
				// `Symbol.toStringTag`, which would override the built-in tag.
				if (Array.isArray(thing)) {
					tag = Symbol.toStringTag in thing ? get_type(thing) : 'Array';
				} else if (
					Object.getPrototypeOf(thing) === Object.prototype &&
					!(Symbol.toStringTag in thing)
				) {
					tag = 'Object';
					plain = true;
				} else {
					tag = get_type(thing);
				}
			} else {
				tag = ops.tagOf(thing);
			}

			switch (tag) {
				case 'Number':
				case 'String':
				case 'Boolean':
				case 'BigInt':
					str = `["Object",${flatten(ops.unbox(thing))}]`;
					break;

				case 'Date':
					str = `["Date","${ops.toISOString(thing)}"]`;
					break;

				case 'URL':
					str = `["URL",${stringify_string(ops.toStringValue(thing))}]`;
					break;

				case 'URLSearchParams':
					str = `["URLSearchParams",${stringify_string(ops.toStringValue(thing))}]`;
					break;

				case 'RegExp':
					const { source, flags } = ops.regExpInfo(thing);
					str = flags
						? `["RegExp",${stringify_string(source)},"${flags}"]`
						: `["RegExp",${stringify_string(source)}]`;
					break;

				case 'Array': {
					// For dense arrays (no holes), we iterate normally.
					// When we encounter the first hole, we call Object.keys
					// to determine the sparseness, then decide between:
					//   - HOLE encoding: [-2, val, -2, ...] (default)
					//   - Sparse encoding: [-7, length, idx, val, ...] (for very sparse arrays)
					// Only the sparse path avoids iterating every slot, which
					// is what protects against the DoS of e.g. `arr[1000000] = 1`.
					let mostly_dense = false;

					const length = native ? thing.length : ops.lengthOf(thing);

					str = '[';

					for (let i = 0; i < length; i += 1) {
						if (i > 0) str += ',';

						/** @type {any} */
						let element;
						/** @type {boolean} */
						let populated;

						if (native) {
							// a hole reads as `undefined`, so the (comparatively
							// expensive) `hasOwn` is only needed to tell a hole
							// apart from a stored `undefined`
							element = thing[i];
							populated = element !== undefined || Object.hasOwn(thing, i);
						} else {
							populated = ops.hasOwn(thing, i);
						}

						if (populated) {
							keys[depth] = KEY_INDEX;
							keys[depth + 1] = i;
							depth += 2;
							str += flatten(native ? element : ops.get(thing, i));
							depth -= 2;
						} else if (mostly_dense) {
							// Use dense encoding. The heuristic guarantees the
							// array is only mildly sparse, so iterating over every
							// slot is fine.
							str += HOLE;
						} else {
							// Decide between HOLE encoding and sparse encoding.
							//
							// HOLE encoding: each hole is serialized as the HOLE
							// sentinel (-2). For example, [, "a", ,] becomes
							// [-2, 0, -2]. Each hole costs 3 chars ("-2" + comma).
							//
							// Sparse encoding: lists only populated indices.
							// For example, [, "a", ,] becomes [-7, 3, 1, 0] — the
							// -7 sentinel, the array length (3), then index-value
							// pairs. This avoids paying per-hole, but each element
							// costs extra chars to write its index.
							//
							// The values are the same size either way, so the
							// choice comes down to structural overhead:
							//
							//   HOLE overhead:
							//     3 chars per hole ("-2" + comma)
							//     = (L - P) * 3
							//
							//   Sparse overhead:
							//     "-7,"          — 3 chars (sparse sentinel + comma)
							//     + length + "," — (d + 1) chars (array length + comma)
							//     + per element: index + "," — (d + 1) chars
							//     = (4 + d) + P * (d + 1)
							//
							// where L is the array length, P is the number of
							// populated elements, and d is the number of digits
							// in L (an upper bound on the digits in any index).
							//
							// Sparse encoding is cheaper when:
							//   (4 + d) + P * (d + 1) < (L - P) * 3
							const populated_keys = ops.indicesOf(thing);
							const population = populated_keys.length;
							const d = String(length).length;

							const hole_cost = (length - population) * 3;
							const sparse_cost = 4 + d + population * (d + 1);

							if (hole_cost > sparse_cost) {
								str = '[' + SPARSE + ',' + length;
								for (let j = 0; j < populated_keys.length; j++) {
									const key = populated_keys[j];
									keys[depth] = KEY_INDEX;
									keys[depth + 1] = key;
									depth += 2;
									str += ',' + key + ',' + flatten(ops.get(thing, key));
									depth -= 2;
								}
								break;
							} else {
								mostly_dense = true;
								str += HOLE;
							}
						}
					}

					str += ']';

					break;
				}

				case 'Set':
					str = '["Set"';

					for (const value of ops.valuesOf(thing)) {
						str += ',';
						str += flatten(value);
					}

					str += ']';
					break;

				case 'Map':
					str = '["Map"';

					for (const [key, value] of ops.entriesOf(thing)) {
						keys[depth] = KEY_MAP;
						keys[depth + 1] = key;
						depth += 2;
						str += ',';
						str += flatten(key);
						str += ',';
						str += flatten(value);
						depth -= 2;
					}

					str += ']';
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
				case 'BigUint64Array': {
					const info = ops.viewInfo(thing);
					str = '["' + tag + '",' + flatten(info.buffer);

					// handle subarrays
					if (info.byteLength !== info.bufferByteLength) {
						str += `,${info.byteOffset},${info.length}`;
					}

					str += ']';
					break;
				}

				case 'DataView': {
					const info = ops.viewInfo(thing);
					str = '["' + tag + '",' + flatten(info.buffer);

					if (info.byteLength !== info.bufferByteLength) {
						str += `,${info.byteOffset},${info.byteLength}`;
					}

					str += ']';
					break;
				}

				case 'ArrayBuffer': {
					const base64 = encode64(ops.toArrayBuffer(thing));

					str = `["ArrayBuffer","${base64}"]`;
					break;
				}

				case 'Temporal.Duration':
				case 'Temporal.Instant':
				case 'Temporal.PlainDate':
				case 'Temporal.PlainTime':
				case 'Temporal.PlainDateTime':
				case 'Temporal.PlainMonthDay':
				case 'Temporal.PlainYearMonth':
				case 'Temporal.ZonedDateTime':
					str = `["${tag}",${stringify_string(ops.toStringValue(thing))}]`;
					break;

				default: {
					// `plain` already tells us the prototype is `Object.prototype`
					// and that there is no `Symbol.toStringTag`; all that's left
					// is ruling out symbol keys, which `shapeOf` would otherwise
					// establish at the cost of two more array allocations.
					/** @type {string[] | undefined} */
					let plain_keys;

					if (plain && Object.getOwnPropertySymbols(thing).length === 0) {
						plain_keys = Object.keys(thing);
					}

					if (plain_keys === undefined) {
						const shape = ops.shapeOf(thing);

						if (shape.kind === 'not-plain') {
							throw new DevalueError(
								`Cannot stringify arbitrary non-POJOs`,
								format_keys(),
								thing,
								value
							);
						}

						if (shape.kind === 'symbol-keys') {
							throw new DevalueError(
								`Cannot stringify POJOs with symbolic keys`,
								format_keys(),
								thing,
								value
							);
						}

						if (shape.kind === 'null-proto') {
							str = '["null"';
							for (const key of shape.keys) {
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
								str += ',';
								str += stringify_string(key);
								str += ',';
								str += flatten(native ? thing[key] : ops.get(thing, key));
								depth -= 2;
							}
							str += ']';
							break;
						}

						plain_keys = shape.keys;
					}

					str = '{';
					for (let i = 0; i < plain_keys.length; i += 1) {
						const key = plain_keys[i];

						if (key === '__proto__') {
							throw new DevalueError(
								`Cannot stringify objects with __proto__ keys`,
								format_keys(),
								thing,
								value
							);
						}

						if (i > 0) str += ',';

						keys[depth] = KEY_PROP;
						keys[depth + 1] = key;
						depth += 2;
						str += stringify_object_key(key);
						str += flatten(native ? thing[key] : ops.get(thing, key));
						depth -= 2;
					}
					str += '}';
				}
			}
		}

		stringified[index] = str;
		return index;
	}

	const index = flatten(value);

	// special case — value is represented as a negative index
	if (index < 0) return `${index}`;

	return stringified;
}

/**
 * @param {any} thing
 * @returns {string}
 */
function stringify_primitive(thing) {
	const type = typeof thing;
	if (type === 'string') return stringify_string(thing);
	if (thing === void 0) return UNDEFINED.toString();
	if (thing === 0 && 1 / thing < 0) return NEGATIVE_ZERO.toString();
	if (type === 'bigint') return `["BigInt","${thing}"]`;
	return String(thing);
}
