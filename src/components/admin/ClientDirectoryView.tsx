import React, { useState, useEffect, useCallback } from 'react';
import type { Employee, ClientRecord } from '../../types/attendance';
import { Building2, Search, Plus, RefreshCw, Mail, User, Copy, Check, X, CheckCircle2, AlertTriangle, MailCheck } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { invokeClientAdmin } from '../../lib/v2';
import { ClientCreationModal } from './ClientCreationModal';

interface Props {
  employees: Employee[];
}

export const ClientDirectoryView: React.FC<Props> = ({ employees }) => {
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [resendingClient, setResendingClient] = useState<string | null>(null);
  const [resendResult, setResendResult] = useState<{
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
  const [copiedLink, setCopiedLink] = useState(false);

  const loadClients = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from('clients')
        .select(`
          id,
          profile_id,
          company_name,
          primary_contact,
          email,
          status,
          created_at,
          updated_at
        `)
        .order('created_at', { ascending: false });

      if (!error && data) {
        setClients(
          data.map((c: any) => ({
            id: c.id,
            profileId: c.profile_id,
            companyName: c.company_name,
            primaryContact: c.primary_contact,
            email: c.email,
            status: c.status,
            createdAt: c.created_at,
            updatedAt: c.updated_at,
          }))
        );
      }
    } catch (err) {
      console.error('Failed to load clients:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadClients();
  }, [loadClients]);

  const handleResendInvitation = async (client: ClientRecord) => {
    setResendingClient(client.id);
    try {
      const res = await invokeClientAdmin({
        action: 'resend_invitation',
        clientId: client.profileId,
      });

      if (res?.success) {
        setResendResult({
          companyName: client.companyName,
          email: client.email,
          invitationUrl: res.invitationUrl,
          emailDelivery: res.emailDelivery,
        });
      } else {
        alert(res?.error || 'Failed to resend invitation.');
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Unable to resend invitation.');
    } finally {
      setResendingClient(null);
    }
  };

  const handleCopyLink = () => {
    if (!resendResult?.invitationUrl) return;
    navigator.clipboard.writeText(resendResult.invitationUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2500);
  };

  const filtered = clients.filter(c => {
    const matchesStatus = statusFilter === 'all' || c.status === statusFilter;
    const term = search.trim().toLowerCase();
    const matchesSearch =
      !term ||
      c.companyName.toLowerCase().includes(term) ||
      c.primaryContact.toLowerCase().includes(term) ||
      c.email.toLowerCase().includes(term);
    return matchesStatus && matchesSearch;
  });

  return (
    <div className="space-y-5">
      {/* Search and Action Bar */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
        <div className="flex gap-2 flex-1 max-w-xl">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search company name, primary contact, or email…"
              className="input pl-9 text-xs"
            />
          </div>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="input w-auto text-xs"
          >
            <option value="all">All status</option>
            <option value="invited">Invited</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          <button
            onClick={() => void loadClients()}
            disabled={loading}
            title="Refresh clients list"
            className="icon-btn"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <button
          onClick={() => setShowCreateModal(true)}
          className="btn-primary flex items-center justify-center gap-1.5 whitespace-nowrap text-xs"
        >
          <Plus className="w-4 h-4" /> Add client
        </button>
      </div>

      {/* Clients Table */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-2xs">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider font-semibold border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-left">Client / Company</th>
                <th className="px-4 py-3 text-left">Primary Contact</th>
                <th className="px-4 py-3 text-left">Login Email</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Created</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map(client => (
                <tr key={client.id} className="hover:bg-slate-50/60 transition-colors">
                  <td className="px-4 py-3.5 font-bold text-slate-900 flex items-center gap-2.5">
                    <span className="w-7 h-7 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 shrink-0">
                      <Building2 className="w-3.5 h-3.5" />
                    </span>
                    <span>{client.companyName}</span>
                  </td>
                  <td className="px-4 py-3.5 text-slate-700">
                    <span className="inline-flex items-center gap-1.5">
                      <User className="w-3.5 h-3.5 text-slate-400" />
                      {client.primaryContact}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 font-mono text-slate-600">
                    <span className="inline-flex items-center gap-1.5">
                      <Mail className="w-3.5 h-3.5 text-slate-400" />
                      {client.email}
                    </span>
                  </td>
                  <td className="px-4 py-3.5">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border ${
                        client.status === 'active'
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : client.status === 'invited'
                          ? 'bg-amber-50 text-amber-700 border-amber-200'
                          : 'bg-slate-100 text-slate-600 border-slate-200'
                      }`}
                    >
                      {client.status}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-slate-500 whitespace-nowrap">
                    {new Date(client.createdAt).toLocaleDateString('en-IN', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </td>
                  <td className="px-4 py-3.5 text-right whitespace-nowrap">
                    {client.status === 'invited' && (
                      <button
                        onClick={() => handleResendInvitation(client)}
                        disabled={resendingClient === client.id}
                        className="px-2.5 py-1 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold text-[11px] inline-flex items-center gap-1.5 transition-colors"
                      >
                        <Mail className="w-3 h-3 text-slate-400" />
                        {resendingClient === client.id ? 'Sending…' : 'Resend Invite'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}

              {!filtered.length && !loading && (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400">
                    <Building2 className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                    <p className="font-semibold text-slate-600">No client accounts found</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Add a client to provision access and generate an onboarding invitation.
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Resend Result Modal */}
      {resendResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full max-w-lg p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <span className="w-8 h-8 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600">
                  <Mail className="w-4 h-4" />
                </span>
                <div>
                  <h4 className="text-sm font-bold text-slate-900">Client Setup Invitation</h4>
                  <p className="text-xs text-slate-500">{resendResult.companyName}</p>
                </div>
              </div>
              <button
                onClick={() => setResendResult(null)}
                className="w-7 h-7 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Email Status */}
            {resendResult.emailDelivery?.sent ? (
              <div className="p-3 rounded-2xl bg-blue-50 border border-blue-200 text-xs text-blue-900 flex items-start gap-2.5">
                <MailCheck className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                <span>Invitation email successfully dispatched to <b>{resendResult.email}</b>.</span>
              </div>
            ) : resendResult.emailDelivery?.attempted ? (
              <div className="p-3 rounded-2xl bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <span>
                  Email dispatch failed: {resendResult.emailDelivery.error}. Please share the setup link below manually.
                </span>
              </div>
            ) : (
              <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200 text-xs text-slate-700 flex items-start gap-2.5">
                <Mail className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                <span>Automated email delivery not configured. Please copy and share the link below.</span>
              </div>
            )}

            {/* Copyable Link */}
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-slate-700">Setup Invitation Link</span>
                <span className="text-[10px] text-slate-400">Expires in 72 hours</span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={resendResult.invitationUrl}
                  className="input text-xs font-mono select-all bg-white"
                />
                <button
                  onClick={handleCopyLink}
                  className="px-3 py-2 bg-slate-900 text-white rounded-xl text-xs font-semibold hover:bg-slate-800 shrink-0 flex items-center gap-1.5 transition-colors"
                >
                  {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedLink ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setResendResult(null)}
                className="px-5 py-2.5 bg-blue-600 text-white text-xs font-bold rounded-xl hover:bg-blue-700 transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {showCreateModal && (
        <ClientCreationModal
          employees={employees}
          onClose={() => setShowCreateModal(false)}
          onCreated={() => void loadClients()}
        />
      )}
    </div>
  );
};
