/* eslint-disable no-console */
/* global self, clients */

self.addEventListener('push', (event) => {
  try {
    if (
      self.Notification == null ||
      self.Notification.permission !== 'granted'
    ) {
      console.debug('notification is disabled.')
      return
    }

    // @ts-ignore
    const payload = event.data?.json() ?? null
    const title = payload?.title ?? 'Title'
    const tag = payload?.tag ?? ''
    const body = payload?.body ?? ''
    const icon = payload?.icon ?? '/phone.png'
    const data = payload?.data ?? null

    // @ts-ignore
    self.registration.showNotification(title, {
      body,
      tag,
      icon,
      data,
    })
  } catch (error) {
    console.error(error)
  }
})

self.addEventListener('notificationclick', (event) => {
  try {
    // @ts-ignore
    event.notification.close()
    // @ts-ignore
    clients.openWindow(event.notification.data?.url ?? '/')
  } catch (error) {
    console.error(error)
  }
})
