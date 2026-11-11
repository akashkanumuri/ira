/**
 * The five steps every client deliverable walks through, and which database statuses sit in each.
 * One definition, used by the delivery pipeline, the deliverable page and the client's tracker, so
 * staff and client are always looking at the same position on the same track.
 */
export interface DeliveryStage {
  id: 'start' | 'work' | 'internal' | 'client' | 'done';
  /** What staff call it. */
  name: string;
  /** What the client is told. No internal vocabulary. */
  clientName: string;
  statuses: string[];
}

export const DELIVERY_STAGES: DeliveryStage[] = [
  { id: 'start', name: 'Not started', clientName: 'Planned', statuses: ['Draft', 'Pending'] },
  { id: 'work', name: 'Work in progress', clientName: 'In work', statuses: ['In Progress', 'Awaiting Client Dependency', 'Modification Requested', 'Revision In Progress'] },
  { id: 'internal', name: 'Internal review', clientName: 'Our check', statuses: ['Under Internal Review'] },
  { id: 'client', name: 'With the client', clientName: 'Your review', statuses: ['Awaiting Client Review'] },
  { id: 'done', name: 'Approved', clientName: 'Approved', statuses: ['Completed', 'Ready for Download'] },
];

/** Position on the track, 0–4. Unknown or cancelled statuses sit at the start. */
export const deliveryStageIndex = (status: string): number =>
  Math.max(0, DELIVERY_STAGES.findIndex((s) => s.statuses.includes(status)));

/** One plain sentence for the client about where their deliverable is. */
export function clientStageLine(status: string): string {
  switch (status) {
    case 'Draft':
    case 'Pending': return 'Planned. Work on this has not started yet.';
    case 'In Progress': return 'We are working on it.';
    case 'Awaiting Client Dependency': return 'Paused: we need something from you before we can continue.';
    case 'Under Internal Review': return 'Finished on our side. We are checking it before it comes to you.';
    case 'Awaiting Client Review': return 'Ready for your review. It is waiting for your decision.';
    case 'Modification Requested':
    case 'Revision In Progress': return 'We are making the changes you asked for.';
    case 'Completed': return 'Approved and finished.';
    case 'Ready for Download': return 'Approved. The final files are ready to download.';
    case 'Cancelled': return 'This deliverable was cancelled.';
    default: return status;
  }
}

/** The short label on the client's tracker. The database status names are staff vocabulary. */
export function clientStageLabel(status: string): string {
  switch (status) {
    case 'Draft':
    case 'Pending': return 'Planned';
    case 'In Progress': return 'In work';
    case 'Awaiting Client Dependency': return 'Needs something from you';
    case 'Under Internal Review': return 'Our check';
    case 'Awaiting Client Review': return 'Your review';
    case 'Modification Requested':
    case 'Revision In Progress': return 'Making your changes';
    case 'Completed': return 'Approved';
    case 'Ready for Download': return 'Ready to download';
    case 'Cancelled': return 'Cancelled';
    default: return status;
  }
}
