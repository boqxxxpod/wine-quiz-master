import { isNativeQuestion, isPilotQuestion, normalizeQuestion, validQuestion } from './quiz.js?v=verbatim-20261031';

export const MAX_PACK_BYTES = 2_000_000;
export const MAX_PACK_QUESTIONS = 2000;
export const DEFAULT_PACK_FILENAME = 'wine-quiz-highlighted.json';
export const DEFAULT_PACK_PATH = '../question-packs/wine-quiz-highlighted.json';
export const DEFAULT_PACK_ID = 'textbook';
export const BUNDLED_PACKS = Object.freeze([
  Object.freeze({ id: 'practice', label: '練習問題', filename: 'wine-quiz-practice-20261031.json', path: '../question-packs/wine-quiz-practice-20261031.json' }),
  Object.freeze({ id: DEFAULT_PACK_ID, label: '教科書問題', filename: DEFAULT_PACK_FILENAME, path: DEFAULT_PACK_PATH }),
]);

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
      throw new Error(`${index + 1} 問目の選択肢・正解・解説・出典情報を確認できません。ファイル全体の読み込みを中止しました。`);
    }
    const texts = question.choices.map(choice => choice.text.trim().replace(/\s+/g, ' '));
    if (new Set(texts).size !== texts.length) throw new Error(`${index + 1} 問目の選択肢に同じ内容があります。ファイル全体の読み込みを中止しました。`);
    if (seen.has(question.id)) throw new Error('同じ問題 ID が複数あります。ファイル全体の読み込みを中止しました。');
    if (!native && !pilot && row.status !== undefined && row.status !== 'approved') {
      throw new Error(`${index + 1} 問目が承認済みではありません。承認済みの問題集を書き出してください。`);
    }
    seen.add(question.id);
    return question;
  });
  return pilot ? { version: 1, questions, metadata: pack.metadata } : { version: 1, questions };
}

/** Load only a registered, same-origin pack; a failed selection never falls back. */
export async function loadBundledQuestionPack(packId, fetcher = globalThis.fetch) {
  const pack = BUNDLED_PACKS.find(item => item.id === packId);
  if (!pack) throw new Error('組み込み問題集を選んでください。');
  let response;
  try {
    const moduleUrl = new URL(import.meta.url);
    const packUrl = new URL(pack.path, moduleUrl);
    const version = moduleUrl.searchParams.get('v');
    if (version) packUrl.searchParams.set('v', version);
    response = await fetcher(packUrl, { cache: 'no-store' });
  } catch (error) {
    throw new Error(`${pack.filename} を取得できません。接続と配置を確認してください。${error?.message ? ` (${error.message})` : ''}`);
  }
  if (!response?.ok) {
    throw new Error(`${pack.filename} を読み込めません (HTTP ${response?.status ?? '不明'})。問題集ファイルの配置を確認してください。`);
  }
  try {
    return parseQuestionPack(await response.text());
  } catch (error) {
    throw new Error(`${pack.filename} の読み込みに失敗しました: ${error?.message ?? '不明なエラー'}`);
  }
}

/** Keep the original default loader available to integrations and manual reset. */
export async function loadDefaultQuestionPack(fetcher = globalThis.fetch) {
  return loadBundledQuestionPack(DEFAULT_PACK_ID, fetcher);
}
