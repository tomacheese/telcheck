 
/* global clients */

globalThis.addEventListener('push', (event) => {
  try {
    if (
      globalThis.Notification == null ||
      globalThis.Notification.permission !== 'granted'
    ) {
      console.debug('notification is disabled.')
      return
    }

    // @ts-expect-error event.data is not null
    const payload = event.data?.json() ?? null
    const title = payload?.title ?? 'Title'
    const tag = payload?.tag ?? ''
    const body = payload?.body ?? ''
    const icon = payload?.icon ?? '/phone.png'
    const data = payload?.data ?? null

    // @ts-expect-error self.registration is not null
    globalThis.registration.showNotification(title, {
      body,
      tag,
      icon,
      data,
    })
  } catch (error) {
    console.error(error)
  }
})

globalThis.addEventListener('notificationclick', (event) => {
  try {
    // @ts-expect-error event.notification is not null
    event.notification.close()
    // @ts-expect-error event.notification is not null
    clients.openWindow(event.notification.data?.url ?? '/')
  } catch (error) {
    console.error(error)
  }
})
