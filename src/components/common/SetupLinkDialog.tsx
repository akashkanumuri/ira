import { useState } from 'react';
import { Check, Copy, MessageCircle } from 'lucide-react';
import { Button, Notice } from '../../ui';
import { Modal } from '../../ui/Modal';
import { notify } from '../../lib/toast';

export interface SetupLink {
  /** Who the link is for (shown, and used in the share message). */
  name?: string | null;
  email: string;
  url: string;
  /** 'reset' = they already have a password; 'invite' = first-time setup. */
  kind: 'invite' | 'reset';
}

/**
 * SIGMA 1 never emails passwords or links. The admin gets the one-time link here
 * and shares it privately (copy, or straight to WhatsApp).
 */
export function SetupLinkDialog({ link, onClose }: { link: SetupLink; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const reset = link.kind === 'reset';
  const who = link.name?.trim() || link.email;
  const message = reset
    ? `Hi ${who}, here is your SIGMA 1 password reset link. It works once and expires in 24 hours:\n${link.url}`
    : `Hi ${who}, welcome to SIGMA 1. Open this link to set your password (it works once and expires in 72 hours):\n${link.url}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      notify('Link copied.', 'success');
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      notify('Copy didn’t work — select the link and copy it.', 'error');
    }
  };

  return (
    <Modal title={reset ? 'Password reset link' : 'Setup link'} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-[13.5px] text-ink-600">
          For <span className="font-semibold text-ink-900">{who}</span>{link.name ? <span className="text-ink-400"> · {link.email}</span> : null}.
          {' '}No email is sent — share this link with them yourself.
        </p>
        <input
          readOnly
          className="input font-mono text-[12px]"
          value={link.url}
          onFocus={(e) => e.currentTarget.select()}
          aria-label="Link"
        />
        <Notice tone="amber" title="Share it privately">
          Anyone with this link can set the password for {link.email}. It works once and expires in {reset ? '24 hours' : '72 hours'}.
        </Notice>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Done</Button>
          <a
            className="btn-secondary inline-flex items-center gap-1.5"
            href={`https://wa.me/?text=${encodeURIComponent(message)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <MessageCircle className="w-4 h-4" /> Share on WhatsApp
          </a>
          <Button onClick={() => void copy()} icon={copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}>
            {copied ? 'Copied' : 'Copy link'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
