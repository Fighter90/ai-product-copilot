import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, UserPlus } from 'lucide-react';
import { v3, type CabinetUser, type Role } from '../../lib/api-v3';
import { useT, fmtDate } from '../../i18n';
import { Card, ErrorBox, Modal, PageHeader, Pill, Skeleton } from '../../components/ui';
import { ApiError } from '../../lib/api';
import { useAuth } from '../../auth/AuthContext';

/** Admin: users and roles (create, change role, enable/disable, reset password). */
export function Users(): JSX.Element {
  const { t, locale } = useT();
  const qc = useQueryClient();
  const { user: me } = useAuth();
  const q = useQuery({ queryKey: ['users'], queryFn: v3.users });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<{ email: string; name: string; role: Role }>({
    email: '',
    name: '',
    role: 'analyst',
  });
  const [secret, setSecret] = useState<{ email: string; password: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const done = () => qc.invalidateQueries({ queryKey: ['users'] });
  const create = useMutation({
    mutationFn: () => v3.createUser(form),
    onSuccess: (r) => {
      setOpen(false);
      setSecret({ email: r.user.email, password: r.temporaryPassword });
      setForm({ email: '', name: '', role: 'analyst' });
      void done();
    },
    onError: (e) =>
      setError(
        e instanceof ApiError && e.status === 409
          ? 'Email уже существует'
          : String((e as Error).message),
      ),
  });
  const update = useMutation({
    mutationFn: (x: { id: number; patch: { role?: Role; isActive?: boolean } }) =>
      v3.updateUser(x.id, x.patch),
    onSuccess: () => void done(),
    onError: (e) =>
      setError(
        e instanceof ApiError && e.status === 409
          ? t('admin.users.lastAdmin')
          : String((e as Error).message),
      ),
  });
  const reset = useMutation({
    mutationFn: (u: CabinetUser) =>
      v3.resetPassword(u.id).then((r) => ({ email: u.email, password: r.temporaryPassword })),
    onSuccess: (r) => setSecret(r),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t('nav.section.admin')}
        title={t('admin.users.title')}
        subtitle={t('admin.users.subtitle')}
        actions={
          <button type="button" className="btn-primary" onClick={() => setOpen(true)}>
            <UserPlus className="h-4 w-4" /> {t('admin.users.invite')}
          </button>
        }
      />
      {error && (
        <div
          role="alert"
          className="card border-red-300 p-3 text-sm text-red-700"
          onClick={() => setError(null)}
        >
          {error}
        </div>
      )}
      {secret && (
        <Card className="border-accent/50">
          <div className="text-sm">
            {t('admin.users.tempPassword')} — <b>{secret.email}</b>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <code className="rounded-md bg-raised px-3 py-2 font-mono text-lg tracking-wider">
              {secret.password}
            </code>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => void navigator.clipboard?.writeText(secret.password)}
            >
              {t('common.copy')}
            </button>
            <button type="button" className="btn-ghost" onClick={() => setSecret(null)}>
              {t('common.close')}
            </button>
          </div>
        </Card>
      )}
      <Card>
        {q.isLoading && <Skeleton className="h-48" />}
        {q.error && <ErrorBox error={q.error} />}
        {q.data && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-2">{t('admin.users.name')}</th>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">{t('admin.users.role')}</th>
                  <th className="px-3 py-2">{t('admin.users.status')}</th>
                  <th className="px-3 py-2">{t('admin.users.lastLogin')}</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {q.data.map((u) => (
                  <tr key={u.id} className="border-t border-line">
                    <td className="px-3 py-2 font-medium">
                      {u.name} {u.id === me?.id && <Pill tone="accent">you</Pill>}
                    </td>
                    <td className="px-3 py-2 text-muted">{u.email}</td>
                    <td className="px-3 py-2">
                      <select
                        value={u.role}
                        aria-label={t('admin.users.role')}
                        onChange={(e) =>
                          update.mutate({ id: u.id, patch: { role: e.target.value as Role } })
                        }
                        className="input w-auto py-1"
                      >
                        <option value="admin">{t('role.admin')}</option>
                        <option value="analyst">{t('role.analyst')}</option>
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <Pill tone={u.isActive ? 'green' : 'neutral'}>
                        {u.isActive ? t('admin.users.active') : t('admin.users.disabled')}
                      </Pill>
                    </td>
                    <td className="px-3 py-2 text-muted">
                      {u.lastLoginAt ? fmtDate(u.lastLoginAt, locale, true) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          className="btn-ghost px-2 py-1 text-xs"
                          onClick={() => reset.mutate(u)}
                        >
                          <KeyRound className="h-3.5 w-3.5" /> {t('admin.users.reset')}
                        </button>
                        <button
                          type="button"
                          className="btn-ghost px-2 py-1 text-xs"
                          onClick={() =>
                            update.mutate({ id: u.id, patch: { isActive: !u.isActive } })
                          }
                        >
                          {u.isActive ? t('admin.users.disable') : t('admin.users.enable')}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={open} title={t('admin.users.invite')} onClose={() => setOpen(false)}>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            create.mutate();
          }}
        >
          <label className="block">
            <span className="label">{t('admin.users.name')}</span>
            <input
              className="input"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="label">Email</span>
            <input
              className="input"
              type="email"
              required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="label">{t('admin.users.role')}</span>
            <select
              className="input"
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
            >
              <option value="analyst">{t('role.analyst')}</option>
              <option value="admin">{t('role.admin')}</option>
            </select>
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn-primary" disabled={create.isPending}>
              {t('common.save')}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
