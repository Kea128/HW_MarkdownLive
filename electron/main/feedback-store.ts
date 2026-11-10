import { appendFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import type { FeedbackRecord } from '../../src/feedback'

export async function appendFeedback(filePath: string, record: FeedbackRecord): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await appendFile(filePath, `${JSON.stringify(record)}\n`, 'utf8')
}
