# Session Heartbeat Lease Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep explicitly attached browser sessions instantly reconnectable while still reclaiming idle backend agents after the browser disappears.

**Architecture:** The browser sends heartbeat requests for every locally known active run. `SessionManager` treats a fresh heartbeat as a short-lived lease; idle sessions with a fresh lease are not reclaimed, while orphaned idle sessions are closed after a short grace period.

**Tech Stack:** Express routes, `SessionManager`, shared TypeScript API types, React App state/effects, Vitest.

---

### Task 1: Shared API and Route Contract

**Files:**
- Modify: `packages/shared/src/api.ts`
- Modify: `packages/shared/src/types.ts`
- Test: `packages/server/src/chatRoutes.test.ts`
- Test: `packages/web/src/chatApi.test.ts`

- [x] Add `SessionHeartbeatResponse` with `ok`, `runId`, `status`, `attached`, `leaseExpiresAt`.
- [x] Extend `ActiveAgent` / `ActiveAgentsResponse` with `attached`, `lastHeartbeatAt`, `leaseExpiresAt`.
- [x] Add failing tests for `POST /api/sessions/:runId/heartbeat` and `chatApi.heartbeatSession()`.
- [x] Implement the route and client wrapper.

### Task 2: Backend Lease GC

**Files:**
- Modify: `packages/server/src/sessionManager.ts`
- Test: `packages/server/src/sessionManager.test.ts`

- [x] Add failing tests: heartbeat keeps idle run alive beyond `idleTimeoutMs`; orphan idle run is reclaimed after heartbeat TTL plus orphan idle grace.
- [x] Add `heartbeatTtlMs` and `orphanIdleTimeoutMs` options.
- [x] Replace simple idle timer behavior with lease-aware GC scheduling.
- [x] Keep executing/waiting sessions alive when orphaned; reclaim once they later become idle.

### Task 3: Frontend Heartbeat Pool

**Files:**
- Modify: `packages/web/src/chatApi.ts`
- Modify: `packages/web/src/App.tsx`
- Test: `packages/web/src/App.test.tsx`

- [x] Add failing test: after A is attached and user switches to B, frontend still heartbeats A from `activeRuns`.
- [x] Add failing test: heartbeat 404 removes stale `activeRuns` mapping.
- [x] Implement heartbeat interval over all local active run IDs plus current `runId`.
- [x] Stop heartbeat on logout by clearing `activeRuns` and `runId`.

### Task 4: Docs and Verification

**Files:**
- Modify: `docs/superpowers/specs/2026-06-18-active-agent-management-design.md`
- Modify: `docs/superpowers/specs/2026-06-14-cc-web-realtime-conversation-design.md`
- Modify: `docs/TECH-DEBT.md`
- Check: `CLAUDE.md`

- [x] Document heartbeat lease semantics and reclaim timings.
- [x] Confirm CLAUDE.md needs config/lifecycle wording updates and apply them.
- [x] Run focused backend/frontend tests.
- [x] Run `npm test --workspace @cc-web/server`, `npm test --workspace @cc-web/web`, and `npm run build`.
