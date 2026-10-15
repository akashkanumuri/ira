import React, { useState } from 'react';
import type { Employee } from '../../types/attendance';
import { Building2, User, Mail, Briefcase, UserCheck, X, AlertCircle, CheckCircle2, Copy, Check, MailCheck, AlertTriangle, RefreshCw } from 'lucide-react';
import { invokeClientAdmin } from '../../lib/v2';

interface Props {
  employees: Employee[];
  onClose: () => void;
  onCreated?: () => Promise<void> | void;
}

export const ClientCreationModal: React.FC<Props> = ({ employees, onClose, onCreated }) => {
  const [companyName, setCompanyName] = useState('');
  const [primaryContact, setPrimaryContact] = useState('');
  const [email, setEmail] = useState('');
  const [managerId, setManagerId] = useState('');
  const [projectName, setProjectName] = useState('');
  const [projectDescription, setProjectDescription] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdInfo, setCreatedInfo] = useState<{
    clientId?: string;
    companyName: string;
    email: string;
    invitationUrl: string;
    emailDelivery?: {
      attempted: boolean;
      sent: boolean;
      id?: string | null;
      error?: string | null;
      reason?: string | null;
    };
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [retryingEmail, setRetryingEmail] = useState(false);
  const [retryFeedback, setRetryFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const activeEmployees = employees.filter(e => e.status !== 'inactive');

  const handleCopyLink = () => {
    if (!createdInfo?.invitationUrl) return;
    navigator.clipboard.writeText(createdInfo.invitationUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleRetryEmail = async () => {
    if (!createdInfo?.clientId) return;
    setRetryingEmail(true);
    setRetryFeedback(null);
    try {
      const res = await invokeClientAdmin({
        action: 'resend_invitation',
        clientId: createdInfo.clientId,
      });

      if (res?.success) {
        setCreatedInfo(prev => prev ? {
          ...prev,
          invitationUrl: res.invitationUrl || prev.invitationUrl,
          emailDelivery: res.emailDelivery,
        } : null);

        if (res.emailDelivery?.sent) {
          setRetryFeedback({ type: 'success', text: `Invitation email sent successfully to ${createdInfo.email}!` });
        } else {
          setRetryFeedback({
            type: 'error',
            text: res.emailDelivery?.error || res.emailDelivery?.reason || 'Email provider delivery failed.',
          });
        }
      } else {
        setRetryFeedback({ type: 'error', text: res?.error || 'Failed to resend invitation.' });
      }
    } catch (err) {
      setRetryFeedback({ type: 'error', text: err instanceof Error ? err.message : 'Unable to resend email.' });
    } finally {
      setRetryingEmail(false);
    }
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const cleanCompany = companyName.trim();
    const cleanContact = primaryContact.trim();
    const cleanEmail = email.trim().toLowerCase();
    const cleanProject = projectName.trim();

    if (!cleanCompany) {
      setError('Please enter the client / company name.');
      return;
    }
    if (!cleanContact) {
      setError('Please enter the primary contact name.');
      return;
    }
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setError('Please enter a valid client email address.');
      return;
    }
    if (!cleanProject) {
      setError('Please specify the initial project name.');
      return;
    }

    setBusy(true);
    try {
      const res = await invokeClientAdmin({
        action: 'create_client',
        companyName: cleanCompany,
        primaryContact: cleanContact,
        email: cleanEmail,
        managerId: managerId || null,
        projectName: cleanProject,
        projectDescription: projectDescription.trim() || null,
      });

      if (res?.success) {
        setCreatedInfo({
          clientId: res.clientId,
          companyName: cleanCompany,
          email: cleanEmail,
          invitationUrl: res.invitationUrl,
          emailDelivery: res.emailDelivery,
        });
        if (onCreated) await onCreated();
      } else {
        setError(res?.error || 'Failed to create client account.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create client account.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full max-w-xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-2xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600">
              <Building2 className="w-5 h-5" />
            </span>
            <div>
              <h3 className="text-base font-bold text-slate-900">Add New Client Account</h3>
              <p className="text-xs text-slate-500">Provision client access and initialize assigned project</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-5">
          {error && (
            <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {createdInfo ? (
            <div className="space-y-4 py-2">
              <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-bold text-sm">Client Account Created Successfully</h4>
                  <p className="mt-1 text-emerald-800">
                    Account for <b>{createdInfo.companyName}</b> has been provisioned and linked to the project.
                  </p>
                </div>
              </div>

              {/* Email Delivery Status Banner */}
              {createdInfo.emailDelivery?.sent ? (
                <div className="p-3.5 rounded-2xl bg-blue-50 border border-blue-200 text-xs text-blue-900 flex items-start gap-2.5">
                  <MailCheck className="w-4.5 h-4.5 text-blue-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold block">Invitation Email Delivered</span>
                    <span className="text-blue-700">
                      An onboarding email with password setup instructions was sent to <b>{createdInfo.email}</b>.
                    </span>
                  </div>
                </div>
              ) : createdInfo.emailDelivery?.attempted ? (
                <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-start gap-2.5">
                  <AlertTriangle className="w-4.5 h-4.5 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold block">Automated Email Not Delivered</span>
                    <span className="text-amber-800">
                      {createdInfo.emailDelivery.error || 'Email dispatch failed'}. The invitation was still created safely. Please use the copyable link below to share it manually.
                    </span>
                  </div>
                </div>
              ) : (
                <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 text-xs text-slate-700 flex items-start gap-2.5">
                  <Mail className="w-4.5 h-4.5 text-slate-500 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold block text-slate-800">Manual Distribution Mode</span>
                    <span className="text-slate-600">
                      Automated email delivery is not configured. Please copy the invitation link below and send it to the client.
                    </span>
                  </div>
                </div>
              )}

              {/* Invitation Link Box */}
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-700">Client Setup Invitation Link</span>
                  <span className="text-[10px] text-slate-400">Expires in 72 hours • Single-use</span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    readOnly
                    value={createdInfo.invitationUrl}
                    className="input text-xs font-mono select-all bg-white"
                  />
                  <button
                    onClick={handleCopyLink}
                    className="px-3 py-2 bg-slate-900 text-white rounded-xl text-xs font-semibold hover:bg-slate-800 shrink-0 flex items-center gap-1.5 transition-colors"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <p className="text-[11px] text-slate-500">
                  The client will choose their permanent password upon clicking this link. No permanent password has been stored in plaintext.
                </p>
              </div>

              {retryFeedback && (
                <div className={`p-3 rounded-xl text-xs flex items-center gap-2 ${
                  retryFeedback.type === 'success'
                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                    : 'bg-rose-50 text-rose-800 border border-rose-200'
                }`}>
                  {retryFeedback.type === 'success' ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  )}
                  <span>{retryFeedback.text}</span>
                </div>
              )}

              <div className="flex items-center justify-between pt-2">
                {!createdInfo.emailDelivery?.sent && createdInfo.clientId ? (
                  <button
                    type="button"
                    onClick={handleRetryEmail}
                    disabled={retryingEmail}
                    className="px-3.5 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold flex items-center gap-1.5 transition-colors"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${retryingEmail ? 'animate-spin' : ''}`} />
                    {retryingEmail ? 'Sending...' : 'Retry Sending Email'}
                  </button>
                ) : <div />}

                <button
                  type="button"
                  onClick={onClose}
                  className="px-5 py-2.5 bg-blue-600 text-white text-xs font-bold rounded-xl hover:bg-blue-700 transition-colors"
                >
                  Done
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Client / Company Name */}
                <label className="block">
                  <span className="label">
                    Client / Company Name <span className="text-rose-500">*</span>
                  </span>
                  <div className="relative mt-1">
                    <Building2 className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      value={companyName}
                      onChange={e => setCompanyName(e.target.value)}
                      placeholder="e.g. Radisson Blu Hyderabad"
                      className="input pl-9"
                      required
                    />
                  </div>
                </label>

                {/* Primary Contact */}
                <label className="block">
                  <span className="label">
                    Primary Contact Name <span className="text-rose-500">*</span>
                  </span>
                  <div className="relative mt-1">
                    <User className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      value={primaryContact}
                      onChange={e => setPrimaryContact(e.target.value)}
                      placeholder="e.g. Rajesh Kumar"
                      className="input pl-9"
                      required
                    />
                  </div>
                </label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Login Email */}
                <label className="block">
                  <span className="label">
                    Login Email (Invitation Recipient) <span className="text-rose-500">*</span>
                  </span>
                  <div className="relative mt-1">
                    <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      placeholder="client.contact@company.com"
                      className="input pl-9"
                      required
                    />
                  </div>
                </label>

                {/* Assigned Manager */}
                <label className="block">
                  <span className="label">Assigned Project Manager</span>
                  <div className="relative mt-1">
                    <UserCheck className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <select
                      value={managerId}
                      onChange={e => setManagerId(e.target.value)}
                      className="input pl-9"
                    >
                      <option value="">No manager assigned</option>
                      {activeEmployees.map(emp => (
                        <option key={emp.id} value={emp.id}>
                          {emp.name} ({emp.designation || 'Staff'})
                        </option>
                      ))}
                    </select>
                  </div>
                </label>
              </div>

              {/* Initial Project */}
              <div className="border-t border-slate-100 pt-3 space-y-3">
                <label className="block">
                  <span className="label">
                    Initial Project Name <span className="text-rose-500">*</span>
                  </span>
                  <div className="relative mt-1">
                    <Briefcase className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      value={projectName}
                      onChange={e => setProjectName(e.target.value)}
                      placeholder="e.g. Banquet Hall Acoustic Retrofit"
                      className="input pl-9"
                      required
                    />
                  </div>
                </label>

                <label className="block">
                  <span className="label">Project Scope / Notes (Optional)</span>
                  <textarea
                    value={projectDescription}
                    onChange={e => setProjectDescription(e.target.value)}
                    placeholder="Brief description of the deliverables and scope…"
                    rows={2}
                    className="input resize-none"
                  />
                </label>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={busy}
                  className="px-4 py-2.5 text-xs font-semibold text-slate-600 hover:text-slate-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-blue-600/20 disabled:opacity-50"
                >
                  {busy ? 'Creating Client…' : 'Create and send invitation'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
