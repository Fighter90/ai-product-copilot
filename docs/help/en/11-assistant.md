---
title: Assistant and help
section: Basics
order: 11
summary: The RAG assistant in the bottom-right corner, how it answers, its limits, and the Help section with search.
---

# Assistant and help

Two layers of built-in knowledge: the **Help** section (this text, searchable) and the **assistant** (a chat that answers from the same help texts).

## The Help section

The Help page gathers all articles with a section contents and full-text search. It works with or without a cabinet account and has a standalone URL, so you can send a link to an analyst who is not signed in.

![Help section screenshot](/screenshots/22-help.png)
_The Help section: contents by sections plus search._

![Help article screenshot](/screenshots/23-help-article.png)
_A help article: stable heading anchors, tables and screenshots._

- The table of contents and the search index are built from the article **headings** (H2/H3), so a precise heading search usually finds the right article faster than a full-text query.
- Every article has a stable URL — bookmark the ones you use weekly.
- The help exists in Russian and English; the interface language switch in the header selects which one you read.

## The RAG assistant

The button in the bottom-right corner opens the help assistant.

![Assistant screenshot](/screenshots/24-assistant.png)
_The assistant answering with section citations._

How it works:

1. Your question is matched against the help texts with **BM25 search** — the most relevant fragments are selected.
2. The fragments are sent to the configured **AI provider**, which composes an answer strictly from them.
3. The answer cites its sources as [1], [2] — follow them to the original sections.

### Ground rules

- The assistant answers **only from the help**: it has no access to your analytics data, no site access and no memory of other conversations.
- If the help has no answer, it says so instead of inventing buttons or menu items.
- **Rate limit**: 20 questions per 10 minutes per address — enough for a working session, enough to stop a runaway loop.
- Without a configured AI provider, the assistant degrades gracefully: it returns links to the matching help sections instead of a composed answer.

### Asking well

- Ask in the language of the help you are reading (RU or EN) — retrieval works per language.
- Name the page or feature: "how do I archive a goal" beats "where is that button".
- If the answer cites the wrong section, rephrase with a term from that section's heading; the citations show what was retrieved.

## Administrators: extending the help

Help articles live in markdown files under `docs/help/<lang>/`. Each file carries front matter (`title`, `section`, `order`, `summary`); the server re-reads them on restart, rebuilds the section tree and the search index. Administrators can add articles this way without touching code — keep one H1 per file and structure content with H2/H3 so headings land in the index and TOC.

## Use cases

- **New team member onboarding** — point them at Help; the assistant answers the "how do I…" questions in their first days without occupying an administrator.
- **Mid-analysis doubt** — "what does bounce rate mean here" → the assistant cites the metrics article instead of a web search with different definitions.
- **Writing a new article** — draft a markdown file with front matter, drop it into `docs/help/en/`, restart, and check the TOC and search pick up the headings.

## Troubleshooting

- **The assistant answers "not in the help"** — the topic is genuinely not documented yet; either write the article or ask the team directly.
- **Answers stopped composing (links only)** — the AI provider is down, its key expired, or the rate limit is hit; check **Admin → AI providers → Test** and the usage log.
- **A new article is not visible** — articles are re-read on server restart; verify the front matter is valid and the file is in the correct language folder.
