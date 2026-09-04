import { rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const buildOutput = fileURLToPath(new URL('../release-build/', import.meta.url))

rmSync(buildOutput, {
  recursive: true,
  force: true,
})

console.log(`Cleaned release build directory: ${buildOutput}`)
