
//------------------------------------------------------------------------------

export type Point = {
  x: number
  y: number
}

export type Size = {
  width: number
  height: number
}

export type Rect = Point & Size

export function pointInRect(pt: Point, r: Rect): boolean {
  if (pt.x >= r.x && pt.x < r.x + r.width) {
    if (pt.y >= r.y && pt.y < r.y + r.height) {
      return true
    }
  }
  return false
}

export function rectIsEmpty(r: Rect): boolean {
  return r.width == 0 || r.height == 0
}

//------------------------------------------------------------------------------

// TODO: consider moving back to display once IMachineDisplay
//  stops using HiresFrame

// TODO: rename SCREEN -> HIRES
// screen coordinates are 280x192

export const SCREEN_BYTE_WIDTH = 40
export const SCREEN_WIDTH = 280
export const SCREEN_HEIGHT = 192

export const HiresTable = [
  0x0000, 0x0400, 0x0800, 0x0c00, 0x1000, 0x1400, 0x1800, 0x1c00,
  0x0080, 0x0480, 0x0880, 0x0c80, 0x1080, 0x1480, 0x1880, 0x1c80,
  0x0100, 0x0500, 0x0900, 0x0d00, 0x1100, 0x1500, 0x1900, 0x1d00,
  0x0180, 0x0580, 0x0980, 0x0d80, 0x1180, 0x1580, 0x1980, 0x1d80,
  0x0200, 0x0600, 0x0a00, 0x0e00, 0x1200, 0x1600, 0x1a00, 0x1e00,
  0x0280, 0x0680, 0x0a80, 0x0e80, 0x1280, 0x1680, 0x1a80, 0x1e80,
  0x0300, 0x0700, 0x0b00, 0x0f00, 0x1300, 0x1700, 0x1b00, 0x1f00,
  0x0380, 0x0780, 0x0b80, 0x0f80, 0x1380, 0x1780, 0x1b80, 0x1f80,
  0x0028, 0x0428, 0x0828, 0x0c28, 0x1028, 0x1428, 0x1828, 0x1c28,
  0x00a8, 0x04a8, 0x08a8, 0x0ca8, 0x10a8, 0x14a8, 0x18a8, 0x1ca8,
  0x0128, 0x0528, 0x0928, 0x0d28, 0x1128, 0x1528, 0x1928, 0x1d28,
  0x01a8, 0x05a8, 0x09a8, 0x0da8, 0x11a8, 0x15a8, 0x19a8, 0x1da8,
  0x0228, 0x0628, 0x0a28, 0x0e28, 0x1228, 0x1628, 0x1a28, 0x1e28,
  0x02a8, 0x06a8, 0x0aa8, 0x0ea8, 0x12a8, 0x16a8, 0x1aa8, 0x1ea8,
  0x0328, 0x0728, 0x0b28, 0x0f28, 0x1328, 0x1728, 0x1b28, 0x1f28,
  0x03a8, 0x07a8, 0x0ba8, 0x0fa8, 0x13a8, 0x17a8, 0x1ba8, 0x1fa8,
  0x0050, 0x0450, 0x0850, 0x0c50, 0x1050, 0x1450, 0x1850, 0x1c50,
  0x00d0, 0x04d0, 0x08d0, 0x0cd0, 0x10d0, 0x14d0, 0x18d0, 0x1cd0,
  0x0150, 0x0550, 0x0950, 0x0d50, 0x1150, 0x1550, 0x1950, 0x1d50,
  0x01d0, 0x05d0, 0x09d0, 0x0dd0, 0x11d0, 0x15d0, 0x19d0, 0x1dd0,
  0x0250, 0x0650, 0x0a50, 0x0e50, 0x1250, 0x1650, 0x1a50, 0x1e50,
  0x02d0, 0x06d0, 0x0ad0, 0x0ed0, 0x12d0, 0x16d0, 0x1ad0, 0x1ed0,
  0x0350, 0x0750, 0x0b50, 0x0f50, 0x1350, 0x1750, 0x1b50, 0x1f50,
  0x03d0, 0x07d0, 0x0bd0, 0x0fd0, 0x13d0, 0x17d0, 0x1bd0, 0x1fd0,
]

export class HiresFrame {
  bytes: number []
  byteWidth: number
  height: number

  constructor(srcBuffer?: HiresFrame) {
    this.byteWidth = SCREEN_BYTE_WIDTH
    this.height = SCREEN_HEIGHT
    if (srcBuffer) {
      this.bytes = srcBuffer.bytes.slice()
    } else {
      this.bytes = new Array(SCREEN_BYTE_WIDTH * SCREEN_HEIGHT)
      this.bytes.fill(0)
    }
  }

  copyFrom(srcBuffer: HiresFrame) {
    this.bytes = srcBuffer.bytes.slice()
  }
}

//------------------------------------------------------------------------------

// TODO: put a real constructor on this class and generalize
export class PixelData {
  dataBytes: Uint8Array | number[] = []
  // NOTE: bounds.width is in pixels, not bytes
  bounds: Rect = { x: 0, y: 0, width: 0, height: 0 }

  getByteWidth(): number {
    return Math.ceil((this.bounds.x + this.bounds.width) / 7) - Math.floor(this.bounds.x / 7)
  }
}

//------------------------------------------------------------------------------

export type Joystick = {
  x0: number,
  y0: number,
  x1?: number,
  y1?: number,
  button0: boolean,
  button1: boolean,
  button2?: boolean
}

export interface IMachineInput {
  setJoystickValues(joystick: Joystick): void
  setKeyCode(appleCode: number): void
}

export interface IMachineDisplay {
  getVisibleDisplayPage(): number
  getActiveDisplayPage(): number
  getDisplayMemory(frame: HiresFrame, page: number): void
  setDisplayMemory(frame: HiresFrame, page: number): void
}

export interface IMachineMemory {
  readConst(address: number): number
  read(address: number): number
  write(address: number, value: number): void
}

//------------------------------------------------------------------------------

// NOTE: named just "Bus" so it works with MOS6502.ts code
export interface Bus {
  read(address: number): number
  write(address: number, value: number): void
  readConst?(address: number): number
}

export interface SlotDevice extends Bus {
  readRom(address: number): number
  readConst(address: number): number
}

//------------------------------------------------------------------------------

export interface IHostHooks {
  capturedUndo(index: number): void
}

//------------------------------------------------------------------------------
