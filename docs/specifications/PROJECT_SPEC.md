# Project Specification

> AI Operations Copilot for Small & Medium Businesses (SMBs)

Status: **Draft·v0** · Owner: Carlos05-code · Last updated: 2026-08-02

## 1. Vision

Every small business should have a **virtual operations manager** — an always-on
assistant that watches the incoming stream of work (messages, emails, documents,
invoices, spreadsheets), keeps the state of the business in one place, plans the
day, and executes routine back-office work before the owner ever has to.

## 2. Problem Statement

Small businesses waste hours every day juggling tools: WhatsApp, Email, Excel
spreadsheets, invoices, calendars, inventory systems, CRMs, and accounting
software. Data lives in silos, decisions are made on stale or incomplete
information, and operational processes (follow-ups, reordering, invoicing,
reporting) are performed manually and inconsistently. There is no single brain
that understands the business state and can act on it.

## 3. Goals

1. Centralize business operations into a **single intelligent platform**.
2. Automate workflows: invoice generation, scheduling, task planning, notifications.
3. Provide AI-powered **decision support**: forecasts, recommendations, insights.
4. Make every business conversation and document **retrievable and answerable**.
5. Reduce manual, repetitive back-office work for SMB owners and staff.
6. Be multi-tenant, secure, and privacy-aware from day one.

## 4. Non-Goals (Phase 0 foundation; may later become goals)

- Not a general-purpose LLM chatbot; the copilot is grounded in _your_ business data.
- Not an accounting system; it orchestrates/imports/derives and pushes to accounting.
- Not a replacement for the CRM or ERP of record; it integrates with them.
- Not a social / customer marketing network.
- No multilingual UI beyond the defined locale strategy in France (English + PT-BR).
- No offline-only usage: the product is cloud-first with offline read cache.

## 5. Target Customers

Primary segments:

| Segment | Description | Typical use cases |
| ------- | ----------- | ----------------- |
| Micro & small retail | Shops, e-commerce D2C | inventory, purchase recs, sales forecast, invoicing |
| Local services | Salons, clinics, agencies | appointments, reminders, follow-ups, summaries |
| Wholesale / distributors | small trades with invoices | invoicing, AR tracking, purchase recs |
| Solo-professionals | Freelancers, consultants | time tracking, invoicing, client summaries |

Sizing: customer orgs with **2–50 employees**, up to **100k customers/documents**,
multiple channels (WhatsApp, email, Excel).

## 6. Business Personas

| Persona | Role | Key motivations | Frustrations to fix |
| ------- | ---- | ----------------- | ------------------- |
| Owner / Founder | decision-maker, operator | save time, see numbers | data scattered, late follow-ups |
| Operations Manager | back-office lead | reduce manual work, standardize ops | chasing data across apps |
| Sales / Support | customer-facing | quick answers, follow-ups | re-finding conversation context |
| Freelancer | sole operator | low maintenance, fast setup | admin burden after work |
| Accountant (external) | books kept | cheap, exportable data | reconciliations |

## 7. Functional Requirements

High-level capability map (see API_SPEC and ROADMAP for detail).

1. **AI task planning** — propose, prioritize, and schedule operational tasks from
   signals (invoices, inventory lows, follow-ups).
2. **Automatic invoice generation** — create and send invoices from orders/recurring
   contracts; detect payments; escalate overdue.
3. **Inventory tracking** — stock levels, low-stock alerts, purchase suggestions.
4. **Customer conversation summaries** — compress WhatsApp/email threads per customer.
5. **Appointment scheduling** — availability, booking, reminders, rescheduling.
6. **Purchase recommendations** — reorder at the right time/volume.
7. **Sales forecasting** — a simple, transparent forecast to decide staffing/stock.
8. **WhatsApp integration** — inbound/outbound, message templates.
9. **Email integration** — inbox, classification, connections to knowledge base.
10. **Executive dashboard** — KPIs, funnel, alerts, insights.
11. **Document search & OCR** — upload PDFs/images, extract (+searchable).
12. **AI chat** — grounded Q&A with citations.
13. **Knowledge base** — document repository per organization.
14. **Semantic search** — hybrid (keyword + vector + graph).
15. **Notifications** — in-app, WhatsApp, email triggers.
16. **Team management** — roles, invites, permissions (RBAC).
17. **Analytics & reports** — exports, cohorts, usage.

## 7. Non-Functional Requirements

| Concern | Requirement |
| ------- | ----------- |
| Performance | p95 < 800 ms for API reads; AI calls streamed; embeddings < 2 s per doc chunk |
| Scale | 1k+ concurrent users/org; multi-tenant data isolation; horizontal scaling |
| Availability | 99.9% target for API; async jobs idempotent, retried with backoff |
| Security | OWASP-top-ten; RBAC; per-tenant isolation; secrets vault; audit logs |
| Privacy | GDPR-aligned; data residency configurable; deletion/export workflows |
| Observability | Trace, metrics, logs via OpenTelemetry; dashboards |
| Reliability | Eventual consistency across graph/vector/relational; dead-letter queues |
| Maintainability | Clean Architecture, monorepo, full docs, ADR-driven changes |
| Compliance | Data localization; records retention for invoice/platform audit |

## 8. Business Constraints

- SMB budgets: must remain affordable vs. an internal ops hire; heavy cost control.
- Multi-channel: must integrate with the tools SMBs already use.
- Data ownership: customers bring their own accounts (BYOK for AI providers, optional).
- Regulatory: invoices/records, privacy laws (GDPR etc.), clean deletion.
- Ops model: monthly subscription + usage-based AI tokens.

## 10. Success Metrics

- Operational metrics: avg weekly time saved per account; tasks completed by AI.
- Retention: revenue, weekly activations, monthly new invoices generated.
- Product health: DAU/WAU, AI answer acceptance, avg response time.
- Monetization: MRR, gross margin on AI tokens, conversion funnel.

## 11. Risks

| Risk | Probability | Impact | Mitigation |
| ---- | ----------- | ------ | ---------- |
| Hallucinated / stale answers | High | High | citations, confidence, human checkpoints |
| Data inaccuracy from import | Medium | High | validation, source-of-truth, audit trail |
| AI cost overrun | Medium | High | model routing, caching, cost thresholds |
| Privacy breach | Low | High | RBAC, audit, encryption, isolation |
| Vendor/WhatsApp API volatility | Medium | Medium | adapter pattern + fallback channels |
| User abandonment (SMB churn) | Medium | High | low-friction onboarding, focus on weekly value |

## 12. Future Vision

- In-app bytecode/roulette-native **AI agent marketplace** for vertical workflows.
- **Autopilot** modes where verified rules are fully executed without clicks.
- Knowledge graphs across entire customer organograms.
- Company-wide "departmental" apps (inventory, banking, shipping) connectors.
- Multi-language copilot and voice interfaces.

## 13. Roadmap

Follow [ROADMAP.md](../../ROADMAP.md).

---

## Appendix A — Terminology

| Term | Meaning |
| ---- | ------- |
| Organization | Tenant; an SMB paying for the product |
| Workspace | Sub-unit within an organization (branch/team) |
| Agent | An AI workflow instance scoped to a job |
| Knowledge base | The document + graph + vector store for an org |
| Corpus | Aggregated indexable text (per org/collection) |

## Appendix B — Related Documents

- [ARCHITECTURE_SPEC.md](./ARCHITECTURE_SPEC.md)
- [API_SPEC.md](./API_SPEC.md)
- [FRONTEND_SPEC.md](./FRONTEND_SPEC.md)
- [BACKEND_SPEC.md](./BACKEND_SPEC.md)
- [SECURITY_SPEC.md](./SECURITY_SPEC.md)
- [DATABASE_SPEC.md](./DATABASE_SPEC.md)