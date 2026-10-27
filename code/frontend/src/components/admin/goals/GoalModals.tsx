import { useEffect, useState } from 'react';
import { Modal, ErrorBox } from '../../ui';
import { useT } from '../../../i18n';
import type { GoalPreview, GoalRefView } from '../../../lib/api-v3';

/** Typed confirmation word required by the backend for any archive. */
// i18n: ignore — protocol word validated server-side (z.literal('АРХИВ'))
export const ARCHIVE_WORD = 'АРХИВ';

/** Shows exactly the JSON that will be POSTed to Metrika; writes only on explicit confirm. */
export function GoalPreviewModal({
  preview,
  pending,
  error,
  onConfirm,
  onClose,
}: {
  preview: GoalPreview | null;
  pending: boolean;
  error: unknown;
  onConfirm: () => void;
  onClose: () => void;
}): JSX.Element | null {
  const { t } = useT();
  return (
    <Modal open={!!preview} title={t('admin.goals.previewTitle')} onClose={onClose}>
      {preview && (
        <>
          <p className="mb-2 font-mono text-xs text-muted">
            {preview.method} {preview.path}
          </p>
          <pre
            data-testid="goal-preview-json"
            className="max-h-72 overflow-auto rounded bg-raised p-3 text-xs"
          >
            {JSON.stringify(preview.body, null, 2)}
          </pre>
          <p className="mt-2 text-xs text-muted">{t('admin.goals.previewHint')}</p>
          {!!error && (
            <div className="mt-3">
              <ErrorBox error={error} />
            </div>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button type="button" className="btn-primary" disabled={pending} onClick={onConfirm}>
              {t('admin.goals.confirmCreate')}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

/** Bulk archive confirmation: lists the goals and unlocks only after typing АРХИВ. */
export function ArchiveConfirmModal({
  goals,
  pending,
  error,
  onConfirm,
  onClose,
}: {
  goals: GoalRefView[] | null;
  pending: boolean;
  error: unknown;
  onConfirm: (word: string) => void;
  onClose: () => void;
}): JSX.Element | null {
  const { t } = useT();
  const [word, setWord] = useState('');
  useEffect(() => setWord(''), [goals]);
  const hasRef = !!goals?.some((g) => g.reference);
  return (
    <Modal open={!!goals} title={t('admin.goals.archiveTitle')} onClose={onClose}>
      {goals && (
        <>
          <ul className="mb-3 max-h-48 overflow-auto text-sm">
            {goals.map((g) => (
              <li key={g.id}>
                <span className="font-mono text-xs text-muted">#{g.id}</span> {g.name}
                {g.reference && (
                  <span className="ml-1 text-xs text-amber-700">({g.reference})</span>
                )}
              </li>
            ))}
          </ul>
          {hasRef && (
            <p className="mb-2 text-sm text-amber-700">{t('admin.goals.archiveRefWarn')}</p>
          )}
          <p className="mb-2 text-sm">
            {t('admin.goals.archiveHint')}{' '}
            <code className="rounded bg-raised px-1">{ARCHIVE_WORD}</code>
          </p>
          <input
            className="input"
            aria-label={ARCHIVE_WORD}
            value={word}
            onChange={(e) => setWord(e.target.value)}
          />
          {!!error && (
            <div className="mt-3">
              <ErrorBox error={error} />
            </div>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="btn-danger"
              disabled={word !== ARCHIVE_WORD || pending}
              onClick={() => onConfirm(word)}
            >
              {t('admin.goals.confirmArchive')}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

/** Restore confirmation (restore is a write too — never fired without a click here). */
export function RestoreConfirmModal({
  goalId,
  pending,
  error,
  onConfirm,
  onClose,
}: {
  goalId: number | null;
  pending: boolean;
  error: unknown;
  onConfirm: () => void;
  onClose: () => void;
}): JSX.Element | null {
  const { t } = useT();
  return (
    <Modal open={goalId !== null} title={t('admin.goals.restoreTitle')} onClose={onClose}>
      <p className="text-sm">{t('admin.goals.restoreConfirm', { id: goalId ?? '' })}</p>
      {!!error && (
        <div className="mt-3">
          <ErrorBox error={error} />
        </div>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button type="button" className="btn-primary" disabled={pending} onClick={onConfirm}>
          {t('admin.goals.restore')}
        </button>
      </div>
    </Modal>
  );
}
