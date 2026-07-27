export type TravelVocabularyR1RoutePanel =
  | { readonly kind: 'runtime' }
  | { readonly kind: 'stage-review' }
  | {
      readonly kind: 'finish-confirmation'
      readonly returnTo: 'runtime' | 'stage-review'
    }

export function requestTravelVocabularyR1FinishConfirmation(
  panel: TravelVocabularyR1RoutePanel,
): TravelVocabularyR1RoutePanel {
  if (panel.kind === 'finish-confirmation') {
    return panel
  }
  return {
    kind: 'finish-confirmation',
    returnTo: panel.kind,
  }
}

export function cancelTravelVocabularyR1FinishConfirmation(
  panel: TravelVocabularyR1RoutePanel,
): TravelVocabularyR1RoutePanel {
  return panel.kind === 'finish-confirmation'
    ? { kind: panel.returnTo }
    : panel
}
