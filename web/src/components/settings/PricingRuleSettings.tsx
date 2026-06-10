'use client';

import { useState } from 'react';
import type { PricingPlan, PricingRule } from '@/lib/types';
import { updatePricingRule } from '@/lib/api';

function Alert({ type, msg }: { type: 'success' | 'error'; msg: string }) {
  return (
    <div className={`rounded-xl px-3 py-2 text-xs font-medium ${type === 'success' ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' : 'bg-red-50 text-red-700 ring-1 ring-red-200'}`}>
      {msg}
    </div>
  );
}

function SelectField({
  label,
  hint,
  value,
  onChange,
  options,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <label className="text-xs font-medium text-stone-600">{label}</label>
      {hint && <p className="text-xs text-stone-400">{hint}</p>}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-0.5 rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-2 text-sm text-stone-900 outline-none focus:border-stone-400"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

interface RuleForm {
  roundingMode: string;
  graceSeconds: string;
  minimumBillableSeconds: string;
  minimumPlanId: string;
  overtimePolicy: string;
  extraMinutePrice: string;
}

export function PricingRuleSettings({
  rule,
  plans,
  onSaved,
}: {
  rule: PricingRule | null;
  plans: PricingPlan[];
  onSaved: () => void;
}) {
  const [form, setForm] = useState<RuleForm>({
    roundingMode: rule?.roundingMode ?? 'NEXT_PLAN',
    graceSeconds: String(rule?.graceSeconds ?? 120),
    minimumBillableSeconds: String(rule?.minimumBillableSeconds ?? 180),
    minimumPlanId: rule?.minimumPlanId ?? '',
    overtimePolicy: rule?.overtimePolicy ?? 'NEXT_PLAN',
    extraMinutePrice: rule?.extraMinutePrice != null ? String(rule.extraMinutePrice) : '',
  });
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  const set = (k: keyof RuleForm) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function handleSave() {
    const grace = parseInt(form.graceSeconds, 10);
    if (!Number.isInteger(grace) || grace < 0) {
      setFeedback({ type: 'error', msg: 'Marge de tolérance invalide' });
      return;
    }
    const minBillable = parseInt(form.minimumBillableSeconds, 10);
    if (!Number.isInteger(minBillable) || minBillable < 0) {
      setFeedback({ type: 'error', msg: 'Durée minimale facturable invalide' });
      return;
    }
    const extraPrice = form.extraMinutePrice.trim() === '' ? null : parseFloat(form.extraMinutePrice);
    if (form.overtimePolicy === 'EXTRA_MINUTE' && (extraPrice === null || isNaN(extraPrice) || extraPrice < 0)) {
      setFeedback({ type: 'error', msg: 'Prix par minute supplémentaire requis pour EXTRA_MINUTE' });
      return;
    }

    setSaving(true);
    setFeedback(null);
    try {
      await updatePricingRule({
        roundingMode: form.roundingMode,
        graceSeconds: grace,
        minimumBillableSeconds: minBillable,
        minimumPlanId: form.minimumPlanId || null,
        overtimePolicy: form.overtimePolicy,
        extraMinutePrice: extraPrice,
      });
      setFeedback({ type: 'success', msg: 'Règle de calcul mise à jour' });
      onSaved();
    } catch (e) {
      setFeedback({ type: 'error', msg: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  const planOptions = [
    { value: '', label: 'Aucun plan minimum' },
    ...plans.filter((p) => p.isActive).map((p) => ({ value: p.id, label: `${p.name} (${Math.floor(p.durationSeconds / 60)} min)` })),
  ];

  if (!rule) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        Aucune règle de calcul configurée. Enregistrer ci-dessous pour créer la règle par défaut.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SelectField
          label="Mode d'arrondi"
          hint="Comment arrondir la durée d'une session"
          value={form.roundingMode}
          onChange={set('roundingMode')}
          options={[
            { value: 'NEXT_PLAN', label: 'Plan suivant (NEXT_PLAN)' },
            { value: 'NEAREST_PLAN', label: 'Plan le plus proche (NEAREST_PLAN)' },
            { value: 'EXACT_MINUTES', label: 'Minutes exactes (EXACT_MINUTES)' },
          ]}
        />
        <div className="flex flex-col gap-0.5">
          <label className="text-xs font-medium text-stone-600">Marge de tolérance</label>
          <p className="text-xs text-stone-400">Secondes de dépassement ignorées</p>
          <div className="mt-0.5 flex items-center gap-1.5">
            <input
              type="number"
              min={0}
              value={form.graceSeconds}
              onChange={(e) => set('graceSeconds')(e.target.value)}
              className="w-full rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-2 text-sm outline-none focus:border-stone-400"
            />
            <span className="shrink-0 text-xs text-stone-400">s</span>
          </div>
        </div>
        <div className="flex flex-col gap-0.5">
          <label className="text-xs font-medium text-stone-600">Durée minimale facturable</label>
          <p className="text-xs text-stone-400">Les sessions plus courtes que cette durée seront marquées comme anomalie et ne seront pas facturées automatiquement.</p>
          <div className="mt-0.5 flex items-center gap-1.5">
            <input
              type="number"
              min={0}
              value={form.minimumBillableSeconds}
              onChange={(e) => set('minimumBillableSeconds')(e.target.value)}
              className="w-full rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-2 text-sm outline-none focus:border-stone-400"
            />
            <span className="shrink-0 text-xs text-stone-400">s</span>
          </div>
        </div>
        <SelectField
          label="Plan minimum"
          hint="Facturation minimale par session"
          value={form.minimumPlanId}
          onChange={set('minimumPlanId')}
          options={planOptions}
        />
        <SelectField
          label="Politique de dépassement"
          hint="Si la session dépasse tous les plans"
          value={form.overtimePolicy}
          onChange={set('overtimePolicy')}
          options={[
            { value: 'NEXT_PLAN', label: 'Plan suivant (NEXT_PLAN)' },
            { value: 'EXTRA_MINUTE', label: 'Prix par minute (EXTRA_MINUTE)' },
            { value: 'ANOMALY', label: 'Marquer anomalie (ANOMALY)' },
          ]}
        />
        {form.overtimePolicy === 'EXTRA_MINUTE' && (
          <div className="flex flex-col gap-0.5">
            <label className="text-xs font-medium text-stone-600">Prix / minute supplémentaire</label>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min={0}
                step={0.5}
                value={form.extraMinutePrice}
                onChange={(e) => set('extraMinutePrice')(e.target.value)}
                className="w-full rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-2 text-sm outline-none focus:border-stone-400"
              />
              <span className="shrink-0 text-xs text-stone-400">MAD</span>
            </div>
          </div>
        )}
      </div>

      {feedback && <Alert type={feedback.type} msg={feedback.msg} />}

      <button
        onClick={() => void handleSave()}
        disabled={saving}
        className="rounded-lg bg-stone-900 px-5 py-2.5 text-sm font-semibold text-white transition-opacity disabled:opacity-50"
      >
        {saving ? 'Enregistrement…' : 'Enregistrer la règle'}
      </button>
    </div>
  );
}
