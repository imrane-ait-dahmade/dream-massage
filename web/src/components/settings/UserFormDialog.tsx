'use client';

import { useState } from 'react';
import { X, AlertTriangle, CheckCircle } from 'lucide-react';
import type { SettingsUser, SettingsUserRole, StaffMember } from '@/lib/types';
import { createSettingsUser, updateSettingsUser } from '@/lib/api';

const ROLE_OPTIONS: { value: SettingsUserRole; label: string }[] = [
  { value: 'OWNER', label: 'Propriétaire' },
  { value: 'ADMIN', label: 'Administrateur' },
  { value: 'ASSISTANT', label: 'Assistant(e)' },
];

interface Props {
  mode: 'create' | 'edit';
  /** Required when mode === 'edit'. */
  user?: SettingsUser;
  staffMembers: StaffMember[];
  onClose: () => void;
  onSuccess: () => void;
}

export function UserFormDialog({ mode, user, staffMembers, onClose, onSuccess }: Props) {
  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<SettingsUserRole>(user?.role ?? 'ASSISTANT');
  const [staffMemberId, setStaffMemberId] = useState<string>(user?.staffMemberId ?? '');
  const [isActive, setIsActive] = useState(user?.isActive ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const isAssistant = role === 'ASSISTANT';
  const activeStaff = staffMembers.filter((s) => s.isActive);
  // If the user being edited is linked to a staff member that has since been
  // deactivated, keep it selectable so saving doesn't silently clear the link.
  const currentStaffStillNeeded =
    user?.staffMember && !user.staffMember.isActive && user.staffMember.id === staffMemberId
      ? user.staffMember
      : null;

  async function handleSubmit() {
    setError(null);

    if (!name.trim()) {
      setError('Le nom est requis.');
      return;
    }
    if (!email.trim()) {
      setError("L'email est requis.");
      return;
    }
    if (mode === 'create' && password.length < 8) {
      setError('Le mot de passe temporaire doit contenir au moins 8 caractères.');
      return;
    }
    if (isAssistant && !staffMemberId) {
      setError('Sélectionnez une assistante liée à ce compte.');
      return;
    }

    setSaving(true);
    try {
      if (mode === 'create') {
        await createSettingsUser({
          name: name.trim(),
          email: email.trim(),
          password,
          role,
          staffMemberId: isAssistant ? staffMemberId : null,
          isActive,
        });
      } else {
        await updateSettingsUser(user!.id, {
          name: name.trim(),
          email: email.trim(),
          role,
          staffMemberId: isAssistant ? staffMemberId : null,
          isActive,
        });
      }
      setDone(true);
      setTimeout(() => { onSuccess(); onClose(); }, 600);
    } catch (e) {
      setError((e as Error).message || 'Erreur lors de la sauvegarde.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-stone-900/40 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="fixed inset-x-4 top-1/2 z-50 max-h-[85vh] -translate-y-1/2 overflow-y-auto rounded-2xl border border-stone-200 bg-white shadow-2xl sm:inset-x-auto sm:left-1/2 sm:w-full sm:max-w-md sm:-translate-x-1/2">
        <div className="sticky top-0 flex items-center justify-between border-b border-stone-200 bg-white px-5 py-4">
          <h2 className="text-base font-bold text-stone-900">
            {mode === 'create' ? 'Créer un utilisateur' : "Modifier l'utilisateur"}
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3.5 p-5">
          <div>
            <label className="mb-1 block text-xs font-semibold text-stone-600">Nom *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="ex: Sarah"
              className="w-full rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm outline-none focus:border-stone-400 focus:bg-white"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-stone-600">Email *</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="nom@example.com"
              className="w-full rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm outline-none focus:border-stone-400 focus:bg-white"
            />
          </div>

          {mode === 'create' && (
            <div>
              <label className="mb-1 block text-xs font-semibold text-stone-600">
                Mot de passe temporaire *
              </label>
              <input
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="8 caractères minimum"
                className="w-full rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm outline-none focus:border-stone-400 focus:bg-white"
              />
              <p className="mt-1 text-[11px] text-stone-400">
                Transmettez-le à la personne concernée — il n&apos;est pas ré-affiché ensuite.
              </p>
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-semibold text-stone-600">Rôle *</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as SettingsUserRole)}
              className="w-full rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm outline-none focus:border-stone-400 focus:bg-white"
            >
              {ROLE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {isAssistant && (
            <div>
              <label className="mb-1 block text-xs font-semibold text-stone-600">
                Assistante liée *
              </label>
              <select
                value={staffMemberId}
                onChange={(e) => setStaffMemberId(e.target.value)}
                className="w-full rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm outline-none focus:border-stone-400 focus:bg-white"
              >
                <option value="">— Sélectionner —</option>
                {currentStaffStillNeeded && (
                  <option value={currentStaffStillNeeded.id}>
                    {currentStaffStillNeeded.name} (inactive)
                  </option>
                )}
                {activeStaff.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              {activeStaff.length === 0 && !currentStaffStillNeeded && (
                <p className="mt-1 text-[11px] text-amber-600">
                  Aucune assistante active — ajoutez-en une dans l&apos;onglet Staff.
                </p>
              )}
            </div>
          )}

          <label className="flex items-center gap-2 text-sm text-stone-700">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="h-4 w-4 rounded border-stone-300"
            />
            Compte actif
          </label>

          {error && (
            <div className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700 ring-1 ring-red-200">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {error}
            </div>
          )}
          {done && (
            <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">
              <CheckCircle className="h-3.5 w-3.5" />
              Enregistré.
            </div>
          )}
        </div>

        <div className="sticky bottom-0 flex justify-end gap-2 border-t border-stone-200 bg-white px-5 py-4">
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
            {saving ? 'Enregistrement…' : mode === 'create' ? "Créer l'utilisateur" : 'Enregistrer'}
          </button>
        </div>
      </div>
    </>
  );
}
