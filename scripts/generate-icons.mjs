import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  }
  return value >>> 0
})

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const name = Buffer.from(type)
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])))
  return Buffer.concat([length, name, data, checksum])
}

function createIcon(size) {
  const rows = []
  const verticalStart = Math.round(size * 0.45)
  const verticalEnd = Math.round(size * 0.55)
  const horizontalStart = Math.round(size * 0.32)
  const horizontalEnd = Math.round(size * 0.68)
  const top = Math.round(size * 0.25)
  const bottom = Math.round(size * 0.75)
  const bar = Math.max(3, Math.round(size * 0.07))

  for (let y = 0; y < size; y += 1) {
    const row = Buffer.alloc(1 + size * 4)
    for (let x = 0; x < size; x += 1) {
      const isLetter =
        (x >= verticalStart && x <= verticalEnd && y >= top && y <= bottom) ||
        (x >= horizontalStart && x <= horizontalEnd && y >= top && y <= top + bar) ||
        (x >= horizontalStart && x <= horizontalEnd && y >= bottom - bar && y <= bottom)
      const offset = 1 + x * 4
      row[offset] = isLetter ? 255 : 79
      row[offset + 1] = isLetter ? 255 : 128
      row[offset + 2] = isLetter ? 255 : 109
      row[offset + 3] = 255
    }
    rows.push(row)
  }

  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8
  header[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function createWindowsIcon(png) {
  const header = Buffer.alloc(22)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(1, 4)
  header[6] = 0
  header[7] = 0
  header.writeUInt16LE(1, 10)
  header.writeUInt16LE(32, 12)
  header.writeUInt32LE(png.length, 14)
  header.writeUInt32LE(header.length, 18)
  return Buffer.concat([header, png])
}

mkdirSync(new URL('../public/', import.meta.url), { recursive: true })
const icon256 = createIcon(256)
writeFileSync(new URL('../public/icon-256.png', import.meta.url), icon256)
writeFileSync(new URL('../public/icon-512.png', import.meta.url), createIcon(512))
writeFileSync(new URL('../public/icon.ico', import.meta.url), createWindowsIcon(icon256))
