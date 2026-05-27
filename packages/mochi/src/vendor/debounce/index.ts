/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-this-alias */
// Vendored from https://github.com/sindresorhus/debounce 3.0.0
type AnyFunction = (...arguments_: readonly any[]) => unknown;

export type Options = {
  readonly immediate?: boolean;
};

export type DebouncedFunction<F extends AnyFunction> = {
  (...arguments_: Parameters<F>): ReturnType<F> | undefined;
  readonly isPending: boolean;
  clear(): void;
  flush(): void;
  trigger(): void;
};

export default function debounce<F extends AnyFunction>(function_: F, wait = 100, options: Options = {}): DebouncedFunction<F> {
  if (typeof function_ !== 'function') {
    throw new TypeError(`Expected the first parameter to be a function, got \`${typeof function_}\`.`);
  }

  if (wait < 0) {
    throw new RangeError('`wait` must not be negative.');
  }

  if (typeof options === 'boolean') {
    throw new TypeError('The `options` parameter must be an object, not a boolean. Use `{immediate: true}` instead.');
  }

  const { immediate } = options;

  let storedContext: unknown;
  let storedArguments: Parameters<F> | undefined;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let timestamp: number;
  let result: ReturnType<F> | undefined;

  function run(): ReturnType<F> {
    const callContext = storedContext;
    const callArguments = storedArguments!;
    storedContext = undefined;
    storedArguments = undefined;
    result = function_.apply(callContext, callArguments) as ReturnType<F>;
    return result;
  }

  function later(): void {
    const last = Date.now() - timestamp;

    if (last < wait && last >= 0) {
      timeoutId = setTimeout(later, wait - last);
    } else {
      timeoutId = undefined;

      if (!immediate) {
        result = run();
      }
    }
  }

  const debounced = function (this: unknown, ...arguments_: Parameters<F>): ReturnType<F> | undefined {
    if (storedContext && this !== storedContext && Object.getPrototypeOf(this) === Object.getPrototypeOf(storedContext)) {
      throw new Error('Debounced method called with different contexts of the same prototype.');
    }

    storedContext = this;
    storedArguments = arguments_;
    timestamp = Date.now();

    const callNow = immediate && !timeoutId;

    if (!timeoutId) {
      timeoutId = setTimeout(later, wait);
    }

    if (callNow) {
      result = run();
      return result;
    }

    return undefined;
  };

  Object.defineProperty(debounced, 'isPending', {
    get() {
      return timeoutId !== undefined;
    },
  });

  debounced.clear = () => {
    if (!timeoutId) {
      return;
    }

    clearTimeout(timeoutId);
    timeoutId = undefined;
    storedContext = undefined;
    storedArguments = undefined;
  };

  debounced.flush = () => {
    if (!timeoutId) {
      return;
    }

    debounced.trigger();
  };

  debounced.trigger = () => {
    result = run();

    debounced.clear();
  };

  return debounced as DebouncedFunction<F>;
}
