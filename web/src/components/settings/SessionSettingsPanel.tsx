'use client';

import { useState, useEffect, useCallback } from 'react';
import { Save, RefreshCw } from 'lucide-react';
import type { SessionSettings, PricingPlan } from '@/lib/types';
import { getSessionSettings, updateSessionSettings, getPricingPlans } from '@/lib/api';

const INPUT_CLS =
  'w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm text-stone-900 focus:border-stone-400 focus:outline-none focus:ring-1 focus:ring-stone-400/40';
const SELECT_CLS =
  'w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm text-stone-900 focus:border-stone-400 focus:outline-none focus:ring-1 focus:ring-stone-400/40 cursor-pointer';
const LABEL_CLS = 'block text-xs font-semibold text-stone-700 mb-1';
const HINT_CLS  = 'mt-1 text-xs text-stone-400';

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className={LABEL_CLS}>{label}</label>
      {children}
      {hint && <p className={HINT_CLS}>{hint}</p>}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 rounded-full transition-colors ${
          checked ? 'bg-stone-800' : 'bg-stone-200'
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-4' : 'translate-x-0'
          }`}
        />
      </button>
      <span className="text-sm text-stone-700">{label}</span>
    </label>
  );
}

export function SessionSettingsPanel() {
  const [settings, setSettings] = useState<SessionSettings | null>(null);
  const [plans,    setPlans]    = useState<PricingPlan[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [saved,    setSaved]    = useState(false);

  // Form fields
  const [minimumBillableSeconds,       setMinimumBillableSeconds]       = useState(180);
  const [graceSeconds,                 setGraceSeconds]                 = useState(120);
  const [roundingMode,                 setRoundingMode]                 = useState<SessionSettings['roundingMode']>('NEXT_PLAN');
  const [overtimePolicy,               setOvertimePolicy]               = useState<SessionSettings['overtimePolicy']>('ANOMALY');
  const [minimumPlanId,                setMinimumPlanId]                = useState('');
  const [allowManualSessionCorrection, setAllowManualSessionCorrection] = useState(true);
  const [correctionReasonRequired,     setCorrectionReasonRequired]     = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, p] = await Promise.all([getSessionSettings(), getPricingPlans()]);
      setSettings(s);
      setPlans(p.items.filter((pl) => pl.isActive));
      setMinimumBillableSeconds(s.minimumBillableSeconds);
      setGraceSeconds(s.graceSeconds);
      setRoundingMode(s.roundingMode);
      setOvertimePolicy(s.overtimePolicy);
      setMinimumPlanId(s.minimumPlanId ?? '');
      setAllowManualSessionCorrection(s.allowManualSessionCorrection);
      setCorrectionReasonRequired(s.correctionReasonRequired);
    } catch (e) {
      setError((e as Error).message ?? 'Erreur de chargement');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const updated = await updateSessionSettings({
        minimumBillableSeconds,
        graceSeconds,
        roundingMode,
        overtimePolicy,
        minimumPlanId: minimumPlanId || null,
        allowManualSessionCorrection,
        correctionReasonRequired,
      });
      setSettings(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setError((e as Error).message ?? 'Erreur lors de la sauvegarde');
    } finally {
      setSaving(false);
    }
  }

  if (loading && !settings) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-14 animate-pulse rounded-2xl bg-stone-100" />
        ))}
      </div>
    );
  }

  if (error && !settings) {
    return (
      <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-4 text-sm text-red-600">
        {error}{' '}
        <button onClick={() => void load()} className="ml-2 underline">
          Réessayer
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Loading indicator while refreshing */}
      {loading && (
        <div className="flex items-center gap-1.5 text-xs text-stone-400">
          <RefreshCw className="h-3 w-3 animate-spin" />
          Actualisation…
        </div>
      )}

      {/* ── Billing thresholds ─────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-stone-100 bg-white p-4 shadow-sm space-y-4">
        <h3 className="text-xs font-bold uppercase tracking-widest text-stone-400">
          Durées & arrondi
        </h3>

        <Field
          label="Durée minimale facturable (secondes)"
          hint="Les sessions plus courtes que cette durée seront marquées comme hors règle."
        >
          <input
            type="number"
            min="0"
            value={minimumBillableSeconds}
            onChange={(e) => setMinimumBillableSeconds(Number(e.target.value))}
            className={INPUT_CLS}
          />
        </Field>

        <Field
          label="Marge de tolérance (secondes)"
          hint="La marge de tolérance permet de garder le même plan en cas de petit dépassement."
        >
          <input
            type="number"
            min="0"
            value={graceSeconds}
            onChange={(e) => setGraceSeconds(Number(e.target.value))}
            className={INPUT_CLS}
          />
        </Field>

        <Field label="Mode d'arrondi">
          <select
            value={roundingMode}
            onChange={(e) => setRoundingMode(e.target.value as SessionSettings['roundingMode'])}
            className={SELECT_CLS}
          >
            <option value="NEXT_PLAN">Plan suivant (arrondi supérieur)</option>
            <option value="NEAREST_PLAN">Plan le plus proche</option>
            <option value="EXACT_MINUTES">Minutes exactes</option>
          </select>
        </Field>

        <Field label="Politique de dépassement">
          <select
            value={overtimePolicy}
            onChange={(e) => setOvertimePolicy(e.target.value as SessionSettings['overtimePolicy'])}
            className={SELECT_CLS}
          >
            <option value="ANOMALY">Marquer comme anomalie</option>
            <option value="NEXT_PLAN">Appliquer le plan suivant</option>
            <option value="EXTRA_MINUTE">Facturer par minute supplémentaire</option>
          </select>
        </Field>

        <Field label="Plan minimum (optionnel)">
          <select
            value={minimumPlanId}
            onChange={(e) => setMinimumPlanId(e.target.value)}
            className={SELECT_CLS}
          >
            <option value="">Aucun plan minimum</option>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {p.priceAmount} MAD
              </option>
            ))}
          </select>
        </Field>
      </div>

      {/* ── Correction permissions ─────────────────────────────────────────── */}
      <div className="rounded-2xl border border-stone-100 bg-white p-4 shadow-sm space-y-4">
        <h3 className="text-xs font-bold uppercase tracking-widest text-stone-400">
          Correction manuelle
        </h3>

        <p className="text-xs text-stone-400">
          La correction manuelle ne modifie pas le prix calculé automatiquement. Elle ajoute un prix
          corrigé qui remplace le prix affiché dans les rapports.
        </p>

        <Toggle
          checked={allowManualSessionCorrection}
          onChange={setAllowManualSessionCorrection}
          label="Autoriser la correction manuelle"
        />

        {allowManualSessionCorrection && (
          <Toggle
            checked={correctionReasonRequired}
            onChange={setCorrectionReasonRequired}
            label="Raison obligatoire pour correction"
          />
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      {/* Success */}
      {saved && (
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          Paramètres enregistrés.
        </div>
      )}

      {/* Save button */}
      <button
        onClick={() => void handleSave()}
        disabled={saving}
        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-stone-900 py-3 text-sm font-semibold text-white hover:bg-stone-700 disabled:opacity-50"
      >
        {saving ? (
          <RefreshCw className="h-4 w-4 animate-spin" />
        ) : (
          <Save className="h-4 w-4" />
        )}
        {saving ? 'Enregistrement…' : 'Enregistrer les paramètres'}
      </button>
    </div>
  );
}
