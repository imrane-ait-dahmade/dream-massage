'use client';

import type { VisibilityFilter } from '@/lib/archive';
import { VISIBILITY_TABS } from '@/lib/archive';

interface Props {
  value: VisibilityFilter;
  onChange: (v: VisibilityFilter) => void;
}

export function VisibilityTabs({ value, onChange }: Props) {
  return (
    <div className="flex gap-1 rounded-xl bg-stone-100 p-1">
      {VISIBILITY_TABS.map((tab) => (
        <button
          key={tab.value}
          type="button"
          onClick={() => onChange(tab.value)}
          className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
            value === tab.value
              ? 'bg-white text-stone-900 shadow-sm'
              : 'text-stone-500 hover:text-stone-700'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export function ArchivedBadge() {
  return (
    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-amber-200">
      Archivé
    </span>
  );
}
