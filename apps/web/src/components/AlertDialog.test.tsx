import { render, screen, fireEvent } from '@testing-library/react';
import { AlertDialog } from './AlertDialog';

describe('AlertDialog', () => {
  test('不显示时不渲染内容', () => {
    render(
      <AlertDialog
        open={false}
        title="提示"
        message="这是一条消息"
        onClose={() => {}}
      />
    );

    expect(screen.queryByText('提示')).not.toBeInTheDocument();
    expect(screen.queryByText('这是一条消息')).not.toBeInTheDocument();
  });

  test('显示时渲染标题和消息', () => {
    render(
      <AlertDialog
        open={true}
        title="错误"
        message="操作失败，请重试"
        onClose={() => {}}
      />
    );

    expect(screen.getByText('错误')).toBeInTheDocument();
    expect(screen.getByText('操作失败，请重试')).toBeInTheDocument();
  });

  test('点击确定按钮调用 onClose', () => {
    const onClose = vi.fn();

    render(
      <AlertDialog
        open={true}
        title="提示"
        message="操作成功"
        onClose={onClose}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /确定/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('点击遮罩层调用 onClose', () => {
    const onClose = vi.fn();

    render(
      <AlertDialog
        open={true}
        title="提示"
        message="操作成功"
        onClose={onClose}
      />
    );

    const backdrop = screen.getByTestId('alert-backdrop');
    fireEvent.click(backdrop);

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
