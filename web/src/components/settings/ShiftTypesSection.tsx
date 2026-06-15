'use client';

import { useState } from 'react';
import { Plus, Pencil, Clock, CheckCircle, XCircle, Save, X } from 'lucide-react';
import type { ShiftTypeSetting } from '@/lib/types';
import { createShiftType, updateShiftType } from '@/lib/api';

interface Props {
  shiftTypes: ShiftTypeSetting[];
  onRefresh: () => void;
}

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

// ── Create form ────────────────────────────────────────────────────────────────

interface CreateState {
  name: string;
  label: string;
  startTime: string;
  endTime: string;
  isActive: boolean;
  sortOrder: string;
}

const BLANK: CreateState = {
  name: '', label: '', startTime: '', endTime: '', isActive: true, sortOrder: '99',
};

interface CreateFormProps {
  onCancel: () => void;
  onSaved: (msg: string) => void;
  onError: (msg: string) => void;
}

function CreateForm({ onCancel, onSaved, onError }: CreateFormProps) {
  const [s, setS] = useState<CreateState>(BLANK);
  const [saving, setSaving] = useState(false);

  function field<K extends keyof CreateState>(key: K) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setS((prev) => ({ ...prev, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  }

  async function handleSave() {
    const name = s.name.trim();
    const label = s.label.trim();
    const start = s.startTime.trim();
    const end = s.endTime.trim();
    if (!name) { onError('Le nom technique est requis'); return; }
    if (!label) { onError('Le libellé est requis'); return; }
    if (!HH_MM.test(start)) { onError('Heure début invalide (format HH:mm)'); return; }
    if (!HH_MM.test(end)) { onError('Heure fin invalide (format HH:mm)'); return; }
    setSaving(true);
    try {
      await createShiftType({
        name,
        label,
        startTime: start,
        endTime: end,
        isActive: s.isActive,
        sortOrder: Number(s.sortOrder) || 99,
      });
      onSaved('Nouveau type de shift créé');
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
      <p className="text-sm font-semibold text-stone-800">Nouveau type de shift</p>

      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1">
          <span className="text-xs font-medium text-stone-500">Nom technique*</span>
          <input
            type="text"
            placeholder="ex: matin"
            value={s.name}
            onChange={field('name')}
            className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm focus:border-stone-400 focus:outline-none"
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs font-medium text-stone-500">Libellé*</span>
          <input
            type="text"
            placeholder="ex: Matin"
            value={s.label}
            onChange={field('label')}
            className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm focus:border-stone-400 focus:outline-none"
          />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1">
          <span className="text-xs font-medium text-stone-500">Heure début*</span>
          <input
            type="time"
            value={s.startTime}
            onChange={field('startTime')}
            className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm focus:border-stone-400 focus:outline-none"
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs font-medium text-stone-500">Heure fin*</span>
          <input
            type="time"
            value={s.endTime}
            onChange={field('endTime')}
            className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm focus:border-stone-400 focus:outline-none"
          />
        </label>
      </div>

      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm text-stone-700">
          <input
            type="checkbox"
            checked={s.isActive}
            onChange={field('isActive')}
            className="h-4 w-4 rounded"
          />
          Actif
        </label>
        <label className="flex items-center gap-2 text-sm text-stone-500">
          <span className="text-xs">Ordre</span>
          <input
            type="number"
            value={s.sortOrder}
            onChange={field('sortOrder')}
            min={1}
            className="w-16 rounded-lg border border-stone-200 px-2 py-1.5 text-sm focus:border-stone-400 focus:outline-none"
          />
        </label>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => void handleSave()}
          disabled={saving}
          className="flex items-center gap-1.5 rounded-xl bg-stone-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-stone-700 disabled:opacity-50"
        >
          <Save className="h-3.5 w-3.5" />
          {saving ? 'Enregistrement…' : 'Enregistrer'}
        </button>
        <button
          onClick={onCancel}
          className="flex items-center gap-1.5 rounded-xl border border-stone-200 px-4 py-2 text-sm font-semibold text-stone-600 transition-colors hover:bg-stone-50"
        >
          <X className="h-3.5 w-3.5" />
          Annuler
        </button>
      </div>
    </div>
  );
}

// ── Edit form (inline) ────────────────────────────────────────────────────────

interface EditState {
  label: string;
  startTime: string;
  endTime: string;
  isActive: boolean;
  sortOrder: string;
}

interface EditFormProps {
  shiftType: ShiftTypeSetting;
  onCancel: () => void;
  onSaved: (msg: string) => void;
  onError: (msg: string) => void;
}

function EditForm({ shiftType: st, onCancel, onSaved, onError }: EditFormProps) {
  const [s, setS] = useState<EditState>({
    label: st.label ?? st.name,
    startTime: st.startTime,
    endTime: st.endTime,
    isActive: st.isActive,
    sortOrder: String(st.sortOrder),
  });
  const [saving, setSaving] = useState(false);

  function field<K extends keyof EditState>(key: K) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setS((prev) => ({ ...prev, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  }

  async function handleSave() {
    const label = s.label.trim();
    const start = s.startTime.trim();
    const end = s.endTime.trim();
    if (!label) { onError('Le libellé est requis'); return; }
    if (!HH_MM.test(start)) { onError('Heure début invalide (format HH:mm)'); return; }
    if (!HH_MM.test(end)) { onError('Heure fin invalide (format HH:mm)'); return; }
    setSaving(true);
    try {
      await updateShiftType(st.id, {
        label,
        startTime: start,
        endTime: end,
        isActive: s.isActive,
        sortOrder: Number(s.sortOrder) || st.sortOrder,
      });
      onSaved('Type de shift mis à jour');
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3 rounded-2xl border border-stone-300 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-stone-400">
        Modifier — {st.name}
      </p>

      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1">
          <span className="text-xs font-medium text-stone-500">Libellé*</span>
          <input
            type="text"
            value={s.label}
            onChange={field('label')}
            className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm focus:border-stone-400 focus:outline-none"
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs font-medium text-stone-500">Ordre</span>
          <input
            type="number"
            value={s.sortOrder}
            onChange={field('sortOrder')}
            min={1}
            className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm focus:border-stone-400 focus:outline-none"
          />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1">
          <span className="text-xs font-medium text-stone-500">Heure début*</span>
          <input
            type="time"
            value={s.startTime}
            onChange={field('startTime')}
            className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm focus:border-stone-400 focus:outline-none"
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs font-medium text-stone-500">Heure fin*</span>
          <input
            type="time"
            value={s.endTime}
            onChange={field('endTime')}
            className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm focus:border-stone-400 focus:outline-none"
          />
        </label>
      </div>

      <label className="flex items-center gap-2 text-sm text-stone-700">
        <input
          type="checkbox"
          checked={s.isActive}
          onChange={field('isActive')}
          className="h-4 w-4 rounded"
        />
        Actif
      </label>

      <div className="flex gap-2">
        <button
          onClick={() => void handleSave()}
          disabled={saving}
          className="flex items-center gap-1.5 rounded-xl bg-stone-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-stone-700 disabled:opacity-50"
        >
          <Save className="h-3.5 w-3.5" />
          {saving ? 'Enregistrement…' : 'Enregistrer'}
        </button>
        <button
          onClick={onCancel}
          className="flex items-center gap-1.5 rounded-xl border border-stone-200 px-4 py-2 text-sm font-semibold text-stone-600 transition-colors hover:bg-stone-50"
        >
          <X className="h-3.5 w-3.5" />
          Annuler
        </button>
      </div>
    </div>
  );
}

// ── Main export ────────────────────────────────────────────────────────────────

export function ShiftTypesSection({ shiftTypes, onRefresh }: Props) {
  const [editId, setEditId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function onSaved(msg: string) {
    setEditId(null);
    setCreating(false);
    setError(null);
    setSuccess(msg);
    onRefresh();
    setTimeout(() => setSuccess(null), 3000);
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-stone-400">
        Les types de shifts définissent les périodes de travail comme Matin, Soir ou Journée.
      </p>

      {success && (
        <div className="flex items-center gap-2 rounded-xl border border-green-100 bg-green-50 px-4 py-2.5 text-sm text-green-700">
          <CheckCircle className="h-4 w-4 shrink-0" />
          {success}
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-red-100 bg-red-50 px-4 py-2.5 text-sm text-red-600">
          <XCircle className="h-4 w-4 shrink-0" />
          {error}
          <button onClick={() => setError(null)} className="ml-auto shrink-0 hover:opacity-70">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {creating && (
        <CreateForm
          onCancel={() => { setCreating(false); setError(null); }}
          onSaved={onSaved}
          onError={setError}
        />
      )}

      {shiftTypes.length === 0 && !creating ? (
        <div className="rounded-2xl border border-dashed border-stone-200 bg-white py-8 text-center">
          <Clock className="mx-auto mb-2 h-6 w-6 text-stone-300" />
          <p className="text-sm text-stone-400">Aucun type de shift configuré</p>
        </div>
      ) : (
        <div className="space-y-2">
          {shiftTypes.map((st) =>
            editId === st.id ? (
              <EditForm
                key={st.id}
                shiftType={st}
                onCancel={() => { setEditId(null); setError(null); }}
                onSaved={onSaved}
                onError={setError}
              />
            ) : (
              <div
                key={st.id}
                className="flex items-center gap-3 rounded-2xl border border-stone-100 bg-white px-4 py-3 shadow-sm"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-stone-100">
                  <Clock className="h-4 w-4 text-stone-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-stone-900">{st.label ?? st.name}</p>
                    {st.isActive ? (
                      <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700">
                        Actif
                      </span>
                    ) : (
                      <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-semibold text-stone-400">
                        Inactif
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-stone-400">
                    {st.startTime} → {st.endTime}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <span className="text-xs text-stone-300">#{st.sortOrder}</span>
                  <button
                    onClick={() => { setEditId(st.id); setError(null); setSuccess(null); }}
                    className="ml-2 rounded-lg p-1.5 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700"
                    title="Modifier"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ),
          )}
        </div>
      )}

      {!creating && (
        <button
          onClick={() => { setCreating(true); setEditId(null); setError(null); setSuccess(null); }}
          className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-stone-300 py-3 text-sm font-medium text-stone-500 transition-colors hover:border-stone-400 hover:text-stone-700"
        >
          <Plus className="h-4 w-4" />
          Nouveau type de shift
        </button>
      )}
    </div>
  );
}
