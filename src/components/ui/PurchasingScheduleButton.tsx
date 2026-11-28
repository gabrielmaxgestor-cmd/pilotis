import { Download } from 'lucide-react';
import type { CustomerMaterialRow } from '../../domain/customerMaterials';
import { planningTodayISO } from '../../domain/pilotisAdapters';
import { createPurchasingSchedulePdf } from '../../domain/purchasingSchedulePdf';
import { Button } from './PilotisUI';

export function PurchasingScheduleButton({ rows, projectId, projectName, companyName = 'Pilotis', contractCode }: {
  rows: CustomerMaterialRow[]; projectId: string; projectName: string; companyName?: string; contractCode?: string;
}) {
  function download() {
    const bytes = createPurchasingSchedulePdf({ rows, projectName, companyName, contractCode, date: planningTodayISO() });
    const url = URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'application/pdf' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'cronograma-compras-' + projectId + '.pdf';
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  return <Button variant="secondary" size="sm" disabled={!rows.length} onClick={download}>
    <Download className="h-4 w-4" aria-hidden="true" /> Cronograma de compras em PDF
  </Button>;
}
