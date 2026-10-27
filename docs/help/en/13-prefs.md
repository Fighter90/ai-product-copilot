---
title: Language and theme
section: Basics
order: 13
summary: Switching Russian/English interface, dark/light theme, number and date formats.
---

# Language and theme

Personal presentation settings: they live in the browser (localStorage), apply to every screen, and do not affect other users.

## Interface language

The RU/EN switch is in the cabinet header and on public pages.

![Overview screenshot](/screenshots/03-overview.png)
_The header with the period switch, segment toggle and the language switch._

1. Click RU or EN in the header — the whole interface re-renders in the chosen language immediately.
2. The choice persists per browser: next sign-in opens in the same language.
3. What is translated: navigation, table headers and data, charts, help articles and the assistant's answers and citations.

The help section follows the interface language — EN shows `docs/help/en/` articles, RU shows the Russian ones. If you read the help in one language but work in the other, switch deliberately before opening the assistant, since it retrieves help fragments from the active language's texts.

![Help section screenshot](/screenshots/22-help.png)
_The help section rendered in the active interface language._

## Theme

Dark and light themes are toggled with the sun/moon button in the header.

1. Click the button — the theme switches instantly.
2. The choice persists like the language.
3. ECharts charts recolor automatically: axis, grid and series colors follow the theme, so screenshots taken in dark mode stay readable.

Dark mode is comfortable for live monitoring (the Live page on a wall screen); light mode usually prints better in report documents.

## Number and date formats

| Setting              | RU selected                                                   | EN selected         |
| -------------------- | ------------------------------------------------------------- | ------------------- |
| Dates                | DD.MM.YYYY                                                    | Month D, YYYY style |
| Thousands separator  | space                                                         | comma               |
| Decimal separator    | comma                                                         | dot                 |
| CSV export filenames | locale-aware preset and period names follow the active locale |

Note: CSV **contents** keep machine formats (dot decimals, ISO dates) so that DataLens and spreadsheets import them consistently regardless of the interface language.

## Recommendations per scenario

- **Mixed-language team** — each member picks their own language; dashboards and exports stay consistent because data formats do not change.
- **Preparing a document** — switch to the language of the audience before generating a report: headings and labels in DOCX/PDF follow the interface locale.
- **Wall-screen Live** — dark theme, RU or EN to match the room, and hide the sidebar for maximum chart width.

## Use cases

- **English-speaking partner demo** — switch to EN, walk Overview and Live; all tables and charts localize on the fly, no re-login needed.
- **Reading the help in your stronger language** — the assistant cites and answers in the active language, so set it before asking "how do I…" questions.
- **Consistent screenshots for a slide deck** — pick theme and language once, then capture all pages; the deck stays visually uniform.

## Troubleshooting

- **The language switched back** — another person used the same browser profile, or the profile cleared localStorage; the setting is per browser, not per account.
- **Charts show mixed colors after a theme switch** — a refresh of the page rebuilds the charts; if a stale chart remains, it is a rendering cache, not lost data.
- **Numbers look "wrong" after switching** — the decimal separator changed with the locale; the values are identical, only formatting differs.

## What is stored and where

Appearance settings live in the browser (localStorage): theme (`pca.theme`), language
(`pca.locale`), sidebar collapse. The locale is also saved to the user profile — signing in on
another device pulls the language from the profile. Numbers, dates and channel names are
formatted per the chosen locale across the cabinet.

## Theme and accessibility

Dark and light themes toggle in the header; charts follow the choice (the «pca» and «pca-dark»
palettes re-register automatically). Contrast and focus rings meet WCAG AA; transitions animate
and respect `prefers-reduced-motion`.

## Profile

Name and password changes — `User menu → Profile`. The password is length-checked; the session
refreshes after a change. Signing out ends the session on the device; the audit log records
logins/logouts (visible to administrators).
