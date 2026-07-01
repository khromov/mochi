// Vendored from https://github.com/js-cookie/js-cookie 3.0.8

export interface CookieAttributes {
  expires?: number | Date;
  path?: string;
  domain?: string;
  secure?: boolean;
  sameSite?: 'strict' | 'Strict' | 'lax' | 'Lax' | 'none' | 'None';
  [property: string]: unknown;
}

export interface CookieConverter {
  read: (value: string, name: string) => string;
  write: (value: string, name: string) => string;
}

export interface CookiesApi {
  set(name: string, value: string, attributes?: CookieAttributes): string | undefined;
  get(name: string): string | undefined;
  get(): { [name: string]: string };
  remove(name: string, attributes?: CookieAttributes): void;
  withAttributes(attributes: CookieAttributes): CookiesApi;
  withConverter(converter: Partial<CookieConverter>): CookiesApi;
  readonly attributes: CookieAttributes;
  readonly converter: CookieConverter;
}

function assign<T extends object>(target: T, ...sources: object[]): T {
  for (const source of sources) {
    for (const key in source) {
      if (key === '__proto__') {
        continue;
      }
      (target as Record<string, unknown>)[key] = (source as Record<string, unknown>)[key];
    }
  }
  return target;
}

const defaultConverter: CookieConverter = {
  read: function (value) {
    if (value[0] === '"') {
      value = value.slice(1, -1);
    }
    return value.replace(/(%[\dA-F]{2})+/gi, decodeURIComponent);
  },
  write: function (value) {
    return encodeURIComponent(value).replace(/%(2[346BF]|3[AC-F]|40|5[BDE]|60|7[BCD])/g, decodeURIComponent);
  },
};

function init(converter: CookieConverter, defaultAttributes: CookieAttributes): CookiesApi {
  function set(name: string, value: string, attributes?: CookieAttributes): string | undefined {
    if (typeof document === 'undefined') {
      return;
    }

    const attrs = assign({} as CookieAttributes, defaultAttributes, attributes ?? {});

    if (typeof attrs.expires === 'number') {
      attrs.expires = new Date(Date.now() + attrs.expires * 864e5);
    }
    if (attrs.expires) {
      (attrs as Record<string, unknown>).expires = (attrs.expires as Date).toUTCString();
    }

    name = encodeURIComponent(name)
      .replace(/%(2[346B]|5E|60|7C)/g, decodeURIComponent)
      .replace(/[()]/g, escape);

    let stringifiedAttributes = '';
    for (const attributeName in attrs) {
      if (!attrs[attributeName]) {
        continue;
      }

      stringifiedAttributes += '; ' + attributeName;

      if (attrs[attributeName] === true) {
        continue;
      }

      // Considers RFC 6265 section 5.2:
      // ...
      // 3.  If the remaining unparsed-attributes contains a %x3B (";")
      //     character:
      // Consume the characters of the unparsed-attributes up to,
      // not including, the first %x3B (";") character.
      // ...
      stringifiedAttributes += '=' + String(attrs[attributeName]).split(';')[0];
    }

    return (document.cookie = name + '=' + converter.write(value, name) + stringifiedAttributes);
  }

  function get(name: string): string | undefined;
  function get(): { [name: string]: string };
  function get(name?: string): string | undefined | { [name: string]: string } {
    if (typeof document === 'undefined' || (arguments.length && !name)) {
      return;
    }

    // To prevent the for loop in the first place assign an empty array
    // in case there are no cookies at all.
    const cookies = document.cookie ? document.cookie.split('; ') : [];
    const jar: { [name: string]: string } = {};
    for (let i = 0; i < cookies.length; i++) {
      const parts = cookies[i].split('=');
      const value = parts.slice(1).join('=');

      try {
        const found = decodeURIComponent(parts[0]);
        if (!(found in jar)) {
          jar[found] = converter.read(value, found);
        }
        if (name === found) {
          break;
        }
      } catch {
        // Do nothing...
      }
    }

    return name ? jar[name] : jar;
  }

  return Object.create(
    {
      set: set,
      get: get,
      remove: function (name: string, attributes?: CookieAttributes) {
        set(
          name,
          '',
          assign({} as CookieAttributes, attributes ?? {}, {
            expires: -1,
          }),
        );
      },
      withAttributes: function (this: CookiesApi, attributes: CookieAttributes) {
        return init(this.converter, assign({} as CookieAttributes, this.attributes, attributes));
      },
      withConverter: function (this: CookiesApi, converter: Partial<CookieConverter>) {
        return init(assign({} as CookieConverter, this.converter, converter), this.attributes);
      },
    },
    {
      attributes: { value: Object.freeze(defaultAttributes) },
      converter: { value: Object.freeze(converter) },
    },
  ) as CookiesApi;
}

const api = init(defaultConverter, { path: '/' });

export default api;
