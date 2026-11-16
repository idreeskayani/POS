import { PrintSettings, savePrintSettings } from '../print';

export default function PrintSettingsPanel({ settings, onChange, mode }: {
  settings: PrintSettings; onChange: (s: PrintSettings) => void; mode: 'cashier' | 'kitchen';
}) {
  const set = (patch: Partial<PrintSettings>) => { const next = { ...settings, ...patch }; savePrintSettings(next); onChange(next); };
  return (
    <details className="print-settings">
      <summary>Print settings</summary>
      <div className="ps-body">
        <label>Paper width
          <select value={settings.width} onChange={(e) => set({ width: Number(e.target.value) as 58 | 80 })}>
            <option value={80}>80 mm</option>
            <option value={58}>58 mm</option>
          </select>
        </label>
        {mode === 'cashier' ? (
          <>
            <label><input type="checkbox" checked={settings.autoKot} onChange={(e) => set({ autoKot: e.target.checked })} /> Also print kitchen slip on this device when order is sent</label>
            <label><input type="checkbox" checked={settings.autoBill} onChange={(e) => set({ autoBill: e.target.checked })} /> Print bill after payment</label>
          </>
        ) : (
          <label><input type="checkbox" checked={settings.kitchenAuto} onChange={(e) => set({ kitchenAuto: e.target.checked })} /> Auto-print new tickets on this screen</label>
        )}
        <p className="muted small">
          Settings are saved on this device. For printing without the dialog, start Chrome/Edge with <code>--kiosk-printing</code> and set the
          thermal printer as the Windows default printer.
        </p>
      </div>
    </details>
  );
}
