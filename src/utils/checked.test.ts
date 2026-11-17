import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { Checked } from './checked'
import { PATH } from './config'
import { DeliveryTracker } from './delivery'
import { FileDeliveryStore } from './delivery-store'

describe('同じ日時の通話の確認', () => {
  let directory = ''
  const originalPath = PATH.CHECKED_FILE
  const date = '2026/10/22'
  const time = '12:34:56'

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'telcheck-checked-'))
    PATH.CHECKED_FILE = path.join(directory, 'checked.json')
  })

  afterEach(() => {
    PATH.CHECKED_FILE = originalPath
    fs.rmSync(directory, { recursive: true, force: true })
  })

  it('成功した通話と失敗した通話を区別し、再起動後も未完了の宛先を再試行する', async () => {
    const calls = ['call-a', 'call-b']
    const attempts: string[] = []
    let fail = true
    const store = new FileDeliveryStore(path.join(directory, 'delivery.json'))
    const run = async (tracker: DeliveryTracker) => {
      const pending = calls.filter((key) => !Checked.isChecked(date, time, key))
      tracker.prune(new Set(pending))
      for (const key of pending) {
        await tracker.deliver(
          key,
          [
            {
              send: () => {
                attempts.push(key)
                if (key === 'call-b' && fail) {
                  fail = false
                  return Promise.reject(new Error('failed'))
                }
                return Promise.resolve()
              },
            },
          ],
          () => Promise.resolve('message'),
          ['destination']
        )
        Checked.check(date, time, key)
      }
    }

    await assert.rejects(run(new DeliveryTracker(store)))
    assert.equal(Checked.isChecked(date, time, 'call-a'), true)
    assert.equal(Checked.isChecked(date, time, 'call-b'), false)
    await run(new DeliveryTracker(store))
    await run(new DeliveryTracker(store))
    assert.deepEqual(attempts, ['call-a', 'call-b', 'call-b'])
    assert.equal(Checked.isChecked(date, time, 'call-b'), true)
    assert.equal(Object.keys(store.load()).length, 0)
    assert.ok(!fs.readFileSync(PATH.CHECKED_FILE, 'utf8').includes('call-a'))
  })

  it('古い形式の日時以前は確認済みとして扱う', () => {
    fs.writeFileSync(
      PATH.CHECKED_FILE,
      JSON.stringify({ datetime: '2026-10-22T03:34:56.000Z' })
    )
    assert.equal(Checked.isChecked(date, time, 'call-a'), true)
    assert.equal(Checked.isChecked(date, '12:34:55', 'call-a'), true)
    assert.equal(Checked.isChecked(date, '12:34:57', 'call-a'), false)
    Checked.check(date, '12:34:57', 'call-a')
    assert.equal(Checked.isChecked(date, '12:34:57', 'call-a'), true)
    assert.equal(Checked.isChecked(date, '12:34:57', 'call-b'), false)
    Checked.check(date, '12:34:57', 'call-b')
    assert.equal(Checked.isChecked(date, '12:34:57', 'call-b'), true)
  })
})
