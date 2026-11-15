import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../test/utils';
import { setTestLocale } from '../../test/i18n-utils';

vi.mock('../../lib/api-v3', () => ({
  v3: {
    settings: vi.fn(),
    saveSettings: vi.fn(),
  },
}));
import { v3, type SettingView } from '../../lib/api-v3';
import { GoalSettingsCard } from './Metrika';

const settings = (kpiTarget: string, eventDate: string): Record<string, SettingView> => ({
  KPI_TARGET: { value: kpiTarget, isSecret: false, source: 'db' },
  EVENT_DATE: { value: eventDate, isSecret: false, source: 'db' },
});

/** ANA-166: карточка цели в админке — SMART-формулировка + сброс после дедлайна (кнопка/авто). */
describe('GoalSettingsCard (ANA-166)', () => {
  beforeEach(() => {
    setTestLocale('ru');
    vi.mocked(v3.saveSettings).mockResolvedValue({ ok: true, changed: [] });
  });

  // «today» передаётся явно (тот же паттерн, что OverviewView/GoalsView) — тесты не зависят
  // от часов машины и не сломаются после июня 2027.
  it('shows the SMART statement of the saved goal (target + deadline)', async () => {
    vi.mocked(v3.settings).mockResolvedValue(settings('300', '2027-06-01'));
    renderWithProviders(<GoalSettingsCard today="2026-01-01" />);
    const preview = await screen.findByTestId('goal-smart-preview');
    // Admin preview has no progress — S+M+T only.
    expect(preview).toHaveTextContent('Достичь ≥300 платных билетов к 01.06.2027.');
    expect(preview).not.toHaveTextContent('осталось');
  });

  it('after the deadline: expired pill + enabled reset button (авто-состояние + кнопка)', async () => {
    vi.mocked(v3.settings).mockResolvedValue(settings('300', '2025-01-01'));
    renderWithProviders(<GoalSettingsCard today="2025-06-01" />);
    await screen.findByTestId('goal-settings-card');
    expect(screen.getByTestId('goal-expired-pill')).toBeInTheDocument();
    expect(screen.getByTestId('goal-reset-btn')).toBeEnabled();
    // The expired variant names the goal — and invents no «0 из 300»: the admin card has no
    // paid data, so the final count must not be fabricated (anti-hallucination).
    expect(screen.getByTestId('goal-smart-preview')).toHaveTextContent(
      'Дедлайн 01.01.2025 прошёл: цель — 300 платных билетов.',
    );
    expect(screen.getByTestId('goal-smart-preview').textContent).not.toContain('0 из');
  });

  it('before the deadline: no pill, reset disabled', async () => {
    vi.mocked(v3.settings).mockResolvedValue(settings('300', '2027-06-01'));
    renderWithProviders(<GoalSettingsCard today="2026-01-01" />);
    await screen.findByTestId('goal-settings-card');
    expect(screen.queryByTestId('goal-expired-pill')).toBeNull();
    expect(screen.getByTestId('goal-reset-btn')).toBeDisabled();
  });

  it('reset flow: confirm modal → POST /settings clears KPI_TARGET and EVENT_DATE (payments kept)', async () => {
    vi.mocked(v3.settings).mockResolvedValue(settings('300', '2025-01-01'));
    renderWithProviders(<GoalSettingsCard today="2025-06-01" />);
    await screen.findByTestId('goal-settings-card');
    fireEvent.click(screen.getByTestId('goal-reset-btn'));
    // The modal explains what is cleared — and that payments are not deleted.
    expect(await screen.findByText(/Введённые оплаты не удаляются/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('goal-reset-confirm'));
    await waitFor(() =>
      expect(v3.saveSettings).toHaveBeenCalledWith({ KPI_TARGET: '', EVENT_DATE: '' }),
    );
    // Success message names the next step for the admin.
    expect(await screen.findByText(/Цель сброшена/)).toBeInTheDocument();
  });

  it('reset failure surfaces the error in the UI (never console-only)', async () => {
    vi.mocked(v3.settings).mockResolvedValue(settings('300', '2025-01-01'));
    vi.mocked(v3.saveSettings).mockRejectedValue(new Error('boom'));
    renderWithProviders(<GoalSettingsCard today="2025-06-01" />);
    await screen.findByTestId('goal-settings-card');
    fireEvent.click(screen.getByTestId('goal-reset-btn'));
    fireEvent.click(await screen.findByTestId('goal-reset-confirm'));
    expect(await screen.findByText('boom')).toBeInTheDocument();
  });
});
