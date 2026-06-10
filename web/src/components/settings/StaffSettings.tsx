'use client';

import { useState } from 'react';
import { Plus, UserX, UserCheck } from 'lucide-react';
import type { StaffMember } from '@/lib/types';
import { createStaffMember, updateStaffMember } from '@/lib/api';

function Alert({ type, msg }: { type: 'success' | 'error'; msg: string }) {
  return (
    <div className={`rounded-xl px-3 py-2 text-xs font-medium ${type === 'success' ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' : 'bg-red-50 text-red-700 ring-1 ring-red-200'}`}>
      {msg}
    </div>
  );
}

// ── Staff form ─────────────────────────────────────────────────────────────────

interface StaffForm { name: string; phone: string; notes: string }
const empty: StaffForm = { name: '', phone: '', notes: '' };

function StaffFormPanel({
  initial,
  onSave,
  onCancel,
}: {
  initial?: StaffForm;
  onSave: (f: StaffForm) => Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<StaffForm>(initial ?? empty);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof StaffForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function handleSubmit() {
    if (!form.name.trim()) { setErr('Le nom est requis'); return; }
    setSaving(true); setErr(null);
    try { await onSave(form); }
    catch (e) { setErr((e as Error).message); setSaving(false); }
  }

  return (
    <div className="space-y-2.5 rounded-xl border border-stone-200 bg-stone-50 p-3">
      <div className="flex flex-col gap-0.5">
        <label className="text-xs text-stone-500">Nom *</label>
        <input type="text" value={form.name} onChange={set('name')} className="rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-stone-400" />
      </div>
      <div className="flex flex-col gap-0.5">
        <label className="text-xs text-stone-500">Téléphone</label>
        <input type="tel" value={form.phone} onChange={set('phone')} className="rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-stone-400" />
      </div>
      <div className="flex flex-col gap-0.5">
        <label className="text-xs text-stone-500">Notes</label>
        <textarea value={form.notes} onChange={set('notes')} rows={2} className="rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-stone-400 resize-none" />
      </div>
      {err && <Alert type="error" msg={err} />}
      <div className="flex gap-2">
        <button onClick={() => void handleSubmit()} disabled={saving} className="rounded-lg bg-stone-900 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">
          {saving ? 'Enregistrement…' : 'Enregistrer'}
        </button>
        <button onClick={onCancel} className="rounded-lg border border-stone-200 px-4 py-2 text-xs font-medium text-stone-600">Annuler</button>
      </div>
    </div>
  );
}

// ── Staff row ──────────────────────────────────────────────────────────────────

function StaffRow({ member, onSaved }: { member: StaffMember; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [toggling, setToggling] = useState(false);

  async function handleSave(form: StaffForm) {
    await updateStaffMember(member.id, {
      name: form.name.trim(),
      phone: form.phone.trim() || null,
      notes: form.notes.trim() || null,
    });
    setFeedback({ type: 'success', msg: 'Membre mis à jour' });
    setEditing(false);
    onSaved();
  }

  async function handleToggleActive() {
    setToggling(true);
    try {
      await updateStaffMember(member.id, { isActive: !member.isActive });
      onSaved();
    } catch (e) {
      setFeedback({ type: 'error', msg: (e as Error).message });
      setToggling(false);
    }
  }

  if (editing) {
    return (
      <div className="py-1">
        <StaffFormPanel
          initial={{ name: member.name, phone: member.phone ?? '', notes: member.notes ?? '' }}
          onSave={handleSave}
          onCancel={() => setEditing(false)}
        />
        {feedback && <div className="mt-1"><Alert type={feedback.type} msg={feedback.msg} /></div>}
      </div>
    );
  }

  return (
    <div className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5 ${member.isActive ? 'border-stone-100 bg-white' : 'border-stone-100 bg-stone-50'}`}>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className={`truncate text-sm font-medium ${member.isActive ? 'text-stone-900' : 'text-stone-400'}`}>{member.name}</p>
          {!member.isActive && <span className="text-xs text-stone-400">Inactif</span>}
        </div>
        {member.phone && <p className="text-xs text-stone-400">{member.phone}</p>}
        {member.notes && <p className="text-xs text-stone-400 truncate">{member.notes}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          onClick={() => void handleToggleActive()}
          disabled={toggling}
          className="text-stone-400 transition-colors hover:text-stone-700 disabled:opacity-40"
          title={member.isActive ? 'Désactiver' : 'Activer'}
        >
          {member.isActive ? <UserX className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}
        </button>
        <button onClick={() => setEditing(true)} className="text-xs text-stone-400 underline-offset-2 hover:text-stone-700">Modifier</button>
      </div>
      {feedback && <Alert type={feedback.type} msg={feedback.msg} />}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function StaffSettings({ members, onSaved }: { members: StaffMember[]; onSaved: () => void }) {
  const [creating, setCreating] = useState(false);
  const [createFeedback, setCreateFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  async function handleCreate(form: StaffForm) {
    await createStaffMember({
      name: form.name.trim(),
      phone: form.phone.trim() || undefined,
      notes: form.notes.trim() || undefined,
    });
    setCreateFeedback({ type: 'success', msg: 'Membre créé' });
    setCreating(false);
    onSaved();
  }

  const active = members.filter((m) => m.isActive);
  const inactive = members.filter((m) => !m.isActive);

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2.5 text-xs text-stone-500">
        Le staff n&apos;a pas de compte et ne se connecte pas à l&apos;application. Ces enregistrements servent uniquement pour les quarts de travail.
      </div>

      <div className="space-y-2">
        {active.length === 0 && inactive.length === 0 && (
          <p className="py-4 text-center text-sm text-stone-400">Aucun membre du staff.</p>
        )}
        {active.map((m) => <StaffRow key={m.id} member={m} onSaved={onSaved} />)}
        {inactive.length > 0 && (
          <>
            <p className="mt-2 text-xs font-medium uppercase tracking-wide text-stone-400">Inactifs</p>
            {inactive.map((m) => <StaffRow key={m.id} member={m} onSaved={onSaved} />)}
          </>
        )}
      </div>

      {createFeedback && <Alert type={createFeedback.type} msg={createFeedback.msg} />}

      {creating ? (
        <StaffFormPanel onSave={handleCreate} onCancel={() => setCreating(false)} />
      ) : (
        <button onClick={() => setCreating(true)} className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-stone-300 py-3 text-sm font-medium text-stone-500 transition-colors hover:border-stone-400 hover:text-stone-700">
          <Plus className="h-4 w-4" />
          Nouveau membre
        </button>
      )}
    </div>
  );
}
