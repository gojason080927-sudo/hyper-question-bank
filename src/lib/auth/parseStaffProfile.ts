import type { StaffRole } from '../workflow/labels'

export type StaffProfile = {
  user_id: string
  role: StaffRole
  display_name: string | null
}

const ROLES: StaffRole[] = ['ADMIN', 'TEACHER', 'REVIEWER']

export function parseStaffProfile(data: unknown): StaffProfile | null {
  const row = typeof data === 'string' ? safeJson(data) : data
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null
  const record = row as Record<string, unknown>
  const userId = typeof record.user_id === 'string' ? record.user_id : ''
  const role = typeof record.role === 'string' ? record.role : ''
  if (!userId || !ROLES.includes(role as StaffRole)) return null
  return {
    user_id: userId,
    role: role as StaffRole,
    display_name: typeof record.display_name === 'string' ? record.display_name : null,
  }
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}
