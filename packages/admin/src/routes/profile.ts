import { Mochi, fail, success } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';
import { currentUser, getProfile } from '../lib/auth.server';
import { validate, required, type Rule, type Schema } from '../lib/validate';

const email: Rule = (v) => {
  if (!v) {
    return 'Email is required.';
  }
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? null : 'Enter a valid email address.';
};

const profileSchema: Schema<{ name: string; email: string }> = {
  name: required('Name'),
  email,
};

export const routes: Record<string, MochiRouteValue> = {
  '/profile': Mochi.page('./src/Profile.svelte', {
    serverProps: () => ({ profile: getProfile(), user: currentUser() }),
    actions: {
      update: async ({ formData }) => {
        const result = validate(profileSchema, formData);
        if (!result.ok) {
          return fail(400, { errors: result.errors, values: result.values });
        }
        // STUB: nothing persisted. Real: updateProfile(result.data).
        return success({ notice: 'Validated ✓ — saving is stubbed. Wire up lib/db.server.ts (see tasks/migrations.md).' });
      },
    },
  }),
};
