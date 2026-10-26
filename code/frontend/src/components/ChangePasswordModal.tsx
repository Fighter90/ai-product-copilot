import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { v3 } from '../lib/api-v3';
import { useT, type DictKey } from '../i18n';
import {
  PASSWORD_MAX,
  PASSWORD_MIN,
  passwordApiError,
  validatePasswordChange,
  type PasswordChangeError,
} from '../lib/password-policy';
import { Modal } from './ui';

const VALIDATION_KEY: Record<PasswordChangeError, DictKey> = {
  current: 'prof.pw.errCurrent',
  short: 'prof.pw.errShort',
  long: 'prof.pw.errLong',
  mismatch: 'prof.pw.errMismatch',
};
const API_KEY: Record<ReturnType<typeof passwordApiError>, DictKey> = {
  wrong: 'prof.pw.errWrong',
  weak: 'prof.pw.errShort',
  failed: 'prof.pw.errFailed',
};

/**
 * «Сменить пароль» — current / new / confirm, validated against the backend policy before the
 * request (POST /api/auth/password). The backend revokes other sessions and re-issues the cookie
 * for this device, so the user stays signed in.
 */
export function ChangePasswordModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): JSX.Element | null {
  const { t } = useT();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [touched, setTouched] = useState(false);
  const change = useMutation({ mutationFn: () => v3.changePassword(current, next) });

  const invalid = validatePasswordChange({ current, next, confirm });
  const vars = { min: PASSWORD_MIN, max: PASSWORD_MAX };

  const close = (): void => {
    setCurrent('');
    setNext('');
    setConfirm('');
    setTouched(false);
    change.reset();
    onClose();
  };

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    setTouched(true);
    if (invalid || change.isPending) return;
    change.mutate();
  };

  const errorText =
    touched && invalid
      ? t(VALIDATION_KEY[invalid], vars)
      : change.isError
        ? t(API_KEY[passwordApiError(change.error)], vars)
        : '';

  return (
    <Modal open={open} title={t('prof.changePassword')} onClose={close}>
      {change.isSuccess ? (
        <div className="space-y-4">
          <p role="status" className="text-sm text-green-700">
            {t('prof.pw.success')}
          </p>
          <div className="flex justify-end">
            <button type="button" className="btn-primary" onClick={close}>
              {t('common.close')}
            </button>
          </div>
        </div>
      ) : (
        <form className="space-y-3" onSubmit={submit} noValidate>
          <label className="block">
            <span className="label">{t('prof.pw.current')}</span>
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              aria-invalid={touched && invalid === 'current' ? true : undefined}
            />
          </label>
          <label className="block">
            <span className="label">{t('prof.pw.next')}</span>
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              value={next}
              maxLength={PASSWORD_MAX + 1}
              onChange={(e) => setNext(e.target.value)}
              aria-describedby="pw-hint"
              aria-invalid={
                touched && (invalid === 'short' || invalid === 'long') ? true : undefined
              }
            />
            <span id="pw-hint" className="mt-1 block text-xs text-muted">
              {t('prof.pw.hint', vars)}
            </span>
          </label>
          <label className="block">
            <span className="label">{t('prof.pw.confirm')}</span>
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              aria-invalid={touched && invalid === 'mismatch' ? true : undefined}
            />
          </label>
          {errorText && (
            <p role="alert" className="text-sm text-red-700">
              {errorText}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className="btn-ghost" onClick={close}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn-primary" disabled={change.isPending}>
              {change.isPending ? t('prof.pw.saving') : t('prof.changePassword')}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
