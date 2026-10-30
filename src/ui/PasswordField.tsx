import React, { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cx } from './index';

/** A password input with a show/hide eye button. Accepts every normal <input> prop. */
export function PasswordField({ className, ...input }: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [show, setShow] = useState(false);
  return (
    <span className="relative block">
      <input {...input} type={show ? 'text' : 'password'} className={cx('input !pr-11', className)} />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        aria-label={show ? 'Hide password' : 'Show password'}
        title={show ? 'Hide password' : 'Show password'}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 w-9 h-9 grid place-items-center rounded-full text-ink-400 hover:text-ink-700 hover:bg-ink-50"
      >
        {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </span>
  );
}
