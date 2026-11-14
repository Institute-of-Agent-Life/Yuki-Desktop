import RFB from '@novnc/novnc'

interface Sock {
  sQpush8(value: number): void
  flush(): void
}
declare global {
  interface Window {
    rfbTest: {
      connect(url: string): Promise<void>
      forceInput(): void
      unknown(): void
      closed: boolean
    }
  }
}
let rfb: RFB
const wire = () => (rfb as unknown as { _sock: Sock })._sock
const messages = (
  RFB as unknown as {
    messages: {
      fbUpdateRequest(
        sock: Sock,
        incremental: boolean,
        x: number,
        y: number,
        w: number,
        h: number,
      ): void
    }
  }
).messages
window.rfbTest = {
  closed: false,
  connect(url) {
    return new Promise((resolve, reject) => {
      rfb = new RFB(document.getElementById('screen')!, url, { wsProtocols: ['binary'] })
      rfb.viewOnly = true
      rfb.addEventListener('connect', () => resolve())
      rfb.addEventListener('disconnect', () => {
        window.rfbTest.closed = true
        reject(new Error('RFB closed'))
      })
    })
  },
  forceInput() {
    // Deliberately bypass the UI setting; authorization must remain in the Bot.
    rfb.viewOnly = false
    rfb.sendKey(65, 'KeyA', true)
    rfb.sendKey(65, 'KeyA', false)
    rfb.sendCtrlAltDel()
    rfb.clipboardPasteFrom('viewer must not replace clipboard')
    document
      .querySelector('canvas')!
      .dispatchEvent(
        new MouseEvent('mousedown', {
          clientX: 30,
          clientY: 30,
          bubbles: true,
          button: 0,
          buttons: 1,
        }),
      )
    document
      .querySelector('canvas')!
      .dispatchEvent(
        new MouseEvent('mouseup', {
          clientX: 30,
          clientY: 30,
          bubbles: true,
          button: 0,
          buttons: 0,
        }),
      )
    messages.fbUpdateRequest(wire(), true, 0, 0, 1, 1)
  },
  unknown() {
    wire().sQpush8(250)
    wire().flush()
  },
}
