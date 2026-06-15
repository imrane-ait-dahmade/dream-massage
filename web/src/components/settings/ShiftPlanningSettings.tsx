'use client';

import { useState, useEffect, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';
import type { ShiftTypeSetting, StaffMember, WeeklyScheduleDay, TodayShiftSuggestion } from '@/lib/types';
import { getShiftTypes, getStaffMembers, getShiftSchedule, getTodayShiftSuggestions } from '@/lib/api';
import { TodayShiftSuggestions } from './TodayShiftSuggestions';
import { ShiftTypesSection } from './ShiftTypesSection';
import { WeeklyScheduleSection } from './WeeklyScheduleSection';

interface PlanningData {
  shiftTypes: ShiftTypeSetting[];
  staff: StaffMember[];
  days: WeeklyScheduleDay[];
  todayLabel: string;
  todaySuggestions: TodayShiftSuggestion[];
}

function SubSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-widest text-stone-400">
        {title}
      </h3>
      {children}
    </section>
  );
}

export function ShiftPlanningSettings() {
  const [data, setData] = useState<PlanningData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [stRes, staffRes, scheduleRes, todayRes] = await Promise.all([
        getShiftTypes(),
        getStaffMembers(),
        getShiftSchedule(),
        getTodayShiftSuggestions(),
      ]);
      setData({
        shiftTypes: stRes.items,
        staff: staffRes.items,
        days: scheduleRes.days,
        todayLabel: todayRes.label,
        todaySuggestions: todayRes.suggestions,
      });
    } catch (e) {
      setError((e as Error).message || 'Impossible de charger le planning.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (loading && !data) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-16 animate-pulse rounded-2xl bg-stone-100" />
        ))}
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-8 text-center">
        <p className="mb-3 text-sm text-red-600">{error}</p>
        <button
          onClick={() => void load()}
          className="mx-auto flex items-center gap-1.5 rounded-xl bg-stone-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-stone-700"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Réessayer
        </button>
      </div>
    );
  }

  if (!data) return null;

  const refresh = () => void load();

  return (
    <div className="space-y-8">
      {loading && (
        <div className="flex items-center gap-1.5 text-xs text-stone-400">
          <RefreshCw className="h-3 w-3 animate-spin" />
          Actualisation…
        </div>
      )}

      <SubSection title="Suggestions du jour">
        <TodayShiftSuggestions
          dayLabel={data.todayLabel}
          suggestions={data.todaySuggestions}
        />
      </SubSection>

      <SubSection title="Types de shifts">
        <ShiftTypesSection shiftTypes={data.shiftTypes} onRefresh={refresh} />
      </SubSection>

      <SubSection title="Planning hebdomadaire">
        <WeeklyScheduleSection
          shiftTypes={data.shiftTypes}
          staff={data.staff}
          days={data.days}
          onRefresh={refresh}
        />
      </SubSection>
    </div>
  );
}
