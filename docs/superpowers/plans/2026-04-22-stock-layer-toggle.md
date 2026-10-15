# Stock Layer Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `useStockImages` toggle to brand configurations and pipeline contexts to allow controlling stock image usage.

**Architecture:** Update TypeScript interfaces in `src/types.ts`, propagate the toggle through pipeline runners and context creators, and enable it by default for existing brands.

**Tech Stack:** TypeScript

---

### Task 1: Update Types in `src/types.ts`

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Add `useStockImages: boolean` to `BrandConfig`**
- [ ] **Step 2: Add `useStockImages?: boolean` to `RunContext`, `ReelContext`, and `ReelRunOptions`**

### Task 2: Update Pipeline Runners and Context

**Files:**
- Modify: `src/pipeline/runner.ts`
- Modify: `src/pipeline/context.ts`
- Modify: `src/pipeline/reel-runner.ts`

- [ ] **Step 1: Add `useStockImages?: boolean` to `RunOptions` in `src/pipeline/runner.ts`**
- [ ] **Step 2: Update `createRunContext` in `src/pipeline/context.ts` to initialize `useStockImages`**
- [ ] **Step 3: Update `PipelineRunner.run` in `src/pipeline/runner.ts` to pass `useStockImages` from options to `createRunContext`**
- [ ] **Step 4: Update `ReelRunner.run` in `src/pipeline/reel-runner.ts` to initialize `useStockImages` from options or brand config**

### Task 3: Update Brand Configurations

**Files:**
- Modify: `src/brands/ds.ts`
- Modify: `src/brands/ns.ts`

- [ ] **Step 1: Set `useStockImages: true` in `ds.ts`**
- [ ] **Step 2: Set `useStockImages: true` in `ns.ts`**

### Task 4: Verification

- [ ] **Step 1: Run build**
- [ ] **Step 2: Commit changes**
