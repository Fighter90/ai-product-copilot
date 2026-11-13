import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import type { Hypothesis } from '@pca/shared';
import { renderWithProviders } from '../../test/utils';
import { setTestLocale } from '../../test/i18n-utils';
import { HypothesisViewModal } from './HypothesisViewModal';

/** ANA-152: the read-only «Посмотреть» popup renders the FULL hypothesis — every section,
    evidence fallbacks (note → slice → type) and the «Редактировать» hand-off. */

const h = (over: Partial<Hypothesis>): Hypothesis =>
  ({
    id: 1,
    diamondPhase: 'define',
    kind: 'problem',
    subject: 'Подкаст',
    action: 'сократим форму',
    solution: 'один шаг',
    condition: 'CR вырастет',
    title: 'Подкаст: низкая конверсия',
    description: 'Подкаст испытывает низкую конверсию при записи, потому что форма длинная.',
    hiddenAssumptions: [
      { category: 'behavior', text: 'слушатели ленятся заполнять' },
      { category: 'market', text: 'конкуренты уже упростили форму' },
      { category: 'tech', text: 'форма переиспользуется с лендинга' },
    ],
    validationMethods: [
      { type: 'quantitative', plan: 'A/B-тест формы' },
      { type: 'synthetic', plan: '5 интервью с пользователями' },
    ],
    impact: 7,
    confidence: 5,
    ease: 8,
    impactRationale: 'много визитов с низкой конверсией',
    confidenceRationale: 'данные Метрики подтверждают',
    easeRationale: 'готовый блок формы',
    greenCriteria: 'CR ≥ 5% за 2 недели',
    yellowCriteria: '',
    redCriteria: 'CR < 3%',
    deadlineDays: 14,
    evidence: [
      { type: 'ai', note: 'CR 0,7%' },
      { type: 'dashboard', slice: 'snapshot:snap-1' },
    ],
    iceScore: 280,
    status: 'in_progress',
    source: 'ai',
    aiProvider: 'openrouter',
    aiModel: 'claude-sonnet-4-6',
    unverifiedNumbers: ['5123'],
    deadlineAt: '2026-11-10T00:00:00.000Z',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...over,
  }) as Hypothesis;

describe('HypothesisViewModal (ANA-152)', () => {
  afterEach(() => setTestLocale('ru'));

  it('renders the complete hypothesis: all testids, evidence fallbacks, ICE rationales, traffic light', () => {
    const full = h({});
    const onClose = vi.fn();
    const onEdit = vi.fn();
    renderWithProviders(
      <HypothesisViewModal hypothesis={full} onClose={onClose} onEdit={onEdit} />,
    );

    const modal = screen.getByTestId('hyp-view-modal');
    expect(screen.getByRole('heading', { name: 'Гипотеза' })).toBeInTheDocument();
    expect(screen.getByTestId('hyp-view-title')).toHaveTextContent('Подкаст: низкая конверсия');
    expect(modal).toHaveTextContent('Проблема'); // kind pill
    expect(modal).toHaveTextContent('В проверке'); // status pill
    expect(modal).toHaveTextContent('AI'); // provenance badge
    expect(modal).toHaveTextContent(/цифры не из среза/); // unverified-numbers warning
    // The format sentence (ANA-24 style), not just a small heading.
    expect(modal).toHaveTextContent('Подкаст сократим форму один шаг, если CR вырастет');
    expect(within(modal).getAllByText('Описание').length).toBeGreaterThan(0);
    expect(modal).toHaveTextContent('испытывает низкую конверсию');

    // Evidence list: note first, slice fallback for the note-less item.
    expect(modal).toHaveTextContent('CR 0,7%');
    expect(modal).toHaveTextContent('snapshot:snap-1');

    // ICE = I×C×E with the rationales that were tooltip-only on the card (7·5·8 = 280).
    expect(modal).toHaveTextContent('ICE = 280');
    expect(within(modal).getAllByText('Обоснование').length).toBe(3);
    expect(modal).toHaveTextContent('много визитов с низкой конверсией');

    // Assumptions, validation methods, deadline.
    expect(modal).toHaveTextContent('Скрытые допущения');
    expect(modal).toHaveTextContent('слушатели ленятся заполнять');
    expect(modal).toHaveTextContent('Методы проверки');
    expect(modal).toHaveTextContent('A/B-тест формы');
    expect(modal).toHaveTextContent('14 дн.');

    // Traffic light: empty «Жёлтый» criterion is filtered out, green + red render.
    expect(modal).toHaveTextContent('CR ≥ 5% за 2 недели');
    expect(modal).toHaveTextContent('CR < 3%');
    expect(within(modal).queryByText(/Жёлтый/)).not.toBeInTheDocument();

    // «Редактировать» hands the SAME hypothesis to the editor; «Закрыть» closes.
    fireEvent.click(within(modal).getByTestId('hyp-view-edit'));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledWith(full);
    fireEvent.click(within(modal).getByTestId('hyp-view-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a minimal hypothesis renders dashes instead of empty fields and omits empty sections', () => {
    const onClose = vi.fn();
    const onEdit = vi.fn();
    renderWithProviders(
      <HypothesisViewModal
        hypothesis={h({
          title: 'Минимум',
          subject: '',
          action: '',
          solution: '',
          condition: '',
          description: undefined,
          hiddenAssumptions: [],
          validationMethods: [],
          impact: 0,
          confidence: 0,
          ease: 0,
          impactRationale: '',
          confidenceRationale: '',
          easeRationale: '',
          greenCriteria: '',
          yellowCriteria: '',
          redCriteria: '',
          evidence: undefined,
          source: undefined,
          aiProvider: undefined,
          aiModel: undefined,
          unverifiedNumbers: undefined,
        })}
        onClose={onClose}
        onEdit={onEdit}
      />,
    );

    const modal = screen.getByTestId('hyp-view-modal');
    expect(screen.getByTestId('hyp-view-title')).toHaveTextContent('Минимум');
    // No sentence block, no «Описание» row (description undefined), no provenance badges.
    expect(modal.textContent).not.toContain('Подкаст');
    expect(within(modal).queryByText('Описание')).not.toBeInTheDocument();
    expect(within(modal).queryByText('AI')).not.toBeInTheDocument();
    // Every format field renders the em-dash placeholder.
    expect(within(modal).getAllByText('—').length).toBe(4);
    // Empty sections are omitted entirely.
    expect(within(modal).queryByText('Доказательства')).not.toBeInTheDocument();
    expect(within(modal).queryByText('Скрытые допущения')).not.toBeInTheDocument();
    expect(within(modal).queryByText('Методы проверки')).not.toBeInTheDocument();
    expect(within(modal).queryByText('Светофор')).not.toBeInTheDocument();
    // ICE legend stays visible with the empty product; no rationale paragraphs.
    expect(modal).toHaveTextContent('ICE = 0');
    expect(within(modal).queryByText('Обоснование')).not.toBeInTheDocument();
  });

  it('an empty-string description stays hidden; note-less AND slice-less evidence falls back to its type', () => {
    renderWithProviders(
      <HypothesisViewModal
        hypothesis={h({
          title: 'Пустое описание',
          description: '',
          evidence: [{ type: 'dashboard' }],
        })}
        onClose={vi.fn()}
        onEdit={vi.fn()}
      />,
    );

    const modal = screen.getByTestId('hyp-view-modal');
    // description: '' — defined but blank → the row is still hidden.
    expect(within(modal).queryByText('Описание')).not.toBeInTheDocument();
    // evidence item without note/slice shows its type as the last fallback.
    expect(within(modal).getByText('Доказательства')).toBeInTheDocument();
    expect(within(modal).getByText('dashboard')).toBeInTheDocument();
  });
});
