---
summary: Routes Trademark Terminal maintainer workflows for development, testing, deployment, source repair, and Linear issues.
read_when:
  - running repository, database, Compose, deployment, repair, or issue-tracker workflows
  - diagnosing a failing check, runtime, source file, Mac mini release, or documentation route
---

# Operations

Operations docs describe what maintainers run, the expected result, and how to
recover safely.

| Workflow | Doc |
| --- | --- |
| Install, live-data local servers, synthetic data seeding, ports, and readiness | [Development](development.md) |
| Environment contract, 1Password sources, and bootstrap identities | [Environment](environment.md) |
| Verification lanes and fixture expectations | [Testing](testing.md) |
| Mac mini release, smoke, monitoring, and rollback | [Deployment](deployment.md) |
| Centralized-auth inventory, backup, mapping, cutover, and rollback | [Access cutover](access-cutover.md) |
| CLI and HTTP client npm releases | [npm packages](npm-packages.md) |
| Inspect and repair one source file | [Source repair](source-repair.md) |
| Create and triage Linear issues | [Issues](issues.md) |
| Maintain repository docs | [Docs policy](../docs-policy.md) |
