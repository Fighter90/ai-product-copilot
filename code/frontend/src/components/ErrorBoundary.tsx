import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Компактный режим: inline-панель для чанков внутри кабинета (не на весь экран). */
  compact?: boolean;
}

interface State {
  error: Error | null;
}

/** Компактный fallback для lazy-маршрутов (спиннер). Экспортируется для CabinetLayout. */
export function RouteFallback(): JSX.Element {
  return (
    <div className="flex h-full min-h-[60vh] w-full items-center justify-center bg-canvas">
      <div
        className="h-8 w-8 animate-spin rounded-full border-2 border-line border-t-accent"
        role="status"
        aria-label="Загрузка"
      />
    </div>
  );
}

/** Ловит любой сбой рендера и показывает панель вместо белого экрана всего SPA. */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  constructor(props: Props) {
    super(props);
    // «Повторить» сбрасывает ошибку и перерисовывает детей (retry загрузки чанка).
    this.reset = this.reset.bind(this);
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Консоль — единственный канал диагностики на клиенте; не глотаем молча.
    console.error('[pca] UI crash:', error, info.componentStack);
  }

  reset(): void {
    this.setState({ error: null });
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div
        role="alert"
        className={
          this.props.compact
            ? 'flex min-h-[40vh] w-full flex-col items-center justify-center gap-3 bg-canvas p-6 text-center text-fg'
            : 'flex min-h-screen flex-col items-center justify-center gap-4 bg-bg p-8 text-center text-fg'
        }
      >
        <div className="text-3xl">😕</div>
        <h1 className="text-xl font-semibold">
          {this.props.compact ? 'Не удалось загрузить раздел' : 'Что-то сломалось на экране'}
        </h1>
        <p className="max-w-md text-sm opacity-70">
          {this.props.compact
            ? 'Попробуйте повторить — обычно это разовый сбой загрузки.'
            : 'Интерфейс восстановим перезагрузкой. Данные в порядке — ошибка только отображения.'}
        </p>
        <pre className="max-w-lg overflow-auto rounded-lg bg-black/5 p-3 text-left text-xs opacity-70">
          {error.message}
        </pre>
        <button
          type="button"
          onClick={this.reset}
          className="rounded-lg bg-accent px-4 py-2 font-medium text-onaccent hover:opacity-90"
        >
          Повторить
        </button>
      </div>
    );
  }
}
