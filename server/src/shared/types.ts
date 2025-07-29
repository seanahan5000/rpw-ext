
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

export type StackRegister = {
  name: string
  value: number
  bitSize?: number
  flagNames?: string
}

export type StackEntry = {
  proc: number
  regs: StackRegister[]
  cycles: number
  dataAddress?: number
  dataString?: string
}

export type BreakpointEntry = {
  address: number
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
  write(address: number, value: number, cycleCount: number): void
  writeRam(address: number, data: Uint8Array | number[]): void
}

export interface IMachineDevice {
  reset(): void
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

export interface IMachineIsa {
  isBranch(opByte: number): boolean
  isJump(opByte: number): boolean
  isCall(opByte: number): boolean
  isReturn(opByte: number): boolean
}

export interface IMachineCpu {
  reset(): void
  getPC(): number
  getCycles(): number
  nextInstruction(): number

  // CPU hook support
  on(name: string, listener: () => void): void

  // debugger support
  setRegister(reg: StackRegister): void
  getCallStack(): StackEntry[]
  getRegIndex(opByte: number): number | undefined
  computeAddress(opBytes: number[], useIndex: boolean): OpInfo

  get isa(): IMachineIsa
}

export interface IClockEvents {
  start: () => void
  stop: (reason: string) => void
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

  // TODO: getter?
  getClockRate(): number
}

export interface IMachine {
  reset(hardReset: boolean): void
  update(cycleCount: number, forceRedraw: boolean): void

  get clock(): IClock
  get memory(): IMachineMemory
  get cpu(): IMachineCpu
}

//------------------------------------------------------------------------------

export interface IHostHooks {
  capturedUndo(index: number): void
}

//------------------------------------------------------------------------------
