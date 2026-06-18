import { render, screen } from '@testing-library/react';
import { DiffView } from './DiffView';

describe('DiffView 渲染行级 diff', () => {
  test('显示 file_path', () => {
    render(<DiffView filePath="/foo/bar.ts" segments={[{ oldText: 'a', newText: 'a' }]} />);
    expect(screen.getByText('/foo/bar.ts')).toBeInTheDocument();
  });

  test('单段 Edit:删除行带 - 前缀和 diff-del 类,新增行带 + 前缀和 diff-add 类', () => {
    render(
      <DiffView
        filePath="/f.ts"
        segments={[{ oldText: 'a\nb\nc', newText: 'a\nB\nc' }]}
      />
    );
    const del = screen.getByText('- b');
    const add = screen.getByText('+ B');
    expect(del).toHaveClass('diff-del');
    expect(add).toHaveClass('diff-add');
    // 上下文行带空格前缀(关闭空白归一化以精确匹配前缀)
    expect(screen.getAllByText('  a', { normalizer: (s) => s })[0]).toHaveClass('diff-ctx');
  });

  test('Write(old 为空)全部为新增行', () => {
    render(
      <DiffView filePath="/new.ts" segments={[{ oldText: '', newText: 'l1\nl2' }]} />
    );
    expect(screen.getByText('+ l1')).toHaveClass('diff-add');
    expect(screen.getByText('+ l2')).toHaveClass('diff-add');
  });

  test('MultiEdit:多段都渲染', () => {
    render(
      <DiffView
        filePath="/m.ts"
        segments={[
          { oldText: 'x', newText: 'X' },
          { oldText: 'y', newText: 'Y' },
        ]}
      />
    );
    expect(screen.getByText('- x')).toBeInTheDocument();
    expect(screen.getByText('+ X')).toBeInTheDocument();
    expect(screen.getByText('- y')).toBeInTheDocument();
    expect(screen.getByText('+ Y')).toBeInTheDocument();
  });
});
