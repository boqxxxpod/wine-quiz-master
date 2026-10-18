/** All practice behavior stays in the browser; no API calls are made here. */
export function shuffle(items, random = Math.random) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

const nonemptyString = value => typeof value === 'string' && Boolean(value.trim());
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Native files carry their own provenance instead of server source/region IDs. */
export function isNativeQuestion(question) {
  return record(question) && ['question', 'options', 'correct_option_id', 'primary_country', 'countries', 'sources']
    .some(key => Object.hasOwn(question, key));
}

/** Keep native metadata intact while exposing the same quiz fields as version 1. */
export function normalizeQuestion(question) {
  if (!record(question) || !isNativeQuestion(question)) return question;
  return {
    ...question,
    prompt: question.question,
    choices: Array.isArray(question.options) ? question.options.map(option => record(option) ? { ...option } : option) : question.options,
    correct_choice_id: question.correct_option_id,
  };
}

export function validQuestion(question) {
  if (!record(question)) return false;
  const native = isNativeQuestion(question);
  const prompt = native ? question.question : question.prompt;
  const choices = native ? question.options : question.choices;
  const correctId = native ? question.correct_option_id : question.correct_choice_id;
  if (!nonemptyString(question.id) || !nonemptyString(prompt) ||
    !Array.isArray(choices) || choices.length !== 3 ||
    !choices.every(choice => record(choice) && nonemptyString(choice.id) && nonemptyString(choice.text)) ||
    new Set(choices.map(choice => choice.id)).size !== 3 ||
    choices.filter(choice => choice.id === correctId).length !== 1 ||
    !nonemptyString(question.explanation)) return false;

  if (native) {
    return ['type', 'question_type'].every(key => question[key] === undefined || question[key] === 'single_choice') &&
      nonemptyString(question.primary_country) &&
      Array.isArray(question.countries) && question.countries.length > 0 &&
      question.countries.every(nonemptyString) &&
      new Set(question.countries).size === question.countries.length &&
      question.countries.includes(question.primary_country) &&
      Array.isArray(question.sources) && question.sources.length > 0 &&
      question.sources.every(source => record(source) && Object.keys(source).length > 0) &&
      (question.validation === undefined || record(question.validation));
  }
  return ['quote', 'file_name', 'source_id', 'region_id'].every(key => nonemptyString(question[key]));
}

function uniqueValidQuestions(questions) {
  const seen = new Set();
  return (Array.isArray(questions) ? questions : []).filter(question => {
    if (!validQuestion(question) || seen.has(question.id)) return false;
    seen.add(question.id);
    return true;
  });
}

/** A cross-country question belongs to each country listed in its metadata. */
export function questionsForCountry(questions, country = null) {
  return uniqueValidQuestions(questions)
    .filter(question => country === null || (Array.isArray(question.countries) && question.countries.includes(country)));
}

/** Counts are by unique question ID, not by primary country or source count. */
export function countryCounts(questions) {
  const counts = new Map();
  for (const question of uniqueValidQuestions(questions)) {
    for (const country of question.countries ?? []) counts.set(country, (counts.get(country) ?? 0) + 1);
  }
  return counts;
}

export function availableCountries(questions) {
  return [...countryCounts(questions).keys()].sort((a, b) => a.localeCompare(b, 'ja'));
}

export class QuizSession {
  constructor(questions, random = Math.random, country = null) {
    this.random = random;
    this.questions = uniqueValidQuestions(questions).map(normalizeQuestion);
    this.country = country;
    this.restart();
  }

  restart(country = this.country) {
    this.country = country;
    this.order = shuffle(questionsForCountry(this.questions, this.country), this.random).map(question => ({
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
