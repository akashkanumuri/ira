import React, { useEffect, useState } from 'react';
import { Lock, Plus, Trash2 } from 'lucide-react';
import { DEFAULT_RULES, deleteTemplate, fetchProjectsLite, fetchTemplates, normalizeRules, rulesSummary, saveTemplate, validateRules, type WorkRules, type WorkTemplate } from '../../lib/workRules';
import { notify } from '../../lib/toast';
import { confirmDialog } from '../../ui/confirm';
import { Badge, Button, Notice, Skeleton } from '../../ui';
import { Modal } from '../../ui/Modal';
import { WorkRulesEditor } from './WorkRulesEditor';

/** Admin: reusable "how they work" templates picked when adding an employee. */
export function WorkTemplatesSettings() {
  const [list, setList] = useState<WorkTemplate[] | null | undefined>(undefined);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [draft, setDraft] = useState<WorkRules>(DEFAULT_RULES);
  const [busy, setBusy] = useState(false);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);

  const load = () => { void fetchTemplates().then(setList); };
  useEffect(() => { load(); void fetchProjectsLite().then(setProjects); }, []);

  async function create() {
    if (!name.trim()) { notify('Give the template a name.', 'error'); return; }
    // person-specific fields (end date, projects) are filled per employee, so don't require them here
    const problem = validateRules({ ...draft, engagement_end: '2999-12-31', project_ids: ['template'] });
    if (problem) { notify(problem, 'error'); return; }
    setBusy(true);
    try { await saveTemplate(name, draft); notify('Template saved.', 'success'); setCreating(false); setName(''); setDraft(DEFAULT_RULES); load(); }
    catch (e) { notify(e instanceof Error ? e.message : 'Couldn’t save.', 'error'); }
    finally { setBusy(false); }
  }

  async function remove(t: WorkTemplate) {
    if (!(await confirmDialog({ title: `Delete “${t.name}”?`, message: 'People already using it keep their settings. It just won’t be offered for new employees.', confirmLabel: 'Delete', danger: true }))) return;
    try { await deleteTemplate(t.id); notify('Template deleted.', 'success'); load(); }
    catch (e) { notify(e instanceof Error ? e.message : 'Couldn’t delete.', 'error'); }
  }

  if (list === undefined) return <div className="card p-5 space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full rounded-2xl" />)}</div>;
  if (list === null) {
    return <Notice tone="sky" title="Work patterns switch on with the next database update">Templates for office, hybrid, remote, part-time and project-based people appear here once it’s applied.</Notice>;
  }

  return (
    <div className="card overflow-hidden">
      <div className="px-5 sm:px-6 py-4 border-b border-ink-100 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-display font-bold text-[15px] text-ink-900">Work patterns</p>
          <p className="text-[13px] text-ink-500 mt-0.5">Templates you pick when adding someone. Each person can still be adjusted individually.</p>
        </div>
        <Button icon={<Plus className="w-4 h-4" />} onClick={() => setCreating(true)}>New template</Button>
      </div>
      <ul className="divide-y divide-ink-100">
        {list.map((t) => (
          <li key={t.id} className="px-5 sm:px-6 py-3.5 flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-bold text-ink-900 flex items-center gap-2">{t.name}{t.is_builtin && <Badge tone="ink"><Lock className="w-3 h-3" /> Built-in</Badge>}</p>
              <p className="text-[12.5px] text-ink-500 mt-0.5">{rulesSummary(normalizeRules(t.rules))}</p>
            </div>
            {!t.is_builtin && (
              <button type="button" onClick={() => void remove(t)} className="icon-btn text-rose-500 hover:bg-rose-50" aria-label={`Delete ${t.name}`}><Trash2 className="w-4 h-4" /></button>
            )}
          </li>
        ))}
      </ul>

      {creating && (
        <Modal title="New work pattern" onClose={() => setCreating(false)} closeDisabled={busy} wide>
          <div className="space-y-4">
            <label className="block">
              <span className="label">Template name</span>
              <input className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="e.g. Hybrid 4 days · editors" />
            </label>
            <WorkRulesEditor value={draft} onChange={setDraft} effectiveFrom="2000-01-01" templates={list} projects={projects} />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setCreating(false)} disabled={busy}>Cancel</Button>
              <Button loading={busy} onClick={() => void create()}>Save template</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
