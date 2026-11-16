import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { v3, type CabinetUser } from '../lib/api-v3';
import { useT } from '../i18n';
import { usePrefs } from '../store/prefs';
import { Modal } from './ui';

/** Ограничения бэкенда PATCH /api/auth/me: `name: z.string().min(1).max(80)`. */
const NAME_MIN = 1;
const NAME_MAX = 80;

/**
 * «Изменить профиль» (ANA-182): имя + язык интерфейса, сохранение через PATCH /api/auth/me —
 * то, что обещает docs/user-guide.md рядом со «Сменить пароль». Успех пишется в кеш сессии
 * `['auth','me']` (как AuthContext.login), поэтому шапка обновляется без повторного запроса;
 * выбранный язык применяется мгновенно через prefs (без перезагрузки страницы).
 */
export function EditProfileModal({
  open,
  onClose,
  user,
}: {
  open: boolean;
  onClose: () => void;
  user: CabinetUser;
}): JSX.Element | null {
  const { t } = useT();
  const qc = useQueryClient();
  const setLocale = usePrefs((s) => s.setLocale);
  const [name, setName] = useState(user.name);
  const [locale, setLocaleDraft] = useState<'ru' | 'en'>(user.locale);
  const [touched, setTouched] = useState(false);
  const save = useMutation({
    mutationFn: () => v3.updateMe({ name: name.trim(), locale }),
    onSuccess: (res) => {
      qc.setQueryData(['auth', 'me'], res.user);
      if (res.user.locale) setLocale(res.user.locale);
    },
  });

  const trimmed = name.trim();
  const invalid = trimmed.length < NAME_MIN || trimmed.length > NAME_MAX;

  const close = (): void => {
    setName(user.name);
    setLocaleDraft(user.locale);
    setTouched(false);
    save.reset();
    onClose();
  };

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    setTouched(true);
    if (invalid || save.isPending) return;
    save.mutate();
  };

  const errorText =
    touched && invalid ? t('prof.edit.errName') : save.isError ? t('prof.edit.errFailed') : '';

  return (
    <Modal open={open} title={t('prof.editProfile')} onClose={close}>
      {save.isSuccess ? (
        <div className="space-y-4">
          <p role="status" className="text-sm text-green-700">
            {t('prof.edit.success')}
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
            <span className="label">{t('prof.edit.name')}</span>
            <input
              className="input"
              type="text"
              autoComplete="name"
              maxLength={NAME_MAX + 1}
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={touched && invalid ? true : undefined}
            />
            <span className="mt-1 block text-xs text-muted">{t('prof.edit.nameHint')}</span>
          </label>
          <div>
            <span className="label">{t('prof.edit.locale')}</span>
            <div role="radiogroup" aria-label={t('prof.edit.locale')} className="mt-1 flex gap-4">
              {(['ru', 'en'] as const).map((l) => (
                <label key={l} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="radio"
                    name="profile-locale"
                    value={l}
                    checked={locale === l}
                    onChange={() => setLocaleDraft(l)}
                  />
                  {t(l === 'ru' ? 'prof.edit.langRu' : 'prof.edit.langEn')}
                </label>
              ))}
            </div>
          </div>
          {errorText && (
            <p role="alert" className="text-sm text-red-700">
              {errorText}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className="btn-ghost" onClick={close}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn-primary" disabled={save.isPending}>
              {save.isPending ? t('prof.edit.saving') : t('common.save')}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
