import { validQuestion } from './quiz.js';

export const MAX_PACK_BYTES = 2_000_000;
export const MAX_PACK_QUESTIONS = 2000;

/** Read a user-selected export without retaining any unrecognized data. */
export function parseQuestionPack(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_PACK_BYTES) {
    throw new Error('問題集は 2 MB 以下の JSON ファイルを選んでください。');
  }
  let pack;
  try { pack = JSON.parse(text); }
  catch { throw new Error('JSON を読み取れません。サーバー版から書き出した問題集を選んでください。'); }
  if (!pack || Array.isArray(pack) || pack.version !== 1 || !Array.isArray(pack.questions)) {
    throw new Error('問題集の形式が違います。version: 1 と questions を含む書き出しファイルが必要です。');
  }
  if (pack.questions.length > MAX_PACK_QUESTIONS) throw new Error('読み込める問題は 2,000 問までです。');
  const seen = new Set();
  const questions = pack.questions.map((row, index) => {
    const question = row && typeof row === 'object' ? {
      id: row.id,
      prompt: row.prompt,
      choices: Array.isArray(row.choices) ? row.choices.map(choice => ({ id: choice?.id, text: choice?.text })) : row.choices,
      correct_choice_id: row.correct_choice_id,
      explanation: row.explanation,
      source_id: row.source_id ?? row.source?.id,
      file_name: row.file_name ?? row.source?.file_name,
      region_id: row.region_id,
      quote: row.quote,
    } : null;
    const idsPresent = question && [question.id, question.source_id, question.region_id].every(value => typeof value === 'string' && value.trim()) &&
      Array.isArray(question.choices) && question.choices.every(choice => typeof choice.id === 'string' && choice.id.trim());
    if (!idsPresent || !validQuestion(question)) {
      throw new Error(`${index + 1} 問目の三択・正解・解説・出典情報を確認できません。ファイル全体の読み込みを中止しました。`);
    }
    const texts = question.choices.map(choice => choice.text.trim().replace(/\s+/g, ' '));
    if (new Set(texts).size !== 3) throw new Error(`${index + 1} 問目の選択肢に同じ内容があります。ファイル全体の読み込みを中止しました。`);
    if (seen.has(question.id)) throw new Error('同じ問題 ID が複数あります。ファイル全体の読み込みを中止しました。');
    if (row.status !== undefined && row.status !== 'approved') throw new Error(`${index + 1} 問目が承認済みではありません。承認済みの問題集を書き出してください。`);
    seen.add(question.id);
    return question;
  });
  return { version: 1, questions };
}
