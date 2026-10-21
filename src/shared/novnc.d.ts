declare module '@novnc/novnc' {
  export default class RFB extends EventTarget {
    constructor(target: HTMLElement, url: string, options: { wsProtocols: string[] })
    viewOnly: boolean
    scaleViewport: boolean
    resizeSession: boolean
    clipViewport: boolean
    focusOnClick: boolean
    focus(): void
    blur(): void
    disconnect(): void
    clipboardPasteFrom(text: string): void
    sendCtrlAltDel(): void
    sendKey(keysym: number, code?: string, down?: boolean): void
    getImageData(): ImageData
    toDataURL(type?: string): string
  }
}
