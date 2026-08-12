/// <reference types="node" />

import { readFile } from 'node:fs/promises'
import {
  ReviewContentSource,
  type ProductionReviewContentIndex,
} from './review-content-source.ts'

/** Node-only fixture: exercise the same manifest merge used by production. */
export async function loadReleasedReviewContentIndex(): Promise<ProductionReviewContentIndex> {
  const source = new ReviewContentSource(async (input) => ({
    ok: true,
    json: async () => JSON.parse(await readFile(new URL(String(input)), 'utf8')) as unknown,
  }) as Response)
  return source.load()
}
