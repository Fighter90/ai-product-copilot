# Roles and permissions

> Source: `docs/help/en/16-roles.md`, spec
> [openspec/specs/auth](https://github.com/Fighter90/ai-product-copilot/blob/main/openspec/specs/auth/spec.md).
> Русская версия: [Roles](../Roles).

Two roles: **Administrator** and **Analyst**. Public pages (landing `/`, sign-in `/login`,
help `/help`) need no session; everything under `/app` requires signing in.

## Permission matrix

| Cabinet section                             | Analyst | Administrator |
| ------------------------------------------- | :-----: | :-----------: |
| Overview, Live, Goals, pc-goals funnel      |   ✅    |      ✅       |
| Traffic, Behavior, Funnel, KPI, Explore     |   ✅    |      ✅       |
| Report, History, B2B                        |   ✅    |      ✅       |
| DataLens (datasets, "request refresh")      |   ✅    |      ✅       |
| Metrika sync                                |   ✅    |      ✅       |
| Users (invite, roles, password reset)       |   ❌    |      ✅       |
| AI providers (keys, priorities, test)       |   ❌    |      ✅       |
| Metrika & data (counter, token, cleanup)    |   ❌    |      ✅       |
| Integrations (DataLens connection, webhook) |   ❌    |      ✅       |
| Audit log                                   |   ❌    |      ✅       |

## How it works

- The "Administration" section appears in the navigation for administrators only.
- An analyst visiting `/app/admin/*` directly gets the **"Access denied" (403)** panel —
  access is granted by the project administrator.
- Significant actions (sign-ins, user operations, password changes) are written to the
  audit log.
- No guest accounts: the administrator creates accounts and hands over passwords via a
  secure channel.
