export type DiffLine = { type: 'add' | 'del' | 'ctx'; text: string };

/**
 * 行级 diff(基于最长公共子序列 LCS)。
 * 返回有序的增/删/上下文行序列:删除行(del)排在对应新增行(add)之前。
 * 不依赖任何第三方库。
 */
export function computeLineDiff(oldStr: string, newStr: string): DiffLine[] {
  // 空串视为 0 行(避免 ''.split('\n') 产生一个空行)
  const oldLines = oldStr === '' ? [] : oldStr.split('\n');
  const newLines = newStr === '' ? [] : newStr.split('\n');

  const m = oldLines.length;
  const n = newLines.length;

  // LCS 长度表:lcs[i][j] = oldLines[i..] 与 newLines[j..] 的最长公共子序列长度
  const lcs: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0)
  );
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (oldLines[i] === newLines[j]) {
        lcs[i][j] = lcs[i + 1][j + 1] + 1;
      } else {
        lcs[i][j] = Math.max(lcs[i + 1][j], lcs[i][j + 1]);
      }
    }
  }

  // 回溯生成 diff 序列
  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (oldLines[i] === newLines[j]) {
      result.push({ type: 'ctx', text: oldLines[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      result.push({ type: 'del', text: oldLines[i] });
      i++;
    } else {
      result.push({ type: 'add', text: newLines[j] });
      j++;
    }
  }
  while (i < m) {
    result.push({ type: 'del', text: oldLines[i] });
    i++;
  }
  while (j < n) {
    result.push({ type: 'add', text: newLines[j] });
    j++;
  }

  return result;
}
