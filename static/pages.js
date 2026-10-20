import { isNativeQuestion, isPilotQuestion, normalizeQuestion, validQuestion } from './quiz.js?v=highlighted-20261020';

export const MAX_PACK_BYTES = 2_000_000;
export const MAX_PACK_QUESTIONS = 2000;
export const DEFAULT_PACK_FILENAME = 'wine-quiz-highlighted.json';
export const DEFAULT_PACK_PATH = '../question-packs/wine-quiz-highlighted.json';

/** Validate the entire file before exposing any questions to a running session. */
export function parseQuestionPack(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_PACK_BYTES) {
    throw new Error('問題集は 2 MB 以下の JSON ファイルを選んでください。');
  }
  let pack;
  try { pack = JSON.parse(text); }
  catch { throw new Error('JSON を読み取れません。問題集の JSON ファイルを確認してください。'); }
  const native = Array.isArray(pack);
  const pilot = !native && pack !== null && typeof pack === 'object' && pack.version === undefined &&
    pack.metadata !== null && typeof pack.metadata === 'object' && !Array.isArray(pack.metadata) && Array.isArray(pack.questions);
  if (!native && !pilot && (!pack || pack.version !== 1 || !Array.isArray(pack.questions))) {
    throw new Error('問題集の形式が違います。metadata と questions を含む試験運用問題集、問題の配列、または version: 1 の書き出しが必要です。');
  }
  const rows = native ? pack : pack.questions;
  if (rows.length > MAX_PACK_QUESTIONS) throw new Error('読み込める問題は 2,000 問までです。');
  const seen = new Set();
  const questions = rows.map((row, index) => {
    let question;
    if (native || pilot) {
      question = (pilot ? isPilotQuestion(row) : isNativeQuestion(row)) ? normalizeQuestion(row) : null;
    } else {
      question = row && typeof row === 'object' ? {
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
    }
    if (!validQuestion(question)) {
      throw new Error(`${index + 1} 問目の三択・正解・解説・出典情報を確認できません。ファイル全体の読み込みを中止しました。`);
    }
    const texts = question.choices.map(choice => choice.text.trim().replace(/\s+/g, ' '));
    if (new Set(texts).size !== 3) throw new Error(`${index + 1} 問目の選択肢に同じ内容があります。ファイル全体の読み込みを中止しました。`);
    if (seen.has(question.id)) throw new Error('同じ問題 ID が複数あります。ファイル全体の読み込みを中止しました。');
    if (!native && !pilot && row.status !== undefined && row.status !== 'approved') {
      throw new Error(`${index + 1} 問目が承認済みではありません。承認済みの問題集を書き出してください。`);
    }
    seen.add(question.id);
    return question;
  });
  return pilot ? { version: 1, questions, metadata: pack.metadata } : { version: 1, questions };
}

/** A missing or invalid default file is actionable; never replace it with demo data. */
export async function loadDefaultQuestionPack(fetcher = globalThis.fetch) {
  let response;
  try {
    const moduleUrl = new URL(import.meta.url);
    const packUrl = new URL(DEFAULT_PACK_PATH, moduleUrl);
    const version = moduleUrl.searchParams.get('v');
    if (version) packUrl.searchParams.set('v', version);
    response = await fetcher(packUrl, { cache: 'no-store' });
  } catch (error) {
    throw new Error(`${DEFAULT_PACK_FILENAME} を取得できません。接続と配置を確認してください。${error?.message ? ` (${error.message})` : ''}`);
  }
  if (!response?.ok) {
    throw new Error(`${DEFAULT_PACK_FILENAME} を読み込めません (HTTP ${response?.status ?? '不明'})。問題集ファイルの配置を確認してください。`);
  }
  try {
    return parseQuestionPack(await response.text());
  } catch (error) {
    throw new Error(`${DEFAULT_PACK_FILENAME} の読み込みに失敗しました: ${error?.message ?? '不明なエラー'}`);
  }
}
