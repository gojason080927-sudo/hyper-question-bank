import type { BookSection, BookStructure } from '../classification/bookStructure'
import { nearestTheoryHeading, sectionForPage } from '../classification/bookStructure'

export type HeadingProximity = {
  heading: string | null
  theory_code: string | null
  heading_page: number | null
  page_distance: number | null
  same_section: boolean
  stale_previous_section: boolean
  proximity_score: number
  evidence: string
}

export function headingProximity(structure: BookStructure, page: number, section?: BookSection | null): HeadingProximity {
  const resolved = section ?? sectionForPage(structure, page)
  const heading = nearestTheoryHeading(structure, page, resolved?.section_code)
  if (!heading) {
    return {
      heading: null,
      theory_code: null,
      heading_page: null,
      page_distance: null,
      same_section: false,
      stale_previous_section: false,
      proximity_score: 0,
      evidence: 'no_theory_heading',
    }
  }
  const page_distance = page - heading.page
  const same_section = resolved ? heading.section_code === resolved.section_code && heading.page >= resolved.page_start : false
  const stale_previous_section = !same_section || page_distance > 10 || heading.page < (resolved?.page_start ?? heading.page)
  let proximity_score = 0.2
  if (stale_previous_section) proximity_score = 0.22
  else if (page_distance < 0) proximity_score = 0.18
  else if (page_distance <= 2) proximity_score = 0.96
  else if (page_distance <= 5) proximity_score = 0.78
  else if (page_distance <= 10) proximity_score = 0.52
  else proximity_score = 0.28
  return {
    heading: heading.title,
    theory_code: heading.theory_code,
    heading_page: heading.page,
    page_distance,
    same_section,
    stale_previous_section,
    proximity_score,
    evidence: stale_previous_section ? 'stale_or_far_heading' : `delta_${page_distance}`,
  }
}

export function headingShouldNotOverrideStem(proximity: HeadingProximity): boolean {
  return proximity.stale_previous_section || proximity.proximity_score < 0.5 || proximity.heading == null
}
