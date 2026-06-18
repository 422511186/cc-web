import { render, screen, fireEvent } from '@testing-library/react';
import { ConfirmDialog } from './ConfirmDialog';

describe('ConfirmDialog', () => {
  test('不显示时不渲染内容', () => {
    render(
      <ConfirmDialog
        open={false}
        title="测试标题"
        message="测试消息"
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );

    expect(screen.queryByText('测试标题')).not.toBeInTheDocument();
    expect(screen.queryByText('测试消息')).not.toBeInTheDocument();
  });

  test('显示时渲染标题和消息', () => {
    render(
      <ConfirmDialog
        open={true}
        title="确认删除"
        message="确定要删除这个项目吗？"
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );

    expect(screen.getByText('确认删除')).toBeInTheDocument();
    expect(screen.getByText('确定要删除这个项目吗？')).toBeInTheDocument();
  });

  test('点击确认按钮调用 onConfirm', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    render(
      <ConfirmDialog
        open={true}
        title="确认"
        message="确定吗？"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /确认|确定/i }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  test('点击取消按钮调用 onCancel', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    render(
      <ConfirmDialog
        open={true}
        title="确认"
        message="确定吗？"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /取消/i }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  test('点击遮罩层调用 onCancel', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    render(
      <ConfirmDialog
        open={true}
        title="确认"
        message="确定吗？"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );

    // 找到遮罩层（backdrop）并点击
    const backdrop = screen.getByTestId('confirm-backdrop');
    fireEvent.click(backdrop);

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
