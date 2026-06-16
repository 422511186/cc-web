import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import { Composer } from "./Composer";

// Mock chatApi
vi.mock("../chatApi.js", () => ({
  uploadFile: vi.fn((file: File) =>
    Promise.resolve({ ref: "file-ref", filename: file.name })
  ),
}));

// Mock AttachmentPreview
vi.mock("./AttachmentPreview.js", () => ({
  AttachmentPreview: () => <div data-testid="attachment-preview" />,
}));

describe("Composer", () => {
  test("点击发送后按钮立即禁用,onSend 调用完成前不可再次点击", async () => {
    let resolveOnSend: (() => void) | undefined;
    const onSendPromise = new Promise<void>((resolve) => {
      resolveOnSend = resolve;
    });

    const onSend = vi.fn(() => onSendPromise);

    render(<Composer disabled={false} onSend={onSend} />);

    const textarea = screen.getByPlaceholderText("输入消息…");
    const sendBtn = screen.getByText("发送");

    fireEvent.change(textarea, { target: { value: "测试消息" } });
    fireEvent.click(sendBtn);

    // 立即检查按钮是否禁用
    expect(sendBtn).toBeDisabled();
    expect(onSend).toHaveBeenCalledTimes(1);

    // 完成 onSend
    resolveOnSend!();
    await waitFor(() => expect(sendBtn).not.toBeDisabled());
  });

  test("快速双击发送,onSend 只调用1次", async () => {
    const onSend = vi.fn(() => Promise.resolve());

    render(<Composer disabled={false} onSend={onSend} />);

    const textarea = screen.getByPlaceholderText("输入消息…");
    const sendBtn = screen.getByText("发送");

    fireEvent.change(textarea, { target: { value: "测试消息" } });
    fireEvent.click(sendBtn);
    fireEvent.click(sendBtn);

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
  });

  test("发送空消息不触发 onSend", () => {
    const onSend = vi.fn();

    render(<Composer disabled={false} onSend={onSend} />);

    const sendBtn = screen.getByText("发送");
    fireEvent.click(sendBtn);

    expect(onSend).not.toHaveBeenCalled();
  });

  test("executing=true 时显示停止按钮,点击后弹出 ConfirmDialog", () => {
    const onAbort = vi.fn();

    render(<Composer disabled={false} executing={true} onSend={vi.fn()} onAbort={onAbort} />);

    const stopBtn = screen.getByText("⏹ 停止");
    expect(stopBtn).toBeInTheDocument();

    fireEvent.click(stopBtn);

    // 应该显示确认对话框
    expect(screen.getByText('确认停止')).toBeInTheDocument();
    expect(screen.getByText('确定要停止当前执行吗？')).toBeInTheDocument();
  });

  test("ConfirmDialog 点击确定后调用 onAbort 并关闭对话框", () => {
    const onAbort = vi.fn();

    render(<Composer disabled={false} executing={true} onSend={vi.fn()} onAbort={onAbort} />);

    fireEvent.click(screen.getByText("⏹ 停止"));

    // 对话框已显示
    expect(screen.getByText('确认停止')).toBeInTheDocument();

    // 点击确定
    fireEvent.click(screen.getByRole('button', { name: /确定/i }));

    expect(onAbort).toHaveBeenCalledTimes(1);
    // 对话框关闭
    expect(screen.queryByText('确认停止')).not.toBeInTheDocument();
  });

  test("ConfirmDialog 点击取消后不调用 onAbort 且关闭对话框", () => {
    const onAbort = vi.fn();

    render(<Composer disabled={false} executing={true} onSend={vi.fn()} onAbort={onAbort} />);

    fireEvent.click(screen.getByText("⏹ 停止"));

    // 对话框已显示
    expect(screen.getByText('确认停止')).toBeInTheDocument();

    // 点击取消
    fireEvent.click(screen.getByRole('button', { name: /取消/i }));

    expect(onAbort).not.toHaveBeenCalled();
    // 对话框关闭
    expect(screen.queryByText('确认停止')).not.toBeInTheDocument();
  });

  test("executing=false 时显示发送按钮,不显示停止按钮", () => {
    render(<Composer disabled={false} executing={false} onSend={vi.fn()} onAbort={vi.fn()} />);

    expect(screen.getByText("发送")).toBeInTheDocument();
    expect(screen.queryByText("⏹ 停止")).not.toBeInTheDocument();
  });
});
