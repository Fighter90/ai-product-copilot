import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/** Ловит любой сбой рендера и показывает панель вместо белого экрана всего SPA. */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Консоль — единственный канал диагностики на клиенте; не глотаем молча.
    console.error('[pca] UI crash:', error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div
        role="alert"
        className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg p-8 text-center text-fg"
      >
        <div className="text-3xl">😕</div>
        <h1 className="text-xl font-semibold">Что-то сломалось на экране</h1>
        <p className="max-w-md text-sm opacity-70">
          Интерфейс восстановим перезагрузкой. Данные в порядке — ошибка только отображения.
        </p>
        <pre className="max-w-lg overflow-auto rounded-lg bg-black/5 p-3 text-left text-xs opacity-70">
          {error.message}
        </pre>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-lg bg-accent px-4 py-2 font-medium text-white hover:opacity-90"
        >
          Перезагрузить
        </button>
      </div>
    );
  }
}
