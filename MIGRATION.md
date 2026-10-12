# Migration to auth-services-monorepo

This repository consolidates `services/personal-email-signup-backend` and `services/login-page-back` into a single monorepo with full history preserved.

Old remotes archived locally:
- `old-origin`: previous monorepo remote (kept for archival only)
- `login-archive`: previous login-page-back upstream (local path preserved)
- `signup-archive`: previous personal-email-signup-backend upstream (local path preserved)

New canonical remote:
- https://github.com/bigdaddyhara/auth-services-monorepo

Instructions for contributors:
1. Clone the new repo:
   git clone https://github.com/bigdaddyhara/auth-services-monorepo.git
2. Work under services/* for service-specific changes.
3. Follow CONTRIBUTING.md and use the monorepo CI workflows.

Historical note: The original services were imported via git subtree; this migration preserves commit authorship and timestamps under the `services/` prefix.

