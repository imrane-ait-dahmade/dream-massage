'use client';

import { useState } from 'react';
import { UserPlus, Pencil, KeyRound, Ban, UserCheck, X, AlertTriangle, CheckCircle } from 'lucide-react';
import type { SettingsUser, SettingsUserRole, StaffMember } from '@/lib/types';
import { disableSettingsUser, updateSettingsUser, resetSettingsUserPassword } from '@/lib/api';
import { UserFormDialog } from './UserFormDialog';

const ROLE_LABELS: Record<SettingsUserRole, string> = {
  OWNER: 'Propriétaire',
  ADMIN: 'Administrateur',
  ASSISTANT: 'Assistant(e)',
};

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

// ── Reset password dialog (compact — no need for its own file) ─────────────────

function ResetPasswordDialog({
  user,
  onClose,
  onSuccess,
}: {
  user: SettingsUser;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit() {
    if (password.length < 8) {
      setError('8 caractères minimum.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await resetSettingsUserPassword(user.id, password);
      setDone(true);
      setTimeout(() => { onSuccess(); onClose(); }, 600);
    } catch (e) {
      setError((e as Error).message || 'Erreur lors de la réinitialisation.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-stone-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-x-4 top-1/2 z-50 -translate-y-1/2 rounded-2xl border border-stone-200 bg-white shadow-2xl sm:inset-x-auto sm:left-1/2 sm:w-full sm:max-w-sm sm:-translate-x-1/2">
        <div className="flex items-center justify-between border-b border-stone-200 px-5 py-4">
          <h2 className="text-base font-bold text-stone-900">Réinitialiser le mot de passe</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-3 p-5">
          <p className="text-sm text-stone-500">
            Nouveau mot de passe temporaire pour{' '}
            <span className="font-semibold text-stone-700">{user.email}</span>.
          </p>
          <input
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="8 caractères minimum"
            className="w-full rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm outline-none focus:border-stone-400 focus:bg-white"
          />
          {error && (
            <div className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700 ring-1 ring-red-200">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {error}
            </div>
          )}
          {done && (
            <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">
              <CheckCircle className="h-3.5 w-3.5" />
              Mot de passe mis à jour.
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-stone-200 px-5 py-4">
          <button
            onClick={onClose}
            disabled={saving}
            className="rounded-lg border border-stone-200 px-4 py-2 text-sm font-medium text-stone-600 hover:bg-stone-50 disabled:opacity-40"
          >
            Annuler
          </button>
          <button
            onClick={() => void handleSubmit()}
            disabled={saving || done}
            className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {saving ? 'Enregistrement…' : 'Réinitialiser'}
          </button>
        </div>
      </div>
    </>
  );
}

// ── Row ──────────────────────────────────────────────────────────────────────

function UserRow({
  user,
  onEdit,
  onResetPassword,
  onToggled,
  onError,
}: {
  user: SettingsUser;
  onEdit: () => void;
  onResetPassword: () => void;
  onToggled: (nowActive: boolean) => void;
  onError: (msg: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function handleToggleActive() {
    setBusy(true);
    try {
      if (user.isActive) {
        await disableSettingsUser(user.id);
      } else {
        await updateSettingsUser(user.id, { isActive: true });
      }
      onToggled(!user.isActive);
    } catch (e) {
      onError((e as Error).message || "Erreur lors du changement de statut.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={`flex items-start justify-between gap-2 rounded-xl border px-3 py-2.5 ${
        user.isActive ? 'border-stone-100 bg-white' : 'border-stone-100 bg-stone-50'
      }`}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className={`truncate text-sm font-medium ${user.isActive ? 'text-stone-900' : 'text-stone-400'}`}>
            {user.name}
          </p>
          <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-semibold text-stone-500">
            {ROLE_LABELS[user.role]}
          </span>
          {!user.isActive && (
            <span className="rounded-full bg-stone-200 px-2 py-0.5 text-[10px] font-semibold text-stone-500">
              Inactif
            </span>
          )}
        </div>
        <p className="truncate text-xs text-stone-400">{user.email}</p>
        {user.role === 'ASSISTANT' && (
          <p className="truncate text-xs text-stone-400">
            {user.staffMember ? `Lié à ${user.staffMember.name}` : 'Aucune assistante liée'}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2.5">
        <button
          onClick={onResetPassword}
          title="Réinitialiser le mot de passe"
          className="text-stone-400 transition-colors hover:text-stone-700"
        >
          <KeyRound className="h-4 w-4" />
        </button>
        <button
          onClick={onEdit}
          title="Modifier"
          className="text-stone-400 transition-colors hover:text-stone-700"
        >
          <Pencil className="h-4 w-4" />
        </button>
        <button
          onClick={() => void handleToggleActive()}
          disabled={busy}
          title={user.isActive ? 'Désactiver' : 'Réactiver'}
          className="text-stone-400 transition-colors hover:text-stone-700 disabled:opacity-40"
        >
          {user.isActive ? <Ban className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function UsersAccessSection({
  users,
  staffMembers,
  onSaved,
}: {
  users: SettingsUser[];
  staffMembers: StaffMember[];
  onSaved: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const [editingUser, setEditingUser] = useState<SettingsUser | null>(null);
  const [resettingUser, setResettingUser] = useState<SettingsUser | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  function handleSaved(msg: string) {
    setFeedback({ type: 'success', msg });
    onSaved();
    setTimeout(() => setFeedback(null), 3000);
  }

  const active = users.filter((u) => u.isActive);
  const inactive = users.filter((u) => !u.isActive);

  return (
    <div className="space-y-3">
      {/* Info banner */}
      <div className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2.5 text-xs text-stone-500">
        Un compte ASSISTANT doit être lié à une assistante active. Un compte OWNER/ADMIN n&apos;a
        jamais de staff lié. Aucun compte n&apos;est jamais supprimé — seulement désactivé.
      </div>

      {/* List */}
      <div className="space-y-2">
        {users.length === 0 && (
          <p className="py-6 text-center text-sm text-stone-400">Aucun utilisateur.</p>
        )}
        {active.map((u) => (
          <UserRow
            key={u.id}
            user={u}
            onEdit={() => setEditingUser(u)}
            onResetPassword={() => setResettingUser(u)}
            onToggled={(nowActive) => handleSaved(nowActive ? 'Utilisateur réactivé' : 'Utilisateur désactivé')}
            onError={(m) => setFeedback({ type: 'error', msg: m })}
          />
        ))}
        {inactive.length > 0 && (
          <>
            <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-stone-400">
              Inactifs
            </p>
            {inactive.map((u) => (
              <UserRow
                key={u.id}
                user={u}
                onEdit={() => setEditingUser(u)}
                onResetPassword={() => setResettingUser(u)}
                onToggled={(nowActive) => handleSaved(nowActive ? 'Utilisateur réactivé' : 'Utilisateur désactivé')}
                onError={(m) => setFeedback({ type: 'error', msg: m })}
              />
            ))}
          </>
        )}
      </div>

      {feedback && <Alert type={feedback.type} msg={feedback.msg} />}

      {/* Create button */}
      <button
        onClick={() => setCreating(true)}
        className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-stone-300 py-3 text-sm font-medium text-stone-500 transition-colors hover:border-stone-400 hover:text-stone-700"
      >
        <UserPlus className="h-4 w-4" />
        Créer un utilisateur
      </button>

      {/* Dialogs */}
      {creating && (
        <UserFormDialog
          mode="create"
          staffMembers={staffMembers}
          onClose={() => setCreating(false)}
          onSuccess={() => handleSaved('Utilisateur créé')}
        />
      )}
      {editingUser && (
        <UserFormDialog
          mode="edit"
          user={editingUser}
          staffMembers={staffMembers}
          onClose={() => setEditingUser(null)}
          onSuccess={() => handleSaved('Utilisateur mis à jour')}
        />
      )}
      {resettingUser && (
        <ResetPasswordDialog
          user={resettingUser}
          onClose={() => setResettingUser(null)}
          onSuccess={() => handleSaved('Mot de passe réinitialisé')}
        />
      )}
    </div>
  );
}
