import { useState } from 'react';
import { CalendarRange } from 'lucide-react';
import { PRESETS, presetRange, type Preset } from '../lib/period';

export interface Period { from: string; to: string }

export function PeriodPicker({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  const [preset, setPreset] = useState<Preset>('mes');
  return (
    <div className="no-print flex flex-wrap items-center gap-2">
      <CalendarRange className="hidden h-4 w-4 text-muted-foreground sm:block" />
      <div className="flex flex-wrap gap-1 rounded-xl border bg-card p-1" role="group" aria-label="Período">
        {PRESETS.map((p) => (
          <button key={p.id} aria-pressed={preset === p.id} onClick={() => { setPreset(p.id); if (p.id !== 'custom') onChange(presetRange(p.id)); }}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${preset === p.id ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted'}`}>{p.label}</button>
        ))}
      </div>
      {preset === 'custom' && (
        <div className="flex items-center gap-2 text-xs">
          <input type="date" aria-label="Data inicial" className="input !w-auto !py-1.5" value={value.from} max={value.to} onChange={(e) => e.target.value && onChange({ ...value, from: e.target.value })} />
          <span className="text-muted-foreground">até</span>
          <input type="date" aria-label="Data final" className="input !w-auto !py-1.5" value={value.to} min={value.from} onChange={(e) => e.target.value && onChange({ ...value, to: e.target.value })} />
        </div>
      )}
    </div>
  );
}
