import fs from 'node:fs'
import path from 'node:path'

/** 同じディレクトリ内で書き込みを完了してからファイルを置き換える */
export function atomicWriteFile(filePath: string, data: string): void {
  const directory = fs.mkdtempSync(
    path.join(path.dirname(filePath), `.${path.basename(filePath)}-`)
  )
  try {
    const temporaryPath = path.join(directory, 'data')
    fs.writeFileSync(temporaryPath, data, { mode: 0o600 })
    fs.renameSync(temporaryPath, filePath)
  } finally {
    try {
      fs.rmSync(directory, { recursive: true, force: true })
    } catch {
      // 保存時のエラーを後始末のエラーで隠さない。
    }
  }
}
