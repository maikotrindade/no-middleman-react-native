import type { Invariant } from './invariants.js';

// ---- Taxonomy axis 1: Trigger ----
export type Trigger =
  | { kind: 'manual' }
  | { kind: 'scheduled'; cadence: string; runner: 'claude-loop' | 'github-actions' | 'cron-print' }
  | { kind: 'event'; hook: 'PostToolUse' | 'Stop' | 'SubagentStop' };

// ---- Taxonomy axis 2: Intake (the goal + scope) ----
export interface Intake {
  goal: string;                              // natural-language intent from the developer
  spec?: string;                             // path to a written spec / acceptance criteria
  scope: { include: string[]; exclude: string[] }; // globs the maker may edit; enforced
}

// ---- Taxonomy axis 3: Verification (the oracle, composite) ----
export interface Verifier {
  readonly id: string;
  readonly gate: 'hard' | 'advisory';        // hard verifiers must pass to stop
  readonly cost: 'cheap' | 'moderate' | 'expensive'; // fail-fast ordering
  run(ctx: LoopContext): Promise<VerifierResult>;
}

export interface VerifierSignal {
  id: string;                                // e.g. 'e2e:login-flow'
  passed: boolean;
  detail?: string;
}

export interface Evidence {
  logs: string[];                            // paths to captured logs
  artifacts: string[];                       // paths to screenshots, reports, etc.
}

export interface VerifierResult {
  passed: boolean;
  signals: VerifierSignal[];                 // per-check breakdown
  evidence: Evidence;                        // logs, artifacts, screenshots, paths
}

export interface LoopContext {
  cwd: string;                               // worktree root the verifier runs against
  spec: LoopSpec;
  iteration: number;
}

// ---- Taxonomy axis 4: State model (memory) ----
export interface MemoryRef {
  workingState: string;                      // path to human-readable markdown state file
  lineage: string;                           // path to append-only JSONL journal
  adapter: 'file' | 'supabase';              // default 'file'
}

// ---- Taxonomy axis: Context (durable knowledge loaded each run) ----
// Loop Contract field "Context": the fixed, declared knowledge every iteration
// loads — kept explicit so context selection is deterministic, not accreted.
export interface ContextRef {
  instructions: string[];                    // CLAUDE.md / AGENTS.md / SKILL.md paths
  docs: string[];                            // supplementary doc paths/globs
}

// ---- Taxonomy axis 5: Topology ----
export type Topology = 'single-maker' | 'maker-checker' | 'explore-implement-verify';

// ---- Stopping rule ----
export interface StoppingRule {
  success: 'all-hard-verifiers-green';
  budget: { maxIterations: number; maxTokens: number; maxWallClockMs: number };
  // Headroom carved out of the budget and never spent on iteration, so the
  // loop can always package a clean handoff (final digest + draft PR) instead
  // of dying mid-escalation once the budget is truly exhausted.
  reserve?: { tokens: number; wallClockMs: number };
  onBudgetExceeded: 'open-draft-pr' | 'abort' | 'escalate';
}

// ---- Agents ----
export interface AgentRef {
  name: string;                              // maps to .claude/agents/<name>.md
  model: 'claude-opus-4-8';                  // Opus, 1M context
  isolation: 'worktree' | 'none';
}

// ---- The spec ----
export interface LoopSpec {
  id: string;
  taxonomy: {
    trigger: Trigger;
    intake: Intake;
    verification: Verifier[];                // composite; ordered cheap -> expensive
    stateModel: MemoryRef;
    context: ContextRef;                     // durable knowledge loaded each run
    topology: Topology;
    operatingDomain: 'react-native';
  };
  stopping: StoppingRule;
  agents: { maker: AgentRef; checker: AgentRef; specAuthor?: AgentRef };
  invariants: Invariant[];                   // enforced at load time
}
