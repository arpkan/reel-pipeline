# StoryReel Admin Approval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require admin approval before any new Telegram chat can use StoryReel.

**Architecture:** Keep first-contact discovery via the dedicated StoryReel bot, but gate all non-admin commands until a chat has an approved profile. Store pending setup requests in SQLite so restarts do not lose approvals. Admin commands use `!admin approve`, `!admin approve <chatId>`, `!admin reject`, `!admin reject <chatId>`, and `!admin pending` from `STORYREEL_ADMIN_CHAT_ID` only.

**Tech Stack:** Node 22, TypeScript ESM, Drizzle ORM, better-sqlite3, Vitest, Telegram Bot API.

---

## File Structure

- Modify `src/services/telegram.ts`: preserve chat metadata (`chatTitle`, `chatType`, `chatUsername`) in parsed messages and keep global message polling for unknown chats.
- Modify `src/db/schema.ts` and `src/db/client.ts`: add `story_setup_requests` table.
- Modify `src/db/queries.ts`: add create/list/get/update/delete helpers for pending StoryReel setup requests.
- Modify `src/config.ts`: add `getStoryReelAdminChatId()`.
- Modify `src/pipeline/story-intake.ts`: parse `!admin approve [chatId]`, `!admin reject [chatId]`, and `!admin pending`.
- Modify `src/pipeline/command-listener.ts`: route admin commands, save pending setup requests, notify admin, and block unauthorized chats.
- Modify `.env` in the worktree only: add `STORYREEL_ADMIN_CHAT_ID=<admin-chat-id>`.
- Tests: extend `tests/telegram-service.test.ts`, `tests/storyreel-db.test.ts`, `tests/story-intake.test.ts`, and `tests/story-command-listener.test.ts`.

## Task 1: Telegram Chat Metadata

- [ ] Write failing test in `tests/telegram-service.test.ts` asserting parsed messages include `chatTitle`, `chatType`, and `chatUsername`.
- [ ] Run `npm test -- tests/telegram-service.test.ts` and confirm failure.
- [ ] Extend `TelegramUpdateMessage.chat` and `TelegramMessage` with optional chat metadata.
- [ ] Run `npm test -- tests/telegram-service.test.ts` and confirm pass.

## Task 2: Pending Setup Request Persistence

- [ ] Write failing DB test in `tests/storyreel-db.test.ts` for `upsertStorySetupRequest`, `getStorySetupRequestByChatId`, `getPendingStorySetupRequests`, `resolveLatestPendingStorySetupRequest`, `markStorySetupRequestRejected`, and `deleteStorySetupRequest`.
- [ ] Run `npm test -- tests/storyreel-db.test.ts` and confirm failure.
- [ ] Add `storySetupRequests` schema table and inline SQLite migration.
- [ ] Add query helpers in `src/db/queries.ts`.
- [ ] Run `npm test -- tests/storyreel-db.test.ts` and confirm pass.

## Task 3: Admin Command Parsing

- [ ] Write failing parser tests in `tests/story-intake.test.ts` for `!admin approve`, `!admin approve <chatId>`, `!admin reject`, `!admin reject <chatId>`, and `!admin pending`.
- [ ] Run `npm test -- tests/story-intake.test.ts` and confirm failure.
- [ ] Add `admin` command variant to `StoryCommand` and parse it.
- [ ] Run `npm test -- tests/story-intake.test.ts` and confirm pass.

## Task 4: Command Listener Authorization Flow

- [ ] Write failing listener tests in `tests/story-command-listener.test.ts` for setup pending, admin approve latest, admin approve explicit chat, admin pending, reject latest, unauthorized admin rejection, and blocked upload before approval.
- [ ] Run `npm test -- tests/story-command-listener.test.ts` and confirm failure.
- [ ] Add `getStoryReelAdminChatId()` and use it in `handleStoryReelCommand`.
- [ ] Implement setup flow: save pending request, notify admin with group name/title and chat ID, notify requester.
- [ ] Implement admin flow: only admin chat can use `!admin`; approve creates/upserts profile and deletes request; reject marks rejected and notifies group.
- [ ] Block non-setup/non-admin commands and uploads when the chat has no approved profile.
- [ ] Run `npm test -- tests/story-command-listener.test.ts` and confirm pass.

## Task 5: Verification And Docs

- [ ] Add `STORYREEL_ADMIN_CHAT_ID=<admin-chat-id>` to worktree `.env`.
- [ ] Update `AGENTS.md` with admin approval commands and env var.
- [ ] Run `npm test -- tests/telegram-service.test.ts tests/storyreel-db.test.ts tests/story-intake.test.ts tests/story-command-listener.test.ts tests/story-*.test.ts tests/storyreel-*.test.ts`.
- [ ] Run `npm run build`.
- [ ] Commit if requested.

## Self-Review

- Spec coverage: admin approval, group metadata, optional chat ID commands, persistence, and unauthorized blocking are covered.
- Placeholder scan: no placeholders remain.
- Type consistency: command parser uses a single `admin` variant and DB helpers use `chatId` as the stable approval key.
