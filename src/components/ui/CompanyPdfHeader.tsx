import type { CompanySettings } from '../../types/pilotis';
import { normalizeHexColor } from '../../utils/spreadsheet';

export function CompanyPdfHeader({
  settings,
  subtitle,
}: {
  settings: CompanySettings | null;
  subtitle: string;
}) {
  const companyName = settings?.companyName || 'Pilotis Soluções Construtivas';
  const accentColor = normalizeHexColor(settings?.accentColor, '#9A6212');
  const showLogo = settings?.pdfShowLogo ?? true;
  const hasUploadedLogo =
    Boolean(settings?.logoDataUrl) &&
    typeof settings?.logoDataUrl === 'string' &&
    settings.logoDataUrl.startsWith('data:image/');

  const detailParts = [
    settings?.cnpj ? `CNPJ ${settings.cnpj}` : '',
    settings?.city || '',
    settings?.phone || '',
    settings?.email || '',
  ].filter(Boolean);

  return (
    <div
      className="flex items-center justify-between gap-4 pb-4 border-b-2"
      style={{ borderBottomColor: accentColor }}
    >
      <div className="flex items-center gap-3 min-w-0">
        {showLogo &&
          (hasUploadedLogo ? (
            <img
              src={settings!.logoDataUrl}
              alt={`Logo ${companyName}`}
              className="w-11 h-11 rounded-[8px] object-contain bg-white border border-[#E4E1DA] p-0.5 shrink-0"
            />
          ) : (
            <div
              className="w-11 h-11 rounded-[8px] text-white font-bold text-lg grid place-items-center shrink-0"
              style={{ backgroundColor: accentColor }}
              aria-hidden="true"
            >
              {(companyName.trim().charAt(0) || 'P').toUpperCase()}
            </div>
          ))}
        <div className="min-w-0">
          <strong className="block text-base font-bold text-[#14181F] truncate">
            {companyName}
          </strong>
          <span className="block text-xs text-[#5B6472]">{subtitle}</span>
          {detailParts.length > 0 && (
            <span className="block text-[11px] text-[#5B6472] mt-0.5 truncate">
              {detailParts.join(' · ')}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
