# ProductCamp Analytics Copilot — Wiki (EN)

English mirror of the wiki. Полная версия на русском — [Home](../Home.md).

**ProductCamp Analytics Copilot** — an analytics tool for paid product programs: it pulls
Yandex.Metrika data into SQLite, shows an analyst cabinet (overview, Live, goals & KPI, funnel,
Explore, reports, history, B2B), generates GOST-style DOCX/PDF reports, prepares DataLens
datasets, and answers help questions via a RAG assistant. Runs without a cloud:
Metrika → SQLite → dashboard → DOCX/PDF. Current version — **v3.3.1**
([CHANGELOG](https://github.com/Fighter90/ai-product-copilot/blob/main/CHANGELOG.md)).

## Pages

| Page                                       | About                                                  |
| ------------------------------------------ | ------------------------------------------------------ |
| [Quickstart](Quickstart.md)                | Local setup from scratch                               |
| [Roles](Roles.md)                          | Admin vs analyst permissions, sessions, counter grants |
| [Metrika & Goals](Metrika-and-Goals.md)    | Sync pipeline, day-history, KPI «lead ≠ payment»       |
| [Halloween funnel](../Halloween-funnel.md) | Halloween tariff goals and funnel reading notes        |
| [AI Providers](AI-Providers.md)            | Keys, priority chain, fallback, ai_usage               |
| [DataLens](DataLens.md)                    | CSV datasets, Public API, webhook                      |
| [Deploy](Deploy.md)                        | Ubuntu + nginx + systemd + certbot layout              |
| [FAQ](FAQ.md)                              | Frequently asked questions                             |

## Full documentation (repo)

- [User guide (EN)](https://github.com/Fighter90/ai-product-copilot/blob/main/docs/en/user-guide.md)
- [Architecture](https://github.com/Fighter90/ai-product-copilot/blob/main/docs/architecture.md) (RU)
- [Data model](https://github.com/Fighter90/ai-product-copilot/blob/main/docs/data-model.md) (RU)
- [Quickstart](https://github.com/Fighter90/ai-product-copilot/blob/main/docs/quickstart.md) (RU)
- [Deploy](https://github.com/Fighter90/ai-product-copilot/blob/main/docs/deploy.md) (RU)
- [Help center sources](https://github.com/Fighter90/ai-product-copilot/tree/main/docs/help) — 20 articles × RU/EN
- [README](https://github.com/Fighter90/ai-product-copilot/blob/main/README.en.md)

## Sources & publishing

Wiki sources live in [`docs/wiki/`](https://github.com/Fighter90/ai-product-copilot/tree/main/docs/wiki)
and are published to the GitHub Wiki by
`scripts/publish-wiki.sh` (maintainer-run).
