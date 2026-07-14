---
summary: Records the decision to include a thin authenticated website in v1 while avoiding a marketing site or custom dashboard system.
read_when:
  - reconsidering whether the website belongs in v1 or expanding its product scope
  - adding website infrastructure, design-system customization, or unauthenticated routes
---

# Include a thin authenticated website in v1

Trademark Turtle includes a private Vite/React website in v1 instead of remaining headless. Direct search, reports, mark detail, corpus freshness, and API-key self-service justify the additional Clerk and deployment surface; stock COSS UI components and the narrow contract in `docs/website.md` keep that surface small and prevent it from becoming a marketing site or custom dashboard framework.
