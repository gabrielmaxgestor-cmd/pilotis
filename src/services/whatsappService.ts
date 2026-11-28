import {
  collection, doc, limit, onSnapshot, orderBy, query, runTransaction, serverTimestamp, startAfter,
  type DocumentData, type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { installmentWhatsAppContext, normalizeWhatsAppNumber } from '../domain/whatsapp';
import { planningTodayISO } from '../domain/pilotisAdapters';
import { db } from '../lib/firebase';
import type {
  ActorRole, Client, CustomerMaterial, Installment, Project, ProjectFollowUp, ProjectStage, WhatsAppModel, WhatsAppSend,
} from '../types/pilotis';

export interface WhatsAppTarget {
  model: WhatsAppModel;
  projectId: string;
  sourceId: string;
}

type HistoryCursor = QueryDocumentSnapshot<DocumentData>;
const HISTORY_PAGE_SIZE = 25;

export function watchWhatsAppHistory(clientId: string, cursor: HistoryCursor | null,
  onPage: (rows: WhatsAppSend[], next: HistoryCursor | null) => void, onError: () => void) {
  const source = collection(db, 'clients', clientId, 'whatsappHistory');
  return onSnapshot(query(source, orderBy('createdAt', 'desc'),
    ...(cursor ? [startAfter(cursor)] : []), limit(HISTORY_PAGE_SIZE + 1)), (snapshot) => {
    const page = snapshot.docs.slice(0, HISTORY_PAGE_SIZE);
    onPage(page.map((record) => ({ ...record.data(), id: record.id }) as WhatsAppSend),
      snapshot.size > page.length ? page.at(-1) ?? null : null);
  }, onError);
}

export async function recordWhatsAppSend(params: {
  uid: string;
  actor: ActorRole;
  clientId: string;
  openedPhone: string;
  messageId: string;
  target: WhatsAppTarget;
}) {
  const { uid, actor, clientId, openedPhone, messageId, target } = params;
  const date = planningTodayISO();
  const clientRef = doc(db, 'clients', clientId);
  const projectRef = doc(db, 'projects', target.projectId);
  const historyRef = doc(clientRef, 'whatsappHistory', messageId);

  await runTransaction(db, async (tx) => {
    const [previous, clientSnap, projectSnap] = await Promise.all([tx.get(historyRef), tx.get(clientRef), tx.get(projectRef)]);
    if (previous.exists()) return;
    const client = clientSnap.data() as Client | undefined;
    const project = projectSnap.data() as Project | undefined;
    if (!client || client.ownerUid !== uid || client.archive || normalizeWhatsAppNumber(client.phone) !== openedPhone) {
      throw new Error('O contato do cliente mudou. Confira o cadastro e reabra o atalho.');
    }
    if (!project || project.ownerUid !== uid || project.archive || project.clientId !== clientId) {
      throw new Error('Confira o cliente vinculado à obra.');
    }

    const updated = { updatedBy: actor, updatedAt: serverTimestamp() };
    const created = { ownerUid: uid, createdBy: actor, createdAt: serverTimestamp(), ...updated };
    if (target.model === 'installmentDue' || target.model === 'installmentOverdue') {
      const ref = doc(db, 'parcelas', target.sourceId);
      const installment = (await tx.get(ref)).data() as Installment | undefined;
      if (!installment || installment.ownerUid !== uid || installment.projectId !== target.projectId ||
        installment.clientId !== clientId || !installmentWhatsAppContext(installment, date)) {
        throw new Error('A parcela precisa estar em aberto para registrar o lembrete.');
      }
      tx.update(ref, { reminderMessageId: messageId, reminderSentAt: serverTimestamp(), ...updated });
    } else if (target.model === 'material') {
      const material = (await tx.get(doc(db, 'customerMaterials', target.sourceId))).data() as CustomerMaterial | undefined;
      if (!material || material.ownerUid !== uid || material.projectId !== target.projectId || material.status === 'Entregue' ||
        project.status === 'Concluída') {
        throw new Error('Selecione um material pendente desta obra.');
      }
    } else if (target.model === 'milestone') {
      const stage = (await tx.get(doc(db, 'stages', target.sourceId))).data() as ProjectStage | undefined;
      if (!stage || stage.ownerUid !== uid || stage.projectId !== target.projectId || !stage.isMilestone ||
        project.status === 'Concluída') {
        throw new Error('Selecione um marco desta obra.');
      }
    } else if (target.model === 'testimonial') {
      if (project.status !== 'Concluída' || target.sourceId !== target.projectId) {
        throw new Error('Encerre a obra para solicitar o depoimento.');
      }
      const followUpRef = doc(db, 'projectFollowUps', target.projectId);
      const followUp = (await tx.get(followUpRef)).data() as ProjectFollowUp | undefined;
      if (followUp) tx.update(followUpRef, { testimonialRequestedAt: date, ...updated });
      else tx.set(followUpRef, {
        projectId: target.projectId, testimonialRequestedAt: date, referralRequestedAt: '',
        testimonial: '', referrals: '', marketingPhotos: [], authorizationNote: '', ...created,
      });
      if (!client.testimonialStatus?.startsWith('Recebido')) {
        tx.update(clientRef, { testimonialStatus: 'Solicitado', ...updated });
      }
    } else {
      throw new Error('Selecione um modelo de WhatsApp válido.');
    }

    tx.set(historyRef, { model: target.model, projectId: target.projectId, sourceId: target.sourceId, ...created });
  });
}
