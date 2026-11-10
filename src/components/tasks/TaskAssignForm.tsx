import { CircleAlert, RefreshCw } from 'lucide-react';
/** Only what the form actually shows, so a lighter row from another screen fits too. */
export interface AssignTarget { id: string; name: string; designation?: string | null }
import type { LinkableDeliverable } from '../../lib/linkableDeliverables';
import { getKolkataDateString } from '../../lib/workingDays';

const today = () => getKolkataDateString();

/** The one Assign work form. Opened from Work & tasks, a manager's page, and a client deliverable. */
export function TaskAssignForm({
  targets,
  onSubmit,
  onClose,
  busy = false,
  isAdmin = false,
  userDesignation,
  directReportDesignations = [],
  hasDirectReportRules = false,
  deliverables = [],
  fixedDeliverable,
}: {
  deliverables?: LinkableDeliverable[];
  /** Opened from inside a deliverable: it is shown, not chosen. */
  fixedDeliverable?: { id: string; label: string };
  targets: AssignTarget[];
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
  busy?: boolean;
  isAdmin?: boolean;
  userDesignation?: string;
  directReportDesignations?: string[];
  hasDirectReportRules?: boolean;
}) {
  const hasNoTargets = targets.length === 0;

  return (
    <form onSubmit={onSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {hasNoTargets && (
        <div className="md:col-span-2 rounded-2xl border border-amber-200 bg-amber-50/90 p-4 flex items-start gap-3">
          <div className="p-2 rounded-xl bg-amber-100 text-amber-800 shrink-0 mt-0.5">
            <CircleAlert className="w-5 h-5" />
          </div>
          <div className="space-y-1 text-xs">
            <p className="font-bold text-amber-950 text-sm">No employees available for assignment</p>
            {isAdmin ? (
              <p className="text-amber-900 leading-relaxed">
                There are currently no active employees in the organization. Add active employees under <span className="font-semibold">Employees / HR</span> to begin assigning tasks.
              </p>
            ) : hasDirectReportRules ? (
              <p className="text-amber-900 leading-relaxed">
                Your designation {userDesignation ? <span className="font-semibold">({userDesignation})</span> : ''} is configured to assign tasks to direct reports{directReportDesignations.length ? <> in <span className="font-semibold">{directReportDesignations.join(', ')}</span></> : ''}. However, no active employees are currently assigned to you as their reporting manager in HR.
              </p>
            ) : (
              <p className="text-amber-900 leading-relaxed">
                No active employees are authorized for task assignment under your current designation rules.
              </p>
            )}
            {!isAdmin && (
              <p className="text-amber-850 pt-1 font-medium">
                To delegate tasks, an administrator must assign team members to your reporting hierarchy in <span className="font-semibold">Employees / HR</span>, or configure assignment rules in <span className="font-semibold">Settings</span>.
              </p>
            )}
          </div>
        </div>
      )}

      <label className="md:col-span-2">
        <span className="label">Task</span>
        <input name="title" className="input" placeholder="e.g. Design homepage hero banner" required disabled={hasNoTargets} />
      </label>

      <label className="md:col-span-2">
        <span className="label">Brief</span>
        <textarea name="description" className="input min-h-20" placeholder="What has to be produced, and anything they need to know to start…" required disabled={hasNoTargets} />
        <span className="block text-xs text-ink-400 mt-1.5">Required. Nobody should get a one-word task.</span>
      </label>

      <label>
        <span className="label">Assign To</span>
        {hasNoTargets ? (
          <div>
            <select name="assignedTo" disabled className="input bg-slate-50 text-slate-400 cursor-not-allowed border-slate-200" aria-disabled="true">
              <option value="">No authorized employees available</option>
            </select>
            <span className="text-[11px] text-amber-700 mt-1 block font-medium">
              {isAdmin ? 'Add active employees in HR to enable assignment.' : 'Direct reporting line required to delegate tasks.'}
            </span>
          </div>
        ) : (
          <select name="assignedTo" className="input" required defaultValue="">
            <option value="" disabled>Select employee</option>
            {targets.map(e => (
              <option key={e.id} value={e.id}>{e.name} · {e.designation}</option>
            ))}
          </select>
        )}
      </label>

      <label>
        <span className="label">Priority</span>
        <select name="priority" defaultValue="medium" className="input" disabled={hasNoTargets}>
          <option value="low">low</option>
          <option value="medium">medium</option>
          <option value="high">high</option>
          <option value="urgent">urgent</option>
        </select>
      </label>

      {fixedDeliverable ? (
        <div className="md:col-span-2 rounded-2xl border border-ink-100 bg-ink-50/70 px-4 py-3">
          <p className="text-xs font-semibold text-ink-700">Part of</p>
          <p className="text-[13px] text-ink-900 mt-0.5">{fixedDeliverable.label}</p>
          <input type="hidden" name="deliverableId" value={fixedDeliverable.id} />
        </div>
      ) : deliverables.length > 0 ? (
        <label className="md:col-span-2">
          <span className="label">Client deliverable <span className="font-normal text-ink-400">optional</span></span>
          <select name="deliverableId" defaultValue="" className="input" disabled={hasNoTargets}>
            <option value="">Not linked to a client deliverable</option>
            {Array.from(new Set(deliverables.map((d) => d.projectName))).map((project) => (
              <optgroup key={project} label={project}>
                {deliverables.filter((d) => d.projectName === project).map((d) => (
                  <option key={d.id} value={d.id}>{d.number ? `${d.number} · ` : ''}{d.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
          <span className="block text-xs text-ink-400 mt-1.5">Links this work to the client’s deliverable so it shows who is responsible.</span>
        </label>
      ) : null}

      <label>
        <span className="label">Start Date</span>
        <input type="date" name="startDate" defaultValue={today()} className="input" required disabled={hasNoTargets} />
      </label>

      <label>
        <span className="label">Due Date</span>
        <input type="date" name="dueDate" defaultValue={today()} className="input" required disabled={hasNoTargets} />
      </label>

      <label>
        <span className="label">Estimated effort <span className="font-normal text-ink-400">optional · hours</span></span>
        <input type="number" name="estimateHours" min={0.25} max={999} step={0.25} className="input" placeholder="e.g. 4" disabled={hasNoTargets} />
        <span className="block text-xs text-ink-400 mt-1.5">Compared with the time the assignee tracks.</span>
      </label>

      <label>
        <span className="label">Research time <span className="font-normal text-ink-400">minutes · before the work starts</span></span>
        <input type="number" name="researchMinutes" min={5} max={480} step={5} defaultValue={30} className="input" required disabled={hasNoTargets} />
        <span className="block text-xs text-ink-400 mt-1.5">On top of the effort. They share links, findings and a plan before working.</span>
      </label>

      <div className="md:col-span-2 flex justify-end gap-2 pt-2">
        <button type="button" onClick={onClose} className="btn-secondary">
          Cancel
        </button>
        <button
          type="submit"
          disabled={busy || hasNoTargets}
          title={hasNoTargets ? 'Cannot assign: No authorized employees available' : undefined}
          className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy ? (
            <span className="inline-flex items-center gap-1.5">
              <RefreshCw className="w-4 h-4 animate-spin" />
              Assigning…
            </span>
          ) : (
            'Assign'
          )}
        </button>
      </div>
    </form>
  );
}
