import { MAX_ARRAY_INDEX, MAX_ARRAY_LEN } from './constants.js';

/** @type {Record<string, string>} */
export const escaped = {
	'<': '\\u003C',
	'\\': '\\\\',
	'\b': '\\b',
	'\f': '\\f',
	'\n': '\\n',
	'\r': '\\r',
	'\t': '\\t',
	'\u2028': '\\u2028',
	'\u2029': '\\u2029'
};

export class DevalueError extends Error {
	/**
	 * @param {string} message
	 * @param {string[]} keys
	 * @param {any} [value] - The value that failed to be serialized
	 * @param {any} [root] - The root value being serialized
	 */
	constructor(message, keys, value, root) {
		super(message);
		this.name = 'DevalueError';
		this.path = keys.join('');
		this.value = value;
		this.root = root;
	}
}

/** @param {any} thing */
export function is_primitive(thing) {
	return thing === null || (typeof thing !== 'object' && typeof thing !== 'function');
}

const object_proto_names = /* @__PURE__ */ Object.getOwnPropertyNames(Object.prototype)
	.sort()
	.join('\0');

/** @param {any} thing */
export function is_plain_object(thing) {
	const proto = Object.getPrototypeOf(thing);

	return (
		proto === Object.prototype ||
		proto === null ||
		Object.getPrototypeOf(proto) === null ||
		Object.getOwnPropertyNames(proto).sort().join('\0') === object_proto_names
	);
}

/** @param {any} thing */
export function get_type(thing) {
	return Object.prototype.toString.call(thing).slice(8, -1);
}

/**
 * Lookup table for the ASCII characters that must be escaped inside a
 * devalue string. Entries are `''` for characters that pass through
 * unchanged, which keeps the array packed.
 * @type {string[]}
 */
const escape_table = new Array(128).fill('');

for (let i = 0; i < 0x20; i += 1) {
	escape_table[i] = '\\u' + i.toString(16).padStart(4, '0');
}

escape_table[0x08] = '\\b';
escape_table[0x09] = '\\t';
escape_table[0x0a] = '\\n';
escape_table[0x0c] = '\\f';
escape_table[0x0d] = '\\r';
escape_table[0x22] = '\\"';
escape_table[0x3c] = '\\u003C';
escape_table[0x5c] = '\\\\';

// the same set of characters, as a regex, so that the common case — a string
// that needs no escaping at all — is decided by a single native scan
const needs_escape = /[\u0000-\u001f"\\<\u2028\u2029]/;

/** @param {string} str */
export function stringify_string(str) {
	if (!needs_escape.test(str)) return '"' + str + '"';

	const len = str.length;

	let result = '"';
	let last_pos = 0;

	for (let i = 0; i < len; i += 1) {
		const code = str.charCodeAt(i);

		/** @type {string} */
		let replacement;

		if (code < 0x80) {
			replacement = escape_table[code];
			if (replacement === '') continue;
		} else if (code === 0x2028) {
			replacement = '\\u2028';
		} else if (code === 0x2029) {
			replacement = '\\u2029';
		} else {
			continue;
		}

		result += str.slice(last_pos, i) + replacement;
		last_pos = i + 1;
	}

	return result + str.slice(last_pos) + '"';
}

/**
 * Property names repeat across every object of the same shape, so both the
 * escaping and the `:` that always follows it are memoized.
 *
 * Serialized values can be attacker-controlled, so the cache is bounded in
 * both directions: at most `KEY_CACHE_LIMIT` entries, none longer than
 * `KEY_CACHE_MAX_LENGTH`. Anything outside those bounds is encoded on the fly,
 * which is what the uncached path does anyway.
 * @type {Map<string, string>}
 */
const object_key_cache = new Map();

export const KEY_CACHE_LIMIT = 1024;
export const KEY_CACHE_MAX_LENGTH = 64;

/** @param {string} key */
export function stringify_object_key(key) {
	const encoded = object_key_cache.get(key);
	if (encoded !== undefined) return encoded;

	const result = stringify_string(key) + ':';

	if (key.length <= KEY_CACHE_MAX_LENGTH && object_key_cache.size < KEY_CACHE_LIMIT) {
		object_key_cache.set(key, result);
	}

	return result;
}

/** @param {Record<string | symbol, any>} object */
export function enumerable_symbols(object) {
	return Object.getOwnPropertySymbols(object).filter(
		(symbol) => Object.getOwnPropertyDescriptor(object, symbol).enumerable
	);
}

const is_identifier = /^[a-zA-Z_$][a-zA-Z_$0-9]*$/;

/** @param {string} key */
export function stringify_key(key) {
	return is_identifier.test(key) ? '.' + key : '[' + JSON.stringify(key) + ']';
}

/** @param {number} n */
export function is_valid_array_index(n) {
	if (!Number.isInteger(n)) return false;
	if (n < 0) return false;
	if (n > MAX_ARRAY_INDEX) return false;
	return true;
}

/** @param {number} n */
export function is_valid_array_len(n) {
	if (!Number.isInteger(n)) return false;
	if (n < 0) return false;
	if (n > MAX_ARRAY_LEN) return false;
	return true;
}

/** @param {string} s */
function is_valid_array_index_string(s) {
	if (s.length === 0) return false;
	if (s.length > 1 && s.charCodeAt(0) === 48) return false; // leading zero
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i);
		if (c < 48 || c > 57) return false;
	}
	// by this point we know it's a string of digits, but it has to be within
	// the range of valid array indices
	return is_valid_array_index(+s);
}

/**
 * Returns the length of the leading run of valid array indices in `keys`.
 * @param {readonly string[]} keys
 */
function array_index_cut(keys) {
	for (var i = keys.length - 1; i >= 0; i--) {
		if (is_valid_array_index_string(keys[i])) {
			break;
		}
	}
	return i + 1;
}

/**
 * Finds the populated indices of an array.
 * @param {unknown[]} array
 */
export function valid_array_indices(array) {
	const keys = Object.keys(array);
	keys.length = array_index_cut(keys);
	return keys;
}

/**
 * Given the own enumerable string keys of an array-like value, in property
 * order, returns the leading run of them that are valid array indices.
 *
 * This is the filtering half of the `indicesOf` stringify operation,
 * exposed so that custom operations — which typically already have the keys
 * in hand, e.g. from a foreign runtime — don't have to reimplement it.
 *
 * Does not modify `keys`.
 *
 * @param {readonly string[]} keys
 * @returns {string[]}
 */
export function filter_array_indices(keys) {
	return keys.slice(0, array_index_cut(keys));
}
