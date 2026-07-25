import { ListeningError } from './errors.ts'
import type {
  ListeningKeywordDictationQuestion,
  ListeningNormalizationHints,
  ListeningQuestion,
} from './types.ts'

export function normalizeListeningDictation(
  value: string,
  hints: ListeningNormalizationHints,
): string {
  let normalized = value
  if (hints.normalizeApostrophes) {
    normalized = normalized.replace(/[\u2018\u2019\u02bc]/g, "'")
  }
  if (hints.collapseWhitespace) {
    normalized = normalized.replace(/\s+/gu, ' ')
  }
  if (hints.trim) {
    normalized = normalized.trim()
  }
  if (hints.stripTerminalPunctuation) {
    normalized = normalized.replace(/[.!?,;:]+$/u, '')
  }
  if (hints.trim) {
    normalized = normalized.trim()
  }
  return normalized.toLocaleLowerCase(hints.caseFoldLocale)
}

export function judgeKeywordDictation(
  question: ListeningKeywordDictationQuestion,
  response: string,
): boolean {
  const normalizedResponse = normalizeListeningDictation(
    response,
    question.normalizationHints,
  )
  return question.acceptedAnswers.some(
    (answer) =>
      normalizeListeningDictation(
        answer,
        question.normalizationHints,
      ) === normalizedResponse,
  )
}

export function judgeListeningAnswer(
  question: ListeningQuestion,
  response: string,
): boolean {
  if (question.type === 'keyword-dictation') {
    return judgeKeywordDictation(question, response)
  }
  if (!question.options.some((option) => option.id === response)) {
    throw new ListeningError(
      'session-transition-invalid',
      `Option ${response} does not belong to question ${question.id}.`,
    )
  }
  return response === question.correctOptionId
}
