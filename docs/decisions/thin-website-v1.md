---
summary: Records the decision to include a thin authenticated website in v1 while avoiding a marketing site or custom dashboard framework.
read_when:
  - reconsidering whether the website belongs in v1 or expanding its scope
  - adding anonymous routes, marketing content, dashboard infrastructure, or design-system customization
---

# Include A Thin Authenticated Website

Status: Accepted

Date: 2026-07-14

## Context

Direct search, reports, mark detail, source visibility, basic product help, and
API-key self-service are useful without requiring MerchBase. A headless-only
service would make those jobs unnecessarily difficult, while a full SaaS
marketing and dashboard surface would distract from the trademark service.

## Decision

V1 includes a private Vite/React website using shared MerchBase Clerk
authentication. It exposes authenticated search, reports, mark detail, and
API-key management; Status and Help are public. Source errors, file details, and
repair remain operator-only. Stock COSS UI and the documented visual system keep
the surface narrow.

## Consequences

- The website is a real product surface and receives browser acceptance.
- Customer and operator views share the same design quality.
- The server remains the source of truth for data and authorization.
- Marketing pages, billing, teams, and a custom dashboard system remain outside
  v1.
- Public status is aggregate operational information, not anonymous trademark
  search or mark-detail access.
