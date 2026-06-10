'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react';
import type { SettingsChair } from '@/lib/types';
import { updateChair, updateChairDetectionConfig } from '@/lib/api';

// ── Inline alert ───────────────────────────────────────────────────────────────

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

// ── Number field ──────────────────────────────────────────────────────────────

function NumField({
  label,
  value,
  onChange,
  min,
  step,
  unit,
}: {
  label: string;
  value: number | string;
  onChange: (v: string) => void;
  min?: number;
  step?: number;
  unit?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <label className="text-xs text-stone-500">{label}</label>
      <div className="flex items-center gap-1">
        <input
          type="number"
          min={min ?? 0}
          step={step ?? 1}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-1.5 text-sm text-stone-900 outline-none focus:border-stone-400 focus:ring-0"
        />
        {unit && <span className="shrink-0 text-xs text-stone-400">{unit}</span>}
      </div>
    </div>
  );
}

// ── Detection config form ──────────────────────────────────────────────────────

interface DetectionForm {
  startThresholdWatts: string;
  stopThresholdWatts: string;
  startConfirmSeconds: string;
  stopConfirmSeconds: string;
  activationDelaySeconds: string;
  baselinePowerWatts: string;
}

function DetectionConfigSection({
  chairId,
  config,
  onSaved,
}: {
  chairId: string;
  config: SettingsChair['detectionConfig'];
  onSaved: () => void;
}) {
  const [form, setForm] = useState<DetectionForm>({
    startThresholdWatts: String(config?.startThresholdWatts ?? 10),
    stopThresholdWatts: String(config?.stopThresholdWatts ?? 5),
    startConfirmSeconds: String(config?.startConfirmSeconds ?? 30),
    stopConfirmSeconds: String(config?.stopConfirmSeconds ?? 60),
    activationDelaySeconds: String(config?.activationDelaySeconds ?? 0),
    baselinePowerWatts: String(config?.baselinePowerWatts ?? ''),
  });
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  const set = (k: keyof DetectionForm) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  function validate(): string | null {
    const start = parseFloat(form.startThresholdWatts);
    const stop = parseFloat(form.stopThresholdWatts);
    const startSec = parseInt(form.startConfirmSeconds, 10);
    const stopSec = parseInt(form.stopConfirmSeconds, 10);
    const delay = parseInt(form.activationDelaySeconds, 10);
    if (isNaN(start) || start < 0) return 'Seuil de démarrage invalide';
    if (isNaN(stop) || stop < 0) return 'Seuil d\'arrêt invalide';
    if (start <= stop) return 'Le seuil de démarrage doit être supérieur au seuil d\'arrêt';
    if (!Number.isInteger(startSec) || startSec <= 0) return 'Confirmation démarrage doit être > 0 s';
    if (!Number.isInteger(stopSec) || stopSec <= 0) return 'Confirmation arrêt doit être > 0 s';
    if (!Number.isInteger(delay) || delay < 0) return 'Délai d\'activation invalide';
    return null;
  }

  async function handleSave() {
    const err = validate();
    if (err) { setFeedback({ type: 'error', msg: err }); return; }
    setSaving(true);
    setFeedback(null);
    try {
      const baseline = form.baselinePowerWatts.trim() === '' ? null : parseFloat(form.baselinePowerWatts);
      await updateChairDetectionConfig(chairId, {
        startThresholdWatts: parseFloat(form.startThresholdWatts),
        stopThresholdWatts: parseFloat(form.stopThresholdWatts),
        startConfirmSeconds: parseInt(form.startConfirmSeconds, 10),
        stopConfirmSeconds: parseInt(form.stopConfirmSeconds, 10),
        activationDelaySeconds: parseInt(form.activationDelaySeconds, 10),
        baselinePowerWatts: baseline,
      });
      setFeedback({ type: 'success', msg: 'Configuration mise à jour (v' + ((config?.version ?? 0) + 1) + ')' });
      onSaved();
    } catch (e) {
      setFeedback({ type: 'error', msg: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-3 space-y-3 border-t border-stone-100 pt-3">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-700">
        <AlertTriangle className="h-3.5 w-3.5" />
        <span>Ces paramètres s&apos;appliquent aux prochaines détections uniquement.</span>
      </div>

      {config && (
        <p className="text-xs text-stone-400">Version actuelle : v{config.version}</p>
      )}

      <div className="grid grid-cols-2 gap-2">
        <NumField label="Seuil démarrage" value={form.startThresholdWatts} onChange={set('startThresholdWatts')} min={0} step={0.5} unit="W" />
        <NumField label="Seuil d'arrêt" value={form.stopThresholdWatts} onChange={set('stopThresholdWatts')} min={0} step={0.5} unit="W" />
        <NumField label="Confirmation démarrage" value={form.startConfirmSeconds} onChange={set('startConfirmSeconds')} min={1} unit="s" />
        <NumField label="Confirmation arrêt" value={form.stopConfirmSeconds} onChange={set('stopConfirmSeconds')} min={1} unit="s" />
        <NumField label="Délai d'activation" value={form.activationDelaySeconds} onChange={set('activationDelaySeconds')} min={0} unit="s" />
        <NumField label="Puissance de veille" value={form.baselinePowerWatts} onChange={set('baselinePowerWatts')} min={0} step={0.1} unit="W" />
      </div>

      {feedback && <Alert type={feedback.type} msg={feedback.msg} />}

      <button
        onClick={() => void handleSave()}
        disabled={saving}
        className="rounded-lg bg-stone-900 px-4 py-2 text-xs font-semibold text-white transition-opacity disabled:opacity-50"
      >
        {saving ? 'Enregistrement…' : 'Enregistrer la config'}
      </button>
    </div>
  );
}

// ── Chair info form ────────────────────────────────────────────────────────────

interface ChairInfoForm {
  displayName: string;
  isEnabled: boolean;
}

// ── Main card ──────────────────────────────────────────────────────────────────

export function ChairSettingsCard({
  chair,
  onSaved,
}: {
  chair: SettingsChair;
  onSaved: () => void;
}) {
  const [infoForm, setInfoForm] = useState<ChairInfoForm>({
    displayName: chair.displayName ?? '',
    isEnabled: chair.isEnabled,
  });
  const [savingInfo, setSavingInfo] = useState(false);
  const [infoFeedback, setInfoFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [showDetection, setShowDetection] = useState(false);

  async function handleSaveInfo() {
    setSavingInfo(true);
    setInfoFeedback(null);
    try {
      await updateChair(chair.id, {
        displayName: infoForm.displayName.trim() || undefined,
        isEnabled: infoForm.isEnabled,
      });
      setInfoFeedback({ type: 'success', msg: 'Fauteuil mis à jour' });
      onSaved();
    } catch (e) {
      setInfoFeedback({ type: 'error', msg: (e as Error).message });
    } finally {
      setSavingInfo(false);
    }
  }

  const statusColor = chair.isOnline ? 'bg-emerald-400' : 'bg-stone-300';

  return (
    <div className="rounded-2xl border border-stone-100 bg-white p-4 shadow-sm">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className={`h-2.5 w-2.5 rounded-full ${statusColor}`} />
          <div>
            <p className="font-semibold text-stone-900">{chair.name}</p>
            <p className="text-xs text-stone-400">{chair.currentPowerWatts.toFixed(1)} W</p>
          </div>
        </div>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${chair.isEnabled ? 'bg-emerald-50 text-emerald-700' : 'bg-stone-100 text-stone-500'}`}>
          {chair.isEnabled ? 'Actif' : 'Désactivé'}
        </span>
      </div>

      {/* Masked device ID */}
      {chair.shellyDeviceIdMasked && (
        <p className="mt-1.5 text-xs text-stone-400">
          Shelly: <span className="font-mono">{chair.shellyDeviceIdMasked}</span>
        </p>
      )}

      {/* Editable fields */}
      <div className="mt-3 space-y-2.5">
        <div className="flex flex-col gap-0.5">
          <label className="text-xs text-stone-500">Nom affiché</label>
          <input
            type="text"
            value={infoForm.displayName}
            onChange={(e) => setInfoForm((f) => ({ ...f, displayName: e.target.value }))}
            placeholder={chair.name}
            className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-1.5 text-sm text-stone-900 outline-none focus:border-stone-400"
          />
        </div>

        <label className="flex cursor-pointer items-center gap-2.5">
          <div
            onClick={() => setInfoForm((f) => ({ ...f, isEnabled: !f.isEnabled }))}
            className={`relative h-5 w-9 rounded-full transition-colors ${infoForm.isEnabled ? 'bg-emerald-500' : 'bg-stone-300'}`}
          >
            <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${infoForm.isEnabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
          </div>
          <span className="text-sm text-stone-700">Fauteuil activé</span>
        </label>
      </div>

      {infoFeedback && <div className="mt-2"><Alert type={infoFeedback.type} msg={infoFeedback.msg} /></div>}

      <button
        onClick={() => void handleSaveInfo()}
        disabled={savingInfo}
        className="mt-3 w-full rounded-lg bg-stone-900 py-2 text-xs font-semibold text-white transition-opacity disabled:opacity-50"
      >
        {savingInfo ? 'Enregistrement…' : 'Enregistrer'}
      </button>

      {/* Detection config toggle */}
      <button
        onClick={() => setShowDetection((v) => !v)}
        className="mt-3 flex w-full items-center justify-between rounded-lg border border-stone-200 px-3 py-2 text-xs font-medium text-stone-600 transition-colors hover:bg-stone-50"
      >
        <span>Seuils de détection{chair.detectionConfig ? ` — v${chair.detectionConfig.version}` : ' (non configuré)'}</span>
        {showDetection ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>

      {showDetection && (
        <DetectionConfigSection chairId={chair.id} config={chair.detectionConfig} onSaved={onSaved} />
      )}
    </div>
  );
}
