import { describe, expect, test } from 'vitest';
import { formatPhone, isGuyanaPhone, localDigits } from '../PhoneInput';
describe('Guyana phone numbers', () => {
  test('any way a number arrives reads as its seven local digits', () => {
    for (const v of ['6001234', '600 1234', '+592 600 1234', '+5926001234', '5926001234']) expect(localDigits(v)).toBe('6001234');
  });
  test('partial input while typing keeps what was typed', () => {
    expect(localDigits('+59260')).toBe('60');
    expect(localDigits('+592')).toBe('');
    expect(localDigits('592')).toBe('592');
  });
  test('seven digits, shown as 600 1234', () => {
    expect(isGuyanaPhone('+5926001234')).toBe(true);
    expect(isGuyanaPhone('60012')).toBe(false);
    expect(formatPhone('+5926001234')).toBe('600 1234');
  });
});

describe('a number with too many digits', () => {
  test('is not a Guyana number', () => {
    expect(isGuyanaPhone('9876543210')).toBe(false);
    expect(isGuyanaPhone('+1 212 555 0100')).toBe(false);
  });
});
