import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, UserPlus } from 'lucide-react';
import { v3, type CabinetUser, type CounterOption, type Role } from '../../lib/api-v3';
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
  // ANA-29: which Metrika counters exist and which are assigned per user.
  const counters = useQuery({ queryKey: ['admin-counters'], queryFn: v3.adminCounters });
  const counterMap = useQuery({ queryKey: ['user-counters'], queryFn: v3.adminUserCounters });
  const counterLabel = (c: CounterOption) =>
    c.name ? `${c.name} (#${c.id})` : c.site ? `${c.site} (#${c.id})` : `#${c.id}`;
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<{
    email: string;
    name: string;
    role: Role;
    counterIds?: number[];
  }>({ email: '', name: '', role: 'analyst' });
  const [secret, setSecret] = useState<{ email: string; password: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /** Invite default for analysts: the configured counter (mirrors the backend default grant). */
  const defaultCounterIds =
    counters.data && counters.data.configured > 0 ? [counters.data.configured] : [];

  const done = () => qc.invalidateQueries({ queryKey: ['users'] });
  const create = useMutation({
    // Untouched selection → omit counterIds so the backend applies its own default
    // (a new analyst gets the configured counter when one is configured).
    mutationFn: () => {
      const { counterIds, ...rest } = form;
      const configured = counters.data?.configured ?? 0;
      const ids = counterIds ?? (form.role === 'analyst' && configured > 0 ? [configured] : null);
      return v3.createUser({ ...rest, ...(ids ? { counterIds: ids } : {}) });
    },
    onSuccess: (r) => {
      setOpen(false);
      setSecret({ email: r.user.email, password: r.temporaryPassword });
      setForm({ email: '', name: '', role: 'analyst' });
      void done();
    },
    onError: (e) =>
      setError(
        e instanceof ApiError && e.status === 409
          ? t('admin.users.emailExists')
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
  const setCounters = useMutation({
    mutationFn: (x: { id: number; counterIds: number[] }) => v3.setUserCounters(x.id, x.counterIds),
    onMutate: () => setNotice(null),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['user-counters'] });
      setError(null);
      setNotice(t('uc.saved'));
    },
    onError: () => {
      setNotice(null);
      setError(t('uc.saveError'));
    },
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
      {counters.data?.metrikaError && <p className="text-xs text-muted">{t('uc.metrikaError')}</p>}
      {notice && (
        <div
          role="status"
          className="card border-green-300 p-3 text-sm text-green-700"
          onClick={() => setNotice(null)}
        >
          {notice}
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
                  <th className="px-3 py-2">{t('uc.column')}</th>
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
                    <td className="px-3 py-2">
                      {u.role === 'admin' || !counters.data ? (
                        <span className="text-muted">{t('uc.all')}</span>
                      ) : !counters.data.counters.length ? (
                        <span className="text-muted">{t('uc.empty')}</span>
                      ) : (
                        <select
                          multiple
                          size={Math.min(4, counters.data.counters.length)}
                          aria-label={t('uc.title')}
                          value={(counterMap.data?.[u.id] ?? []).map(String)}
                          onChange={(e) =>
                            setCounters.mutate({
                              id: u.id,
                              counterIds: [...e.target.selectedOptions].map((o) => Number(o.value)),
                            })
                          }
                          className="input h-auto w-full min-w-40 py-1 text-xs"
                        >
                          {counters.data.counters.map((c) => (
                            <option key={c.id} value={c.id}>
                              {String(c.id === counters.data?.configured ? '• ' : '')}
                              {counterLabel(c)}
                            </option>
                          ))}
                        </select>
                      )}
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
          {form.role === 'analyst' && !!counters.data?.counters.length && (
            <label className="block">
              <span className="label">{t('uc.inviteLabel')}</span>
              <select
                multiple
                size={Math.min(4, counters.data.counters.length)}
                aria-label={t('uc.title')}
                value={(form.counterIds ?? defaultCounterIds).map(String)}
                onChange={(e) =>
                  setForm({
                    ...form,
                    counterIds: [...e.target.selectedOptions].map((o) => Number(o.value)),
                  })
                }
                className="input h-auto w-full py-1 text-xs"
              >
                {counters.data.counters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.id === counters.data?.configured ? '• ' : ''}
                    {counterLabel(c)}
                  </option>
                ))}
              </select>
            </label>
          )}
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
