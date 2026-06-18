import { render, screen, fireEvent } from '@testing-library/react';
import { Login } from './Login';

describe('Login', () => {
  it('提交时应 trim token 两端空白后再回传', () => {
    const onLogin = vi.fn();
    render(<Login onLogin={onLogin} />);

    const input = screen.getByPlaceholderText('Enter your access token');
    fireEvent.change(input, { target: { value: '  test-token-123 ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Login' }));

    expect(onLogin).toHaveBeenCalledWith('test-token-123');
  });

  it('仅空白的 token 视为缺失,不回传', () => {
    const onLogin = vi.fn();
    render(<Login onLogin={onLogin} />);

    const input = screen.getByPlaceholderText('Enter your access token');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Login' }));

    expect(onLogin).not.toHaveBeenCalled();
    expect(screen.getByText('Token is required')).toBeInTheDocument();
  });
});
