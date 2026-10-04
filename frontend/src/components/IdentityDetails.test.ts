import { describe, expect, it } from 'vitest';
import { compactIdNumber, formatEid, idNumberProblem, nationalIdMismatch } from './IdentityDetails';

describe('identity document numbers', () => {
  it('keeps letters and digits, uppercased, as the server stores them', () => {
    expect(compactIdNumber('r 012-3456')).toBe('R0123456');
    expect(compactIdNumber('592-2001-0101')).toBe('59220010101');
  });

  it('asks for a number, and refuses anything but letters and digits', () => {
    expect(idNumberProblem('Passport', '  ')).toMatch(/number printed on your Passport/);
    expect(idNumberProblem('Passport', 'R01#3456')).toMatch(/letters and digits only/);
    expect(idNumberProblem('Passport', 'R12')).toMatch(/letters and digits only/);
    expect(idNumberProblem('National ID Card', '123 456 789')).toBeNull();
  });
});

describe('a National ID card', () => {
  it('must carry the National ID number, however it is typed', () => {
    expect(nationalIdMismatch('National ID Card', '900 100 200', '900100200')).toBeNull();
    expect(nationalIdMismatch('National ID Card', '900100299', '900100200')).toMatch(/must match your National ID/);
  });

  it('is not checked for other documents, or without a National ID', () => {
    expect(nationalIdMismatch('Passport', 'R0123456', '900100200')).toBeNull();
    expect(nationalIdMismatch('National ID Card', '900100299', null)).toBeNull();
  });
});

describe('an e-ID number', () => {
  it('is shaped 592-2001-0101 as it is typed', () => {
    expect(formatEid('59220010101')).toBe('592-2001-0101');
    expect(formatEid('5922')).toBe('592-2');
    expect(formatEid('592 2001 0101 99')).toBe('592-2001-0101');
  });

  it('must be eleven digits', () => {
    expect(idNumberProblem('e-ID', '592-2001-010')).toMatch(/592-2001-0101/);
    expect(idNumberProblem('e-ID', '592-2001-0101')).toBeNull();
  });
});
