/** All practice behavior stays in the browser; no API calls are made here. */
export function shuffle(items, random = Math.random) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function validQuestion(question) {
  return Boolean(
    question && typeof question.id === 'string' && question.id &&
    typeof question.prompt === 'string' && question.prompt.trim() &&
    Array.isArray(question.choices) && question.choices.length === 3 &&
    question.choices.every(choice => typeof choice.id === 'string' && choice.id && typeof choice.text === 'string' && choice.text.trim()) &&
    new Set(question.choices.map(choice => choice.id)).size === 3 &&
    question.choices.filter(choice => choice.id === question.correct_choice_id).length === 1 &&
    typeof question.explanation === 'string' && question.explanation.trim() &&
    typeof question.quote === 'string' && question.quote.trim() &&
    typeof question.file_name === 'string' && question.file_name.trim() &&
    typeof question.source_id === 'string' && question.source_id &&
    typeof question.region_id === 'string' && question.region_id
  );
}

export class QuizSession {
  constructor(questions, random = Math.random) {
    this.random = random;
    const seen = new Set();
    this.questions = questions.filter(question => {
      if (!validQuestion(question) || seen.has(question.id)) return false;
      seen.add(question.id);
      return true;
    });
    this.restart();
  }

  restart() {
    this.order = shuffle(this.questions, this.random).map(question => ({
      ...question,
      choices: shuffle(question.choices, this.random),
    }));
    this.index = 0;
    this.answers = [];
    this.selectedId = null;
    return this.current;
  }

  get current() { return this.order[this.index] ?? null; }
  get total() { return this.order.length; }
  get complete() { return this.total > 0 && this.index >= this.total; }
  get answered() { return this.selectedId !== null; }
  get score() { return this.answers.filter(answer => answer.correct).length; }

  answer(choiceId) {
    if (!this.current || this.answered || !this.current.choices.some(choice => choice.id === choiceId)) return null;
    this.selectedId = choiceId;
    const result = {
      questionId: this.current.id,
      choiceId,
      correct: choiceId === this.current.correct_choice_id,
    };
    this.answers.push(result);
    return result;
  }

  next() {
    if (!this.answered || !this.current) return false;
    this.index += 1;
    this.selectedId = null;
    return true;
  }
}
