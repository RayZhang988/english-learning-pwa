import {
  TRAVEL_VOCABULARY_ESTIMATION_MODEL_VERSION_R1,
  TRAVEL_VOCABULARY_RESULT_MAPPING_VERSION_R1,
  TRAVEL_VOCABULARY_SAMPLE_SIZE_PER_STAGE_R1,
  TRAVEL_VOCABULARY_STAGE_DEFINITIONS_R1,
} from '../../src/features/assessment/travel-vocabulary-model.ts'
import type {
  TravelVocabularyBankR1,
  TravelVocabularyCandidateR1,
  TravelVocabularyStageId,
} from '../../src/features/assessment/travel-vocabulary-types.ts'
import { travelVocabularyStageRowsR1 } from './travel-vocabulary-data.r1.ts'

function parseStage(
  stageId: TravelVocabularyStageId,
  source: string,
): readonly TravelVocabularyCandidateR1[] {
  return source
    .trim()
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line, index) => {
      const separator = line.indexOf('|')
      if (separator <= 0 || separator === line.length - 1) {
        throw new TypeError(
          `${stageId} row ${index + 1} must contain word|meaning`,
        )
      }
      const word = line.slice(0, separator).trim().toLowerCase()
      const meaningZh = line.slice(separator + 1).trim()
      return {
        id: `${stageId}-${word}`,
        word,
        meaningZh,
        stageId,
      }
    })
}

export const travelVocabularyBankR1 = {
  id: 'travel-vocabulary-zh-cn-r1-v1',
  schemaVersion: 3,
  assessmentKind: 'staged-travel-vocabulary',
  dataVersion: 'travel-vocabulary-pools-r1-v1',
  estimationModelVersion:
    TRAVEL_VOCABULARY_ESTIMATION_MODEL_VERSION_R1,
  resultMappingVersion:
    TRAVEL_VOCABULARY_RESULT_MAPPING_VERSION_R1,
  locale: 'en-US',
  meaningLocale: 'zh-CN',
  sampleSizePerStage:
    TRAVEL_VOCABULARY_SAMPLE_SIZE_PER_STAGE_R1,
  stages: TRAVEL_VOCABULARY_STAGE_DEFINITIONS_R1.map(
    (definition) => ({
      ...definition,
      candidates: parseStage(
        definition.id,
        travelVocabularyStageRowsR1[definition.id],
      ),
    }),
  ),
} as const satisfies TravelVocabularyBankR1
