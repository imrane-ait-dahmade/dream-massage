'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { UserPlus, RefreshCw } from 'lucide-react';
import { ApiError } from '@/lib/api';
import type { StaffMember } from '@/lib/types';
import type { VisibilityFilter } from '@/lib/archive';
import {
  getStaffMembers,
  createStaffMember,
  updateStaffMember,
  archiveStaffMember,
  restoreStaffMember,
  hardDeleteStaffMember,
} from '@/lib/api';
import { VisibilityTabs, ArchivedBadge } from './VisibilityTabs';
import { ArchiveActionMenu } from './ArchiveActionMenu';

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

function Alert({ type, msg }: { type: 'success' | 'error'; msg: string }) {
  return (
    <div
      className={`rounded-xl px-3 py-2 text-xs font-medium ${
        type === 'success'
          ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
          : 'bg-red-50 text-red-700 ring-1 ring-red-200'
      }`}
    >
      {msg}
    </div>
  );
}

interface StaffForm {
  name: string;
  phone: string;
  notes: string;
}

const EMPTY: StaffForm = { name: '', phone: '', notes: '' };

function StaffFormPanel({
  initial,
  submitLabel,
  onSave,
  onCancel,
}: {
  initial?: StaffForm;
  submitLabel?: string;
  onSave: (f: StaffForm) => Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<StaffForm>(initial ?? EMPTY);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const set =
    (k: keyof StaffForm) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  async function handleSubmit() {
    if (!form.name.trim()) {
      setErr('Le nom est requis');
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      await onSave(form);
    } catch (e) {
      setErr((e as Error).message);
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2.5 rounded-xl border border-stone-200 bg-stone-50 p-3">
      <div className="flex flex-col gap-0.5">
        <label className="text-xs text-stone-500">Nom *</label>
        <input
          type="text"
          value={form.name}
          onChange={set('name')}
          className="rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-stone-400"
        />
      </div>
      <div className="flex flex-col gap-0.5">
        <label className="text-xs text-stone-500">Téléphone</label>
        <input type="tel" value={form.phone} onChange={set('phone')} className="rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-sm" />
      </div>
      <div className="flex flex-col gap-0.5">
        <label className="text-xs text-stone-500">Notes</label>
        <textarea value={form.notes} onChange={set('notes')} rows={2} className="resize-none rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-sm" />
      </div>
      {err && <Alert type="error" msg={err} />}
      <div className="flex gap-2">
        <button type="button" onClick={() => void handleSubmit()} disabled={saving} className="rounded-lg bg-stone-900 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">
          {saving ? 'Enregistrement…' : (submitLabel ?? 'Enregistrer')}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-stone-200 px-4 py-2 text-xs font-medium text-stone-600">
          Annuler
        </button>
      </div>
    </div>
  );
}

function StaffRow({
  member,
  onRefresh,
}: {
  member: StaffMember;
  onRefresh: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const isArchived = member.isArchived ?? !!member.archivedAt;

  async function handleSave(form: StaffForm) {
    await updateStaffMember(member.id, {
      name: form.name.trim(),
      phone: form.phone.trim() || null,
      notes: form.notes.trim() || null,
    });
    setFeedback({ type: 'success', msg: 'Assistante mise à jour' });
    setEditing(false);
    await onRefresh();
  }

  if (editing) {
    return (
      <StaffFormPanel
        initial={{ name: member.name, phone: member.phone ?? '', notes: member.notes ?? '' }}
        onSave={handleSave}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <div className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5 ${isArchived ? 'border-amber-100 bg-amber-50/40' : 'border-stone-100 bg-white'}`}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className={`truncate text-sm font-medium ${isArchived ? 'text-stone-500' : 'text-stone-900'}`}>{member.name}</p>
          {isArchived && <ArchivedBadge />}
        </div>
        {member.phone && <p className="text-xs text-stone-400">{member.phone}</p>}
        {member.archiveReason && <p className="text-xs text-stone-400">Motif : {member.archiveReason}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button type="button" onClick={() => setEditing(true)} className="px-2 text-xs text-stone-500 hover:text-stone-800">
          Modifier
        </button>
        <ArchiveActionMenu
          isArchived={isArchived}
          canHardDelete={member.canHardDelete}
          hardDeleteBlockers={member.hardDeleteBlockers}
          showReactivateUser
          onArchive={async (reason) => {
            await archiveStaffMember(member.id, reason || undefined);
            await onRefresh();
          }}
          onRestore={async (reactivateLinkedUser) => {
            await restoreStaffMember(member.id, { reactivateLinkedUser });
            await onRefresh();
          }}
          onHardDelete={async () => {
            await hardDeleteStaffMember(member.id);
            await onRefresh();
          }}
        />
      </div>
      {feedback && <div className="w-full"><Alert type={feedback.type} msg={feedback.msg} /></div>}
    </div>
  );
}

export function StaffSettings({ onSaved }: { onSaved?: () => void }) {
  const [visibility, setVisibility] = useState<VisibilityFilter>('active');
  const [members, setMembers] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Keep parent callback out of fetch effect deps — inline () => load() from page.tsx
  // is recreated every render and caused an infinite refetch loop.
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;

  const fetchMembers = useCallback(async (signal?: AbortSignal) => {
    if (process.env.NODE_ENV === 'development') {
      console.debug('[StaffSettings] load staff', { filter: visibility });
    }
    setLoading(true);
    setError(null);
    try {
      const res = await getStaffMembers(visibility, signal ? { signal } : undefined);
      if (signal?.aborted) return;
      setMembers(res.items);
    } catch (e) {
      if (signal?.aborted || isAbortError(e)) return;
      const msg =
        e instanceof ApiError
          ? e.message
          : (e as Error).message || 'Impossible de charger les assistantes.';
      setError(msg);
      if (process.env.NODE_ENV === 'development') {
        console.error('[StaffSettings] getStaffMembers failed', e);
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [visibility]);

  useEffect(() => {
    const controller = new AbortController();
    void fetchMembers(controller.signal);
    return () => controller.abort();
  }, [fetchMembers]);

  const reloadAfterMutation = useCallback(async () => {
    await fetchMembers();
    onSavedRef.current?.();
  }, [fetchMembers]);

  async function handleCreate(form: StaffForm) {
    await createStaffMember({
      name: form.name.trim(),
      phone: form.phone.trim() || undefined,
      notes: form.notes.trim() || undefined,
    });
    setFeedback('Assistante ajoutée');
    setCreating(false);
    if (visibility !== 'active') {
      setVisibility('active');
      onSavedRef.current?.();
    } else {
      await reloadAfterMutation();
    }
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2.5 text-xs text-stone-500">
        Archivez une assistante pour la masquer des listes et du planning, sans perdre l&apos;historique des sessions et shifts.
      </div>

      <VisibilityTabs value={visibility} onChange={setVisibility} />

      {feedback && <Alert type="success" msg={feedback} />}

      {error && (
        <div className="space-y-2 rounded-xl border border-red-200 bg-red-50 px-3 py-3">
          <p className="text-xs font-medium text-red-700">{error}</p>
          {process.env.NODE_ENV === 'development' && (
            <p className="text-[11px] text-red-500">
              Endpoint : GET /api/settings/staff — voir la console pour l’URL complète.
            </p>
          )}
          <button
            type="button"
            onClick={() => void fetchMembers()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Réessayer
          </button>
        </div>
      )}

      <div className="space-y-2">
        {loading && !error ? (
          <div className="h-16 animate-pulse rounded-xl bg-stone-100" />
        ) : !error && members.length === 0 ? (
          <p className="py-6 text-center text-sm text-stone-400">Aucune assistante dans cette vue.</p>
        ) : (
          members.map((m) => (
            <StaffRow key={m.id} member={m} onRefresh={reloadAfterMutation} />
          ))
        )}
      </div>

      {visibility === 'active' && (
        creating ? (
          <StaffFormPanel submitLabel="Ajouter" onSave={handleCreate} onCancel={() => setCreating(false)} />
        ) : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-stone-300 py-3 text-sm font-medium text-stone-500 hover:border-stone-400"
          >
            <UserPlus className="h-4 w-4" />
            Ajouter une assistante
          </button>
        )
      )}
    </div>
  );
}
