import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import type { HypothesisStatus } from '@pca/shared';
import { renderWithProviders } from '../../test/utils';
import { setTestLocale } from '../../test/i18n-utils';
import { blankDraft, HypothesisEditor, type HypothesisDraft } from './HypothesisEditor';

/**
 * ANA-181 (round 2): the disabled «Сохранить» must explain itself in EVERY disabled state.
 * The explanation lists the unmet checklist requirements; if the checklist cannot explain
 * the disabled state (a shared-validator rule not mirrored in the checklist — e.g. an
 * out-of-range ICE factor from stored data), the panel still renders with a generic line.
 */

/** Fully valid work-mode draft — the save is enabled and the panel is absent. */
const validDraft = (): HypothesisDraft => ({
  ...blankDraft(),
  subject: 'Подкаст',
  action: 'сократим форму',
  solution: 'один шаг',
  condition: 'CR вырастет',
  title: 'Гипотеза A',
  hiddenAssumptions: [
    { category: 'behavior', text: 'a' },
    { category: 'market', text: 'b' },
    { category: 'tech', text: 'c' },
  ],
  validationMethods: [
    { type: 'quantitative', plan: 'A/B' },
    { type: 'synthetic', plan: 'интервью' },
  ],
  impactRationale: 'i',
  confidenceRationale: 'c',
  easeRationale: 'e',
  greenCriteria: 'g',
  yellowCriteria: 'y',
  redCriteria: 'r',
});

/** One row per unmet requirement: exactly one checklist item broken, everything else met. */
const REQUIREMENT_CASES: ReadonlyArray<{
  readonly name: string;
  readonly line: string;
  readonly draft: HypothesisDraft;
  readonly status?: HypothesisStatus;
}> = [
  {
    name: 'format sentence',
    line: 'Формат: ЦА + действие + решение + условие',
    draft: { ...validDraft(), subject: '' },
  },
  {
    name: 'assumptions count',
    line: '≥3 скрытых допущения',
    draft: { ...validDraft(), hiddenAssumptions: validDraft().hiddenAssumptions.slice(0, 2) },
  },
  {
    name: 'validation methods count',
    line: '≥2 метода проверки',
    draft: { ...validDraft(), validationMethods: validDraft().validationMethods.slice(0, 1) },
  },
  {
    name: 'ICE rationales',
    line: 'Обоснования ICE',
    draft: { ...validDraft(), impactRationale: '' },
  },
  {
    name: 'traffic light criteria',
    line: 'Светофор',
    draft: { ...validDraft(), yellowCriteria: '' },
  },
  {
    name: 'deadline',
    line: 'Дедлайн: целое число дней ≥ 1',
    draft: { ...validDraft(), deadlineDays: 0 },
  },
  {
    name: 'draft title (light rules)',
    line: 'Название',
    status: 'draft',
    draft: { ...blankDraft() },
  },
];

function renderEditor(draft: HypothesisDraft, status: HypothesisStatus = 'in_progress'): void {
  renderWithProviders(
    <HypothesisEditor
      open
      initial={draft}
      heading="Редактирование гипотезы"
      status={status}
      onClose={vi.fn()}
      onSave={vi.fn()}
    />,
  );
}

describe('HypothesisEditor save blockers (ANA-181)', () => {
  afterEach(() => {
    setTestLocale('ru');
  });

  it('a fully valid work draft enables the save and hides the panel', () => {
    renderEditor(validDraft());
    expect(screen.getByTestId('hyp-save')).toBeEnabled();
    expect(screen.queryByTestId('hyp-save-blockers')).not.toBeInTheDocument();
  });

  it.each(REQUIREMENT_CASES)(
    '$name: the save is disabled and the panel lists the unmet requirement',
    ({ line, draft, status = 'in_progress' }) => {
      renderEditor(draft, status);
      expect(screen.getByTestId('hyp-save')).toBeDisabled();
      expect(screen.getByTestId('hyp-save-blockers')).toHaveTextContent(line);
    },
  );

  it('a disabled save the checklist cannot explain still shows the panel (generic line)', () => {
    // Stored data can carry an out-of-range ICE factor the 1–10 range input cannot produce:
    // the shared validator rejects it while every checklist item stays met. The panel must
    // not disappear — otherwise the button is disabled with no explanation (ANA-181 again).
    renderEditor({ ...validDraft(), impact: 42 });
    expect(screen.getByTestId('hyp-save')).toBeDisabled();
    const panel = screen.getByTestId('hyp-save-blockers');
    expect(panel).toHaveTextContent(
      'Кнопка «Сохранить» недоступна — проверьте поля формы: какое-то значение не прошло проверку.',
    );
    // The generic line replaces the checklist — no dangling «заполните:» with an empty list.
    expect(within(panel).queryByRole('list')).not.toBeInTheDocument();
  });

  it('ANA-187: the live format sentence does not double the «если» joiner', () => {
    renderEditor({ ...validDraft(), condition: 'если конверсия ниже 50%' });
    const editor = screen.getByTestId('hypothesis-editor');
    // The stored condition already opens with «если» — the sentence adds only the comma,
    // never a second joiner («…, если если …» / «…, if если …»).
    expect(editor.textContent).toContain(
      'Подкаст сократим форму один шаг, если конверсия ниже 50%',
    );
    expect(editor.textContent).not.toContain(', если если');
    expect(editor.textContent).not.toContain(', if если');
  });
});
