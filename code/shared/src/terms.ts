/**
 * Shared term dictionary (ANA-19): one definition per business term, used by the UI tooltips,
 * the help center and the report so «заявка», «заказ» and «оплата» never mean different things on
 * different screens. Funnel order: Визит → Заявка → Заказ → Оплата.
 *
 * Key rule (заявка ≠ оплата): Metrika goals only ever give applications/orders. Payments come from
 * outside Metrika — B2C payments entered manually / imported from CSV, B2B deals in stage «paid».
 */
export type TermKey =
  | 'visit'
  | 'application'
  | 'order'
  | 'payment'
  | 'paid'
  | 'b2cPaid'
  | 'b2bPaid'
  | 'gap'
  | 'conversion'
  | 'goalReach'
  | 'testTraffic'
  | 'tildaEvents'
  | 'demoData';

export type TermLocale = 'ru' | 'en';

export interface TermEntry {
  readonly label: string;
  readonly definition: string;
}

export const TERMS: Readonly<Record<TermKey, Readonly<Record<TermLocale, TermEntry>>>> = {
  visit: {
    ru: {
      label: 'Визит',
      definition:
        'Сессия на сайте по данным Метрики; закрывается после 30 минут неактивности. Визит ≠ человек.',
    },
    en: {
      label: 'Visit',
      definition:
        'A site session as counted by Metrika; closed after 30 minutes of inactivity. A visit ≠ a person.',
    },
  },
  application: {
    ru: {
      label: 'Заявка',
      definition:
        'Достижение цели-заявки в Метрике (форма, регистрация). Это намерение, а не оплата.',
    },
    en: {
      label: 'Application',
      definition:
        'A Metrika application goal reach (form, sign-up). It is an intent, not a payment.',
    },
  },
  order: {
    ru: {
      label: 'Заказ',
      definition:
        'Достижение цели-покупки в Метрике: заказ создан в корзине (контакты оставлены, переход к оплате). Оплату Метрика не видит.',
    },
    en: {
      label: 'Order',
      definition:
        'A Metrika purchase-goal reach: an order created in the cart (contacts left, sent to checkout). Metrika does not see the payment.',
    },
  },
  payment: {
    ru: {
      label: 'Оплата',
      definition:
        'Подтверждённые деньги: B2C-оплаты, внесённые вручную или импортом CSV из платёжки, и B2B-сделки в стадии «оплачено».',
    },
    en: {
      label: 'Payment',
      definition:
        'Confirmed money: B2C payments entered manually or imported from a payment-provider CSV, plus B2B deals in the «paid» stage.',
    },
  },
  paid: {
    ru: {
      label: 'Оплачено',
      definition: 'Оплачено = B2C-оплаты (ручной ввод/CSV) + билеты оплаченных B2B-сделок.',
    },
    en: {
      label: 'Paid',
      definition: 'Paid = B2C payments (manual entry/CSV) + tickets of paid B2B deals.',
    },
  },
  b2cPaid: {
    ru: {
      label: 'Оплачено B2C',
      definition:
        'Билеты физлиц, оплаченные по данным платёжки: вносятся по дням вручную или импортом CSV.',
    },
    en: {
      label: 'B2C paid',
      definition:
        'Individual tickets paid according to the payment provider: entered per day manually or via CSV import.',
    },
  },
  b2bPaid: {
    ru: {
      label: 'Оплачено B2B',
      definition: 'Билеты корпоративных сделок в стадии «оплачено» (раздел B2B).',
    },
    en: {
      label: 'B2B paid',
      definition: 'Tickets of corporate deals in the «paid» stage (B2B section).',
    },
  },
  gap: {
    ru: {
      label: 'Разрыв до цели',
      definition: 'Разрыв = цель по оплатам − Оплачено (не меньше 0). Заявки и заказы не входят.',
    },
    en: {
      label: 'Gap to target',
      definition:
        'Gap = payments target − Paid (never below 0). Applications and orders are not counted.',
    },
  },
  conversion: {
    ru: {
      label: 'Конверсия',
      definition: 'Конверсия = достижения цели / визиты × 100 %.',
    },
    en: {
      label: 'Conversion',
      definition: 'Conversion = goal reaches / visits × 100%.',
    },
  },
  goalReach: {
    ru: {
      label: 'Достижение цели',
      definition: 'Одно срабатывание цели Метрики. Достижения разных целей не складываются.',
    },
    en: {
      label: 'Goal reach',
      definition: 'One Metrika goal completion. Reaches of different goals are not additive.',
    },
  },
  testTraffic: {
    ru: {
      label: 'Тестовый трафик',
      definition:
        'Роботы, визиты с параметром env=test (скрипт pc-goals), песочница file:// и страницы/UTM из списка администратора. По умолчанию исключён.',
    },
    en: {
      label: 'Test traffic',
      definition:
        'Robots, visits with the env=test parameter (pc-goals script), file:// sandbox and pages/UTMs from the admin list. Excluded by default.',
    },
  },
  tildaEvents: {
    ru: {
      label: 'События Тильды',
      definition:
        'Виртуальные просмотры Тильды (/tilda/popup, /tilda/click, /tilda/form…) — это события, а не страницы; сгруппированы в одну строку /tilda/*.',
    },
    en: {
      label: 'Tilda events',
      definition:
        'Tilda virtual pageviews (/tilda/popup, /tilda/click, /tilda/form…) are events, not pages; grouped into a single /tilda/* row.',
    },
  },
  demoData: {
    ru: {
      label: 'Демо-данные',
      definition:
        'Выдуманные данные из pnpm seed для знакомства с кабинетом. Удаляются при первой синхронизации с Метрикой.',
    },
    en: {
      label: 'Demo data',
      definition:
        'Made-up data from pnpm seed to explore the cabinet. Removed on the first Metrika sync.',
    },
  },
};

/** Ordered keys of the main funnel: Визит → Заявка → Заказ → Оплата. */
export const FUNNEL_TERMS: readonly TermKey[] = ['visit', 'application', 'order', 'payment'];

/** Term entry for a locale (unknown locales fall back to Russian). */
export function term(key: TermKey, locale: string = 'ru'): TermEntry {
  const entry = TERMS[key];
  return locale === 'en' ? entry.en : entry.ru;
}

/** «Label — definition» one-liner for tooltips. */
export function termHint(key: TermKey, locale: string = 'ru'): string {
  const t = term(key, locale);
  return `${t.label} — ${t.definition}`;
}
