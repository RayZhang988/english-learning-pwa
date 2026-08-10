export function naturalListeningVoiceCandidates<T extends { readonly id: string }>(voices: readonly T[]): readonly T[] {
  const excluded = new Set([
    'albert', 'bad news', 'bahh', 'bells', 'boing', 'bubbles', 'cellos',
    'fred', 'good news', 'hysterical', 'jester', 'junior', 'kathy',
    'organ', 'ralph', 'superstar', 'trinoids', 'whisper', 'wobble', 'zarvox',
  ])
  return voices
    .filter((voice) => !excluded.has(voice.id.split(' (')[0]!.trim().toLowerCase()))
    .toSorted((left, right) => left.id.localeCompare(right.id, 'en'))
}
