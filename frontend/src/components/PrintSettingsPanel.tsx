import { PrintSettings, savePrintSettings } from '../print';

export default function PrintSettingsPanel({ settings, onChange }: { settings: PrintSettings; onChange: (s: PrintSettings) => void }) {
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
        <label><input type="checkbox" checked={settings.autoKot} onChange={(e) => set({ autoKot: e.target.checked })} /> Print the kitchen slip on this PC when an order is sent</label>
        <label><input type="checkbox" checked={settings.autoBill} onChange={(e) => set({ autoBill: e.target.checked })} /> Print the bill after payment</label>
        <p className="muted small">
          Turn the first option on only if the kitchen printer is connected to this PC. If the kitchen printer is on another PC, open the
          <b> Kitchen printer</b> page there and leave it open: it prints every new order automatically.
        </p>
        <p className="muted small">
          For printing without the dialog, start Chrome/Edge with <code>--kiosk-printing</code> and set the thermal printer as the Windows default printer.
        </p>
      </div>
    </details>
  );
}
