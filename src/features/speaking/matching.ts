import type {
  SpeakingMatchLevel,
  SpeakingTextMatch,
} from './types.ts'

const contractions: Readonly<Record<string, string>> = {
  "aren't": 'are not',
  "can't": 'cannot',
  "couldn't": 'could not',
  "didn't": 'did not',
  "doesn't": 'does not',
  "don't": 'do not',
  "hasn't": 'has not',
  "haven't": 'have not',
  "he's": 'he is',
  "here's": 'here is',
  "i'd": 'i would',
  "i'll": 'i will',
  "i'm": 'i am',
  "i've": 'i have',
  "isn't": 'is not',
  "it's": 'it is',
  "let's": 'let us',
  "she's": 'she is',
  "shouldn't": 'should not',
  "that's": 'that is',
  "there's": 'there is',
  "they're": 'they are',
  "wasn't": 'was not',
  "we're": 'we are',
  "weren't": 'were not',
  "what's": 'what is',
  "where's": 'where is',
  "won't": 'will not',
  "wouldn't": 'would not',
  "you're": 'you are',
}

function expandContractions(value: string): string {
  return value.replace(
    /\b[a-z]+(?:'[a-z]+)\b/g,
    (token) => contractions[token] ?? token,
  )
}

export function normalizeSpeakingText(value: string): string {
  const canonical = value
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[’‘`´]/g, "'")
  return expandContractions(canonical)
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}']+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function levenshteinDistance(
  left: readonly string[],
  right: readonly string[],
): number {
  const previous = Array.from(
    { length: right.length + 1 },
    (_, index) => index,
  )
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex]
    for (
      let rightIndex = 1;
      rightIndex <= right.length;
      rightIndex += 1
    ) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] +
          (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      )
    }
    previous.splice(0, previous.length, ...current)
  }
  return previous[right.length]
}

function tokenSimilarity(left: string, right: string): number {
  const leftTokens = left.length === 0 ? [] : left.split(' ')
  const rightTokens = right.length === 0 ? [] : right.split(' ')
  const denominator = Math.max(leftTokens.length, rightTokens.length)
  if (denominator === 0) {
    return 1
  }
  return Math.max(
    0,
    1 - levenshteinDistance(leftTokens, rightTokens) / denominator,
  )
}

function sharedTokenCoverage(left: string, right: string): number {
  const leftTokens = new Set(left.split(' ').filter(Boolean))
  const rightTokens = new Set(right.split(' ').filter(Boolean))
  if (rightTokens.size === 0) {
    return leftTokens.size === 0 ? 1 : 0
  }
  let shared = 0
  for (const token of rightTokens) {
    if (leftTokens.has(token)) {
      shared += 1
    }
  }
  return shared / rightTokens.size
}

function classify(
  similarity: number,
  coverage: number,
  exact: boolean,
): SpeakingMatchLevel {
  if (exact) {
    return 'match'
  }
  if (similarity >= 0.8 && coverage >= 0.75) {
    return 'close'
  }
  if (similarity >= 0.5 || coverage >= 0.55) {
    return 'partial'
  }
  return 'different'
}

export function matchSpeakingText(
  transcript: string,
  acceptedAnswers: readonly string[],
): SpeakingTextMatch {
  if (acceptedAnswers.length === 0) {
    throw new TypeError('acceptedAnswers cannot be empty')
  }
  const normalizedTranscript = normalizeSpeakingText(transcript)
  let bestAnswer = acceptedAnswers[0]
  let bestNormalized = normalizeSpeakingText(bestAnswer)
  let bestSimilarity = tokenSimilarity(
    normalizedTranscript,
    bestNormalized,
  )
  let bestCoverage = sharedTokenCoverage(
    normalizedTranscript,
    bestNormalized,
  )

  for (const acceptedAnswer of acceptedAnswers.slice(1)) {
    const normalized = normalizeSpeakingText(acceptedAnswer)
    const similarity = tokenSimilarity(
      normalizedTranscript,
      normalized,
    )
    const coverage = sharedTokenCoverage(
      normalizedTranscript,
      normalized,
    )
    if (
      similarity > bestSimilarity ||
      (similarity === bestSimilarity && coverage > bestCoverage)
    ) {
      bestAnswer = acceptedAnswer
      bestNormalized = normalized
      bestSimilarity = similarity
      bestCoverage = coverage
    }
  }

  return {
    level: classify(
      bestSimilarity,
      bestCoverage,
      normalizedTranscript === bestNormalized,
    ),
    similarity: Number(bestSimilarity.toFixed(4)),
    transcript: transcript.trim(),
    normalizedTranscript,
    closestAcceptedAnswer: bestAnswer,
    normalizedAcceptedAnswer: bestNormalized,
  }
}
