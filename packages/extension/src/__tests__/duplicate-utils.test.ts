import { describe, it, expect } from 'vitest';
import { getUniqueCopyName } from '../utils/duplicate.js';

describe('getUniqueCopyName', () => {
  it('appends _copy before the extension', () => {
    expect(getUniqueCopyName('report.txt', [])).toBe('report_copy.txt');
  });

  it('appends _copy to a folder name (no extension)', () => {
    expect(getUniqueCopyName('images', [])).toBe('images_copy');
  });

  it('increments to _copy_2 when _copy already exists', () => {
    expect(getUniqueCopyName('report.txt', ['report_copy.txt'])).toBe('report_copy_2.txt');
  });

  it('increments further when multiple copies exist', () => {
    const existing = ['report_copy.txt', 'report_copy_2.txt', 'report_copy_3.txt'];
    expect(getUniqueCopyName('report.txt', existing)).toBe('report_copy_4.txt');
  });

  it('handles extension-less files like Makefile', () => {
    expect(getUniqueCopyName('Makefile', [])).toBe('Makefile_copy');
  });

  it('uses only the final extension for multi-dot filenames', () => {
    // path.extname('archive.tar.gz') === '.gz'
    expect(getUniqueCopyName('archive.tar.gz', [])).toBe('archive.tar_copy.gz');
  });

  it('returns _copy when existing list has unrelated names', () => {
    expect(getUniqueCopyName('data.json', ['readme.md', 'config.json'])).toBe('data_copy.json');
  });
});
