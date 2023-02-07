import fs from 'node:fs'
import { PATH } from './config'

interface IChecked {
  datetime: string
}

export class Checked {
  public static isFirst(): boolean {
    const path = PATH.CHECKED_FILE
    return !fs.existsSync(path)
  }

  public static isChecked(date: string, time: string): boolean {
    const checked = Checked.load()
    if (!checked) {
      return false
    }
    const previousDateObject = new Date(checked.datetime)
    const dateObject = this.convertDate(date, time)
    return previousDateObject >= dateObject
  }

  public static check(date: string, time: string): void {
    const dateObject = this.convertDate(date, time)
    Checked.save({
      datetime: dateObject.toISOString(),
    })
  }

  private static convertDate(date: string, time: string): Date {
    return new Date(`${date.replace(/\//g, '-')}T${time}+09:00`)
  }

  private static load(): IChecked | undefined {
    if (!fs.existsSync(PATH.CHECKED_FILE)) {
      return
    }
    const json = fs.readFileSync(PATH.CHECKED_FILE).toString()
    return JSON.parse(json)
  }

  private static save(checked: IChecked): void {
    const json = JSON.stringify(checked)
    fs.writeFileSync(PATH.CHECKED_FILE, json)
  }
}
