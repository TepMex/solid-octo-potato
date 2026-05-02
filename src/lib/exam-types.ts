export type ExamAnswer = {
  id: number;
  answer: string;
  isCorrect: boolean;
};

export type ExamTask = {
  id: number;
  img: string;
  question: string;
  answers: ExamAnswer[];
};

export type TasksPayload = {
  tasks: ExamTask[];
};
