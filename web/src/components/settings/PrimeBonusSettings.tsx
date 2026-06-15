'use client';

import { useState, useEffect, useCallback } from 'react';
import { Clock, Percent, Target, Gift, Plus, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import type {
  PrimeSettingsSummary,
  ShiftTypeSetting,
  CommissionRuleSetting,
  TargetBonusRuleSetting,
  CommissionType,
  PricingPlan,
} from '@/lib/types';
import {
  getPrimeSettingsSummary,
  createShiftType,
  updateShiftType,
  createCommissionRule,
  updateCommissionRule,
  createTargetBonusRule,
  updateTargetBonusRule,
} from '@/lib/api';

// ── Shared helpers ─────────────────────────────────────────────────────────────

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

function Badge({ active }: { active: boolean }) {
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
        active ? 'bg-emerald-50 text-emerald-700' : 'bg-stone-100 text-stone-400'
      }`}
    >
      {active ? 'Actif' : 'Inactif'}
    </span>
  );
}

function inputCls() {
  return 'rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-stone-400 w-full';
}

function selectCls() {
  return 'rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-stone-400 w-full';
}

function SaveButton({ saving, label = 'Enregistrer' }: { saving: boolean; label?: string }) {
  return (
    <button
      type="submit"
      disabled={saving}
      className="rounded-lg bg-stone-900 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
    >
      {saving ? 'Enregistrement…' : label}
    </button>
  );
}

function CancelButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border border-stone-200 px-4 py-2 text-xs font-medium text-stone-600 hover:bg-stone-50"
    >
      Annuler
    </button>
  );
}

function SectionCard({
  icon: Icon,
  title,
  helper,
  children,
}: {
  icon: React.ElementType;
  title: string;
  helper?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-stone-100 bg-white shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 border-b border-stone-100 px-4 py-3">
        <Icon className="h-4 w-4 text-stone-400" />
        <h3 className="text-sm font-semibold text-stone-800">{title}</h3>
      </div>
      {helper && (
        <div className="border-b border-stone-100 bg-stone-50 px-4 py-2.5 text-xs leading-relaxed text-stone-500">
          {helper}
        </div>
      )}
      <div className="space-y-3 p-4">{children}</div>
    </div>
  );
}

// ── A. Shift Types ─────────────────────────────────────────────────────────────

function ShiftTypeRow({
  st,
  onRefresh,
}: {
  st: ShiftTypeSetting;
  onRefresh: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    label: st.label ?? '',
    startTime: st.startTime,
    endTime: st.endTime,
    sortOrder: String(st.sortOrder),
    isActive: st.isActive,
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function set(k: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form.label.trim()) { setErr('Le libellé est requis'); return; }
    if (!form.startTime) { setErr("L'heure de début est requise"); return; }
    if (!form.endTime) { setErr("L'heure de fin est requise"); return; }
    setSaving(true);
    setErr(null);
    try {
      await updateShiftType(st.id, {
        label: form.label.trim(),
        startTime: form.startTime,
        endTime: form.endTime,
        sortOrder: parseInt(form.sortOrder, 10) || 0,
        isActive: form.isActive,
      });
      setEditing(false);
      onRefresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <form onSubmit={(e) => void handleSave(e)} className="space-y-2.5 rounded-xl border border-stone-200 bg-stone-50 p-3">
        <div className="flex flex-col gap-0.5">
          <label className="text-xs text-stone-500">Libellé *</label>
          <input type="text" value={form.label} onChange={set('label')} className={inputCls()} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-0.5">
            <label className="text-xs text-stone-500">Début</label>
            <input type="time" value={form.startTime} onChange={set('startTime')} className={inputCls()} />
          </div>
          <div className="flex flex-col gap-0.5">
            <label className="text-xs text-stone-500">Fin</label>
            <input type="time" value={form.endTime} onChange={set('endTime')} className={inputCls()} />
          </div>
        </div>
        <div className="flex flex-col gap-0.5">
          <label className="text-xs text-stone-500">Ordre d&apos;affichage</label>
          <input type="number" min="0" value={form.sortOrder} onChange={set('sortOrder')} className="w-24 rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-stone-400" />
        </div>
        <label className="flex cursor-pointer items-center gap-2">
          <input type="checkbox" checked={form.isActive} onChange={set('isActive')} className="rounded" />
          <span className="text-xs text-stone-600">Actif</span>
        </label>
        {err && <Alert type="error" msg={err} />}
        <div className="flex gap-2">
          <SaveButton saving={saving} />
          <CancelButton onClick={() => { setEditing(false); setErr(null); }} />
        </div>
      </form>
    );
  }

  return (
    <div className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${st.isActive ? 'border-stone-100 bg-white' : 'border-stone-100 bg-stone-50'}`}>
      <div className="min-w-0 flex-1">
        <p className={`text-sm font-medium ${st.isActive ? 'text-stone-900' : 'text-stone-400'}`}>
          {st.label ?? st.name}
        </p>
        <p className="text-xs text-stone-400">{st.startTime} → {st.endTime}</p>
      </div>
      <Badge active={st.isActive} />
      <button
        onClick={() => setEditing(true)}
        className="shrink-0 text-xs text-stone-400 underline-offset-2 hover:text-stone-700"
      >
        Modifier
      </button>
    </div>
  );
}

function CreateShiftTypeForm({ onRefresh }: { onRefresh: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', label: '', startTime: '', endTime: '' });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function set(k: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setForm((f) => {
        const next = { ...f, [k]: value };
        if (k === 'label') next.name = value.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
        return next;
      });
    };
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form.label.trim()) { setErr('Le libellé est requis'); return; }
    if (!form.name.trim()) { setErr('Le nom technique est requis'); return; }
    if (!form.startTime) { setErr("L'heure de début est requise"); return; }
    if (!form.endTime) { setErr("L'heure de fin est requise"); return; }
    setSaving(true);
    setErr(null);
    try {
      await createShiftType({
        name: form.name.trim(),
        label: form.label.trim(),
        startTime: form.startTime,
        endTime: form.endTime,
        isActive: true,
        sortOrder: 0,
      });
      setForm({ name: '', label: '', startTime: '', endTime: '' });
      setOpen(false);
      onRefresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-stone-300 py-3 text-sm font-medium text-stone-500 transition-colors hover:border-stone-400 hover:text-stone-700"
      >
        <Plus className="h-4 w-4" />
        Nouveau type de shift
      </button>
    );
  }

  return (
    <form onSubmit={(e) => void handleSave(e)} className="space-y-2.5 rounded-xl border border-stone-200 bg-stone-50 p-3">
      <p className="text-xs font-medium text-stone-700">Nouveau type de shift</p>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-0.5">
          <label className="text-xs text-stone-500">Libellé *</label>
          <input type="text" value={form.label} onChange={set('label')} placeholder="ex: Nuit" className={inputCls()} />
        </div>
        <div className="flex flex-col gap-0.5">
          <label className="text-xs text-stone-500">Nom technique</label>
          <input type="text" value={form.name} onChange={set('name')} placeholder="ex: nuit" className={inputCls()} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-0.5">
          <label className="text-xs text-stone-500">Heure début *</label>
          <input type="time" value={form.startTime} onChange={set('startTime')} className={inputCls()} />
        </div>
        <div className="flex flex-col gap-0.5">
          <label className="text-xs text-stone-500">Heure fin *</label>
          <input type="time" value={form.endTime} onChange={set('endTime')} className={inputCls()} />
        </div>
      </div>
      {err && <Alert type="error" msg={err} />}
      <div className="flex gap-2">
        <SaveButton saving={saving} />
        <CancelButton onClick={() => { setOpen(false); setErr(null); }} />
      </div>
    </form>
  );
}

function ShiftTypesSection({
  shiftTypes,
  onRefresh,
}: {
  shiftTypes: ShiftTypeSetting[];
  onRefresh: () => void;
}) {
  return (
    <SectionCard
      icon={Clock}
      title="Types de shifts"
      helper="Les types de shifts servent à calculer les objectifs et les primes."
    >
      {shiftTypes.length === 0 ? (
        <p className="py-2 text-center text-sm text-stone-400">Aucun type de shift configuré.</p>
      ) : (
        <div className="space-y-2">
          {shiftTypes.map((st) => (
            <ShiftTypeRow key={st.id} st={st} onRefresh={onRefresh} />
          ))}
        </div>
      )}
      <CreateShiftTypeForm onRefresh={onRefresh} />
    </SectionCard>
  );
}

// ── B. Commission Rules ────────────────────────────────────────────────────────

function calcPreview(type: CommissionType, value: number, planPrice: number): string {
  if (!isFinite(value) || value < 0) return '—';
  const amount = type === 'PERCENTAGE' ? (planPrice * value) / 100 : value;
  return `~${amount.toFixed(2)} DH/session`;
}

function CommissionRuleRow({
  rule,
  onRefresh,
}: {
  rule: CommissionRuleSetting;
  onRefresh: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<{ type: CommissionType; value: string }>({
    type: rule.type,
    value: String(rule.value),
  });
  const [toggling, setToggling] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const valueNum = parseFloat(form.value);
  const preview = calcPreview(form.type, valueNum, rule.pricingPlanPrice);

  async function handleToggle() {
    setToggling(true);
    setErr(null);
    try {
      await updateCommissionRule(rule.id, { isActive: !rule.isActive });
      onRefresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setToggling(false);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!isFinite(valueNum) || valueNum < 0) { setErr('Valeur invalide'); return; }
    if (form.type === 'PERCENTAGE' && valueNum > 100) { setErr('Le pourcentage doit être ≤ 100'); return; }
    setSaving(true);
    setErr(null);
    try {
      await updateCommissionRule(rule.id, { type: form.type, value: valueNum });
      setEditing(false);
      onRefresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const typeLabel = rule.type === 'PERCENTAGE'
    ? `${rule.value}%`
    : `${rule.value} DH fixe`;

  if (editing) {
    return (
      <form onSubmit={(e) => void handleSave(e)} className="space-y-2.5 rounded-xl border border-stone-200 bg-stone-50 p-3">
        <p className="text-xs font-medium text-stone-700">
          Modifier — {rule.pricingPlanName} ({rule.pricingPlanPrice} DH)
        </p>
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-0.5">
            <label className="text-xs text-stone-500">Type</label>
            <select
              value={form.type}
              onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as CommissionType }))}
              className={selectCls()}
            >
              <option value="PERCENTAGE">Pourcentage</option>
              <option value="FIXED_AMOUNT">Montant fixe</option>
            </select>
          </div>
          <div className="flex flex-col gap-0.5">
            <label className="text-xs text-stone-500">
              Valeur {form.type === 'PERCENTAGE' ? '(%)' : '(DH)'}
            </label>
            <input
              type="number"
              min="0"
              max={form.type === 'PERCENTAGE' ? 100 : undefined}
              step="0.01"
              value={form.value}
              onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
              className={inputCls()}
            />
          </div>
        </div>
        <div className="rounded-lg bg-stone-100 px-3 py-1.5 text-xs text-stone-600">
          Prime estimée par session : <span className="font-semibold">{preview}</span>
        </div>
        {err && <Alert type="error" msg={err} />}
        <div className="flex gap-2">
          <SaveButton saving={saving} />
          <CancelButton onClick={() => { setEditing(false); setErr(null); }} />
        </div>
      </form>
    );
  }

  return (
    <div className={`space-y-1 rounded-xl border px-3 py-2.5 ${rule.isActive ? 'border-stone-100 bg-white' : 'border-stone-100 bg-stone-50'}`}>
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className={`text-sm font-medium ${rule.isActive ? 'text-stone-900' : 'text-stone-400'}`}>
            {rule.pricingPlanName} <span className="font-normal text-stone-400">({rule.pricingPlanPrice} DH)</span>
          </p>
          <p className={`text-xs ${rule.isActive ? 'text-stone-500' : 'text-stone-400'}`}>
            {typeLabel}
            {rule.isActive && (
              <span className="ml-2 text-stone-400">{calcPreview(rule.type, rule.value, rule.pricingPlanPrice)}</span>
            )}
          </p>
        </div>
        <Badge active={rule.isActive} />
        {rule.isActive && (
          <>
            <button
              onClick={() => setEditing(true)}
              className="shrink-0 text-xs text-stone-400 underline-offset-2 hover:text-stone-700"
            >
              Modifier
            </button>
            <button
              onClick={() => void handleToggle()}
              disabled={toggling}
              className="shrink-0 text-xs text-red-400 underline-offset-2 hover:text-red-600 disabled:opacity-40"
            >
              Désactiver
            </button>
          </>
        )}
      </div>
      {err && <Alert type="error" msg={err} />}
    </div>
  );
}

function CreateCommissionRuleForm({
  plans,
  onRefresh,
}: {
  plans: PricingPlan[];
  onRefresh: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<{
    pricingPlanId: string;
    type: CommissionType;
    value: string;
  }>({
    pricingPlanId: plans[0]?.id ?? '',
    type: 'PERCENTAGE',
    value: '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const selectedPlan = plans.find((p) => p.id === form.pricingPlanId);
  const valueNum = parseFloat(form.value);
  const preview = selectedPlan && isFinite(valueNum)
    ? calcPreview(form.type, valueNum, selectedPlan.priceAmount)
    : '—';

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form.pricingPlanId) { setErr('Veuillez sélectionner un plan'); return; }
    if (!isFinite(valueNum) || valueNum < 0) { setErr('Valeur invalide'); return; }
    if (form.type === 'PERCENTAGE' && valueNum > 100) { setErr('Le pourcentage doit être ≤ 100'); return; }
    setSaving(true);
    setErr(null);
    try {
      await createCommissionRule({
        pricingPlanId: form.pricingPlanId,
        type: form.type,
        value: valueNum,
        isActive: true,
      });
      setForm({ pricingPlanId: plans[0]?.id ?? '', type: 'PERCENTAGE', value: '' });
      setOpen(false);
      onRefresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-stone-300 py-3 text-sm font-medium text-stone-500 transition-colors hover:border-stone-400 hover:text-stone-700"
      >
        <Plus className="h-4 w-4" />
        Nouvelle règle de prime
      </button>
    );
  }

  if (plans.length === 0) {
    return (
      <div className="rounded-xl border border-stone-200 bg-stone-50 p-3 text-xs text-stone-500">
        Aucun plan tarifaire disponible. Configurez des plans dans l&apos;onglet &quot;Prix &amp; plans&quot; d&apos;abord.
      </div>
    );
  }

  return (
    <form onSubmit={(e) => void handleSave(e)} className="space-y-2.5 rounded-xl border border-stone-200 bg-stone-50 p-3">
      <p className="text-xs font-medium text-stone-700">Nouvelle règle de prime</p>
      <div className="flex flex-col gap-0.5">
        <label className="text-xs text-stone-500">Plan tarifaire *</label>
        <select
          value={form.pricingPlanId}
          onChange={(e) => setForm((f) => ({ ...f, pricingPlanId: e.target.value }))}
          className={selectCls()}
        >
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.priceAmount} DH)
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-0.5">
          <label className="text-xs text-stone-500">Type de prime</label>
          <select
            value={form.type}
            onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as CommissionType }))}
            className={selectCls()}
          >
            <option value="PERCENTAGE">Pourcentage</option>
            <option value="FIXED_AMOUNT">Montant fixe</option>
          </select>
        </div>
        <div className="flex flex-col gap-0.5">
          <label className="text-xs text-stone-500">
            Valeur {form.type === 'PERCENTAGE' ? '(%)' : '(DH)'}
          </label>
          <input
            type="number"
            min="0"
            max={form.type === 'PERCENTAGE' ? 100 : undefined}
            step="0.01"
            value={form.value}
            onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
            placeholder={form.type === 'PERCENTAGE' ? 'ex: 10' : 'ex: 5'}
            className={inputCls()}
          />
        </div>
      </div>
      {isFinite(valueNum) && valueNum >= 0 && (
        <div className="rounded-lg bg-stone-100 px-3 py-1.5 text-xs text-stone-600">
          Prime estimée par session : <span className="font-semibold">{preview}</span>
        </div>
      )}
      {err && <Alert type="error" msg={err} />}
      <div className="flex gap-2">
        <SaveButton saving={saving} />
        <CancelButton onClick={() => { setOpen(false); setErr(null); }} />
      </div>
    </form>
  );
}

function CommissionRulesSection({
  rules,
  plans,
  onRefresh,
}: {
  rules: CommissionRuleSetting[];
  plans: PricingPlan[];
  onRefresh: () => void;
}) {
  const [showHistorical, setShowHistorical] = useState(false);
  const active = rules.filter((r) => r.isActive);
  const historical = rules.filter((r) => !r.isActive);

  return (
    <SectionCard
      icon={Percent}
      title="Prime par plan"
      helper="Exemple : Plan 30 min à 30 DH avec 10% donne une prime de 3 DH par session éligible."
    >
      {active.length === 0 && historical.length === 0 ? (
        <p className="py-2 text-center text-sm text-stone-400">Aucune règle de prime configurée.</p>
      ) : (
        <div className="space-y-2">
          {active.length > 0 && (
            <div className="space-y-2">
              {active.map((r) => (
                <CommissionRuleRow key={r.id} rule={r} onRefresh={onRefresh} />
              ))}
            </div>
          )}
          {active.length === 0 && (
            <p className="py-1 text-xs text-stone-400">Aucune règle active.</p>
          )}
          {historical.length > 0 && (
            <div>
              <button
                onClick={() => setShowHistorical((s) => !s)}
                className="flex items-center gap-1 text-xs text-stone-400 hover:text-stone-600"
              >
                {showHistorical ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                {historical.length} règle{historical.length > 1 ? 's' : ''} historique{historical.length > 1 ? 's' : ''}
              </button>
              {showHistorical && (
                <div className="mt-2 space-y-2">
                  {historical.map((r) => (
                    <CommissionRuleRow key={r.id} rule={r} onRefresh={onRefresh} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      <CreateCommissionRuleForm plans={plans} onRefresh={onRefresh} />
    </SectionCard>
  );
}

// ── C. Target Bonus Rules ──────────────────────────────────────────────────────

function TargetBonusRuleRow({
  rule,
  onRefresh,
}: {
  rule: TargetBonusRuleSetting;
  onRefresh: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    targetAmount: String(rule.targetAmount),
    bonusAmount: String(rule.bonusAmount),
  });
  const [toggling, setToggling] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleToggle() {
    setToggling(true);
    setErr(null);
    try {
      await updateTargetBonusRule(rule.id, { isActive: !rule.isActive });
      onRefresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setToggling(false);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const target = parseFloat(form.targetAmount);
    const bonus = parseFloat(form.bonusAmount);
    if (!isFinite(target) || target <= 0) { setErr("L'objectif doit être supérieur à 0"); return; }
    if (!isFinite(bonus) || bonus < 0) { setErr('Le bonus doit être ≥ 0'); return; }
    setSaving(true);
    setErr(null);
    try {
      await updateTargetBonusRule(rule.id, { targetAmount: target, bonusAmount: bonus });
      setEditing(false);
      onRefresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <form onSubmit={(e) => void handleSave(e)} className="space-y-2.5 rounded-xl border border-stone-200 bg-stone-50 p-3">
        <p className="text-xs font-medium text-stone-700">
          Modifier — {rule.shiftTypeLabel}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-0.5">
            <label className="text-xs text-stone-500">Objectif (DH) *</label>
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={form.targetAmount}
              onChange={(e) => setForm((f) => ({ ...f, targetAmount: e.target.value }))}
              className={inputCls()}
            />
          </div>
          <div className="flex flex-col gap-0.5">
            <label className="text-xs text-stone-500">Bonus (DH) *</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.bonusAmount}
              onChange={(e) => setForm((f) => ({ ...f, bonusAmount: e.target.value }))}
              className={inputCls()}
            />
          </div>
        </div>
        {err && <Alert type="error" msg={err} />}
        <div className="flex gap-2">
          <SaveButton saving={saving} />
          <CancelButton onClick={() => { setEditing(false); setErr(null); }} />
        </div>
      </form>
    );
  }

  return (
    <div className={`space-y-1 rounded-xl border px-3 py-2.5 ${rule.isActive ? 'border-stone-100 bg-white' : 'border-stone-100 bg-stone-50'}`}>
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className={`text-sm font-medium ${rule.isActive ? 'text-stone-900' : 'text-stone-400'}`}>
            {rule.shiftTypeLabel}
          </p>
          <p className={`text-xs ${rule.isActive ? 'text-stone-500' : 'text-stone-400'}`}>
            Objectif ≥ {rule.targetAmount} DH → Bonus {rule.bonusAmount} DH
          </p>
        </div>
        <Badge active={rule.isActive} />
        {rule.isActive && (
          <>
            <button
              onClick={() => setEditing(true)}
              className="shrink-0 text-xs text-stone-400 underline-offset-2 hover:text-stone-700"
            >
              Modifier
            </button>
            <button
              onClick={() => void handleToggle()}
              disabled={toggling}
              className="shrink-0 text-xs text-red-400 underline-offset-2 hover:text-red-600 disabled:opacity-40"
            >
              Désactiver
            </button>
          </>
        )}
      </div>
      {err && <Alert type="error" msg={err} />}
    </div>
  );
}

function CreateTargetBonusForm({
  shiftTypes,
  onRefresh,
}: {
  shiftTypes: ShiftTypeSetting[];
  onRefresh: () => void;
}) {
  const [open, setOpen] = useState(false);
  const activeTypes = shiftTypes.filter((s) => s.isActive);
  const [form, setForm] = useState({
    shiftTypeId: activeTypes[0]?.id ?? shiftTypes[0]?.id ?? '',
    targetAmount: '',
    bonusAmount: '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form.shiftTypeId) { setErr('Veuillez sélectionner un type de shift'); return; }
    const target = parseFloat(form.targetAmount);
    const bonus = parseFloat(form.bonusAmount);
    if (!isFinite(target) || target <= 0) { setErr("L'objectif doit être supérieur à 0"); return; }
    if (!isFinite(bonus) || bonus < 0) { setErr('Le bonus doit être ≥ 0'); return; }
    setSaving(true);
    setErr(null);
    try {
      await createTargetBonusRule({
        shiftTypeId: form.shiftTypeId,
        targetAmount: target,
        bonusAmount: bonus,
        isActive: true,
      });
      const firstId = activeTypes[0]?.id ?? shiftTypes[0]?.id ?? '';
      setForm({ shiftTypeId: firstId, targetAmount: '', bonusAmount: '' });
      setOpen(false);
      onRefresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-stone-300 py-3 text-sm font-medium text-stone-500 transition-colors hover:border-stone-400 hover:text-stone-700"
      >
        <Plus className="h-4 w-4" />
        Nouveau bonus objectif
      </button>
    );
  }

  if (shiftTypes.length === 0) {
    return (
      <div className="rounded-xl border border-stone-200 bg-stone-50 p-3 text-xs text-stone-500">
        Aucun type de shift disponible. Configurez des types de shifts d&apos;abord.
      </div>
    );
  }

  return (
    <form onSubmit={(e) => void handleSave(e)} className="space-y-2.5 rounded-xl border border-stone-200 bg-stone-50 p-3">
      <p className="text-xs font-medium text-stone-700">Nouveau bonus objectif</p>
      <div className="flex flex-col gap-0.5">
        <label className="text-xs text-stone-500">Type de shift *</label>
        <select
          value={form.shiftTypeId}
          onChange={(e) => setForm((f) => ({ ...f, shiftTypeId: e.target.value }))}
          className={selectCls()}
        >
          {shiftTypes.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label ?? s.name}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-0.5">
          <label className="text-xs text-stone-500">Objectif (DH) *</label>
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={form.targetAmount}
            onChange={(e) => setForm((f) => ({ ...f, targetAmount: e.target.value }))}
            placeholder="ex: 500"
            className={inputCls()}
          />
        </div>
        <div className="flex flex-col gap-0.5">
          <label className="text-xs text-stone-500">Bonus (DH) *</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={form.bonusAmount}
            onChange={(e) => setForm((f) => ({ ...f, bonusAmount: e.target.value }))}
            placeholder="ex: 50"
            className={inputCls()}
          />
        </div>
      </div>
      {err && <Alert type="error" msg={err} />}
      <div className="flex gap-2">
        <SaveButton saving={saving} />
        <CancelButton onClick={() => { setOpen(false); setErr(null); }} />
      </div>
    </form>
  );
}

function TargetBonusSection({
  rules,
  shiftTypes,
  onRefresh,
}: {
  rules: TargetBonusRuleSetting[];
  shiftTypes: ShiftTypeSetting[];
  onRefresh: () => void;
}) {
  const [showHistorical, setShowHistorical] = useState(false);
  const active = rules.filter((r) => r.isActive);
  const historical = rules.filter((r) => !r.isActive);

  return (
    <SectionCard
      icon={Target}
      title="Bonus objectif"
      helper="Le bonus objectif est ajouté en plus de la prime par plan lorsque le chiffre du shift atteint l'objectif."
    >
      {active.length === 0 && historical.length === 0 ? (
        <p className="py-2 text-center text-sm text-stone-400">Aucun bonus objectif configuré.</p>
      ) : (
        <div className="space-y-2">
          {active.length > 0 && (
            <div className="space-y-2">
              {active.map((r) => (
                <TargetBonusRuleRow key={r.id} rule={r} onRefresh={onRefresh} />
              ))}
            </div>
          )}
          {active.length === 0 && (
            <p className="py-1 text-xs text-stone-400">Aucun bonus actif.</p>
          )}
          {historical.length > 0 && (
            <div>
              <button
                onClick={() => setShowHistorical((s) => !s)}
                className="flex items-center gap-1 text-xs text-stone-400 hover:text-stone-600"
              >
                {showHistorical ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                {historical.length} règle{historical.length > 1 ? 's' : ''} historique{historical.length > 1 ? 's' : ''}
              </button>
              {showHistorical && (
                <div className="mt-2 space-y-2">
                  {historical.map((r) => (
                    <TargetBonusRuleRow key={r.id} rule={r} onRefresh={onRefresh} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      <CreateTargetBonusForm shiftTypes={shiftTypes} onRefresh={onRefresh} />
    </SectionCard>
  );
}

// ── D. Explanation card ────────────────────────────────────────────────────────

function ExplanationCard() {
  return (
    <div className="rounded-2xl border border-stone-100 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <Gift className="h-4 w-4 text-stone-400" />
        <h3 className="text-sm font-semibold text-stone-800">Comment sont calculées les primes ?</h3>
      </div>
      <p className="mb-3 text-xs leading-relaxed text-stone-500">
        Le total brut est la somme des sessions du shift. La prime par plan est calculée selon les règles
        configurées par plan tarifaire. Le bonus objectif est ajouté si le shift atteint le montant défini.
        La prime totale = prime par plan + bonus objectif + bonus manuel.
      </p>
      <div className="space-y-0.5 rounded-xl bg-stone-50 px-4 py-3 font-mono text-xs">
        <p className="text-stone-600">Total brut (chiffre du shift)</p>
        <p className="text-red-500">− Prime totale</p>
        <p className="border-t border-stone-200 pt-1 font-semibold text-stone-800">= Recette nette</p>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function PrimeBonusSettings() {
  const [summary, setSummary] = useState<PrimeSettingsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getPrimeSettingsSummary();
      setSummary(data);
      setError(null);
    } catch (e) {
      setError((e as Error).message || 'Impossible de charger les paramètres primes.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !summary) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-32 animate-pulse rounded-2xl bg-stone-200" />
        ))}
      </div>
    );
  }

  if (error && !summary) {
    return (
      <div className="rounded-2xl border border-stone-100 bg-white p-6 text-center shadow-sm">
        <p className="mb-3 text-sm text-stone-500">{error}</p>
        <button
          onClick={() => void load()}
          className="inline-flex items-center gap-2 rounded-xl bg-stone-900 px-5 py-2.5 text-xs font-semibold text-white"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Réessayer
        </button>
      </div>
    );
  }

  if (!summary) return null;

  const refresh = () => { void load(); };

  return (
    <div className="space-y-4">
      <ExplanationCard />
      <ShiftTypesSection shiftTypes={summary.shiftTypes} onRefresh={refresh} />
      <CommissionRulesSection
        rules={summary.commissionRules}
        plans={summary.pricingPlans}
        onRefresh={refresh}
      />
      <TargetBonusSection
        rules={summary.targetBonusRules}
        shiftTypes={summary.shiftTypes}
        onRefresh={refresh}
      />
    </div>
  );
}
