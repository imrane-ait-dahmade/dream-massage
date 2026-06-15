'use client';

import { useState } from 'react';
import { Plus, Pencil, Trash2, Save, X, CheckCircle, XCircle, Users, Moon } from 'lucide-react';
import type { ShiftTypeSetting, StaffMember, WeeklyScheduleDay, StaffScheduleItem } from '@/lib/types';
import { createShiftSchedule, updateShiftSchedule, deleteShiftSchedule } from '@/lib/api';

interface Props {
  shiftTypes: ShiftTypeSetting[];
  staff: StaffMember[];
  days: WeeklyScheduleDay[];
  onRefresh: () => void;
}

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

const DAY_OPTIONS = [
  { value: '1', label: 'Lundi' },
  { value: '2', label: 'Mardi' },
  { value: '3', label: 'Mercredi' },
  { value: '4', label: 'Jeudi' },
  { value: '5', label: 'Vendredi' },
  { value: '6', label: 'Samedi' },
  { value: '7', label: 'Dimanche' },
];

// ── Add form ───────────────────────────────────────────────────────────────────

interface AddFormState {
  staffMemberId: string;
  dayOfWeek: string;
  shiftTypeId: string;
  isOff: boolean;
  startTime: string;
  endTime: string;
  notes: string;
}

const BLANK_ADD: AddFormState = {
  staffMemberId: '', dayOfWeek: '1', shiftTypeId: '',
  isOff: false, startTime: '', endTime: '', notes: '',
};

interface AddFormProps {
  shiftTypes: ShiftTypeSetting[];
  staff: StaffMember[];
  onCancel: () => void;
  onSaved: () => void;
  onError: (msg: string) => void;
}

function AddForm({ shiftTypes, staff, onCancel, onSaved, onError }: AddFormProps) {
  const [s, setS] = useState<AddFormState>(BLANK_ADD);
  const [saving, setSaving] = useState(false);

  const activeShiftTypes = shiftTypes.filter((st) => st.isActive);

  async function handleSave() {
    if (!s.staffMemberId) { onError('Veuillez sélectionner une assistante'); return; }
    if (!s.isOff && !s.shiftTypeId) { onError('Veuillez sélectionner un type de shift'); return; }
    if (s.startTime && !HH_MM.test(s.startTime)) { onError('Heure début invalide (HH:mm)'); return; }
    if (s.endTime && !HH_MM.test(s.endTime)) { onError('Heure fin invalide (HH:mm)'); return; }
    setSaving(true);
    try {
      await createShiftSchedule({
        staffMemberId: s.staffMemberId,
        shiftTypeId: s.isOff ? null : (s.shiftTypeId || null),
        dayOfWeek: Number(s.dayOfWeek),
        startTime: s.startTime || null,
        endTime: s.endTime || null,
        isOff: s.isOff,
        notes: s.notes || null,
      });
      onSaved();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
      <p className="text-sm font-semibold text-stone-800">Assigner une assistante</p>

      <label className="block space-y-1">
        <span className="text-xs font-medium text-stone-500">Assistante*</span>
        <select
          value={s.staffMemberId}
          onChange={(e) => setS((prev) => ({ ...prev, staffMemberId: e.target.value }))}
          className="w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm focus:border-stone-400 focus:outline-none"
        >
          <option value="">— Sélectionner —</option>
          {staff.filter((m) => m.isActive).map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1">
          <span className="text-xs font-medium text-stone-500">Jour*</span>
          <select
            value={s.dayOfWeek}
            onChange={(e) => setS((prev) => ({ ...prev, dayOfWeek: e.target.value }))}
            className="w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm focus:border-stone-400 focus:outline-none"
          >
            {DAY_OPTIONS.map((d) => (
              <option key={d.value} value={d.value}>{d.label}</option>
            ))}
          </select>
        </label>

        <div className="flex items-end pb-2">
          <label className="flex items-center gap-2 text-sm text-stone-700">
            <input
              type="checkbox"
              checked={s.isOff}
              onChange={(e) => setS((prev) => ({ ...prev, isOff: e.target.checked, shiftTypeId: '' }))}
              className="h-4 w-4 rounded"
            />
            Repos
          </label>
        </div>
      </div>

      {!s.isOff && (
        <label className="block space-y-1">
          <span className="text-xs font-medium text-stone-500">Type de shift*</span>
          <select
            value={s.shiftTypeId}
            onChange={(e) => setS((prev) => ({ ...prev, shiftTypeId: e.target.value }))}
            className="w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm focus:border-stone-400 focus:outline-none"
          >
            <option value="">— Sélectionner —</option>
            {activeShiftTypes.map((st) => (
              <option key={st.id} value={st.id}>
                {st.label ?? st.name} ({st.startTime}–{st.endTime})
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1">
          <span className="text-xs font-medium text-stone-500">Début (optionnel)</span>
          <input
            type="time"
            value={s.startTime}
            onChange={(e) => setS((prev) => ({ ...prev, startTime: e.target.value }))}
            className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm focus:border-stone-400 focus:outline-none"
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs font-medium text-stone-500">Fin (optionnel)</span>
          <input
            type="time"
            value={s.endTime}
            onChange={(e) => setS((prev) => ({ ...prev, endTime: e.target.value }))}
            className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm focus:border-stone-400 focus:outline-none"
          />
        </label>
      </div>

      <label className="block space-y-1">
        <span className="text-xs font-medium text-stone-500">Notes (optionnel)</span>
        <input
          type="text"
          value={s.notes}
          onChange={(e) => setS((prev) => ({ ...prev, notes: e.target.value }))}
          className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm focus:border-stone-400 focus:outline-none"
        />
      </label>

      <p className="text-[11px] text-stone-400">
        Le planning sert à préparer qui travaille chaque jour. Le shift réel reste ouvert/fermé depuis la gestion des shifts.
      </p>

      <div className="flex gap-2">
        <button
          onClick={() => void handleSave()}
          disabled={saving}
          className="flex items-center gap-1.5 rounded-xl bg-stone-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-stone-700 disabled:opacity-50"
        >
          <Save className="h-3.5 w-3.5" />
          {saving ? 'Enregistrement…' : 'Assigner'}
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

// ── Inline edit form for an existing schedule item ─────────────────────────────

interface EditItemState {
  shiftTypeId: string;
  isOff: boolean;
  startTime: string;
  endTime: string;
  notes: string;
}

interface EditItemFormProps {
  item: StaffScheduleItem;
  shiftTypes: ShiftTypeSetting[];
  onCancel: () => void;
  onSaved: () => void;
  onError: (msg: string) => void;
}

function EditItemForm({ item, shiftTypes, onCancel, onSaved, onError }: EditItemFormProps) {
  const [s, setS] = useState<EditItemState>({
    shiftTypeId: item.shiftTypeId ?? '',
    isOff: item.isOff,
    startTime: item.startTime ?? '',
    endTime: item.endTime ?? '',
    notes: item.notes ?? '',
  });
  const [saving, setSaving] = useState(false);

  const activeShiftTypes = shiftTypes.filter((st) => st.isActive);

  async function handleSave() {
    if (!s.isOff && !s.shiftTypeId) { onError('Veuillez sélectionner un type de shift'); return; }
    if (s.startTime && !HH_MM.test(s.startTime)) { onError('Heure début invalide (HH:mm)'); return; }
    if (s.endTime && !HH_MM.test(s.endTime)) { onError('Heure fin invalide (HH:mm)'); return; }
    setSaving(true);
    try {
      await updateShiftSchedule(item.id, {
        shiftTypeId: s.isOff ? null : (s.shiftTypeId || null),
        startTime: s.startTime || null,
        endTime: s.endTime || null,
        isOff: s.isOff,
        notes: s.notes || null,
      });
      onSaved();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-2 space-y-2.5 rounded-xl border border-stone-200 bg-stone-50 p-3">
      <label className="flex items-center gap-2 text-sm text-stone-700">
        <input
          type="checkbox"
          checked={s.isOff}
          onChange={(e) => setS((prev) => ({ ...prev, isOff: e.target.checked, shiftTypeId: '' }))}
          className="h-4 w-4 rounded"
        />
        Repos
      </label>

      {!s.isOff && (
        <label className="block space-y-1">
          <span className="text-xs font-medium text-stone-500">Type de shift*</span>
          <select
            value={s.shiftTypeId}
            onChange={(e) => setS((prev) => ({ ...prev, shiftTypeId: e.target.value }))}
            className="w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm focus:border-stone-400 focus:outline-none"
          >
            <option value="">— Sélectionner —</option>
            {activeShiftTypes.map((st) => (
              <option key={st.id} value={st.id}>
                {st.label ?? st.name} ({st.startTime}–{st.endTime})
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1">
          <span className="text-xs font-medium text-stone-500">Début</span>
          <input
            type="time"
            value={s.startTime}
            onChange={(e) => setS((prev) => ({ ...prev, startTime: e.target.value }))}
            className="w-full rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-sm focus:border-stone-400 focus:outline-none"
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs font-medium text-stone-500">Fin</span>
          <input
            type="time"
            value={s.endTime}
            onChange={(e) => setS((prev) => ({ ...prev, endTime: e.target.value }))}
            className="w-full rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-sm focus:border-stone-400 focus:outline-none"
          />
        </label>
      </div>

      <label className="block space-y-1">
        <span className="text-xs font-medium text-stone-500">Notes</span>
        <input
          type="text"
          value={s.notes}
          onChange={(e) => setS((prev) => ({ ...prev, notes: e.target.value }))}
          className="w-full rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-sm focus:border-stone-400 focus:outline-none"
        />
      </label>

      <div className="flex gap-2">
        <button
          onClick={() => void handleSave()}
          disabled={saving}
          className="flex items-center gap-1.5 rounded-lg bg-stone-900 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-stone-700 disabled:opacity-50"
        >
          <Save className="h-3 w-3" />
          {saving ? '…' : 'Enregistrer'}
        </button>
        <button
          onClick={onCancel}
          className="flex items-center gap-1.5 rounded-lg border border-stone-200 px-3 py-1.5 text-xs font-semibold text-stone-600 transition-colors hover:bg-stone-50"
        >
          <X className="h-3 w-3" />
          Annuler
        </button>
      </div>
    </div>
  );
}

// ── Schedule item row ──────────────────────────────────────────────────────────

interface ScheduleItemRowProps {
  item: StaffScheduleItem;
  shiftTypes: ShiftTypeSetting[];
  isEditing: boolean;
  onToggleEdit: () => void;
  onCancelEdit: () => void;
  onSavedEdit: () => void;
  onDeleteSuccess: () => void;
  onError: (msg: string) => void;
}

function ScheduleItemRow({
  item, shiftTypes, isEditing, onToggleEdit, onCancelEdit, onSavedEdit, onDeleteSuccess, onError,
}: ScheduleItemRowProps) {
  const [deleting, setDeleting] = useState(false);

  async function doDelete() {
    if (!window.confirm(`Retirer ${item.staffMemberName} du planning ce jour ?`)) return;
    setDeleting(true);
    try {
      await deleteShiftSchedule(item.id);
      onDeleteSuccess();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="py-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-stone-100">
            {item.isOff
              ? <Moon className="h-3.5 w-3.5 text-stone-400" />
              : <Users className="h-3.5 w-3.5 text-stone-500" />}
          </div>
          <div className="min-w-0">
            <p className="truncate font-medium text-stone-800">{item.staffMemberName}</p>
            <p className="truncate text-xs text-stone-400">
              {item.isOff ? (
                <span className="font-medium text-amber-600">Repos</span>
              ) : (
                <>
                  {item.shiftTypeLabel ?? '—'}
                  {item.startTime && item.endTime
                    ? ` · ${item.startTime}→${item.endTime}`
                    : null}
                </>
              )}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={onToggleEdit}
            className="rounded-md p-1 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700"
            title="Modifier"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => void doDelete()}
            disabled={deleting}
            className="rounded-md p-1 text-stone-400 transition-colors hover:bg-red-50 hover:text-red-500 disabled:opacity-50"
            title="Retirer"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {isEditing && (
        <EditItemForm
          item={item}
          shiftTypes={shiftTypes}
          onCancel={onCancelEdit}
          onSaved={onSavedEdit}
          onError={onError}
        />
      )}
    </div>
  );
}

// ── Main export ────────────────────────────────────────────────────────────────

export function WeeklyScheduleSection({ shiftTypes, staff, days, onRefresh }: Props) {
  const [adding, setAdding] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const noStaff = staff.length === 0;
  const noShiftTypes = shiftTypes.length === 0;

  function flashSuccess(msg: string) {
    setSuccess(msg);
    setTimeout(() => setSuccess(null), 3000);
  }

  function onMutationSuccess(msg: string) {
    setAdding(false);
    setEditingItemId(null);
    setError(null);
    flashSuccess(msg);
    onRefresh();
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-stone-400">
        Le planning sert à préparer qui travaille chaque jour. Le shift réel reste ouvert/fermé depuis la gestion des shifts.
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

      {noStaff && (
        <div className="rounded-2xl border border-dashed border-amber-200 bg-amber-50 p-4 text-center text-sm text-amber-700">
          Ajoutez d&apos;abord une assistante dans l&apos;onglet Staff.
        </div>
      )}

      {!noStaff && noShiftTypes && (
        <div className="rounded-2xl border border-dashed border-amber-200 bg-amber-50 p-4 text-center text-sm text-amber-700">
          Créez d&apos;abord un type de shift dans la section ci-dessus.
        </div>
      )}

      {!noStaff && !noShiftTypes && adding && (
        <AddForm
          shiftTypes={shiftTypes}
          staff={staff}
          onCancel={() => { setAdding(false); setError(null); }}
          onSaved={() => onMutationSuccess('Planning mis à jour')}
          onError={setError}
        />
      )}

      {/* Day cards */}
      <div className="space-y-3">
        {days.map((day) => (
          <div
            key={day.dayOfWeek}
            className="overflow-hidden rounded-2xl border border-stone-100 bg-white shadow-sm"
          >
            <div className="flex items-center justify-between border-b border-stone-50 bg-stone-50/50 px-4 py-3">
              <span className="text-sm font-semibold text-stone-700">{day.label}</span>
              <span className="text-xs text-stone-400">
                {day.items.length === 0
                  ? 'Aucun'
                  : `${day.items.length} entrée${day.items.length > 1 ? 's' : ''}`}
              </span>
            </div>

            {day.items.length === 0 ? (
              <p className="px-4 py-4 text-center text-xs text-stone-300">Aucune assignation</p>
            ) : (
              <div className="divide-y divide-stone-50 px-4">
                {day.items.map((item) => (
                  <ScheduleItemRow
                    key={item.id}
                    item={item}
                    shiftTypes={shiftTypes}
                    isEditing={editingItemId === item.id}
                    onToggleEdit={() =>
                      setEditingItemId(editingItemId === item.id ? null : item.id)
                    }
                    onCancelEdit={() => setEditingItemId(null)}
                    onSavedEdit={() => onMutationSuccess('Entrée mise à jour')}
                    onDeleteSuccess={() => onMutationSuccess('Entrée retirée du planning')}
                    onError={setError}
                  />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {!noStaff && !noShiftTypes && !adding && (
        <button
          onClick={() => { setAdding(true); setError(null); setSuccess(null); }}
          className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-stone-300 py-3 text-sm font-medium text-stone-500 transition-colors hover:border-stone-400 hover:text-stone-700"
        >
          <Plus className="h-4 w-4" />
          Assigner au planning
        </button>
      )}
    </div>
  );
}
