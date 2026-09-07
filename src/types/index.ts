export type FeatureArea = {
  id: string
  code: string
  title: string
  summary: string
}

/** Future lineage fields. Tables are not created in STEP 1. */
export type SourceLineage = {
  sourceDocumentId?: string
  sourcePage?: number
  sourceRegion?: string
  sourceProblemNumber?: string
}

/** Future rights metadata. Tables are not created in STEP 1. */
export type SourceRights = {
  source?: string
  publisher?: string
  documentTitle?: string
  year?: number
  edition?: string
  licenseStatus?: string
}
