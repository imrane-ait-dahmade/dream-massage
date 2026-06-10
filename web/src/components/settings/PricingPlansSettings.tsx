'use client';

import { useState } from 'react';
import { Plus, AlertTriangle } from 'lucide-react';
import type { PricingPlan } from '@/lib/types';
import { createPricingPlan, updatePricingPlan } from '@/lib/api';

function Alert({ type, msg }: { type: 'success' | 'error'; msg: string }) {
  return (
    <div className={`rounded-xl px-3 py-2 text-xs font-medium ${type === 'success' ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' : 'bg-red-50 text-red-700 ring-1 ring-red-200'}`}>
      {msg}
    </div>
  );
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (s === 0) return `${m} min`;
  return `${m}m ${s}s`;
}

// ── Edit/Create form ───────────────────────────────────────────────────────────

interface PlanForm { name: string; durationSeconds: string; priceAmount: string; currency: string; isActive: boolean; sortOrder: string }
const emptyForm: PlanForm = { name: '', durationSeconds: '600', priceAmount: '10', currency: 'MAD', isActive: true, sortOrder: '0' };

function PlanForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: PlanForm;
  onSave: (f: PlanForm) => Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<PlanForm>(initial ?? emptyForm);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof PlanForm) => (v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  async function handleSubmit() {
    if (!form.name.trim()) { setErr('Le nom est requis'); return; }
    const dur = parseInt(form.durationSeconds, 10);
    const price = parseFloat(form.priceAmount);
    if (!Number.isInteger(dur) || dur <= 0) { setErr('Durée invalide'); return; }
    if (isNaN(price) || price < 0) { setErr('Prix invalide'); return; }
    setSaving(true); setErr(null);
    try {
      await onSave({ ...form });
    } catch (e) {
      setErr((e as Error).message);
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2.5 rounded-xl border border-stone-200 bg-stone-50 p-3">
      <div className="grid grid-cols-2 gap-2">
        <div className="col-span-2 flex flex-col gap-0.5">
          <label className="text-xs text-stone-500">Nom du plan</label>
          <input type="text" value={form.name} onChange={(e) => set('name')(e.target.value)} className="rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-stone-400" />
        </div>
        <div className="flex flex-col gap-0.5">
          <label className="text-xs text-stone-500">Durée (secondes)</label>
          <input type="number" min={1} value={form.durationSeconds} onChange={(e) => set('durationSeconds')(e.target.value)} className="rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-stone-400" />
        </div>
        <div className="flex flex-col gap-0.5">
          <label className="text-xs text-stone-500">Prix</label>
          <div className="flex gap-1">
            <input type="number" min={0} step={0.5} value={form.priceAmount} onChange={(e) => set('priceAmount')(e.target.value)} className="w-full rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-stone-400" />
            <input type="text" value={form.currency} onChange={(e) => set('currency')(e.target.value)} maxLength={5} className="w-16 rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-stone-400" />
          </div>
        </div>
        <div className="flex flex-col gap-0.5">
          <label className="text-xs text-stone-500">Ordre</label>
          <input type="number" min={0} value={form.sortOrder} onChange={(e) => set('sortOrder')(e.target.value)} className="rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-stone-400" />
        </div>
        <label className="flex cursor-pointer items-center gap-2 self-end pb-1.5">
          <div onClick={() => set('isActive')(!form.isActive)} className={`relative h-5 w-9 rounded-full transition-colors ${form.isActive ? 'bg-emerald-500' : 'bg-stone-300'}`}>
            <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${form.isActive ? 'translate-x-4' : 'translate-x-0.5'}`} />
          </div>
          <span className="text-xs text-stone-600">Actif</span>
        </label>
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

// ── Plan row ───────────────────────────────────────────────────────────────────

function PlanRow({ plan, onSaved }: { plan: PricingPlan; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [toggling, setToggling] = useState(false);

  async function handleSave(form: PlanForm) {
    await updatePricingPlan(plan.id, {
      name: form.name.trim(),
      durationSeconds: parseInt(form.durationSeconds, 10),
      priceAmount: parseFloat(form.priceAmount),
      currency: form.currency.trim() || 'MAD',
      isActive: form.isActive,
      sortOrder: parseInt(form.sortOrder, 10),
    });
    setFeedback({ type: 'success', msg: 'Plan mis à jour' });
    setEditing(false);
    onSaved();
  }

  async function handleToggle() {
    setToggling(true);
    try {
      await updatePricingPlan(plan.id, { isActive: !plan.isActive });
      onSaved();
    } catch (e) {
      setFeedback({ type: 'error', msg: (e as Error).message });
    } finally {
      setToggling(false);
    }
  }

  if (editing) {
    return (
      <div className="py-1">
        <PlanForm
          initial={{ name: plan.name, durationSeconds: String(plan.durationSeconds), priceAmount: String(plan.priceAmount), currency: plan.currency, isActive: plan.isActive, sortOrder: String(plan.sortOrder) }}
          onSave={handleSave}
          onCancel={() => setEditing(false)}
        />
        {feedback && <div className="mt-1"><Alert type={feedback.type} msg={feedback.msg} /></div>}
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-2 rounded-xl border border-stone-100 bg-white px-3 py-2.5">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-stone-900">{plan.name}</p>
        <p className="text-xs text-stone-400">{formatDuration(plan.durationSeconds)} · {plan.priceAmount} {plan.currency}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button onClick={() => void handleToggle()} disabled={toggling} className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${plan.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-stone-100 text-stone-500'}`}>
          {plan.isActive ? 'Actif' : 'Inactif'}
        </button>
        <button onClick={() => setEditing(true)} className="text-xs text-stone-400 underline-offset-2 hover:text-stone-700">Modifier</button>
      </div>
      {feedback && <div className="col-span-full w-full"><Alert type={feedback.type} msg={feedback.msg} /></div>}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function PricingPlansSettings({ plans, onSaved }: { plans: PricingPlan[]; onSaved: () => void }) {
  const [creating, setCreating] = useState(false);
  const [createFeedback, setCreateFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  async function handleCreate(form: PlanForm) {
    await createPricingPlan({
      name: form.name.trim(),
      durationSeconds: parseInt(form.durationSeconds, 10),
      priceAmount: parseFloat(form.priceAmount),
      currency: form.currency.trim() || 'MAD',
      isActive: form.isActive,
      sortOrder: parseInt(form.sortOrder, 10),
    });
    setCreateFeedback({ type: 'success', msg: 'Plan créé' });
    setCreating(false);
    onSaved();
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5 rounded-xl bg-amber-50 px-3 py-2.5 text-xs text-amber-800 ring-1 ring-amber-200">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        <span>Modifier un plan ne recalcule pas les anciennes sessions. Elles conservent leur pricing snapshot.</span>
      </div>

      <div className="space-y-2">
        {plans.length === 0 && (
          <p className="py-4 text-center text-sm text-stone-400">Aucun plan configuré.</p>
        )}
        {plans.map((p) => <PlanRow key={p.id} plan={p} onSaved={onSaved} />)}
      </div>

      {createFeedback && <Alert type={createFeedback.type} msg={createFeedback.msg} />}

      {creating ? (
        <PlanForm onSave={handleCreate} onCancel={() => setCreating(false)} />
      ) : (
        <button onClick={() => setCreating(true)} className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-stone-300 py-3 text-sm font-medium text-stone-500 transition-colors hover:border-stone-400 hover:text-stone-700">
          <Plus className="h-4 w-4" />
          Nouveau plan
        </button>
      )}
    </div>
  );
}
