import { computeLineDiff } from './diff';

describe('computeLineDiff 行级 diff', () => {
  test('完全相同的文本全部是 ctx 行', () => {
    expect(computeLineDiff('a\nb', 'a\nb')).toEqual([
      { type: 'ctx', text: 'a' },
      { type: 'ctx', text: 'b' },
    ]);
  });

  test('old 为空时(Write 全新增)所有行都是 add', () => {
    expect(computeLineDiff('', 'line1\nline2')).toEqual([
      { type: 'add', text: 'line1' },
      { type: 'add', text: 'line2' },
    ]);
  });

  test('new 为空时所有行都是 del', () => {
    expect(computeLineDiff('x\ny', '')).toEqual([
      { type: 'del', text: 'x' },
      { type: 'del', text: 'y' },
    ]);
  });

  test('中间一行被替换:del 在 add 之前,两侧为 ctx', () => {
    expect(computeLineDiff('a\nb\nc', 'a\nB\nc')).toEqual([
      { type: 'ctx', text: 'a' },
      { type: 'del', text: 'b' },
      { type: 'add', text: 'B' },
      { type: 'ctx', text: 'c' },
    ]);
  });

  test('纯新增一行:保留上下文', () => {
    expect(computeLineDiff('a\nc', 'a\nb\nc')).toEqual([
      { type: 'ctx', text: 'a' },
      { type: 'add', text: 'b' },
      { type: 'ctx', text: 'c' },
    ]);
  });

  test('纯删除一行:保留上下文', () => {
    expect(computeLineDiff('a\nb\nc', 'a\nc')).toEqual([
      { type: 'ctx', text: 'a' },
      { type: 'del', text: 'b' },
      { type: 'ctx', text: 'c' },
    ]);
  });
});
