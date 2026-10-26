import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  BarChart3,
  Bot,
  Check,
  ChevronDown,
  Database,
  FileText,
  Lock,
  ShieldCheck,
  Sparkles,
  Target,
  Users,
  Workflow,
  X as XIcon,
} from 'lucide-react';
import { useT } from '../../i18n';
import { PublicHeader, PublicFooter } from './PublicChrome';

/** Scroll-driven parallax: elements with data-speed move at their own rate (transform only). */
function useParallax(root: React.RefObject<HTMLElement>): void {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const layers = Array.from(el.querySelectorAll<HTMLElement>('[data-speed]'));
    let raf = 0;
    const update = () => {
      raf = 0;
      const y = window.scrollY;
      for (const l of layers) {
        const speed = Number(l.dataset.speed);
        const rot = Number(l.dataset.rotate ?? 0);
        l.style.transform = `translate3d(0, ${(y * speed).toFixed(1)}px, 0)${rot ? ` rotate(${(y * rot).toFixed(2)}deg)` : ''}`;
      }
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(raf);
    };
  }, [root]);
}

/** Reveal-on-scroll for `.reveal` children. */
function useReveal(root: React.RefObject<HTMLElement>): void {
  useEffect(() => {
    const el = root.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      el?.querySelectorAll('.reveal').forEach((n) => n.classList.add('is-visible'));
      return;
    }
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('is-visible');
            io.unobserve(e.target);
          }
        }),
      { threshold: 0.12 },
    );
    el.querySelectorAll('.reveal').forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, [root]);
}

function Stars({ count, seed, size }: { count: number; seed: number; size: number }): JSX.Element {
  const dots = useMemo(() => {
    let s = seed;
    const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280;
    return Array.from({ length: count }, () => ({
      x: rnd() * 100,
      y: rnd() * 100,
      o: 0.25 + rnd() * 0.75,
    }));
  }, [count, seed]);
  return (
    <svg className="absolute inset-0 h-full w-full" preserveAspectRatio="none" aria-hidden="true">
      {dots.map((d, i) => (
        <circle
          key={i}
          cx={`${d.x}%`}
          cy={`${d.y}%`}
          r={size}
          fill="rgb(var(--c-ink))"
          opacity={d.o}
        />
      ))}
    </svg>
  );
}

const CONTENT = {
  ru: {
    eyebrow: 'Для команды ProductCamp',
    h1a: 'От Метрики',
    h1b: 'к гипотезам',
    lead: 'Аналитический копилот трека «Конверсии и лидген»: живые цели Яндекс.Метрики, воронка заявка → заказ → оплата, AI-гипотезы по ICE и отчёты DOCX/PDF — в одном кабинете с ролями.',
    ctaLogin: 'Войти в кабинет',
    ctaHow: 'Как это работает',
    kpis: [
      ['163', 'цели счётчика под контролем'],
      ['60 с', 'обновление живых данных'],
      ['4', 'AI-провайдера с фолбэком'],
      ['0', 'цифр без источника'],
    ],
    problemTitle: 'Проблема',
    problemLead: 'Цифры есть, ответа нет',
    problems: [
      [
        'Заявка ≠ оплата',
        'Метрика считает заказы в корзине, а не оплаты. Без разделения KPI «300 платных билетов» превращается в гадание.',
      ],
      [
        '163 цели и путаница',
        'По аудиту: 75 целей мертвы 90 дней, есть дубли, кнопочные цели ломаются после правок Тильды.',
      ],
      [
        'Excel и чаты',
        'Ручные выгрузки, гипотезы в мессенджерах, решения не связаны с данными и не воспроизводятся.',
      ],
    ],
    howTitle: 'Как работает',
    how: [
      [
        'Подключить',
        'Администратор подключает счётчик Метрики по OAuth и выдаёт доступ аналитикам.',
      ],
      [
        'Синхронизировать',
        'Сырые ответы Метрики сохраняются в SQLite — каждая цифра прослеживается до источника.',
      ],
      [
        'Смотреть вживую',
        'Цели, воронка pc-goals, источники и страницы — с автообновлением и data grids.',
      ],
      [
        'Решать',
        'AI предлагает гипотезы по ICE, отчёт собирается в DOCX/PDF из неизменяемого среза.',
      ],
    ],
    featTitle: 'Возможности',
    feats: [
      [
        Target,
        'Цели Метрики',
        'Все цели счётчика: достижения, конверсия, динамика, статус живая/спящая/мёртвая и дубли.',
      ],
      [
        Workflow,
        'Воронка pc-goals',
        'Визит → билеты → CTA → регистрация → корзина → заказ, тарифы и роли участников.',
      ],
      [
        BarChart3,
        'Подробная аналитика',
        'Источники, UTM, страницы входа и выхода, устройства, гео — с сортировкой и экспортом CSV.',
      ],
      [
        Sparkles,
        'AI-гипотезы',
        'Формат гипотезы, 3 допущения, 2 метода проверки, ICE = I × C × E, светофор и дедлайн.',
      ],
      [
        FileText,
        'Отчёты DOCX/PDF',
        'Детерминированный отчёт из среза данных: один ID → одинаковые файлы.',
      ],
      [
        Database,
        'DataLens',
        'Экспорт типизированных CSV и приёмник вебхуков DataLens для свободного анализа.',
      ],
    ],
    aiTitle: 'AI-провайдеры',
    aiLead:
      'Администратор подключает любые из четырёх и задаёт порядок фолбэка. Ключи хранятся зашифрованными.',
    rolesTitle: 'Роли',
    rolesLead:
      'Администратор настраивает всё. Аналитик загружает данные, строит отчёты и гипотезы.',
    roleCols: ['Действие', 'Администратор', 'Аналитик'],
    roles: [
      ['Создать пользователя, выдать роль и доступ', true, false],
      ['Подключить Метрику, выбрать цели KPI', true, false],
      ['Настроить AI-провайдеров и ключи', true, false],
      ['Журнал действий, интеграции, вебхуки', true, false],
      ['Загрузить данные из Метрики', true, true],
      ['Дашборд, живые цели, data grids', true, true],
      ['Сгенерировать отчёт и гипотезы, экспорт', true, true],
      ['Вести B2B-сделки', true, true],
    ] as Array<[string, boolean, boolean]>,
    trustTitle: 'Надёжность',
    trust: [
      [
        ShieldCheck,
        'Анти-галлюцинация',
        'Ни одной цифры в отчёте без следа в сырых ответах Метрики. AI видит только факты среза.',
      ],
      [
        Lock,
        'Безопасность',
        'Сессии httpOnly, роли на сервере, AES-256-GCM для ключей, журнал всех изменений.',
      ],
      [
        Users,
        'Командная работа',
        'Каждый аналитик в своём аккаунте, администратор управляет доступом в один клик.',
      ],
    ],
    faqTitle: 'Вопросы',
    faq: [
      [
        'Чем заказ отличается от оплаты?',
        'Заказ — это цель Метрики (контакты оставлены, переход к оплате). Оплата приходит из платёжной системы или B2B-сделок. Инструмент никогда не складывает их в одну цифру.',
      ],
      [
        'Нужен ли AI, чтобы пользоваться?',
        'Нет. Дашборд, цели, воронка и отчёт работают без провайдера. AI добавляет гипотезы, разбор и ассистента по справке.',
      ],
      [
        'Откуда данные в режиме «Сейчас»?',
        'Прямо из Reporting API Метрики с кэшем 60 секунд, тестовый трафик (песочницы, метки env=test) отфильтрован.',
      ],
      [
        'Можно ли анализировать в DataLens?',
        'Да: выгрузка CSV для подключения «Файлы» и встроенный коннектор Метрики. Вебхуки DataLens приходят в кабинет.',
      ],
      [
        'Как получить доступ?',
        'Аккаунт создаёт администратор и передаёт временный пароль. Самостоятельной регистрации нет.',
      ],
    ],
    finalTitle: 'Начните с живых целей',
    finalLead: 'Войдите — первый экран покажет, успеваем ли к 300 оплатам.',
  },
  en: {
    eyebrow: 'For the ProductCamp team',
    h1a: 'From Metrika',
    h1b: 'to hypotheses',
    lead: 'An analytics copilot for the “Conversions & lead-gen” track: live Yandex Metrika goals, the application → order → payment funnel, ICE-scored AI hypotheses and DOCX/PDF reports — in one role-based cabinet.',
    ctaLogin: 'Sign in',
    ctaHow: 'How it works',
    kpis: [
      ['163', 'counter goals under control'],
      ['60 s', 'live data refresh'],
      ['4', 'AI providers with fallback'],
      ['0', 'numbers without a source'],
    ],
    problemTitle: 'Problem',
    problemLead: 'Plenty of numbers, no answers',
    problems: [
      [
        'Application ≠ payment',
        'Metrika counts cart orders, not payments. Without separating them the “300 paid tickets” KPI is guesswork.',
      ],
      [
        '163 goals and confusion',
        'Audit: 75 goals dead for 90 days, duplicates, button goals break after Tilda edits.',
      ],
      [
        'Excel and chats',
        'Manual exports, hypotheses in messengers, decisions not tied to data and not reproducible.',
      ],
    ],
    howTitle: 'How it works',
    how: [
      [
        'Connect',
        'An administrator connects the Metrika counter via OAuth and grants analysts access.',
      ],
      [
        'Sync',
        'Raw Metrika responses are stored in SQLite — every number traces back to its source.',
      ],
      [
        'Watch live',
        'Goals, the pc-goals funnel, sources and pages — auto-refreshed, with data grids.',
      ],
      [
        'Decide',
        'AI proposes ICE-scored hypotheses; the report is built as DOCX/PDF from an immutable snapshot.',
      ],
    ],
    featTitle: 'Features',
    feats: [
      [
        Target,
        'Metrika goals',
        'Every counter goal: reaches, conversion, trend, live/sleeping/dead status and duplicates.',
      ],
      [
        Workflow,
        'pc-goals funnel',
        'Visit → tickets → CTA → registration → cart → order, tariffs and participant roles.',
      ],
      [
        BarChart3,
        'Deep analytics',
        'Sources, UTM, entry and exit pages, devices, geo — sortable, exportable to CSV.',
      ],
      [
        Sparkles,
        'AI hypotheses',
        'Hypothesis format, 3 assumptions, 2 test methods, ICE = I × C × E, traffic light and deadline.',
      ],
      [
        FileText,
        'DOCX/PDF reports',
        'Deterministic report from a data snapshot: one ID → identical files.',
      ],
      [
        Database,
        'DataLens',
        'Typed CSV export and a DataLens webhook receiver for free-form analysis.',
      ],
    ],
    aiTitle: 'AI providers',
    aiLead:
      'An administrator enables any of the four and sets the fallback order. Keys are stored encrypted.',
    rolesTitle: 'Roles',
    rolesLead:
      'The administrator configures everything. Analysts load data, build reports and hypotheses.',
    roleCols: ['Action', 'Administrator', 'Analyst'],
    roles: [
      ['Create users, assign roles and access', true, false],
      ['Connect Metrika, choose KPI goals', true, false],
      ['Configure AI providers and keys', true, false],
      ['Audit log, integrations, webhooks', true, false],
      ['Load data from Metrika', true, true],
      ['Dashboard, live goals, data grids', true, true],
      ['Generate reports and hypotheses, export', true, true],
      ['Manage B2B deals', true, true],
    ] as Array<[string, boolean, boolean]>,
    trustTitle: 'Trust',
    trust: [
      [
        ShieldCheck,
        'Anti-hallucination',
        'No number in a report without a trace in raw Metrika responses. AI sees only snapshot facts.',
      ],
      [
        Lock,
        'Security',
        'httpOnly sessions, server-side roles, AES-256-GCM for keys, an audit log of every change.',
      ],
      [
        Users,
        'Teamwork',
        'Every analyst has their own account; the administrator manages access in one click.',
      ],
    ],
    faqTitle: 'FAQ',
    faq: [
      [
        'How is an order different from a payment?',
        'An order is a Metrika goal (contacts left, moved to payment). A payment comes from the payment system or B2B deals. The tool never adds them up.',
      ],
      [
        'Do I need AI to use it?',
        'No. Dashboard, goals, funnel and report work without a provider. AI adds hypotheses, analysis and the help assistant.',
      ],
      [
        'Where does “Live” data come from?',
        'Directly from the Metrika Reporting API with a 60 s cache; test traffic (sandboxes, env=test) is filtered out.',
      ],
      [
        'Can I analyse in DataLens?',
        'Yes: CSV export for the “Files” connection plus the built-in Metrika connector. DataLens webhooks arrive in the cabinet.',
      ],
      [
        'How do I get access?',
        'An administrator creates the account and hands over a temporary password. There is no self sign-up.',
      ],
    ],
    finalTitle: 'Start with live goals',
    finalLead: 'Sign in — the first screen shows whether we are on track for 300 payments.',
  },
} as const;

const PROVIDERS = [
  { name: 'OpenRouter', note: 'Claude · GPT · Gemini · DeepSeek' },
  { name: 'Anthropic', note: 'Claude Sonnet / Opus' },
  { name: 'YandexGPT', note: 'AI Studio · Yandex Cloud' },
  { name: 'GigaChat', note: 'Сбер · GigaChat-2' },
];

function IntegrationMark({ kind }: { kind: 'metrika' | 'datalens' }): JSX.Element {
  return kind === 'metrika' ? (
    <svg width="44" height="44" viewBox="0 0 44 44" aria-hidden="true" className="shrink-0">
      <circle cx="22" cy="22" r="20" fill="#FC3F1D" />
      <circle cx="22" cy="22" r="8" fill="#fff" />
      <path d="M22 2 a20 20 0 0 1 17.3 10 L22 22 Z" fill="#fff" opacity="0.35" />
    </svg>
  ) : (
    <svg width="44" height="44" viewBox="0 0 44 44" aria-hidden="true" className="shrink-0">
      <rect x="4" y="24" width="8" height="16" rx="2" fill="#5282FF" />
      <rect x="18" y="14" width="8" height="26" rx="2" fill="#7BA7FF" />
      <rect x="32" y="4" width="8" height="36" rx="2" fill="#A9C5FF" />
    </svg>
  );
}

function IntegrationCard({
  mark,
  name,
  what,
  bullets,
  setup,
  helpPath,
}: {
  mark: 'metrika' | 'datalens';
  name: string;
  what: string;
  bullets: string[];
  setup: string;
  helpPath: string;
}): JSX.Element {
  return (
    <div className="card reveal flex flex-col gap-3 p-6">
      <div className="flex items-center gap-3">
        <IntegrationMark kind={mark} />
        <h3 className="text-lg font-semibold">{name}</h3>
      </div>
      <p className="text-sm text-muted">{what}</p>
      <ul className="space-y-1 text-sm">
        {bullets.map((b) => (
          <li key={b} className="flex gap-2">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
            <span>{b}</span>
          </li>
        ))}
      </ul>
      <Link to={helpPath} className="mt-auto text-sm text-accent hover:underline">
        {setup} →
      </Link>
    </div>
  );
}

export function Landing(): JSX.Element {
  const { locale, t } = useT();
  const c = CONTENT[locale];
  const root = useRef<HTMLDivElement>(null);
  const [faqOpen, setFaqOpen] = useState<number | null>(0);
  useParallax(root);
  useReveal(root);

  return (
    <div ref={root} className="min-h-screen overflow-x-hidden bg-canvas text-ink">
      <PublicHeader />

      <main>
        {/* HERO with layered parallax */}
        <section className="relative isolate flex min-h-[100svh] items-center overflow-hidden pt-16">
          <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden="true">
            <div data-speed="0.15" className="absolute inset-0 opacity-60">
              <Stars count={140} seed={7} size={0.8} />
            </div>
            <div data-speed="0.3" className="absolute inset-0 opacity-80">
              <Stars count={50} seed={42} size={1.4} />
            </div>
            <div
              data-speed="0.22"
              data-rotate="0.02"
              className="absolute -right-[20vw] top-[8vh] h-[110vh] w-[110vh] rounded-full border border-line/70"
            />
            <div
              data-speed="0.35"
              data-rotate="-0.03"
              className="absolute -right-[8vw] top-[22vh] h-[70vh] w-[70vh] rounded-full border border-accent/30"
            >
              <span className="absolute left-[12%] top-[14%] h-3 w-3 rounded-full bg-accent shadow-[0_0_24px_6px_rgba(255,77,20,.6)]" />
            </div>
            <div
              data-speed="0.45"
              className="absolute -right-[2vw] top-[36vh] h-[40vh] w-[40vh] rounded-full border border-line"
            />
            <div className="absolute bottom-0 left-1/2 h-[45vh] w-[120vw] -translate-x-1/2 rounded-[100%] bg-accent/25 blur-[120px]" />
          </div>

          {/* Floating KPI cards (foreground parallax) */}
          <div className="pointer-events-none absolute inset-0 hidden lg:block" aria-hidden="true">
            <div data-speed="-0.12" className="absolute right-[12%] top-[24%]">
              <div className="card animate-float w-56 p-4 shadow-2xl backdrop-blur">
                <div className="text-[10px] uppercase tracking-widest text-muted">
                  {locale === 'en' ? 'reg_step1 · orders' : 'reg_step1 · заказы'}
                </div>
                <div className="mt-1 text-3xl font-bold">15</div>
                <div className="mt-2 flex h-8 items-end gap-1">
                  {[3, 5, 2, 6, 4, 8, 5].map((h, i) => (
                    <span
                      key={i}
                      className="flex-1 rounded-sm bg-accent/80"
                      style={{ height: `${h * 12}%` }}
                    />
                  ))}
                </div>
              </div>
            </div>
            <div data-speed="-0.25" className="absolute right-[30%] top-[58%]">
              <div className="card animate-float w-48 p-4 shadow-2xl [animation-delay:1.5s]">
                <div className="text-[10px] uppercase tracking-widest text-muted">
                  {locale === 'en' ? 'CR visit → order' : 'CR визит → заказ'}
                </div>
                <div className="mt-1 text-3xl font-bold text-accent">
                  {locale === 'en' ? '1.3%' : '1,3%'}
                </div>
              </div>
            </div>
            <div data-speed="-0.06" className="absolute right-[6%] top-[62%]">
              <div className="card animate-float w-52 p-4 shadow-2xl [animation-delay:3s]">
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-muted">
                  <Bot className="h-3 w-3" /> AI · ICE 512
                </div>
                <div className="mt-1 text-sm leading-snug">
                  {locale === 'en' ? 'Simplify the mobile cart' : 'Упростить корзину для мобильных'}
                </div>
              </div>
            </div>
          </div>

          <div className="mx-auto w-full max-w-7xl px-4 sm:px-6">
            <div className="max-w-4xl">
              <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-line px-3 py-1 text-xs uppercase tracking-[0.2em] text-muted animate-fade-up">
                <span className="h-1.5 w-1.5 rounded-full bg-accent" /> {c.eyebrow}
              </div>
              <h1 className="h-display text-[44px] sm:text-[74px] xl:text-[112px] animate-fade-up">
                {c.h1a}
                <br />
                <span className="text-accent">{c.h1b}</span>
              </h1>
              <p className="mt-6 max-w-2xl text-base text-muted sm:text-lg animate-fade-up [animation-delay:.15s]">
                {c.lead}
              </p>
              <div className="mt-8 flex flex-wrap gap-3 animate-fade-up [animation-delay:.3s]">
                <Link to="/login" className="btn-primary px-6 py-3 uppercase tracking-wide">
                  {c.ctaLogin} <ArrowRight className="h-4 w-4" />
                </Link>
                <a href="#how" className="btn-ghost px-6 py-3 uppercase tracking-wide">
                  {c.ctaHow}
                </a>
              </div>
            </div>
            <div className="mt-16 grid max-w-4xl grid-cols-2 gap-6 sm:grid-cols-4">
              {c.kpis.map(([v, l], i) => (
                <div key={l} className="reveal" style={{ transitionDelay: `${i * 80}ms` }}>
                  <div className="text-4xl font-bold sm:text-5xl">{v}</div>
                  <div className="mt-1 text-xs uppercase tracking-wide text-muted">{l}</div>
                </div>
              ))}
            </div>
          </div>
          <a
            href="#problem"
            aria-label="scroll"
            className="absolute bottom-6 left-1/2 -translate-x-1/2 text-muted hover:text-accent"
          >
            <ChevronDown className="h-6 w-6 animate-bounce" />
          </a>
        </section>

        {/* PROBLEM */}
        <section id="problem" className="border-t border-line py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <SectionTitle eyebrow={c.problemTitle} title={c.problemLead} />
            <div className="grid gap-4 md:grid-cols-3">
              {c.problems.map(([t, d], i) => (
                <div
                  key={t}
                  className="card reveal p-6"
                  style={{ transitionDelay: `${i * 100}ms` }}
                >
                  <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full border border-accent/40 text-accent">
                    <XIcon className="h-5 w-5" />
                  </div>
                  <h3 className="text-xl font-semibold">{t}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{d}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* HOW (sticky parallax band) */}
        <section id="how" className="relative overflow-hidden border-t border-line py-24">
          <div
            aria-hidden="true"
            data-speed="-0.08"
            className="pointer-events-none absolute -left-20 top-10 select-none text-[22vw] font-black leading-none text-ink/[0.03]"
          >
            FLOW
          </div>
          <div className="relative mx-auto max-w-7xl px-4 sm:px-6">
            <SectionTitle eyebrow="01—04" title={c.howTitle} />
            <ol className="grid gap-4 md:grid-cols-4">
              {c.how.map(([t, d], i) => (
                <li
                  key={t}
                  className="reveal relative card p-6"
                  style={{ transitionDelay: `${i * 120}ms` }}
                >
                  <div className="text-5xl font-black text-accent/90">0{i + 1}</div>
                  <h3 className="mt-4 text-lg font-semibold uppercase tracking-wide">{t}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{d}</p>
                  {i < 3 && (
                    <ArrowRight className="absolute -right-3 top-1/2 hidden h-6 w-6 -translate-y-1/2 text-accent md:block" />
                  )}
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* FEATURES */}
        <section className="border-t border-line py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <SectionTitle eyebrow="Copilot" title={c.featTitle} />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {c.feats.map(([Icon, t, d], i) => (
                <div
                  key={t as string}
                  className="card reveal group p-6 transition-all duration-300 hover:-translate-y-1 hover:border-accent/60"
                  style={{ transitionDelay: `${(i % 3) * 90}ms` }}
                >
                  <Icon className="h-7 w-7 text-accent transition-transform duration-300 group-hover:scale-110" />
                  <h3 className="mt-4 text-lg font-semibold">{t as string}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{d as string}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* AI PROVIDERS */}
        <section className="relative overflow-hidden border-t border-line py-24">
          <div
            aria-hidden="true"
            data-speed="0.1"
            className="pointer-events-none absolute right-[-10%] top-0 h-[60vh] w-[60vh] rounded-full bg-accent/10 blur-[100px]"
          />
          <div className="relative mx-auto max-w-7xl px-4 sm:px-6">
            <SectionTitle eyebrow="AI" title={c.aiTitle} lead={c.aiLead} />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {PROVIDERS.map((p, i) => (
                <div
                  key={p.name}
                  className="card reveal p-6"
                  style={{ transitionDelay: `${i * 90}ms` }}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xl font-bold">{p.name}</span>
                    <span className="text-xs text-muted">#{i + 1}</span>
                  </div>
                  <div className="mt-2 text-sm text-muted">{p.note}</div>
                  <div className="mt-4 h-1 overflow-hidden rounded-full bg-raised">
                    <div
                      className="h-full rounded-full bg-accent"
                      style={{ width: `${100 - i * 18}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* INTEGRATIONS — Метрика + DataLens */}
        <section className="border-t border-line py-24">
          <div className="mx-auto max-w-5xl px-4 sm:px-6">
            <SectionTitle
              eyebrow="Data"
              title={t('land.integrations.title')}
              lead={t('land.integrations.lead')}
            />
            <div className="grid gap-4 md:grid-cols-2">
              <IntegrationCard
                mark="metrika"
                name={t('land.int.metrika.name')}
                what={t('land.int.metrika.what')}
                bullets={[
                  t('land.int.metrika.b1'),
                  t('land.int.metrika.b2'),
                  t('land.int.metrika.b3'),
                ]}
                setup={t('land.int.metrika.setup')}
                helpPath="/help/admin"
              />
              <IntegrationCard
                mark="datalens"
                name={t('land.int.datalens.name')}
                what={t('land.int.datalens.what')}
                bullets={[
                  t('land.int.datalens.b1'),
                  t('land.int.datalens.b2'),
                  t('land.int.datalens.b3'),
                ]}
                setup={t('land.int.datalens.setup')}
                helpPath="/help/datalens"
              />
            </div>
          </div>
        </section>

        {/* ROLES */}
        <section className="border-t border-line py-24">
          <div className="mx-auto max-w-5xl px-4 sm:px-6">
            <SectionTitle eyebrow="RBAC" title={c.rolesTitle} lead={c.rolesLead} />
            <div className="card reveal overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-raised text-left text-xs uppercase tracking-wide text-muted">
                  <tr>
                    {c.roleCols.map((h, i) => (
                      <th key={h} className={`px-4 py-3 ${i ? 'text-center' : ''}`}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {c.roles.map(([a, admin, analyst]) => (
                    <tr key={a} className="border-t border-line">
                      <td className="px-4 py-3">{a}</td>
                      {[admin, analyst].map((v, i) => (
                        <td key={i} className="px-4 py-3 text-center">
                          {v ? (
                            <Check className="mx-auto h-4 w-4 text-accent" />
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* TRUST */}
        <section className="border-t border-line py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <SectionTitle eyebrow="Trust" title={c.trustTitle} />
            <div className="grid gap-4 md:grid-cols-3">
              {c.trust.map(([Icon, t, d], i) => (
                <div
                  key={t as string}
                  className="reveal p-2"
                  style={{ transitionDelay: `${i * 100}ms` }}
                >
                  <Icon className="h-8 w-8 text-accent" />
                  <h3 className="mt-4 text-xl font-semibold">{t as string}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{d as string}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="border-t border-line py-24">
          <div className="mx-auto max-w-3xl px-4 sm:px-6">
            <SectionTitle eyebrow="?" title={c.faqTitle} />
            <div className="divide-y divide-line rounded-card border border-line">
              {c.faq.map(([q, a], i) => (
                <div key={q} className="reveal">
                  <button
                    type="button"
                    aria-expanded={faqOpen === i}
                    onClick={() => setFaqOpen(faqOpen === i ? null : i)}
                    className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left font-medium hover:text-accent"
                  >
                    {q}
                    <ChevronDown
                      className={`h-5 w-5 shrink-0 transition-transform duration-300 ${faqOpen === i ? 'rotate-180 text-accent' : ''}`}
                    />
                  </button>
                  <div
                    className={`grid transition-all duration-300 ${faqOpen === i ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
                  >
                    <div className="overflow-hidden">
                      <p className="px-5 pb-5 text-sm leading-relaxed text-muted">{a}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FINAL CTA */}
        <section className="relative overflow-hidden border-t border-line py-28">
          <div aria-hidden="true" data-speed="0.12" className="absolute inset-0 -z-0 opacity-50">
            <Stars count={60} seed={99} size={1} />
          </div>
          <div className="relative mx-auto max-w-4xl px-4 text-center sm:px-6">
            <h2 className="h-display text-4xl sm:text-6xl reveal">{c.finalTitle}</h2>
            <p className="mx-auto mt-4 max-w-xl text-muted reveal">{c.finalLead}</p>
            <Link to="/login" className="btn-primary mt-8 px-8 py-3 uppercase tracking-wide reveal">
              {c.ctaLogin} <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </section>
      </main>

      <PublicFooter />
    </div>
  );
}

function SectionTitle({
  eyebrow,
  title,
  lead,
}: {
  eyebrow: string;
  title: string;
  lead?: string;
}): JSX.Element {
  return (
    <div className="mb-10 reveal">
      <div className="mb-3 text-xs font-semibold uppercase tracking-[0.25em] text-accent">
        {eyebrow}
      </div>
      <h2 className="h-display text-4xl sm:text-[64px]">{title}</h2>
      {lead && <p className="mt-4 max-w-2xl text-muted">{lead}</p>}
    </div>
  );
}
