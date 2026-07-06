'use client';

import { useCallback, useEffect, useState } from 'react';
import { DoorClosed, DoorOpen, Loader2, RefreshCw } from 'lucide-react';
import type { OpenShift, StaffMember } from '@/lib/types';
import {
  closeShift,
  getOpenShift,
  getStaffMembers,
  openShiftManual,
  runShiftAutomationCheck,
} from '@/lib/api';

interface Props {
  staff: StaffMember[];
  onChanged: () => void;
}

export function ShiftManualControls({ staff, onChanged }: Props) {
  const [openShift, setOpenShift] = useState<OpenShift | null>(null);
  const [selectedStaffId, setSelectedStaffId] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const activeStaff = staff.filter((s) => s.isActive);

  const refresh = useCallback(async () => {
    const res = await getOpenShift();
    setOpenShift(res.shift);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (activeStaff.length === 1) setSelectedStaffId(activeStaff[0]!.id);
  }, [staff]);

  async function run(label: string, fn: () => Promise<unknown>, okMsg: string) {
    setBusy(label);
    setMessage(null);
    try {
      await fn();
      await refresh();
      onChanged();
      setMessage({ type: 'ok', text: okMsg });
    } catch (err) {
      setMessage({ type: 'err', text: err instanceof Error ? err.message : 'Action échouée' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
      <p className="text-sm font-semibold text-stone-800">Actions manuelles</p>
      <p className="mt-1 text-xs text-stone-500">
        Ouverture / fermeture d&apos;urgence. Le planning automatique reste la source principale.
      </p>

      {openShift && (
        <p className="mt-2 text-xs text-emerald-700">
          Shift ouvert : {openShift.staffMemberName} (depuis {openShift.startedAt.slice(11, 16)})
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!!busy}
          onClick={() => void run('check', runShiftAutomationCheck, 'Vérification effectuée')}
          className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50"
        >
          {busy === 'check' ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Vérifier maintenant
        </button>

        {!openShift && activeStaff.length > 0 && (
          <>
            {activeStaff.length > 1 && (
              <select
                value={selectedStaffId}
                onChange={(e) => setSelectedStaffId(e.target.value)}
                className="rounded-lg border border-stone-200 px-2 py-1.5 text-xs"
              >
                <option value="">Choisir staff…</option>
                {activeStaff.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            )}
            <button
              type="button"
              disabled={!!busy || (activeStaff.length > 1 && !selectedStaffId)}
              onClick={() => {
                const id = selectedStaffId || activeStaff[0]?.id;
                if (!id) return;
                void run('open', () => openShiftManual(id), 'Shift ouvert');
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-stone-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-stone-700 disabled:opacity-50"
            >
              {busy === 'open' ? <Loader2 className="h-3 w-3 animate-spin" /> : <DoorOpen className="h-3 w-3" />}
              Ouvrir shift
            </button>
          </>
        )}

        {openShift && (
          <button
            type="button"
            disabled={!!busy}
            onClick={() => void run('close', () => closeShift(openShift.id), 'Shift fermé')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
          >
            {busy === 'close' ? <Loader2 className="h-3 w-3 animate-spin" /> : <DoorClosed className="h-3 w-3" />}
            Fermer shift
          </button>
        )}
      </div>

      {message && (
        <p className={`mt-2 text-xs ${message.type === 'ok' ? 'text-green-700' : 'text-red-600'}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
