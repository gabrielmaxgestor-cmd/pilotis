import type { ArchiveMeta, FinancialTransaction, PilotisDataState } from '../types/pilotis';

export const ARCHIVABLE_COLLECTIONS = ['clients', 'quotes', 'projects', 'employees'] as const;
export type ArchivableCollection = typeof ARCHIVABLE_COLLECTIONS[number];
export const DELETE_CONFIRMATION = 'EXCLUIR';

export function isArchived(record: ArchiveMeta) {
  return Boolean(record.archive);
}

export function isReversalStatus(status: string) {
  return status === 'Estornado' || status === 'Estorno';
}

export function canReverseMovement(record: Pick<FinancialTransaction, 'status' | 'installmentId'>) {
  // Forecast entries with a parcel can be restored only through the parcel's lifecycle.
  return !isReversalStatus(record.status) && !record.installmentId;
}

export function ledgerSignedAmount(record: Pick<FinancialTransaction, 'amount' | 'entryKind' | 'status'>) {
  const amount = record.entryKind === 'expense' ? -record.amount : record.amount;
  return record.status === 'Estorno' ? -amount : amount;
}

/** Corrective entries offset the original in its own period and account. */
export function effectiveTransactions<T extends Pick<FinancialTransaction, 'status'>>(rows: readonly T[]): T[] {
  return rows.filter((row) => !isReversalStatus(row.status));
}

/** Remove archived entities from operational views while retaining financial and fiscal records. */
export function activePilotisData(data: PilotisDataState): PilotisDataState {
  const archivedProjects = new Set(data.projects.filter(isArchived).map((row) => row.id));
  const archivedEmployees = new Set(data.employees.filter(isArchived).map((row) => row.id));
  const onActiveProject = (row: { projectId: string }) => !archivedProjects.has(row.projectId);
  return {
    ...data,
    clients: data.clients.filter((row) => !isArchived(row)),
    quotes: data.quotes.filter((row) => !isArchived(row)),
    projects: data.projects.filter((row) => !isArchived(row)),
    employees: data.employees.filter((row) => !isArchived(row)),
    stages: data.stages.filter(onActiveProject),
    allocations: data.allocations.filter((row) => onActiveProject(row) && !archivedEmployees.has(row.employeeId)),
    baselines: data.baselines?.filter(onActiveProject),
    scheduleProgress: data.scheduleProgress?.filter(onActiveProject),
    projectRisks: data.projectRisks?.filter(onActiveProject),
    dailyLogs: data.dailyLogs.filter(onActiveProject),
  };
}
