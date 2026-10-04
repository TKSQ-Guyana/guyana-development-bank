import { describe, expect, it } from 'vitest';
import { pageNumbers } from './Pager';

describe('pageNumbers', () => {
  it('shows every page when there are few', () => {
    expect(pageNumbers(1, 1)).toEqual([1]);
    expect(pageNumbers(2, 4)).toEqual([1, 2, 3, 4]);
  });

  it('keeps the first, the last and the neighbours, with gaps between', () => {
    expect(pageNumbers(1, 10)).toEqual([1, 2, null, 10]);
    expect(pageNumbers(6, 10)).toEqual([1, null, 5, 6, 7, null, 10]);
    expect(pageNumbers(10, 10)).toEqual([1, null, 9, 10]);
  });

  it('fills a gap of one page with the page instead of an ellipsis', () => {
    expect(pageNumbers(4, 10)).toEqual([1, 2, 3, 4, 5, null, 10]);
  });
});
