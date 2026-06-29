
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

// *** how much of this really needs to be shared? ***

// *** apple specific ***
export type Joystick = {
  x0: number,
  y0: number,
  x1?: number,
  y1?: number,
  button0: boolean,
  button1: boolean,
  button2?: boolean
}

export type StackRegister = {
  name: string
  value: number
  bitSize?: number
  flagNames?: string
}

export type StackEntry = {
  proc: number
  regs: StackRegister[]
  cpuCycles: number
  dataAddress?: number
  dataString?: string
  topOfStack?: boolean
}

export type BreakpointEntry = {
  address: number
}

export type DataBreakpointEntry = {
  address: number
  length: number
  access: number
}

// *** replicate in other types.ts ***
// export interface IInputEventHandler {
//   setMousePt(mousePt?: Point, lastMousePt?: Point): void
//   // *** apply camel-casing ***
//   onkeydown(e: KeyboardEvent): void
//   onkeyup(e: KeyboardEvent): void
//   onpointerenter(e: PointerEvent, hasFocus: boolean): void
//   onpointerdown(e: PointerEvent, reset: boolean): void
//   onpointermove(e: PointerEvent, hasFocus: boolean): void
//   onpointerup(e: PointerEvent, hasFocus: boolean): void
//   onpointerleave(e: PointerEvent, hasFocus: boolean): void
// }

type Bitmap = any

export interface IMemory {

  // *** fold into read w/cycleCount == 0 ***
  readConst(address: number): number

  read(address: number, cycleCount: number): number
  write(address: number, value: number, cycleCount: number): void

  // direct readMemory method for checking binary load status
  readRange(address: number, length: number): Uint8Array

  // direct writeMemory method for loading project binaries
  writeRange(address: number, data: Uint8Array | number[]): void
}

export interface IDevice {
  reset(hardReset: boolean): void
  readConst(address: number): number
  read(address: number, cycleCount: number): number
  write(address: number, value: number, cycleCount: number): void
  readRom(address: number): number
  update(cycleCount: number): void
}

export type OpcodeDef = {
  val: number   // opcode byte value
  name: string  // opcode name
  mode: number  // addressing mode (OpMode)
  bc: number    // byte count
  sf: string    // status flags
  cy: string    // cycles
  fc?: boolean  // flow control
}

export type OpInfo = {
  address: number
  size: number
  opcode: OpcodeDef
}

export interface ICpuIsa {
  isBranch(opByte: number): boolean
  isJump(opByte: number): boolean
  isCall(opByte: number): boolean
  isReturn(opByte: number): boolean
}

export interface ICpuEvents {
  debug: (error?: string) => void
  call: () => void
  return: () => void
  halt: (cycleCount: number) => number
}

export interface ICpu {
  reset(): void
  getPC(): number
  nextInstruction(cycleCount: number, cycleScale: number): number

  // CPU hook support
  on<K extends keyof ICpuEvents>(event: K, listener: ICpuEvents[K]): void

  // Atari 2600 wsync support
  requestHalt(): void
  clearHalt(): void
  raiseNMI(): void

  // debugger support
  setRegister(reg: StackRegister): void
  getCallStack(curCycleCount: number): StackEntry[]
  getRegIndex(opByte: number): number | undefined
  computeAddress(opBytes: number[], useIndex: boolean): OpInfo
  enableCheckStack(enable: boolean): void

  get isa(): ICpuIsa
}

export interface IClockEvents {
  start: () => void
  stop: (reason: string) => void
  error: (error: string) => void
}

export interface IClock {
  reset(hardReset: boolean): void
  start(): void
  stop(stopReason: string): void

  stepInto(): void
  stepOver(): void
  stepOutOf(): void
  stepForward(): void

  setBreakpoints(breakpoints: BreakpointEntry[]): void

  on<K extends keyof IClockEvents>(event: K, listener: IClockEvents[K]): void

  get isRunning(): boolean

  get rate(): number
  get cycles(): number
  get cpuCycles(): number
}

export interface IMachine {
  reset(hardReset: boolean): void
  update(cycleCount: number): void

  snapState(frameNumber: number): void
  getState(): any
  flattenState(state: any): Promise<void>
  setState(state: any): void

  setDiskCartImage(
    fullPath: string,
    dataBytes: Uint8Array,
    driveIndex?: number,
    onWrite?: (newDataBytes: Uint8Array) => void): void

  setDataBreakpoints(breakpoints: DataBreakpointEntry[]): void

  get clock(): IClock
  get memory(): IMemory
  get cpu(): ICpu
}

//------------------------------------------------------------------------------

export interface IHostHooks {
  capturedUndo(index: number): void
}

//------------------------------------------------------------------------------
