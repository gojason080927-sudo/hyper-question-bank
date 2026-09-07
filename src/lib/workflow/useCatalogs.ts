import { useEffect, useState } from 'react'
import { getSupabase } from '../supabase/client'

export type Catalogs = {
  frameworks: Array<{ id: string; code: string; name: string }>
  nodes: Array<{
    id: string
    framework_id: string
    parent_id: string | null
    node_type: string
    code: string | null
    name: string
    sort_order: number
  }>
  concepts: Array<{ id: string; code: string; name: string }>
  types: Array<{ id: string; code: string; name: string; parent_id: string | null }>
  strategies: Array<{ id: string; code: string; name: string }>
  steps: Array<{ strategy_template_id: string; step_no: number; label: string }>
  conditions: Array<{ id: string; code: string; name: string; approval_status: string }>
  targets: Array<{ id: string; code: string; name: string; approval_status: string }>
  reasoning: Array<{ id: string; code: string; name: string }>
  documents: Array<{
    id: string
    title: string
    license_status: string
    document_type: string
    publisher: string | null
    publication_year: number | null
  }>
}

export function useCatalogs() {
  const [data, setData] = useState<Catalogs | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const client = getSupabase()
    if (!client) {
      setError('Supabase가 설정되지 않았습니다.')
      setLoading(false)
      return
    }
    void (async () => {
      const [
        frameworks,
        nodes,
        concepts,
        types,
        strategies,
        steps,
        conditions,
        targets,
        reasoning,
        documents,
      ] = await Promise.all([
        client.from('curriculum_frameworks').select('id,code,name').eq('active', true).order('name'),
        client.from('curriculum_nodes').select('id,framework_id,parent_id,node_type,code,name,sort_order').eq('active', true).order('sort_order'),
        client.from('concepts').select('id,code,name').eq('active', true).order('name'),
        client.from('hyper_problem_types').select('id,code,name,parent_id').eq('active', true).order('name'),
        client.from('strategy_templates').select('id,code,name').eq('active', true).order('name'),
        client.from('strategy_template_steps').select('strategy_template_id,step_no,label').order('step_no'),
        client.from('condition_terms').select('id,code,name,approval_status').eq('active', true).order('name'),
        client.from('target_terms').select('id,code,name,approval_status').eq('active', true).order('name'),
        client.from('reasoning_terms').select('id,code,name').eq('active', true).order('name'),
        client.from('source_documents').select('id,title,license_status,document_type,publisher,publication_year').is('archived_at', null).order('title'),
      ])
      const firstError =
        frameworks.error ||
        nodes.error ||
        concepts.error ||
        types.error ||
        strategies.error ||
        steps.error ||
        conditions.error ||
        targets.error ||
        reasoning.error ||
        documents.error
      if (firstError) {
        setError('분류 목록을 불러오지 못했습니다. 로그인 상태를 확인해 주세요.')
        setLoading(false)
        return
      }
      setData({
        frameworks: frameworks.data ?? [],
        nodes: nodes.data ?? [],
        concepts: concepts.data ?? [],
        types: types.data ?? [],
        strategies: strategies.data ?? [],
        steps: steps.data ?? [],
        conditions: conditions.data ?? [],
        targets: targets.data ?? [],
        reasoning: reasoning.data ?? [],
        documents: documents.data ?? [],
      })
      setLoading(false)
    })()
  }, [])

  return { data, error, loading }
}

export function nodePath(
  nodes: Catalogs['nodes'],
  nodeId: string | null,
): string {
  if (!nodeId) return ''
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const parts: string[] = []
  let current = byId.get(nodeId)
  const guard = new Set<string>()
  while (current && !guard.has(current.id)) {
    guard.add(current.id)
    parts.unshift(current.name)
    current = current.parent_id ? byId.get(current.parent_id) : undefined
  }
  return parts.join(' / ')
}
