---
title: Assistant and help
section: Basics
order: 11
summary: The RAG assistant in the bottom-right corner and the Help section with search.
---

# Assistant and help

## RAG assistant

The button in the bottom-right corner opens the help assistant. It answers strictly from the help text: it finds relevant fragments (BM25 search) and composes an answer via the AI provider, citing sections [1], [2].

- Without a configured AI provider the assistant returns links to matching help sections.
- Rate limit: 20 questions per 10 minutes per address.
- The assistant never sees your data and never invents buttons: if the help has no answer, it says so.

## The Help section

A separate page with all articles: section contents, search, a standalone URL for analysts who are not signed in. Available in Russian and English — switch with the interface language.

## Articles

Help lives in markdown files under `docs/help/<lang>/`. Administrators can extend it with files carrying front matter (title, section, order, summary) — re-read on server restart.
