import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runCommand } from '@no-middleman/verifiers';

export interface FlowOutcome {
  id: string; // jest fullName
  file: string;
  votes: boolean[]; // one entry per run the flow appeared in
  passed: boolean; // majority
  flaky: boolean; // mixed votes
}

export interface DetoxRunOptions {
  appDir: string;
  configuration: string;
  /** Total runs a red flow gets, including the first (§6.2 default 3). */
  maxRuns?: number;
  timeoutMs?: number;
  exec?: typeof runCommand;
}

interface JestAssertion {
  fullName: string;
  status: string;
}

interface JestTestFile {
  name: string;
  assertionResults: JestAssertion[];
}

export interface ParsedRun {
  flows: { id: string; file: string; passed: boolean }[];
}

// jest --json output -> per-flow pass/fail.
export function parseJestJson(text: string): ParsedRun {
  const parsed = JSON.parse(text) as { testResults: JestTestFile[] };
  const flows = parsed.testResults.flatMap((file) =>
    file.assertionResults.map((assertion) => ({
      id: assertion.fullName,
      file: file.name,
      passed: assertion.status === 'passed',
    })),
  );
  return { flows };
}

// Majority vote per flow across however many runs it appeared in.
export function majorityVote(votesPerFlow: Map<string, { file: string; votes: boolean[] }>): FlowOutcome[] {
  return [...votesPerFlow.entries()].map(([id, { file, votes }]) => {
    const passes = votes.filter(Boolean).length;
    return {
      id,
      file,
      votes,
      passed: passes * 2 > votes.length,
      flaky: passes > 0 && passes < votes.length,
    };
  });
}

async function runOnce(
  options: DetoxRunOptions,
  exec: typeof runCommand,
  testFiles: string[],
  runIndex: number,
): Promise<{ parsed: ParsedRun; logPath: string; outputFile: string }> {
  const evidenceDir = join(options.appDir, '.nm/evidence');
  mkdirSync(evidenceDir, { recursive: true });
  const outputFile = join(evidenceDir, `detox-run-${runIndex}.json`);
  rmSync(outputFile, { force: true });

  const args = [
    'detox',
    'test',
    '-c',
    options.configuration,
    ...testFiles,
    '--',
    '--json',
    `--outputFile=${outputFile}`,
  ];
  const outcome = await exec('npx', args, options.appDir, options.timeoutMs ?? 15 * 60 * 1000);
  const logPath = join(evidenceDir, `detox-run-${runIndex}.log`);
  writeFileSync(logPath, outcome.output, 'utf8');

  if (!existsSync(outputFile)) {
    throw new Error(
      `detox produced no jest JSON (exit ${outcome.code}) — oracle is broken, not red; log: ${logPath}`,
    );
  }
  return { parsed: parseJestJson(readFileSync(outputFile, 'utf8')), logPath, outputFile };
}

export interface DetoxSuiteResult {
  flows: FlowOutcome[];
  passed: boolean;
  logs: string[];
  artifacts: string[];
}

// First run covers the whole suite; red flows get their files re-run up to
// maxRuns total, and each flow's fate is the majority of its votes.
export async function runDetoxSuite(options: DetoxRunOptions): Promise<DetoxSuiteResult> {
  const exec = options.exec ?? runCommand;
  const maxRuns = options.maxRuns ?? 3;
  const logs: string[] = [];
  const artifacts: string[] = [];
  const votesPerFlow = new Map<string, { file: string; votes: boolean[] }>();

  const record = (parsed: ParsedRun) => {
    for (const flow of parsed.flows) {
      const entry = votesPerFlow.get(flow.id) ?? { file: flow.file, votes: [] };
      entry.votes.push(flow.passed);
      votesPerFlow.set(flow.id, entry);
    }
  };

  const first = await runOnce(options, exec, [], 1);
  logs.push(first.logPath);
  artifacts.push(first.outputFile);
  record(first.parsed);

  // Zero flows means the suite never ran (setup crash, bad config). That is
  // a broken oracle, not a green one — refuse to report anything.
  if (votesPerFlow.size === 0) {
    throw new Error(`detox ran zero flows — oracle is broken, not green; log: ${first.logPath}`);
  }

  for (let run = 2; run <= maxRuns; run++) {
    const undecidedFiles = [
      ...new Set(
        majorityVote(votesPerFlow)
          .filter((flow) => flow.votes.includes(false))
          .map((flow) => flow.file),
      ),
    ];
    if (undecidedFiles.length === 0) break;
    const retry = await runOnce(options, exec, undecidedFiles, run);
    logs.push(retry.logPath);
    artifacts.push(retry.outputFile);
    record(retry.parsed);
  }

  const flows = majorityVote(votesPerFlow);
  return { flows, passed: flows.every((flow) => flow.passed), logs, artifacts };
}
