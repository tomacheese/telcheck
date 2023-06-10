import axios from 'axios'

interface SyslogItem {
  date: string
  time: string
  message: string
}

export interface SyslogCall {
  date: string
  time: string
  direction: 'outgoing' | 'incoming'
  from: string
  fromNumber: string
  to: string
  toNumber: string
  status: 'connecting' | 'connected' | 'disconnected'
}

export class NVR510 {
  private readonly ip: string
  private readonly username: string
  private readonly password: string

  // 2023/01/21 17:03:31: PP[01] IP Commencing (DNS Query [ssl.gstatic.com] from 192.168.0.99)
  // 2023/01/21 17:03:31: same message repeated 1 times
  // 2023/01/21 17:03:32: PPPOE[01] Connecting to PPPoE server
  // 2023/01/21 17:03:32: PPPOE[01] PPPoE Connect
  private readonly lineRegex =
    /^(?<date>\d{4}\/\d{2}\/\d{2}) (?<time>\d{2}:\d{2}:\d{2}): (?<message>.*)$/

  // 2023/02/01 20:12:37: [SIP] SIP Call to [sip:10@192.168.0.1] from [sip:0123456789].
  // 2023/02/01 20:12:52: [SIP] SIP Call to [sip:10@192.168.0.1] from [sip:0123456789] connected.
  // 2023/02/01 20:14:27: [SIP] SIP Call to [sip:10@192.168.0.1] from [sip:0123456789] disconnected Normally (0).
  private readonly sipCallToMessageRegex =
    /^\[SIP] SIP Call to \[(?<to>.+)] from \[(?<from>.+)](?<status>.+)?.$/

  // 2023/02/01 20:12:37: [SIP] SIP Call from [sip:0123456789@192.168.0.1] to [sip:10@192.168.0.1].
  // 2023/02/01 20:12:52: [SIP] SIP Call from [sip:0123456789@192.168.0.1] to [sip:10@192.168.0.1] connected.
  // 2023/02/01 20:14:27: [SIP] SIP Call from [sip:0123456789@192.168.0.1] to [sip:10@192.168.0.1] disconnected Normally (0).
  private readonly sipCallFromMessageRegex =
    /^\[SIP] SIP Call from \[(?<from>.+)] to \[(?<to>.+)](?<status>.+)?.$/

  // sip:0123456789@192.168.0.1
  // sip:10@192.168.0.1
  // sip:0123456789
  private readonly sipRegex = /^sip:(?<number>.+?)(@.+)?$/

  constructor(ip: string, username: string, password: string) {
    this.ip = ip
    this.username = username
    this.password = password
  }

  public async getDashboardSyslog(): Promise<any> {
    // http://192.168.0.1/dashboard/syslog_data.csv?num=100
    const response = await axios.get(
      `http://${this.ip}/dashboard/syslog_data.csv?num=100`,
      {
        auth: {
          username: this.username,
          password: this.password,
        },
      }
    )
    if (response.status !== 200) {
      throw new Error(`Failed to get syslog: ${response.status}`)
    }
    // csvで返る
    // スペースが &nbsp; になっているので、&nbsp; をスペースに変換する
    // 改行が不定で、\r だけだったり \r\n だったりするので、\n に統一する
    // <br> も混ざっているので、<br> を削除する
    // 最初の行はヘッダーなので削除する
    const data = response.data
      .replaceAll('&nbsp;', ' ')
      .replaceAll('<br>', '')
      .replaceAll('\r\n', '\r')
      .replaceAll('\r', '\n')
      .split('\n')
      .slice(1)
      .join('\r\n')
    return this.parseSyslog(data)
  }

  public async getCallsFromSyslog(): Promise<SyslogCall[]> {
    const syslog = await this.getDashboardSyslog()
    const calls: any[] = []
    for (const item of syslog) {
      const matchOut = this.sipCallToMessageRegex.exec(item.message)
      if (matchOut) {
        calls.push({
          date: item.date,
          time: item.time,
          direction: 'outgoing',
          from: matchOut.groups?.from || '',
          fromNumber: this.sip2number(matchOut.groups?.from),
          to: matchOut.groups?.to || '',
          toNumber: this.sip2number(matchOut.groups?.to),
          status: this.getStatus(matchOut.groups?.status),
        })
      }
      const matchIn = this.sipCallFromMessageRegex.exec(item.message)
      if (matchIn) {
        calls.push({
          date: item.date,
          time: item.time,
          direction: 'incoming',
          from: matchIn.groups?.from || '',
          fromNumber: this.sip2number(matchIn.groups?.from),
          to: matchIn.groups?.to || '',
          toNumber: this.sip2number(matchIn.groups?.to),
          status: this.getStatus(matchIn.groups?.status),
        })
      }
    }
    return calls
  }

  private getStatus(statusRaw: string | undefined): string | undefined {
    if (!statusRaw) {
      return 'connecting'
    }
    const status = statusRaw.trim()
    // 2023/02/01 20:12:52: [SIP] SIP Call from [sip:0123456789@192.168.0.1] to [sip:10@192.168.0.1] connected.
    if (status === 'connected') {
      return 'connected'
    }

    // 2023/02/01 20:14:27: [SIP] SIP Call from [sip:0123456789@192.168.0.1] to [sip:10@192.168.0.1] disconnected Normally (0).
    if (status.startsWith('disconnected')) {
      return 'disconnected'
    }

    // 2023/02/01 20:12:37: [SIP] SIP Call from [sip:0123456789@192.168.0.1] to [sip:10@192.168.0.1].
    return 'connecting'
  }

  private parseSyslog(data: string): SyslogItem[] {
    const lines = data.split('\r\n')
    const items: SyslogItem[] = []
    let item: SyslogItem | undefined
    for (const line of lines) {
      const match = this.lineRegex.exec(line)
      if (match) {
        if (item) {
          items.push(item)
        }
        item = {
          date: match.groups?.date || '',
          time: match.groups?.time || '',
          message: match.groups?.message || '',
        }
      } else if (item) {
        item.message += '\n' + line
      }
    }
    if (item) {
      items.push(item)
    }
    return items
  }

  private sip2number(sip: string | undefined): string | undefined {
    if (!sip) {
      return undefined
    }
    const match = this.sipRegex.exec(sip)
    return match?.groups?.number
  }
}
