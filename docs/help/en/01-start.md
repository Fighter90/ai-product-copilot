---
title: Getting started
section: Basics
order: 1
summary: Signing in, Administrator and Analyst roles, signing out.
---

# Getting started

## Signing in

1. Open the site and click "Sign in" in the header.
2. Enter the e-mail and password provided by your administrator.
3. You land in the cabinet on the Overview page.

The session lasts 7 days. The sign-out button is at the bottom of the cabinet sidebar.

## Roles

- **Administrator** — full access: dashboards, reports, user management, AI providers, Metrika settings, integrations, audit log.
- **Analyst** — data work: dashboards, real-time, goals, reports, DataLens. Admin sections are hidden and the API returns 403.

## Demo accounts

Two demo users exist by default: `admin@dashboardcamp.ru` (administrator) and `analyst@dashboardcamp.ru` (analyst). Passwords are set at deployment. Create personal accounts in "Admin → Users" for real work.

## First-run checklist for administrators

1. "Admin → Yandex Metrika" — verify the counter and run a data sync.
2. "Admin → AI providers" — add a provider key (Anthropic, OpenRouter, YandexGPT or GigaChat) and press "Test".
3. "Admin → Users" — create analyst accounts.
