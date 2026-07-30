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
  const accepted = question.acceptedAnswers.some(
    (answer) =>
      normalizeListeningDictation(
        answer,
        question.normalizationHints,
      ) === normalizedResponse,
  )
  if (accepted) {
    return true
  }

  const tokens = (value: string) =>
    normalizeListeningDictation(
      value,
      question.normalizationHints,
    )
      .replace(/[^\p{L}\p{N}']+/gu, ' ')
      .split(/\s+/u)
      .filter(Boolean)
  const responseTokens = tokens(response)
  const allowedTokens = new Set(
    [
      ...question.acceptedAnswers,
      ...question.targetKeywords,
    ].flatMap(tokens),
  )
  if (responseTokens.some((token) => !allowedTokens.has(token))) {
    return false
  }
  let cursor = 0
  for (const targetKeyword of question.targetKeywords) {
    const targetTokens = tokens(targetKeyword)
    let foundAt = -1
    for (
      let index = cursor;
      index <= responseTokens.length - targetTokens.length;
      index += 1
    ) {
      if (
        targetTokens.every(
          (token, offset) => responseTokens[index + offset] === token,
        )
      ) {
        foundAt = index
        break
      }
    }
    if (foundAt < 0) {
      return false
    }
    cursor = foundAt + targetTokens.length
  }
  return true
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
