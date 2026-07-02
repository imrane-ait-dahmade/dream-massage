'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getMe, type AuthUser, type UserRole } from '@/lib/api';

interface AuthGuardProps {
  children: React.ReactNode;
  /** Roles allowed on this route. Defaults to OWNER + ADMIN. */
  allowedRoles?: UserRole[];
  /** Where to send users with the wrong role (defaults by role). */
  wrongRolePath?: string;
}

export function AuthGuard({
  children,
  allowedRoles = ['OWNER', 'ADMIN'],
  wrongRolePath,
}: AuthGuardProps) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  const rolesKey = allowedRoles.join(',');

  useEffect(() => {
    getMe()
      .then((user) => {
        if (!allowedRoles.includes(user.role)) {
          const dest =
            wrongRolePath ??
            (user.role === 'ASSISTANT' ? '/assistant' : '/');
          router.replace(dest);
          return;
        }
        setReady(true);
      })
      .catch(() => router.replace('/login'));
  }, [router, rolesKey, wrongRolePath, allowedRoles]);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-stone-50">
        <p className="text-sm text-stone-400">Vérification…</p>
      </div>
    );
  }

  return <>{children}</>;
}

export type { AuthUser };
