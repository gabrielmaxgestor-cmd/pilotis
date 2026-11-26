import { FieldPath, getFirestore, type Firestore, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import type { App } from 'firebase-admin/app';
import type { AiTopic, AiTurn } from '../domain/aiContext';
import type { CompanySettings, PilotisDataState } from '../types/pilotis';

export type StoredAiTurn = Omit<AiTurn, 'id'> & {
  ownerUid: string;
  updatedAt: string;
  updatedBy: AiTurn['createdBy'];
};
export interface AiStore {
  read(uid: string, topics: Set<AiTopic>): Promise<PilotisDataState>;
  history(uid: string): Promise<AiTurn[]>;
  find(uid: string, id: string): Promise<AiTurn | undefined>;
  save(uid: string, id: string, turn: StoredAiTurn): Promise<AiTurn>;
}

export function createAiStore(app: App, databaseId: string): AiStore {
  const db = databaseId === '(default)' ? getFirestore(app) : getFirestore(app, databaseId);
  const historyRef = (uid: string) => db.collection('conversasIA').doc(uid).collection('mensagens');
  return {
    read: (uid, topics) => readCompanyData(db, uid, topics),
    async history(uid) {
      const snapshot = await historyRef(uid).orderBy('createdAt', 'desc').limit(80).get();
      return snapshot.docs.map((row) => toTurn(row.id, row.data() as StoredAiTurn, uid)).filter((row): row is AiTurn => Boolean(row)).reverse();
    },
    async find(uid, id) {
      const row = await historyRef(uid).doc(id).get();
      const data = row.data() as StoredAiTurn | undefined;
      return data && toTurn(row.id, data, uid);
    },
    async save(uid, id, turn) {
      const ref = historyRef(uid).doc(id);
      try {
        await ref.create(turn);
        return toTurn(id, turn, uid)!;
      } catch (error) {
        if ((error as { code?: number }).code !== 6) throw error;
        const row = await ref.get();
        const data = row.data() as StoredAiTurn | undefined;
        if (!data || data.ownerUid !== uid) throw error;
        return toTurn(id, data, uid)!;
      }
    },
  };
}

function toTurn(id: string, data: StoredAiTurn, uid: string) {
  if (data.ownerUid !== uid) return undefined;
  return { id, conversationId: data.conversationId, mode: data.mode, question: data.question,
    weekly: data.weekly, week: data.week, answer: data.answer, createdAt: data.createdAt, createdBy: data.createdBy };
}

function needs(topics: Set<AiTopic>, ...requested: AiTopic[]) {
  return requested.some((topic) => topics.has(topic));
}

async function readCompanyData(db: Firestore, uid: string, topics: Set<AiTopic>): Promise<PilotisDataState> {
  async function rows<T>(collection: string, required: boolean, fields?: string[]): Promise<T[]> {
    if (!required) return [];
    const result: T[] = [];
    const owned = db.collection(collection).where('ownerUid', '==', uid);
    const source = (fields ? owned.select(...fields) : owned).orderBy(FieldPath.documentId()).limit(200);
    let cursor: QueryDocumentSnapshot | undefined;
    for (;;) {
      const snapshot = await (cursor ? source.startAfter(cursor) : source).get();
      result.push(...snapshot.docs.map((row) => ({ ...row.data(), id: row.id } as T)));
      if (snapshot.size < 200) return result;
      cursor = snapshot.docs[snapshot.docs.length - 1];
    }
  }
  const [settings, projects, transactions, installments, quotes, employees, allocations, stages, complianceItems, debts, projectClosures] =
    await Promise.all([
      needs(topics, 'forecast', 'payroll') ? db.collection('companySettings').doc(uid).get() : undefined,
      rows<PilotisDataState['projects'][number]>('projects', needs(topics, 'finance', 'forecast', 'invoices', 'projects', 'stages', 'team', 'payroll', 'compliance'), [
        'name', 'type', 'contractKind', 'status', 'startDate', 'closureDate', 'warrantyStartDate', 'contractValue',
        'budgetedLabor', 'budgetedSubcontract', 'budgetedEquipment', 'budgetedTax', 'budgetedBdi',
      ]),
      rows<PilotisDataState['transactions'][number]>('transactions', needs(topics, 'finance', 'forecast', 'invoices', 'projects'), [
        'date', 'dueDate', 'description', 'entryKind', 'category', 'projectId', 'projectName', 'amount', 'status',
        'isForecast', 'wasForecast', 'invoiceStatus', 'source', 'installmentId', 'debtId',
        'payrollPeriod', 'payrollProvisions',
      ]),
      rows<PilotisDataState['installments'][number]>('parcelas', needs(topics, 'finance', 'forecast', 'invoices')),
      rows<PilotisDataState['quotes'][number]>('quotes', needs(topics, 'forecast', 'funnel')),
      rows<PilotisDataState['employees'][number]>('employees', needs(topics, 'forecast', 'team', 'payroll')),
      rows<PilotisDataState['allocations'][number]>('allocations', needs(topics, 'forecast', 'team', 'payroll')),
      rows<PilotisDataState['stages'][number]>('stages', needs(topics, 'projects', 'stages')),
      rows<PilotisDataState['complianceItems'][number]>('complianceItems', topics.has('compliance')),
      rows<PilotisDataState['debts'][number]>('debts', topics.has('debts')),
      rows<NonNullable<PilotisDataState['projectClosures']>[number]>('projectClosures', topics.has('projects')),
    ]);
  const savedSettings = settings?.data() as CompanySettings | undefined;
  return {
    settings: savedSettings?.ownerUid === uid ? { ...savedSettings, id: uid } : null,
    projects, transactions, installments, quotes, employees, allocations, stages, complianceItems, debts, projectClosures,
    clients: [], dailyLogs: [], pops: [], tenders: [], warrantyCalls: [], auditLogs: [],
  };
}
