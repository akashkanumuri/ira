import React, { useEffect, useState } from 'react';
import type { AuthUser } from '../../contexts/AuthContext';
import type { ProjectRecord } from '../../types/attendance';
import { Building2, Briefcase, Clock, User, LogOut, RefreshCw, FolderKanban } from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface Props {
  user: AuthUser;
  onLogout: () => Promise<void>;
}

export const ClientPortalView: React.FC<Props> = ({ user, onLogout }) => {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const loadProjects = async () => {
    setLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from('projects')
        .select('id, name, description, status, created_at, updated_at')
        .order('created_at', { ascending: false });

      if (!error && data) {
        setProjects(
          data.map((p: any) => ({
            id: p.id,
            name: p.name,
            description: p.description,
            status: p.status,
            createdBy: null,
            createdAt: p.created_at,
            updatedAt: p.updated_at,
          }))
        );
      }
    } catch (err) {
      console.error('Failed to load client projects:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadProjects();
  }, []);

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col">
      {/* Top Navigation */}
      <header className="border-b border-white/10 bg-slate-950/80 backdrop-blur-xl px-6 py-4 sticky top-0 z-30 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <img
            src="/ira-hospitality-logo.png"
            alt="IRA Hospitality"
            className="h-10 w-auto object-contain"
          />
          <div className="hidden sm:block border-l border-white/10 pl-4">
            <span className="text-xs font-bold text-white block">Client Portal</span>
            <span className="text-[11px] text-slate-400">IRA Hospitality & Architecture</span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-right hidden sm:block">
            <div className="text-xs font-bold text-white">{user.companyName || user.name}</div>
            <div className="text-[11px] text-slate-400">{user.email}</div>
          </div>

          <button
            onClick={() => void onLogout()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white text-xs font-semibold border border-white/10 transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out</span>
          </button>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-8 space-y-6">
        {/* Welcome Banner */}
        <div className="rounded-3xl bg-gradient-to-r from-blue-900/40 via-indigo-900/20 to-slate-800/40 border border-white/10 p-6 sm:p-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-xl">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-[10px] font-bold uppercase tracking-wider">
              <Building2 className="w-3 h-3" /> Client Workspace
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-white">
              Welcome, {user.primaryContact || user.name}
            </h1>
            <p className="text-xs text-slate-400 max-w-lg leading-relaxed">
              Track project progress, active milestones, design deliverables, and operational updates in real time.
            </p>
          </div>

          <button
            onClick={() => void loadProjects()}
            disabled={loading}
            className="px-3.5 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-200 border border-white/10 text-xs font-semibold flex items-center gap-2 transition-colors self-start sm:self-auto"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh Projects</span>
          </button>
        </div>

        {/* Projects Section */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FolderKanban className="w-4 h-4 text-blue-400" />
              <h2 className="text-sm font-bold text-white uppercase tracking-wider">
                Authorized Projects ({projects.length})
              </h2>
            </div>
          </div>

          {loading ? (
            <div className="py-16 text-center text-slate-400 text-xs flex flex-col items-center gap-3">
              <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <span>Loading authorized projects…</span>
            </div>
          ) : projects.length === 0 ? (
            <div className="rounded-2xl bg-white/5 border border-white/10 p-12 text-center space-y-2">
              <Briefcase className="w-8 h-8 text-slate-500 mx-auto" />
              <h3 className="text-sm font-bold text-slate-200">No active projects assigned</h3>
              <p className="text-xs text-slate-400 max-w-sm mx-auto">
                Your client account is active. When the administrator assigns an active project to your company profile, it will appear here.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {projects.map(project => (
                <div
                  key={project.id}
                  className="rounded-2xl bg-white/5 border border-white/10 p-5 space-y-3 hover:border-white/20 transition-colors shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="font-bold text-sm text-white">{project.name}</h3>
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border ${
                        project.status === 'active'
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                          : project.status === 'paused'
                          ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                          : 'bg-slate-500/10 text-slate-400 border-slate-500/20'
                      }`}
                    >
                      {project.status}
                    </span>
                  </div>

                  {project.description && (
                    <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed">
                      {project.description}
                    </p>
                  )}

                  <div className="pt-2 border-t border-white/5 flex items-center justify-between text-[11px] text-slate-500">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {new Date(project.createdAt).toLocaleDateString('en-IN', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </span>
                    <span className="text-blue-400 font-semibold">Active Milestone</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
};
