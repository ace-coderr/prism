import { describe, expect, it } from 'vitest';
import { cleanShown, replaceLiteral } from '../src';

describe('text people wrote', () => {
  it('drops bidi controls and zero-width characters, keeps everything else', () => {
    expect(cleanShown('ab‮cd⁦e⁩f‪‫‬‭')).toBe('abcdef');
    expect(cleanShown('p​r‌i‍s﻿m')).toBe('prism');
    expect(cleanShown('Café 🚀 “quotes” <b>')).toBe('Café 🚀 “quotes” <b>');
  });

  it('replaces literally: $&, $\', $`, $1 and $$ stay as written', () => {
    for (const v of ['$1INCH', "$'", '$`', '$&', '$$', '$<x>']) expect(replaceLiteral('<title>x</title>', /<title>[^<]*<\/title>/, `<title>${v}</title>`)).toBe(`<title>${v}</title>`);
  });
});
