import type { SupabaseClient } from '@supabase/supabase-js'
import { ASSET_BUCKET, ASSET_MAX_BYTES, ASSET_MIME } from './schema'

function extForMime(mime: string): string {
  if (mime === 'image/jpeg') return 'jpg'
  if (mime === 'image/webp') return 'webp'
  if (mime === 'image/gif') return 'gif'
  return 'png'
}

export async function uploadEditorImage(
  client: SupabaseClient,
  problemId: string,
  versionId: string,
  file: File,
): Promise<{ storagePath: string; assetId: string; signedUrl: string }> {
  if (!ASSET_MIME.includes(file.type as (typeof ASSET_MIME)[number])) {
    throw new Error('HQB_ASSET_MIME: PNG/JPEG/WebP/GIF only')
  }
  if (file.size > ASSET_MAX_BYTES) {
    throw new Error('HQB_FILE_TOO_LARGE: 이미지는 8MB 이하여야 합니다.')
  }
  const storagePath = `${problemId}/${crypto.randomUUID()}.${extForMime(file.type)}`
  const uploaded = await client.storage.from(ASSET_BUCKET).upload(storagePath, file, {
    upsert: false,
    contentType: file.type,
  })
  if (uploaded.error) throw uploaded.error
  const registered = await client.rpc('hqb_register_editor_asset', {
    payload: {
      problem_version_id: versionId,
      storage_path: storagePath,
      asset_type: 'IMAGE',
      mime: file.type,
      byte_size: String(file.size),
      alt_text: file.name,
    },
  })
  if (registered.error) throw registered.error
  const signed = await client.storage.from(ASSET_BUCKET).createSignedUrl(storagePath, 3600)
  if (signed.error || !signed.data?.signedUrl) throw signed.error ?? new Error('signed url')
  const row = registered.data as { asset_id?: string }
  return { storagePath, assetId: row.asset_id ?? '', signedUrl: signed.data.signedUrl }
}
