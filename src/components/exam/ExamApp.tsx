import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import type { ExamTask, TasksPayload } from "@/lib/exam-types";
import {
  clearPersistedSession,
  countCorrect,
  getCorrectAnswerIds,
  isResponseCorrect,
  loadPersistedSession,
  pickSessionTasks,
  QUESTIONS_PER_SESSION,
  savePersistedSession,
  sessionFromTasks,
  type ExamPhase,
} from "@/lib/exam-session";

function findAnswerText(task: ExamTask, answerId: number | null): string {
  if (answerId === null) return "—";
  const a = task.answers.find(x => x.id === answerId);
  return a?.answer ?? "—";
}

function restoreTasksFromIds(ids: number[], all: ExamTask[]): ExamTask[] {
  const map = new Map(all.map(t => [t.id, t]));
  return ids.map(id => map.get(id)).filter((t): t is ExamTask => t !== undefined);
}

export function ExamApp() {
  const [phase, setPhase] = useState<ExamPhase>("home");
  const [pool, setPool] = useState<ExamTask[]>([]);
  const [sessionTasks, setSessionTasks] = useState<ExamTask[]>([]);
  const [answers, setAnswers] = useState<Record<number, number | null>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const snapshot = useCallback(
    (nextPhase: "quiz" | "results", tasks: ExamTask[], ans: Record<number, number | null>, idx: number) => {
      const prev = loadPersistedSession();
      savePersistedSession({
        version: 1,
        phase: nextPhase,
        taskIds: tasks.map(t => t.id),
        answers: Object.fromEntries(tasks.map(t => [String(t.id), ans[t.id] ?? null])),
        currentIndex: idx,
        startedAt: prev?.startedAt ?? new Date().toISOString(),
      });
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/data/tasks.json");
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : res.statusText);
        const data = body as TasksPayload;
        if (cancelled) return;
        setPool(data.tasks);
        setLoadError(null);

        const saved = loadPersistedSession();
        if (saved?.taskIds?.length) {
          const restored = restoreTasksFromIds(saved.taskIds, data.tasks);
          if (restored.length === saved.taskIds.length) {
            const ans: Record<number, number | null> = {};
            for (const id of saved.taskIds) {
              ans[id] = saved.answers[String(id)] ?? null;
            }
            setSessionTasks(restored);
            setAnswers(ans);
            setCurrentIndex(Math.min(saved.currentIndex, restored.length - 1));
            setPhase(saved.phase === "results" ? "results" : "quiz");
          }
        }
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Failed to load exam");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const startNewSession = useCallback(() => {
    if (pool.length === 0) return;
    clearPersistedSession();
    const picked = pickSessionTasks(pool);
    setSessionTasks(picked);
    const init: Record<number, number | null> = {};
    for (const t of picked) init[t.id] = null;
    setAnswers(init);
    setCurrentIndex(0);
    setPhase("quiz");
    savePersistedSession(sessionFromTasks(picked));
  }, [pool]);

  const total = sessionTasks.length;
  const currentTask = sessionTasks[currentIndex];
  const progressPct = total > 0 ? Math.round(((currentIndex + 1) / total) * 100) : 0;

  const goNext = () => {
    if (!currentTask) return;
    if (currentIndex >= total - 1) {
      snapshot("results", sessionTasks, answers, currentIndex);
      setPhase("results");
      return;
    }
    const next = currentIndex + 1;
    setCurrentIndex(next);
    snapshot("quiz", sessionTasks, answers, next);
  };

  const selectAnswer = (value: string) => {
    if (!currentTask) return;
    const id = Number.parseInt(value, 10);
    const next = { ...answers, [currentTask.id]: id };
    setAnswers(next);
    snapshot("quiz", sessionTasks, next, currentIndex);
  };

  const finishSession = () => {
    snapshot("results", sessionTasks, answers, currentIndex);
    setPhase("results");
  };

  const score = useMemo(() => countCorrect(sessionTasks, answers), [sessionTasks, answers]);

  const incorrectItems = useMemo(() => {
    return sessionTasks.filter(t => !isResponseCorrect(t, answers[t.id] ?? null));
  }, [sessionTasks, answers]);

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl p-6 text-center text-muted-foreground">
        Загрузка вопросов…
      </div>
    );
  }

  if (loadError) {
    return (
      <Card className="mx-auto max-w-lg border-destructive/50">
        <CardHeader>
          <CardTitle>Нет данных</CardTitle>
          <CardDescription>{loadError}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (phase === "home") {
    return (
      <Card className="mx-auto w-full max-w-lg text-left">
        <CardHeader>
          <CardTitle>Экзаменационные вопросы</CardTitle>
          <CardDescription>
            Сессия из {Math.min(QUESTIONS_PER_SESSION, pool.length)} случайных вопросов из {pool.length}. Работает
            офлайн после первой загрузки (PWA).
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Button className="w-full" size="lg" onClick={startNewSession} disabled={pool.length === 0}>
            Начать сессию
          </Button>
        </CardFooter>
      </Card>
    );
  }

  if (phase === "quiz" && currentTask) {
    const selected = answers[currentTask.id];
    const valueStr = selected != null ? String(selected) : "";

    return (
      <div className="mx-auto w-full max-w-3xl space-y-6 p-4 text-left">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
            <span>
              Вопрос {currentIndex + 1} из {total}
            </span>
            <Badge variant="secondary">{progressPct}%</Badge>
          </div>
          <Progress value={progressPct} />
        </div>

        <Card>
          <CardHeader className="space-y-4">
            <CardTitle className="text-base font-medium leading-relaxed whitespace-pre-wrap">
              {currentTask.question}
            </CardTitle>
            <div className="overflow-hidden rounded-md border bg-muted/30">
              <img
                src={`/images/${encodeURIComponent(currentTask.img)}`}
                alt=""
                className="mx-auto max-h-[min(420px,50vh)] w-auto max-w-full object-contain"
                loading="lazy"
              />
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <Label className="text-base">Выберите ответ</Label>
            <RadioGroup value={valueStr} onValueChange={selectAnswer} className="gap-3">
              {currentTask.answers.map(a => (
                <div
                  key={a.id}
                  className="flex items-start gap-3 rounded-lg border border-transparent px-2 py-2 has-data-[state=checked]:border-primary/40 has-data-[state=checked]:bg-muted/40"
                >
                  <RadioGroupItem value={String(a.id)} id={`a-${a.id}`} className="mt-1" />
                  <Label htmlFor={`a-${a.id}`} className="cursor-pointer font-normal leading-snug">
                    {a.answer}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </CardContent>
          <CardFooter className="flex flex-wrap justify-between gap-2">
            <Button
              variant="outline"
              onClick={() => {
                clearPersistedSession();
                setPhase("home");
                setSessionTasks([]);
                setAnswers({});
                setCurrentIndex(0);
              }}
            >
              На главную
            </Button>
            <div className="flex gap-2">
              {currentIndex < total - 1 ? (
                <Button onClick={goNext} disabled={selected == null}>
                  Далее
                </Button>
              ) : (
                <Button onClick={finishSession} disabled={selected == null}>
                  Завершить
                </Button>
              )}
            </div>
          </CardFooter>
        </Card>
      </div>
    );
  }

  if (phase === "results") {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-6 p-4 text-left">
        <Card>
          <CardHeader>
            <CardTitle>Результаты сессии</CardTitle>
            <CardDescription>
              Правильных ответов:{" "}
              <span className="font-semibold text-foreground">
                {score} / {total}
              </span>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {incorrectItems.length === 0 ? (
              <p className="text-muted-foreground">Все ответы верны.</p>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  Неверные ответы ({incorrectItems.length}) — для повторения:
                </p>
                <ScrollArea className="h-[min(480px,60vh)] pr-4">
                  <ul className="space-y-6">
                    {incorrectItems.map(t => {
                      const correctIds = getCorrectAnswerIds(t);
                      const correctTexts = t.answers.filter(a => a.isCorrect).map(a => a.answer);
                      return (
                        <li key={t.id} className="space-y-3">
                          <Separator />
                          <p className="whitespace-pre-wrap text-sm font-medium">{t.question}</p>
                          <div className="overflow-hidden rounded-md border bg-muted/20">
                            <img
                              src={`/images/${encodeURIComponent(t.img)}`}
                              alt=""
                              className="mx-auto max-h-40 w-auto max-w-full object-contain"
                              loading="lazy"
                            />
                          </div>
                          <div className="space-y-1 text-sm">
                            <p>
                              <span className="text-muted-foreground">Ваш ответ: </span>
                              {findAnswerText(t, answers[t.id] ?? null)}
                            </p>
                            <p>
                              <span className="text-muted-foreground">Верно: </span>
                              {correctIds.length === 0 ? (
                                <span className="text-amber-600 dark:text-amber-400">
                                  в данных не отмечен правильный вариант
                                </span>
                              ) : (
                                correctTexts.join(" · ")
                              )}
                            </p>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </ScrollArea>
              </>
            )}
          </CardContent>
          <CardFooter>
            <Button
              className="w-full"
              onClick={() => {
                clearPersistedSession();
                setPhase("home");
                setSessionTasks([]);
                setAnswers({});
                setCurrentIndex(0);
              }}
            >
              Новая сессия
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return null;
}
