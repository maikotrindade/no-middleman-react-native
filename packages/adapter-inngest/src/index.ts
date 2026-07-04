import type { LoopHooks } from '@no-middleman/core';

// The durable-execution adapter interface (§5): anything with a step.run
// primitive — Inngest's `step`, Temporal activities behind a shim, or a test
// recorder — can make the loop's expensive hook calls durable/resumable.
export interface DurableStep {
  run<T>(id: string, fn: () => T | Promise<T>): Promise<T>;
}

// Wraps every loop hook in step.run with deterministic ids, so a durable
// engine can checkpoint each maker iteration, verifier-triggering step, and
// checker verdict. The XState journal remains the source of truth for
// replay; this only makes the side-effectful steps resumable.
export function durableHooks(hooks: LoopHooks, step: DurableStep): LoopHooks {
  return {
    plan: hooks.plan ? (ctx) => step.run('plan', () => hooks.plan!(ctx)) : undefined,
    build: hooks.build ? (ctx) => step.run('build', () => hooks.build!(ctx)) : undefined,
    makerStep: (ctx) => step.run(`maker-iteration-${ctx.iteration + 1}`, () => hooks.makerStep(ctx)),
    checker: (ctx, result) =>
      step.run(`checker-iteration-${ctx.iteration}`, () => hooks.checker(ctx, result)),
    report: hooks.report ? (outcome) => step.run('report', () => hooks.report!(outcome)) : undefined,
  };
}
