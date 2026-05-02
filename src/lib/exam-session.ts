import type { ExamTask } from "./exam-types";

const SESSION_KEY = "energy-exam-session-v1";
const QUESTIONS_PER_SESSION = 20;

export type ExamPhase = "home" | "quiz" | "results";

export type PersistedSession = {
  version: 1;
  phase: "quiz" | "results";
  taskIds: number[];
  /** task id -> selected answer id, or null if not chosen */
  answers: Record<string, number | null>;
  currentIndex: number;
  startedAt: string;
};

function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

export function pickSessionTasks(all: ExamTask[]): ExamTask[] {
  const n = Math.min(QUESTIONS_PER_SESSION, all.length);
  const copy = shuffleInPlace([...all]);
  return copy.slice(0, n);
}

export function getCorrectAnswerIds(task: ExamTask): number[] {
  return task.answers.filter(a => a.isCorrect).map(a => a.id);
}

export function isResponseCorrect(task: ExamTask, selectedAnswerId: number | null): boolean {
  if (selectedAnswerId === null) return false;
  const correct = getCorrectAnswerIds(task);
  if (correct.length === 0) return false;
  return correct.includes(selectedAnswerId);
}

export function countCorrect(tasks: ExamTask[], answers: Record<number, number | null>): number {
  let n = 0;
  for (const t of tasks) {
    const sel = answers[t.id];
    if (isResponseCorrect(t, sel ?? null)) n += 1;
  }
  return n;
}

export function loadPersistedSession(): PersistedSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<PersistedSession>;
    if (p.version !== 1 || !p.taskIds) return null;
    return {
      version: 1,
      phase: p.phase === "results" ? "results" : "quiz",
      taskIds: p.taskIds,
      answers: p.answers ?? {},
      currentIndex: typeof p.currentIndex === "number" ? p.currentIndex : 0,
      startedAt: p.startedAt ?? new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function savePersistedSession(s: PersistedSession) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
}

export function clearPersistedSession() {
  sessionStorage.removeItem(SESSION_KEY);
}

export function sessionFromTasks(tasks: ExamTask[]): PersistedSession {
  return {
    version: 1,
    phase: "quiz",
    taskIds: tasks.map(t => t.id),
    answers: Object.fromEntries(tasks.map(t => [String(t.id), null as number | null])),
    currentIndex: 0,
    startedAt: new Date().toISOString(),
  };
}

export { QUESTIONS_PER_SESSION };
