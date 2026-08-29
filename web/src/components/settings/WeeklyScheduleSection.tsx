'use client';

import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Save, X, CheckCircle, XCircle, Users, Moon } from 'lucide-react';
import type { CashAccountRow, ShiftTypeSetting, StaffMember, WeeklyScheduleDay, StaffScheduleItem } from '@/lib/types';
import {
  createShiftSchedule,
  updateShiftSchedule,
  deleteShiftSchedule,
  archiveShiftSchedule,
  restoreShiftSchedule,
  getCashAccounts,
} from '@/lib/api';
import { ArchiveActionMenu } from './ArchiveActionMenu';
import { ArchivedBadge } from './VisibilityTabs';
import { filterAllowedShiftTypes } from '@/lib/shift-period';

interface Props {
  shiftTypes: ShiftTypeSetting[];
  staff: StaffMember[];
  days: WeeklyScheduleDay[];
  onRefresh: () => void;
}

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
  cashAccountId: string;
  isOff: boolean;
  notes: string;
}

const BLANK_ADD: AddFormState = {
  staffMemberId: '', dayOfWeek: '1', shiftTypeId: '', cashAccountId: '',
  isOff: false, notes: '',
};

function ShiftTypeHoursPreview({
  shiftTypes,
  shiftTypeId,
}: {
  shiftTypes: ShiftTypeSetting[];
  shiftTypeId: string;
}) {
  const st = shiftTypes.find((t) => t.id === shiftTypeId);
  if (!st) return null;
  return (
    <div className="rounded-lg border border-stone-100 bg-stone-50 px-3 py-2 text-xs text-stone-600">
      <span className="font-medium text-stone-800">{st.label ?? st.name}</span>
      <span className="text-stone-400"> · Horaires : </span>
      <span className="font-mono text-stone-700">{st.startTime} → {st.endTime}</span>
    </div>
  );
}

interface AddFormProps {
  shiftTypes: ShiftTypeSetting[];
  staff: StaffMember[];
  initialDayOfWeek: number;
  dayLabel: string;
  lockDay?: boolean;
  onCancel: () => void;
  onSaved: () => void;
  onError: (msg: string) => void;
}

function AddForm({
  shiftTypes,
  staff,
  initialDayOfWeek,
  dayLabel,
  lockDay = true,
  onCancel,
  onSaved,
  onError,
}: AddFormProps) {
  const [s, setS] = useState<AddFormState>({
    ...BLANK_ADD,
    dayOfWeek: String(initialDayOfWeek),
  });
  const [saving, setSaving] = useState(false);
  const [tills, setTills] = useState<CashAccountRow[]>([]);

  const activeShiftTypes = filterAllowedShiftTypes(shiftTypes);

  useEffect(() => {
    void getCashAccounts()
      .then((res) => setTills(res.accounts.filter((a) => a.isActive)))
      .catch(() => setTills([]));
  }, []);

  async function handleSave() {
    if (!s.staffMemberId) { onError('Veuillez sélectionner une assistante'); return; }
    if (!s.isOff && !s.shiftTypeId) { onError('Veuillez sélectionner un type de shift'); return; }
    if (!s.isOff && !s.cashAccountId) { onError('Veuillez sélectionner une caisse physique'); return; }
    setSaving(true);
    try {
      await createShiftSchedule({
        staffMemberId: s.staffMemberId,
        shiftTypeId: s.isOff ? null : (s.shiftTypeId || null),
        dayOfWeek: Number(s.dayOfWeek),
        isOff: s.isOff,
        notes: s.notes || null,
        cashAccountId: s.isOff ? null : (s.cashAccountId || null),
      });
      onSaved();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-semibold text-stone-800">
          {lockDay ? `Planifier — ${dayLabel}` : 'Assigner une assistante'}
        </p>
        {lockDay && (
          <p className="mt-0.5 text-xs text-stone-400">
            Jour présélectionné · choisissez l&apos;assistante et Matin ou Soir
          </p>
        )}
      </div>

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

      {lockDay ? (
        <div className="flex items-center justify-between rounded-lg border border-stone-100 bg-stone-50 px-3 py-2">
          <span className="text-xs font-medium text-stone-500">Jour</span>
          <span className="text-sm font-semibold text-stone-800">{dayLabel}</span>
        </div>
      ) : (
        <label className="block space-y-1">
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
      )}

      <label className="flex items-center gap-2 text-sm text-stone-700">
        <input
          type="checkbox"
          checked={s.isOff}
          onChange={(e) => setS((prev) => ({ ...prev, isOff: e.target.checked, shiftTypeId: '', cashAccountId: '' }))}
          className="h-4 w-4 rounded"
        />
        Repos
      </label>

      {!s.isOff && (
        <>
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
          {s.shiftTypeId && (
            <ShiftTypeHoursPreview shiftTypes={shiftTypes} shiftTypeId={s.shiftTypeId} />
          )}
          <label className="block space-y-1">
            <span className="text-xs font-medium text-stone-500">Caisse physique*</span>
            <select
              value={s.cashAccountId}
              onChange={(e) => setS((prev) => ({ ...prev, cashAccountId: e.target.value }))}
              className="w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm focus:border-stone-400 focus:outline-none"
            >
              <option value="">— Sélectionner —</option>
              {tills.map((a) => (
                <option key={a.cashAccountId} value={a.cashAccountId}>
                  {a.name} ({a.code})
                </option>
              ))}
            </select>
          </label>
        </>
      )}

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
        Les horaires sont définis dans Types de shifts (Matin / Soir).
      </p>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-stone-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-stone-700 disabled:opacity-50"
        >
          <Save className="h-3.5 w-3.5" />
          {saving ? 'Enregistrement…' : 'Enregistrer'}
        </button>
        <button
          type="button"
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
  cashAccountId: string;
  isOff: boolean;
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
    cashAccountId: item.cashAccountId ?? '',
    isOff: item.isOff,
    notes: item.notes ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [tills, setTills] = useState<CashAccountRow[]>([]);

  const activeShiftTypes = filterAllowedShiftTypes(shiftTypes);

  useEffect(() => {
    void getCashAccounts()
      .then((res) => setTills(res.accounts.filter((a) => a.isActive)))
      .catch(() => setTills([]));
  }, []);

  async function handleSave() {
    if (!s.isOff && !s.shiftTypeId) { onError('Veuillez sélectionner un type de shift'); return; }
    if (!s.isOff && !s.cashAccountId) { onError('Veuillez sélectionner une caisse physique'); return; }
    setSaving(true);
    try {
      await updateShiftSchedule(item.id, {
        shiftTypeId: s.isOff ? null : (s.shiftTypeId || null),
        isOff: s.isOff,
        notes: s.notes || null,
        cashAccountId: s.isOff ? null : (s.cashAccountId || null),
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
          onChange={(e) => setS((prev) => ({ ...prev, isOff: e.target.checked, shiftTypeId: '', cashAccountId: '' }))}
          className="h-4 w-4 rounded"
        />
        Repos
      </label>

      {!s.isOff && (
        <>
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
          {s.shiftTypeId && (
            <ShiftTypeHoursPreview shiftTypes={shiftTypes} shiftTypeId={s.shiftTypeId} />
          )}
          <label className="block space-y-1">
            <span className="text-xs font-medium text-stone-500">Caisse physique*</span>
            <select
              value={s.cashAccountId}
              onChange={(e) => setS((prev) => ({ ...prev, cashAccountId: e.target.value }))}
              className="w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm focus:border-stone-400 focus:outline-none"
            >
              <option value="">— Sélectionner —</option>
              {tills.map((a) => (
                <option key={a.cashAccountId} value={a.cashAccountId}>
                  {a.name} ({a.code})
                </option>
              ))}
            </select>
          </label>
        </>
      )}

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
  const isArchived = item.isArchived ?? !!item.archivedAt;

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
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate font-medium text-stone-800">{item.staffMemberName}</p>
              {isArchived && <ArchivedBadge />}
            </div>
            <p className="truncate text-xs text-stone-400">
              {item.isOff ? (
                <span className="font-medium text-amber-600">Repos</span>
              ) : (
                <>
                  <span>{item.shiftTypeLabel ?? '—'}</span>
                  {item.startTime && item.endTime && (
                    <span className="text-stone-400"> · {item.startTime} → {item.endTime}</span>
                  )}
                  {item.cashAccountName && (
                    <span className="text-stone-400"> · {item.cashAccountName}</span>
                  )}
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
          <ArchiveActionMenu
            isArchived={isArchived}
            canHardDelete={item.canHardDelete}
            hardDeleteBlockers={item.hardDeleteBlockers}
            onArchive={async (reason) => {
              await archiveShiftSchedule(item.id, reason || undefined);
              onDeleteSuccess();
            }}
            onRestore={async () => {
              await restoreShiftSchedule(item.id);
              onDeleteSuccess();
            }}
            onHardDelete={async () => {
              await deleteShiftSchedule(item.id, true);
              onDeleteSuccess();
            }}
          />
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

// ── Plan modal ─────────────────────────────────────────────────────────────────

interface PlanModalProps {
  dayOfWeek: number;
  dayLabel: string;
  shiftTypes: ShiftTypeSetting[];
  staff: StaffMember[];
  onCancel: () => void;
  onSaved: () => void;
  onError: (msg: string) => void;
}

function PlanModal({ dayOfWeek, dayLabel, shiftTypes, staff, onCancel, onSaved, onError }: PlanModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl border border-stone-200 bg-white p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <AddForm
          key={dayOfWeek}
          shiftTypes={shiftTypes}
          staff={staff}
          initialDayOfWeek={dayOfWeek}
          dayLabel={dayLabel}
          lockDay
          onCancel={onCancel}
          onSaved={onSaved}
          onError={onError}
        />
      </div>
    </div>
  );
}

// ── Day card plan button ───────────────────────────────────────────────────────

function DayPlanButton({
  dayLabel,
  hasItems,
  disabled,
  onClick,
}: {
  dayLabel: string;
  hasItems: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const shortLabel = dayLabel.toLowerCase();

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={hasItems ? `Ajouter une assignation — ${dayLabel}` : `Planifier ${dayLabel}`}
      className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-stone-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-stone-600 transition-colors hover:border-stone-300 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-40"
    >
      <Plus className="h-3 w-3" />
      {hasItems ? '+ Ajouter' : `+ Planifier ${shortLabel}`}
    </button>
  );
}

// ── Main export ────────────────────────────────────────────────────────────────

export function WeeklyScheduleSection({ shiftTypes, staff, days, onRefresh }: Props) {
  const [planModalDay, setPlanModalDay] = useState<{ dayOfWeek: number; label: string } | null>(null);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const noStaff = staff.length === 0;
  const noShiftTypes = shiftTypes.length === 0;
  const canPlan = !noStaff && !noShiftTypes;

  function openPlanModal(dayOfWeek: number, label: string) {
    setError(null);
    setSuccess(null);
    setPlanModalDay({ dayOfWeek, label });
  }

  function flashSuccess(msg: string) {
    setSuccess(msg);
    setTimeout(() => setSuccess(null), 3000);
  }

  function onMutationSuccess(msg: string) {
    setPlanModalDay(null);
    setEditingItemId(null);
    setError(null);
    flashSuccess(msg);
    onRefresh();
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-stone-500">
        Assignez une assistante à Matin ou Soir par jour. Les horaires viennent des types de shift.
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
          <button type="button" onClick={() => setError(null)} className="ml-auto shrink-0 hover:opacity-70">
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

      {planModalDay && canPlan && (
        <PlanModal
          dayOfWeek={planModalDay.dayOfWeek}
          dayLabel={planModalDay.label}
          shiftTypes={shiftTypes}
          staff={staff}
          onCancel={() => { setPlanModalDay(null); setError(null); }}
          onSaved={() => onMutationSuccess('Planning mis à jour')}
          onError={setError}
        />
      )}

      {/* Day cards */}
      <div className="space-y-2.5">
        {days.map((day) => (
          <div
            key={day.dayOfWeek}
            className="overflow-hidden rounded-2xl border border-stone-100 bg-white shadow-sm"
          >
            <div className="flex items-center justify-between gap-2 border-b border-stone-50 bg-stone-50/50 px-3 py-2.5 sm:px-4">
              <span className="text-sm font-semibold text-stone-700">{day.label}</span>
              <div className="flex items-center gap-2">
                {day.items.length > 0 && (
                  <>
                    <span className="text-xs text-stone-400">
                      {day.items.length} entrée{day.items.length > 1 ? 's' : ''}
                    </span>
                    <DayPlanButton
                      dayLabel={day.label}
                      hasItems
                      disabled={!canPlan}
                      onClick={() => openPlanModal(day.dayOfWeek, day.label)}
                    />
                  </>
                )}
              </div>
            </div>

            {day.items.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-3 py-3 sm:px-4">
                <p className="text-xs text-stone-400">Aucune assignation</p>
                {canPlan && (
                  <button
                    type="button"
                    onClick={() => openPlanModal(day.dayOfWeek, day.label)}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-dashed border-stone-300 px-4 py-2 text-xs font-semibold text-stone-600 transition-colors hover:border-stone-400 hover:bg-stone-50"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Planifier ce jour
                  </button>
                )}
              </div>
            ) : (
              <div className="divide-y divide-stone-50 px-3 sm:px-4">
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
    </div>
  );
}
