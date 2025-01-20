
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

// pixel data encoded to a specific format

export class PixelData {
  public format: string
  public bounds: Rect
  public byteWidth: number
  public bytes: Uint8Array

  constructor(format: string, bounds: Rect, byteWidth: number, bytes?: Uint8Array) {
    this.format = format
    this.bounds = bounds
    this.byteWidth = byteWidth
    this.bytes = bytes ?? new Uint8Array(bounds.height * byteWidth).fill(0)
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
  getDisplayMode(): string
  getVisibleDisplayPage(): number
  getActiveDisplayPage(): number
  getDisplayMemory(frame: PixelData, page: number): void
  setDisplayMemory(frame: PixelData, page: number): void
}

export interface IMachineMemory {
  readConst(address: number): number
  read(address: number, cycleCount: number): number
  write(address: number, value: number): void
}

export type StackEntry = {
  proc: number
  pc: number
  sp: number
  regs: number[]
  status: number
}

//------------------------------------------------------------------------------

// NOTE: named just "Bus" so it works with MOS6502.ts code
export interface Bus {
  read(address: number, cycleCount: number): number
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
