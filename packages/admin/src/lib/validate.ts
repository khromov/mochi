// Validation stub.
//
// STUB MODULE. A tiny presence-checking validator standing in for the real
// validation battery (tasks/validation-library.md), which will offer typed,
// schema-driven validation that rejects invalid input before the handler runs
// and produces a field-keyed error bag that flows through Mochi's form/enhance
// path automatically.

export type FieldErrors<T> = Partial<Record<keyof T, string>>;

export type ValidateResult<T> = { ok: true; data: T } | { ok: false; errors: FieldErrors<T>; values: Record<string, string> };

/** A field rule: given the raw string, return an error message or null. */
export type Rule = (value: string) => string | null;

export type Schema<T> = Record<keyof T & string, Rule>;

/**
 * Run each field's rule against the submitted FormData.
 *
 * TODO: replace with the real validation battery — typed parsing, coercion,
 * and standard-schema interop (tasks/validation-library.md). This stub only
 * does the trivial per-field string checks the caller supplies.
 */
export function validate<T extends Record<string, unknown>>(schema: Schema<T>, formData: FormData): ValidateResult<T> {
  const values: Record<string, string> = {};
  const errors: FieldErrors<T> = {};

  for (const key of Object.keys(schema) as (keyof T & string)[]) {
    const raw = String(formData.get(key) ?? '').trim();
    values[key] = raw;
    const message = schema[key](raw);
    if (message) {
      errors[key] = message;
    }
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors, values };
  }
  // Cast: the real battery would return parsed/typed data. The stub hands back
  // the trimmed string values.
  return { ok: true, data: values as unknown as T };
}

// A few reusable rules so callers read declaratively.
export const required =
  (label: string): Rule =>
  (v) =>
    v ? null : `${label} is required.`;

export const positiveNumber =
  (label: string): Rule =>
  (v) => {
    if (!v) {
      return `${label} is required.`;
    }
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) {
      return `${label} must be a number ≥ 0.`;
    }
    return null;
  };
