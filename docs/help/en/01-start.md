---
title: Getting started
section: Basics
order: 1
summary: Signing in, Administrator and Analyst roles, first-run checklist, signing out.
---

# Getting started

ProductCamp Analytics Copilot is the analytics cabinet for the ProductCamp conference site: it collects Yandex Metrika data, tracks ticket sales KPI, builds funnels and reports, and keeps B2B deals and DataLens integrations in one place. This article gets you from an empty browser tab to a working session.

![Landing page screenshot](/screenshots/01-landing.png)
_Public landing page — the entry point to the cabinet._

## Signing in

1. Open [dashboardcamp.ru](https://dashboardcamp.ru) and click **Sign in** in the header.
2. Enter the e-mail and password provided by your administrator.
3. You land in the cabinet on the **Overview** page.
4. If you forgot the password, contact an administrator — accounts are managed in **Admin → Users** (there is no self-service reset).

![Login screenshot](/screenshots/02-login.png)
_The sign-in form accepts only cabinet accounts created by an administrator._

The session lasts **7 days**; after that you are asked to sign in again. The sign-out button sits at the bottom of the cabinet sidebar.

## Roles

| Role              | What it can do                                                                                                | What is hidden                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **Administrator** | Everything: all dashboards, reports, user management, AI providers, Metrika settings, integrations, audit log | —                                                                                          |
| **Analyst**       | Overview, Live, Goals, Traffic, Behavior, Funnel, Explore, Report, History, B2B, DataLens, help, assistant    | All "Admin" sections; the API additionally returns 403, so the restriction is not cosmetic |

Assign roles deliberately: analysts do the daily data work, administrators own configuration and accounts. One person can hold an administrator account and a separate analyst account if you want to see the cabinet "as an analyst sees it".

## Demo accounts

Two demo users exist by default: `admin@dashboardcamp.ru` (administrator) and `analyst@dashboardcamp.ru` (analyst). Passwords are set at deployment. Use them to explore the cabinet, but create personal accounts in **Admin → Users** for real work — the audit log attributes every action to a specific e-mail, which is only useful if people do not share logins.

## First-run checklist for administrators

1. **Admin → Yandex Metrika** — verify the counter (54280963) is connected and run a manual data sync.
2. **Admin → AI providers** — add a provider key (OpenRouter, Anthropic, YandexGPT or GigaChat) and press **Test**. This enables the assistant and AI report analysis.
3. **Admin → Users** — create personal analyst accounts.
4. **Admin → Integrations** — generate the DataLens webhook token if you plan to hook up DataLens alerts.
5. Wait for the first scheduled sync (every 30 minutes) and confirm daily rows appear in **History**.

## Navigation at a glance

The sidebar groups the cabinet: dashboard pages (Overview, Live, Goals, Traffic, Behavior, Funnel, KPI, Explore), reports (Report, History, B2B), DataLens, and — for administrators — the Admin section. The header carries the period switch, the B2C+B2B segment toggle, the RU/EN language switch and the dark/light theme button. The version number is in the footer.

## Use cases

- **New analyst on the team** — an administrator creates the account, the analyst signs in and starts from Overview; this article and **Help** cover the rest.
- **Fresh deployment** — walk through the first-run checklist above before showing the cabinet to stakeholders.
- **Access review** — an administrator opens **Admin → Users** and deactivates accounts of people who left; history stays intact.

## Troubleshooting

- **"Sign in" rejects the password** — check the e-mail spelling; passwords are case-sensitive. If it still fails, an administrator should verify the account is active in **Admin → Users**.
- **Admin sections are missing** — your account has the Analyst role; ask an administrator to upgrade it.
- **Empty dashboards right after sign-in** — data appears after the first sync; see [Overview](#) → "Data status".
