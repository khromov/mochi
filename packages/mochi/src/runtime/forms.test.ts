import { describe, expect, test } from 'bun:test';
import { fail, isFormFail, isFormSuccess, isRedirect, redirect, success } from './forms';

describe('fail', () => {
  test('builds a MochiFormFail with status and data', () => {
    const result = fail(400, { error: 'bad', username: 'alice' });
    expect(result.__mochiFormFail).toBe(true);
    expect(result.status).toBe(400);
    expect(result.data).toEqual({ error: 'bad', username: 'alice' });
  });
});

describe('redirect', () => {
  test('builds a MochiRedirect with status and location', () => {
    const result = redirect(303, '/dashboard');
    expect(result.__mochiRedirect).toBe(true);
    expect(result.status).toBe(303);
    expect(result.location).toBe('/dashboard');
  });
});

describe('success', () => {
  test('builds a MochiFormSuccess with data', () => {
    const result = success({ message: 'ok' });
    expect(result.__mochiFormSuccess).toBe(true);
    expect(result.data).toEqual({ message: 'ok' });
  });

  test('defaults data to empty object when omitted', () => {
    const result = success();
    expect(result.__mochiFormSuccess).toBe(true);
    expect(result.data).toEqual({});
  });
});

describe('type guards', () => {
  test('isFormFail matches fail() output and nothing else', () => {
    expect(isFormFail(fail(400, { error: 'x' }))).toBe(true);
    expect(isFormFail(redirect(303, '/'))).toBe(false);
    expect(isFormFail(success())).toBe(false);
    expect(isFormFail(null)).toBe(false);
    expect(isFormFail(undefined)).toBe(false);
    expect(isFormFail({})).toBe(false);
    expect(isFormFail({ __mochiFormFail: false })).toBe(false);
    expect(isFormFail('string')).toBe(false);
  });

  test('isRedirect matches redirect() output and nothing else', () => {
    expect(isRedirect(redirect(302, '/x'))).toBe(true);
    expect(isRedirect(fail(400, { error: 'x' }))).toBe(false);
    expect(isRedirect(success())).toBe(false);
    expect(isRedirect(null)).toBe(false);
    expect(isRedirect(undefined)).toBe(false);
    expect(isRedirect({})).toBe(false);
  });

  test('isFormSuccess matches success() output and nothing else', () => {
    expect(isFormSuccess(success({ message: 'ok' }))).toBe(true);
    expect(isFormSuccess(success())).toBe(true);
    expect(isFormSuccess(fail(400, { error: 'x' }))).toBe(false);
    expect(isFormSuccess(redirect(303, '/'))).toBe(false);
    expect(isFormSuccess(null)).toBe(false);
    expect(isFormSuccess(undefined)).toBe(false);
    expect(isFormSuccess({})).toBe(false);
  });
});
