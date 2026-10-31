export const PRACTICE_COUNTS = Object.freeze([5, 10, 20, 30, 50, 70, 100]);
export const PRACTICE_ASSETS = Object.freeze([
  'fr-002.png', 'it-007-2.png', 'es-021.png',
  'it-023.jpg', 'it-024.jpg', 'it-025.jpg', 'it-026.jpg',
]);

/** Only bundled crops can be displayed, including when importing a custom pack. */
export function practiceAssetUrl(filename, moduleUrl = import.meta.url) {
  if (!PRACTICE_ASSETS.includes(filename)) throw new Error('未登録の原文画像です。');
  const url = new URL(`../question-packs/practice-assets/${filename}`, moduleUrl);
  const version = new URL(moduleUrl).searchParams.get('v');
  if (version) url.searchParams.set('v', version);
  return url;
}

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
const validCountries = question => Array.isArray(question.countries) && question.countries.length > 0 &&
  question.countries.every(nonemptyString) && new Set(question.countries).size === question.countries.length;

/** The registered review pack uses string options and a zero-based answer index. */
export function isPilotQuestion(question) {
  return record(question) && (question.format === 'pilot' || Object.hasOwn(question, 'question_id') || Object.hasOwn(question, 'correct_index'));
}

/** Native files carry their own provenance instead of server source/region IDs. */
export function isNativeQuestion(question) {
  return record(question) && !isPilotQuestion(question) && ['question', 'options', 'correct_option_id', 'primary_country', 'countries', 'sources']
    .some(key => Object.hasOwn(question, key));
}

/** Keep native metadata intact while exposing the same quiz fields as version 1. */
export function normalizeQuestion(question) {
  if (!record(question)) return question;
  if (isPilotQuestion(question)) {
    return {
      ...question,
      format: 'pilot',
      id: question.question_id,
      prompt: question.question,
      choices: Array.isArray(question.options) ? question.options.map((text, index) => ({
        id: question.question_type === 'matching' ? String.fromCharCode(65 + index) : `option-${index}`, text,
      })) : question.options,
      ...(question.question_type === 'matching' ? {} : { correct_choice_id: `option-${question.correct_index}` }),
    };
  }
  if (!isNativeQuestion(question)) return question;
  return {
    ...question,
    prompt: question.question,
    choices: Array.isArray(question.options) ? question.options.map(option => record(option) ? { ...option } : option) : question.options,
    correct_choice_id: question.correct_option_id,
  };
}

export function validQuestion(question) {
  if (!record(question)) return false;
  const pilot = isPilotQuestion(question);
  const native = isNativeQuestion(question);
  const normalized = pilot ? normalizeQuestion(question) : question;
  const prompt = native ? question.question : normalized.prompt;
  const choices = native ? question.options : normalized.choices;
  const correctId = native ? question.correct_option_id : normalized.correct_choice_id;
  const verbatim = pilot && question.source_verbatim === true;
  const matching = verbatim && question.question_type === 'matching';
  const choiceCount = matching ? 5 : verbatim && question.options?.length === 2 ? 2 : 3;
  if (!nonemptyString(normalized.id) || !nonemptyString(prompt) ||
    !Array.isArray(choices) || choices.length !== choiceCount ||
    !choices.every(choice => record(choice) && nonemptyString(choice.id) && nonemptyString(choice.text)) ||
    new Set(choices.map(choice => choice.id)).size !== choiceCount ||
    (!matching && choices.filter(choice => choice.id === correctId).length !== 1) ||
    !nonemptyString(question.explanation)) return false;

  if (question.source_image !== undefined && (!verbatim || !record(question.source_image) ||
    !PRACTICE_ASSETS.includes(question.source_image.filename) || !nonemptyString(question.source_image.alt) ||
    !['diagram', 'original'].includes(question.source_image.kind))) return false;
  if (question.context !== undefined && (!verbatim || !record(question.context) ||
    !nonemptyString(question.context.question) || !Array.isArray(question.context.options) ||
    question.context.options.length !== 3 || !question.context.options.every(nonemptyString))) return false;

  if (pilot) {
    if (!['single_choice', 'matching'].includes(question.question_type ?? 'single_choice') ||
      (question.question_type === 'matching' && !matching)) return false;
    if (matching) {
      if (!Array.isArray(question.matching_items) || question.matching_items.length !== 5 ||
        !question.matching_items.every(item => record(item) && nonemptyString(item.id) && nonemptyString(item.text)) ||
        new Set(question.matching_items.map(item => item.id)).size !== 5 ||
        !validMatchingAnswer(normalized, question.correct_matches) ||
        question.correct_answer !== question.matching_items.map(item => `${item.id}-${question.correct_matches[item.id]}`).join('、')) return false;
    } else if (!Number.isInteger(question.correct_index) || question.correct_index < 0 || question.correct_index >= choiceCount ||
      !nonemptyString(question.correct_answer) || question.options[question.correct_index] !== question.correct_answer) return false;
    return nonemptyString(question.knowledge_id) && nonemptyString(question.country) &&
      validCountries(question) && question.countries.includes(question.country) &&
      nonemptyString(question.topic) &&
      (typeof question.source_page === 'number' ? Number.isFinite(question.source_page) : nonemptyString(question.source_page)) &&
      ['auto_checked', 'approved'].includes(question.status) &&
      (question.version === undefined || question.version === 1);
  }

  if (native) {
    return ['type', 'question_type'].every(key => question[key] === undefined || question[key] === 'single_choice') &&
      nonemptyString(question.primary_country) &&
      validCountries(question) &&
      question.countries.includes(question.primary_country) &&
      Array.isArray(question.sources) && question.sources.length > 0 &&
      question.sources.every(source => record(source) && Object.keys(source).length > 0) &&
      (question.validation === undefined || record(question.validation));
  }
  return ['quote', 'file_name', 'source_id', 'region_id'].every(key => nonemptyString(question[key]));
}

/** A matching response is complete only when each original item has one unique match. */
export function validMatchingAnswer(question, answer) {
  return record(answer) && Array.isArray(question.matching_items) && Array.isArray(question.choices) &&
    Object.keys(answer).length === question.matching_items.length &&
    question.matching_items.every(item => Object.hasOwn(answer, item.id) && question.choices.some(choice => choice.id === answer[item.id])) &&
    new Set(Object.values(answer)).size === question.matching_items.length;
}

function uniqueValidQuestions(questions) {
  const seen = new Set();
  return (Array.isArray(questions) ? questions : []).map(normalizeQuestion).filter(question => {
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
  constructor(questions, random = Math.random, country = null, questionCount = null) {
    this.random = random;
    this.questions = uniqueValidQuestions(questions).map(normalizeQuestion);
    this.country = country;
    this.questionCount = questionCount;
    this.restart();
  }

  restart(country = this.country, questionCount = this.questionCount) {
    const available = questionsForCountry(this.questions, country);
    if (questionCount !== null && (!Number.isInteger(questionCount) || questionCount < 1 || questionCount > available.length)) {
      throw new RangeError('Question count must be an integer within the selected range.');
    }
    const selected = shuffle(available, this.random).slice(0, questionCount ?? available.length);
    this.country = country;
    this.questionCount = questionCount;
    this.order = selected.map(question => ({
      ...question,
      choices: question.source_verbatim ? [...question.choices] : shuffle(question.choices, this.random),
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
    if (!this.current || this.answered) return null;
    const matching = this.current.question_type === 'matching';
    if (matching ? !validMatchingAnswer(this.current, choiceId) : !this.current.choices.some(choice => choice.id === choiceId)) return null;
    if (matching) choiceId = Object.freeze({ ...choiceId });
    this.selectedId = choiceId;
    const result = {
      questionId: this.current.id,
      choiceId,
      correct: matching ? this.current.matching_items.every(item => choiceId[item.id] === this.current.correct_matches[item.id])
        : choiceId === this.current.correct_choice_id,
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
