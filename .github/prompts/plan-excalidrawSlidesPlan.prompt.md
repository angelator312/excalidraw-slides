Plan: model‑mapped task list

GPT 5 mini
1. Scaffold client + server: `package.json`, `vite.config.ts`, `src/entry.tsx`, `server/src/index.ts`, basic NPM scripts.
2. Create UI skeletons: `src/presentation/plugin.tsx`, `ToolbarButton.tsx`, `PresenterView.tsx` shells with ARIA.
3. Implement slide model helpers: `src/presentation/slideModel.ts` — `getSlidesFromFile()`, `serializeSlide()`, `deserializeSlide()`.
4. Client export: `src/presentation/export.ts` using `html2canvas` to produce PNGs.
5. GridFS helper (basic): `server/src/storage/thumbnail.ts` to store/retrieve thumbnail files.
6. Simple unit tests: `tests/slideModel.test.ts` and test harness.
7. Docker/dev compose: minimal `docker-compose.yml` (MongoDB + optional Redis).

Claude Sonnet 4.5
1. Design and implement REST APIs + DB models: `server/src/api/presentations.ts`, `auth.ts`, `teams.ts` and models (`user.ts`, `team.ts`, `presentation.ts`, `slide.ts`, `version.ts`, `snapshot.ts`, `sharelink.ts`, `authToken.ts`).
2. Auth flows: owner one‑time token generation/accept flow, session issuance, email-as-username enforcement.
3. Team management: create-on-demand teams, add/remove member by username, user-search behavior and invite fallback.
4. Permissions middleware: `server/src/middleware/perm.ts` enforcing visibility/ACLs and sharelink logic.
5. Realtime server + client implementation: `server/src/ws.ts` (socket.io), `src/presentation/rtc.ts` client wrapper — protocol `joinRoom`, `presence`, `diff`, `slideChange`, `snapshot`.
6. Versioning job & snapshots: `server/src/jobs/pruneVersions.ts`, snapshot APIs, history UI `src/presentation/history.tsx`.
7. Presenter UX & pointer sync: implement pointer broadcast, smoothing, and thumbnails hooks.
8. Integration tests: `tests/ws.integration.ts` multi-client scenario.

Claude Hainku 4.5
1. Security & threat model: token lifecycle, revocation, CSRF/XSS/serialization hardening for scene JSON, sensitive endpoints review.
2. Scaling & architecture: multi-instance socket.io with Redis adapter, sticky session guidance, DB indexing and sharding considerations, autoscaling guidance.
3. CRDT migration plan: concrete migration path from server-authoritative diffs → `yjs` (data model, storage, dual-mode runbook).
4. Performance & storage strategy: audit log retention policy design, snapshot/thumbnail storage costs and pruning strategy, GridFS vs S3 decision with migration plan.
5. Compliance & privacy: PII handling rules (email-as-username), GDPR/retention implications, secure default configurations.
6. Final security review before production release and detailed mitigation steps.

Rapter AI mini (Preview)
1. Code quality & maintainability: set up linting, formatting, and commit hooks;
2. Developer experience: comprehensive README, contribution guidelines, API documentation, and onboarding guide.
3. Monitoring & observability: integrate logging, error tracking, and performance monitoring tools; define
4. Give ideas to test the code