import type { ChairStatus } from './types';

export function getStatusLabel(status: ChairStatus): string {
  const map: Record<ChairStatus, string> = {
    IDLE: 'Disponible',
    MAYBE_ACTIVE: 'Démarrage détecté',
    ACTIVE: 'Actif',
    MAYBE_FINISHED: 'Fin possible',
    OFFLINE: 'Hors ligne',
    ERROR: 'Erreur',
    MAINTENANCE: 'Maintenance',
  };
  return map[status] ?? status;
}

export interface StatusStyle {
  /** Card left-border accent class */
  accent: string;
  /** Badge background + text */
  badge: string;
  /** Small dot background */
  dot: string;
  /** Whether the dot should pulse */
  pulse: boolean;
}

export function getStatusStyle(status: ChairStatus): StatusStyle {
  const map: Record<ChairStatus, StatusStyle> = {
    IDLE: {
      accent: 'border-l-emerald-400',
      badge: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
      dot: 'bg-emerald-400',
      pulse: false,
    },
    MAYBE_ACTIVE: {
      accent: 'border-l-amber-400',
      badge: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
      dot: 'bg-amber-400',
      pulse: true,
    },
    ACTIVE: {
      accent: 'border-l-blue-500',
      badge: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200',
      dot: 'bg-blue-500',
      pulse: true,
    },
    MAYBE_FINISHED: {
      accent: 'border-l-orange-400',
      badge: 'bg-orange-50 text-orange-700 ring-1 ring-orange-200',
      dot: 'bg-orange-400',
      pulse: true,
    },
    OFFLINE: {
      accent: 'border-l-red-400',
      badge: 'bg-red-50 text-red-600 ring-1 ring-red-200',
      dot: 'bg-red-400',
      pulse: false,
    },
    ERROR: {
      accent: 'border-l-red-600',
      badge: 'bg-red-100 text-red-700 ring-1 ring-red-300',
      dot: 'bg-red-600',
      pulse: false,
    },
    MAINTENANCE: {
      accent: 'border-l-stone-400',
      badge: 'bg-stone-100 text-stone-600 ring-1 ring-stone-200',
      dot: 'bg-stone-400',
      pulse: false,
    },
  };
  return map[status] ?? map.OFFLINE;
}
