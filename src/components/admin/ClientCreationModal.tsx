import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import type { Employee } from '../../types/attendance';
import {
  Building2,
  User,
  Mail,
  Briefcase,
  UserCheck,
  ChevronDown,
  X,
  AlertCircle,
  CheckCircle2,
  Copy,
  Check,
  MailCheck,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
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
        setCreatedInfo(prev =>
          prev
            ? {
                ...prev,
                invitationUrl: res.invitationUrl || prev.invitationUrl,
                emailDelivery: res.emailDelivery,
              }
            : null
        );

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

  const modalContent = (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 md:p-8 bg-slate-950/60 backdrop-blur-sm overflow-y-auto overscroll-contain animate-fade-in"
      onClick={e => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="client-modal-title"
    >
      <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full md:w-[960px] max-w-[calc(100vw-32px)] sm:max-w-[calc(100vw-48px)] md:max-w-[960px] max-h-[calc(100dvh-32px)] sm:max-h-[calc(100dvh-48px)] flex flex-col overflow-hidden my-auto">
        {/* Modal Header */}
        <div className="px-6 sm:px-8 py-5 sm:py-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50 shrink-0">
          <div className="flex items-center gap-3.5 sm:gap-4">
            <span className="w-12 h-12 rounded-2xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 shrink-0 shadow-xs">
              <Building2 className="w-6 h-6" />
            </span>
            <div>
              <h3 id="client-modal-title" className="text-xl sm:text-2xl font-bold text-slate-900 leading-tight">
                Add New Client Account
              </h3>
              <p className="text-xs sm:text-sm text-slate-500 mt-1">
                Provision client portal access and initialize assigned project
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-10 h-10 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 sm:p-8 md:p-10 overflow-y-auto flex-1 space-y-6 sm:space-y-7">
          {error && (
            <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-sm text-rose-800 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              <span className="leading-relaxed">{error}</span>
            </div>
          )}

          {createdInfo ? (
            <div className="space-y-6 py-2">
              <div className="p-5 sm:p-6 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-900 flex items-start gap-3.5">
                <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-bold text-base sm:text-lg">Client Account Created Successfully</h4>
                  <p className="mt-1 text-sm sm:text-base text-emerald-800 leading-relaxed">
                    Account for <b className="text-emerald-950">{createdInfo.companyName}</b> has been provisioned and linked to the project.
                  </p>
                </div>
              </div>

              {/* Email Delivery Status Banner */}
              {createdInfo.emailDelivery?.sent ? (
                <div className="p-4 sm:p-5 rounded-2xl bg-blue-50 border border-blue-200 text-sm text-blue-900 flex items-start gap-3">
                  <MailCheck className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold block text-sm sm:text-base">Invitation Email Delivered</span>
                    <span className="text-blue-700 leading-relaxed block mt-0.5">
                      An onboarding email with password setup instructions was sent to <b>{createdInfo.email}</b>.
                    </span>
                  </div>
                </div>
              ) : createdInfo.emailDelivery?.attempted ? (
                <div className="p-4 sm:p-5 rounded-2xl bg-amber-50 border border-amber-200 text-sm text-amber-900 flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold block text-sm sm:text-base">Automated Email Not Delivered</span>
                    <span className="text-amber-800 leading-relaxed block mt-0.5">
                      {createdInfo.emailDelivery.error || 'Email dispatch failed'}. The invitation was still created safely. Please use the copyable link below to share it manually.
                    </span>
                  </div>
                </div>
              ) : (
                <div className="p-4 sm:p-5 rounded-2xl bg-slate-50 border border-slate-200 text-sm text-slate-700 flex items-start gap-3">
                  <Mail className="w-5 h-5 text-slate-500 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold block text-slate-800 text-sm sm:text-base">Manual Distribution Mode</span>
                    <span className="text-slate-600 leading-relaxed block mt-0.5">
                      Automated email delivery is not configured. Please copy the invitation link below and send it to the client.
                    </span>
                  </div>
                </div>
              )}

              {/* Invitation Link Box */}
              <div className="p-5 sm:p-6 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
                <div className="flex items-center justify-between text-xs sm:text-sm">
                  <span className="font-bold text-slate-700 uppercase tracking-wider text-xs">Client Setup Invitation Link</span>
                  <span className="text-xs text-slate-400">Expires in 72 hours • Single-use</span>
                </div>
                <div className="flex flex-col sm:flex-row items-stretch gap-3">
                  <input
                    readOnly
                    value={createdInfo.invitationUrl}
                    className="w-full h-14 rounded-xl border border-slate-300 bg-white text-slate-900 text-sm sm:text-base font-mono px-4 select-all shadow-xs outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleCopyLink}
                    className="h-14 px-6 sm:px-7 bg-slate-900 text-white rounded-xl text-sm font-bold hover:bg-slate-800 shrink-0 flex items-center justify-center gap-2 transition-colors shadow-xs"
                  >
                    {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                    {copied ? 'Copied Link' : 'Copy Link'}
                  </button>
                </div>
                <p className="text-xs text-slate-500">
                  The client will choose their permanent password upon clicking this link. No permanent password has been stored in plaintext.
                </p>
              </div>

              {retryFeedback && (
                <div
                  className={`p-4 rounded-xl text-sm flex items-center gap-2.5 ${
                    retryFeedback.type === 'success'
                      ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                      : 'bg-rose-50 text-rose-800 border border-rose-200'
                  }`}
                >
                  {retryFeedback.type === 'success' ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                  ) : (
                    <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
                  )}
                  <span>{retryFeedback.text}</span>
                </div>
              )}

              <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-3">
                {!createdInfo.emailDelivery?.sent && createdInfo.clientId ? (
                  <button
                    type="button"
                    onClick={handleRetryEmail}
                    disabled={retryingEmail}
                    className="h-13 sm:h-14 px-5 rounded-xl border border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-bold flex items-center justify-center gap-2 transition-colors"
                  >
                    <RefreshCw className={`w-4 h-4 ${retryingEmail ? 'animate-spin' : ''}`} />
                    {retryingEmail ? 'Sending...' : 'Retry Sending Email'}
                  </button>
                ) : (
                  <div />
                )}

                <button
                  type="button"
                  onClick={onClose}
                  className="h-13 sm:h-14 px-8 bg-blue-600 text-white text-sm sm:text-base font-bold rounded-xl hover:bg-blue-700 transition-colors text-center shadow-md shadow-blue-600/20"
                >
                  Done
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6 sm:space-y-7">
              {/* Client & Primary Contact Row */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-7 gap-y-6 sm:gap-y-7">
                {/* Client / Company Name */}
                <label className="block">
                  <span className="block text-[15px] sm:text-base font-semibold text-slate-800 mb-2">
                    Client / Company Name <span className="text-rose-500 font-bold ml-1">*</span>
                  </span>
                  <div className="relative">
                    <div className="absolute left-4 top-1/2 -translate-y-1/2 flex items-center justify-center pointer-events-none text-slate-400">
                      <Building2 className="w-5 h-5" />
                    </div>
                    <input
                      value={companyName}
                      onChange={e => setCompanyName(e.target.value)}
                      placeholder="e.g. Radisson Blu Hyderabad"
                      className="w-full h-14 rounded-xl border border-slate-300 bg-white text-slate-900 text-[18px] placeholder:text-slate-400 focus:outline-none focus:border-blue-600 focus:ring-4 focus:ring-blue-600/10 transition-all shadow-xs"
                      style={{ paddingLeft: '3.25rem', paddingRight: '1rem' }}
                      required
                    />
                  </div>
                </label>

                {/* Primary Contact */}
                <label className="block">
                  <span className="block text-[15px] sm:text-base font-semibold text-slate-800 mb-2">
                    Primary Contact Name <span className="text-rose-500 font-bold ml-1">*</span>
                  </span>
                  <div className="relative">
                    <div className="absolute left-4 top-1/2 -translate-y-1/2 flex items-center justify-center pointer-events-none text-slate-400">
                      <User className="w-5 h-5" />
                    </div>
                    <input
                      value={primaryContact}
                      onChange={e => setPrimaryContact(e.target.value)}
                      placeholder="e.g. Rajesh Kumar"
                      className="w-full h-14 rounded-xl border border-slate-300 bg-white text-slate-900 text-[18px] placeholder:text-slate-400 focus:outline-none focus:border-blue-600 focus:ring-4 focus:ring-blue-600/10 transition-all shadow-xs"
                      style={{ paddingLeft: '3.25rem', paddingRight: '1rem' }}
                      required
                    />
                  </div>
                </label>
              </div>

              {/* Email & Manager Row */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-7 gap-y-6 sm:gap-y-7">
                {/* Login Email */}
                <label className="block">
                  <span className="block text-[15px] sm:text-base font-semibold text-slate-800 mb-2">
                    Login Email (Invitation Recipient) <span className="text-rose-500 font-bold ml-1">*</span>
                  </span>
                  <div className="relative">
                    <div className="absolute left-4 top-1/2 -translate-y-1/2 flex items-center justify-center pointer-events-none text-slate-400">
                      <Mail className="w-5 h-5" />
                    </div>
                    <input
                      type="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      placeholder="client.contact@company.com"
                      className="w-full h-14 rounded-xl border border-slate-300 bg-white text-slate-900 text-[18px] placeholder:text-slate-400 focus:outline-none focus:border-blue-600 focus:ring-4 focus:ring-blue-600/10 transition-all shadow-xs"
                      style={{ paddingLeft: '3.25rem', paddingRight: '1rem' }}
                      required
                    />
                  </div>
                </label>

                {/* Assigned Manager */}
                <label className="block">
                  <span className="block text-[15px] sm:text-base font-semibold text-slate-800 mb-2">
                    Assigned Project Manager
                  </span>
                  <div className="relative">
                    <div className="absolute left-4 top-1/2 -translate-y-1/2 flex items-center justify-center pointer-events-none text-slate-400">
                      <UserCheck className="w-5 h-5" />
                    </div>
                    <select
                      value={managerId}
                      onChange={e => setManagerId(e.target.value)}
                      className="w-full h-14 rounded-xl border border-slate-300 bg-white text-slate-900 text-[18px] focus:outline-none focus:border-blue-600 focus:ring-4 focus:ring-blue-600/10 transition-all shadow-xs appearance-none cursor-pointer"
                      style={{ paddingLeft: '3.25rem', paddingRight: '3rem' }}
                    >
                      <option value="">No manager assigned</option>
                      {activeEmployees.map(emp => (
                        <option key={emp.id} value={emp.id}>
                          {emp.name} ({emp.designation || 'Staff'})
                        </option>
                      ))}
                    </select>
                    <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center justify-center pointer-events-none text-slate-400">
                      <ChevronDown className="w-5 h-5" />
                    </div>
                  </div>
                </label>
              </div>

              {/* Project Section Divider */}
              <div className="border-t border-slate-100 pt-6 mt-2 space-y-6 sm:space-y-7">
                <div className="flex items-center gap-2.5">
                  <span className="w-2 h-2 rounded-full bg-blue-600" />
                  <h4 className="text-xs sm:text-sm font-bold uppercase tracking-wider text-slate-500">
                    Project Assignment
                  </h4>
                </div>

                {/* Initial Project Name — Full Width */}
                <label className="block">
                  <span className="block text-[15px] sm:text-base font-semibold text-slate-800 mb-2">
                    Initial Project Name <span className="text-rose-500 font-bold ml-1">*</span>
                  </span>
                  <div className="relative">
                    <div className="absolute left-4 top-1/2 -translate-y-1/2 flex items-center justify-center pointer-events-none text-slate-400">
                      <Briefcase className="w-5 h-5" />
                    </div>
                    <input
                      value={projectName}
                      onChange={e => setProjectName(e.target.value)}
                      placeholder="e.g. Banquet Hall Acoustic Retrofit"
                      className="w-full h-14 rounded-xl border border-slate-300 bg-white text-slate-900 text-[18px] placeholder:text-slate-400 focus:outline-none focus:border-blue-600 focus:ring-4 focus:ring-blue-600/10 transition-all shadow-xs"
                      style={{ paddingLeft: '3.25rem', paddingRight: '1rem' }}
                      required
                    />
                  </div>
                </label>

                {/* Project Scope / Notes (Optional) — Full Width */}
                <label className="block">
                  <span className="block text-[15px] sm:text-base font-semibold text-slate-800 mb-2">
                    Project Scope / Notes <span className="text-xs font-normal text-slate-400 ml-1.5">(Optional)</span>
                  </span>
                  <div>
                    <textarea
                      value={projectDescription}
                      onChange={e => setProjectDescription(e.target.value)}
                      placeholder="Brief description of the deliverables and scope…"
                      rows={3}
                      className="w-full min-h-[110px] rounded-xl border border-slate-300 bg-white text-slate-900 text-[18px] placeholder:text-slate-400 p-4 focus:outline-none focus:border-blue-600 focus:ring-4 focus:ring-blue-600/10 transition-all shadow-xs resize-none"
                    />
                  </div>
                </label>
              </div>

              {/* Modal Footer */}
              <div className="px-6 sm:px-8 py-4 sm:py-5 -mx-6 sm:-mx-8 md:-mx-10 -mb-6 sm:-mb-8 md:-mb-10 mt-8 border-t border-slate-200/80 bg-slate-50/50 flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-3 sm:gap-4 shrink-0">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={busy}
                  className="h-13 sm:h-14 px-6 sm:px-7 rounded-xl border border-slate-200 hover:border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-[15px] sm:text-base font-bold transition-all text-center flex items-center justify-center"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="h-13 sm:h-14 px-6 sm:px-8 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-xl text-[15px] sm:text-base font-bold transition-all shadow-md shadow-blue-600/20 disabled:opacity-50 flex items-center justify-center gap-2.5"
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

  return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : modalContent;
};
