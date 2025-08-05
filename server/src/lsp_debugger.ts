
import * as base64 from 'base64-js'
import * as path from 'path'
import * as lsp from 'vscode-languageserver'
import { DebugProtocol } from "@vscode/debugprotocol"
import { Handles, Breakpoint, StackFrame, Source, Scope, Variable } from "@vscode/debugadapter"
import { WebSocket, WebSocketServer } from "ws"
import { LspServer, LspProject } from "./lsp_server"
import { StackEntry, StackRegister } from "./shared/types"
import { Statement, MacroInvokeStatement, OpStatement } from "./asm/statements"
import { ObjectDoc, DataRange, RangeMatch } from "./asm/object_doc"
import { evalOpExpression } from "./asm/assembler"
import { Symbol, TypeDef, FieldEntry } from "./asm/symbols"

import { Parser } from "./asm/parser"
import { TokenType } from "./asm/tokenizer"

// TODO: temporary hack
import { NajaTextStatement } from "./asm/statements"

// TODO:
//  - show timing
//  - step forward
//  - add default key-combos for all stepping operations
//
//  ? enum type references
//  ? underline index field in a structure
//  ? array of structures
//  ? text string editing
//  - modifying code memory doesn't cause red bytes in disassembly
//
//  ? split stack update
//  - exceptions on handled errors
//    - (stack tracking, for example)
//  ? runtime completions
//  - data breakpoints
//  ? conditional breakpoints

//------------------------------------------------------------------------------

// NOTE: duplicated in machine/debugger.ts

const ProtocolVersion = 1

type RequestHeader = {
  command: string
  id?: number
}

type AcknowledgeResponse = RequestHeader & {
  errorMsg?: string
}

type LaunchRequest = RequestHeader & {
  version: number
  stopOnEntry: boolean
}

type AttachRequest = RequestHeader & {
  version: number
  stopOnEntry: boolean
}

type BreakpointEntry = {
  address: number
}

type SetBreakpointsRequest = RequestHeader & {
  entries: BreakpointEntry[]
}

type StackResponse = RequestHeader & {
  entries: StackEntry[]
}

type StopNotification = RequestHeader & {
  reason: string
  pc: number
  dataAddress?: number
  dataString?: string
}

type SetRegisterRequest = RequestHeader & StackRegister

type ReadOpMemoryRequest = RequestHeader & {
  opBytes: number[]     // instruction bytes, to determine addressing mode
  typeSize?: number     // number of bytes to read beyond index
}

type ReadOpMemoryResponse = RequestHeader & {
  dataAddress: number   // effective read address (baseAddress if indexAddress present)
  indexAddress?: number // read address including index register
  dataString: string    // actual data read in base64
}

type ReadMemoryRequest = RequestHeader & {
  dataAddress: number   // direct read address, ignoring opMode, opBytes
  readOffset?: number   // offset applied after final address is computed
  readLength?: number   // number of bytes to read (default 1)
}

type ReadMemoryResponse = RequestHeader & {
  dataAddress: number   // effective read address
  dataLength: number    // number of bytes actually read
  dataString: string    // actual data read in base64, possibly < readLength
}

type WriteMemoryRequest = RequestHeader & {
  dataAddress: number     // direct write address
  dataBank?: number       // optional bank 0, 1, or 2
  dataString: string      // bytes to write in base64
  partialAllowed: boolean // can write just some of the bytes
}

type WriteMemoryResponse = RequestHeader & {
  bytesWritten: number  // bytes successfully written
}

type WriteRamRequest = RequestHeader & {
  dataAddress: number     // direct write address
  dataString: string      // bytes to write in base64
}

type SetDiskImageRequest = RequestHeader & {
  fullPath?: string     // no path means set drive as empty
  dataString: string    // disk contents in base64
  driveIndex: number
  writeProtected: boolean
}

//------------------------------------------------------------------------------

function valueToString(value: number, typeSize: number): string {
  let valStr = "$" + value.toString(16).toUpperCase().padStart(typeSize * 2, "0")
  if (typeSize == 1) {
    valStr += (" (#" + value.toString()) + ")"
  }
  return valStr
}

function dataToString(dataBytes: Uint8Array | number[], offset: number, typeSize: number): string {
  let value = dataBytes[offset + 0]
  if (typeSize > 1) {
    value += dataBytes[offset + 1] << 8
    if (typeSize > 2) {
      value += dataBytes[offset + 2] << 16
    }
  }
  return valueToString(value, typeSize)
}

function underlineString(input: string): string {
  return [...input].join("\u0332") + "\u0332"
}

function deunderlineString(input: string): string {
  return input.replace("\u0332", "")
}

// TODO: clean up this hack
function buildTextString(dataBytes: Uint8Array | number[]): string {
  let result = "\""
  const unmapping = NajaTextStatement.buildUnmapping()
  for (let i = 0; i < dataBytes.length; i += 1) {
    const unmapped = unmapping[dataBytes[i]]
    result += unmapped ?? "."
  }
  result += "\""
  return result
}

function isSimpleType(typeName: string): boolean {
  return typeName == "byte" ||
    typeName == "word" ||
    typeName == "long" ||
    typeName == "text"
}

//------------------------------------------------------------------------------

class DebugVariable {

  protected name: string
  protected address?: number
  protected valueStr: string = ""
  protected children?: Map<string, DebugVariable>

  constructor(name: string, address?: number) {
    this.name = name
    this.address = address
  }

  public addChild(variable: DebugVariable) {
    if (!this.children) {
      this.children = new Map<string, DebugVariable>()
    }
    this.children.set(variable.name, variable)
  }

  public setNamedValue(dbg: LspDebugger, name: string, valueStr: string) {
    if (this.children) {
      const v = this.children.get(name)
      v?.setValue(dbg, valueStr)
    } else {
      this.setValue(dbg, valueStr)
    }
  }

  protected setValue(dbg: LspDebugger, valueStr: string) {
    return
  }

  public buildChildVariables(): DebugProtocol.Variable[] {
    const variables = []
    if (this.children) {
      for (const child of this.children.values()) {
        variables.push(child.buildVariable())
      }
    }
    return variables
  }

  protected buildVariable(): DebugProtocol.Variable {
    const result: DebugProtocol.Variable = {
      name: this.name,
      value: this.valueStr,
      variablesReference: 0
    }
    if (this.address != undefined) {
      result.memoryReference = this.address.toString(16).toUpperCase().padStart(4, "0")
    }
    return result
  }

  protected parseValues(valueStr: string, typeSize: number): number[] | undefined {

    const parser = new Parser()
    parser.setSourceLine(deunderlineString(valueStr))

    const values: number[] = []
    while (true) {
      let token = parser.getNextToken()
      if (!token) {
        break
      }
      let str = token.getString()
      let base = 16
      let sign = 1
      if (str == "#") {
        base = 10
        token = parser.getNextToken()
      } else if (str == "$") {
        base = 16
        token = parser.getNextToken()
      } else if (str == "%") {
        base = 2
        token = parser.getNextToken()
      }
      if (!token) {
        return
      }
      str = token.getString()
      if (str == "-") {
        sign = -1
        token = parser.getNextToken()
        if (!token) {
          return
        }
        str = token.getString()
      }
      if (token.type != TokenType.DecNumber && token.type != TokenType.HexNumber) {
        return
      }
      let value = parseInt(str, base)
      if (isNaN(value)) {
        return
      }
      value *= sign
      if (typeSize == 1) {
        value &= 0xFF
      } else if (typeSize == 2) {
        value &= 0xFFFF
      } else if (typeSize == 3) {
        value &= 0xFFFFFF
      }
      values.push(value)
    }

    return values
  }
}

class StructVariable extends DebugVariable {

  public handle: number

  constructor(dbg: LspDebugger, typeDef: TypeDef, address: number, dataBytes: Uint8Array) {
    super("struct", address)

    this.handle = dbg.variableHandles.create(this)

    if (typeDef.fields) {
      for (let field of typeDef.fields) {

        const subAddress = address + field.offset
        const subDataBytes = dataBytes.subarray(field.offset, field.offset + field.size)

        if (field.typeName && !isSimpleType(field.typeName)) {
          const subType = dbg.findTypeDef(field.typeName)
          if (subType && subType.size != undefined) {
            const structVar = new StructVariable(dbg, subType, subAddress, subDataBytes)
            structVar.name = field.name
            structVar.valueStr = "$" + subAddress.toString(16).toUpperCase().padStart(address < 0x100 ? 2 : 4, "0") + ": { }"
            this.addChild(structVar)
            continue
          }
        }

        this.addChild(new FieldVariable(field, subAddress, subDataBytes))
      }
    }
  }

  public override buildVariable(): DebugProtocol.Variable {
    let result = super.buildVariable()
    result.variablesReference = this.handle
    return result
  }
}

class FieldVariable extends DebugVariable {

  // NOTE: address and dataBytes have been adjust to start of field
  constructor(protected field: FieldEntry, address: number, dataBytes: Uint8Array) {
    super(field.name, address)
    this.updateValueStr(dataBytes)
  }

  public override async setValue(dbg: LspDebugger, valueStr: string): Promise<void> {
    const dataBytes = this.parseValues(valueStr, 1)
    if (dataBytes && dataBytes.length == this.field.size) {

      const request: WriteMemoryRequest =  {
        command: "writeMemory",
        dataAddress: this.address!,
        dataString: base64.fromByteArray(new Uint8Array(dataBytes)),
        partialAllowed: false
      }

      await dbg.sendRequest(request)
      this.updateValueStr(dataBytes)
    }
  }

  private updateValueStr(dataBytes: Uint8Array | number[]) {
    this.valueStr = ""

    if (this.field.typeName) {

      if (this.field.typeName == "text") {
        this.valueStr = buildTextString(dataBytes)
        return
      }

      let typeSize = 1
      if (this.field.typeName == "word") {
        typeSize = 2
      } else if (this.field.typeName == "long") {
        typeSize = 3
      }
      if (typeSize == this.field.size) {
        this.valueStr = dataToString(dataBytes, 0, typeSize)
        return
      }
    }

    // TODO: add an array var as child of the field
    this.valueStr = ""
    for (let i = 0; i < this.field.size; i += 1) {
      if (i > 0) {
        this.valueStr += " "
      }
      this.valueStr += dataBytes[i].toString(16).toUpperCase().padStart(2, "0")
    }
  }
}

class ArrayRowVariable extends DebugVariable {

  constructor(
      private columns: number,
      private typeSize: number,
      address: number,
      private indexAddress: number | undefined,
      dataBytes: Uint8Array) {
    super("row", address)
    this.name = "$" + address.toString(16).toUpperCase().padStart(address < 0x100 ? 2 : 4, "0")
    this.updateValueStr(dataBytes)
  }

  public override async setValue(dbg: LspDebugger, valueStr: string): Promise<void> {
    const dataBytes = this.parseValues(valueStr, this.typeSize)
    if (dataBytes) {

      const request: WriteMemoryRequest =  {
        command: "writeMemory",
        dataAddress: this.address!,
        dataString: base64.fromByteArray(new Uint8Array(dataBytes)),
        partialAllowed: false
      }

      await dbg.sendRequest(request)
      this.updateValueStr(dataBytes)
    }
  }

  private updateValueStr(dataBytes: Uint8Array | number[]) {
    this.valueStr = ""

    let offset = 0
    for (let col = 0; col < this.columns; col += 1) {

      // TODO: reuse code above
      let value = dataBytes[offset + 0]
      if (this.typeSize > 1) {
        value += dataBytes[offset + 1] << 8
        if (this.typeSize > 2) {
          value += dataBytes[offset + 2] << 16
        }
      }
      let hexStr = value.toString(16).toUpperCase().padStart(this.typeSize * 2, "0")
      if (this.indexAddress == this.address! + col * this.typeSize) {
        hexStr = underlineString(hexStr)
      }
      if (col > 0) {
        this.valueStr += "\xA0"
      }
      this.valueStr += hexStr
      if (col == 8 / this.typeSize) {
        this.valueStr += "\xA0"
      }
      offset += this.typeSize
    }
  }
}

class ArrayVariable extends DebugVariable {
  constructor(
    rows: number,
    columns: number,
    typeSize: number,
    address: number,
    indexAddress: number | undefined,
    dataBytes: Uint8Array) {

    super("array", address)

    let curOffset = 0
    for (let row = 0; row < rows; row += 1) {
      const nextOffset = curOffset + columns * typeSize
      const arrayRow = new ArrayRowVariable(
        columns,
        typeSize,
        address + curOffset,
        indexAddress,
        dataBytes.subarray(curOffset, nextOffset))
      this.addChild(arrayRow)
      curOffset = nextOffset
    }
  }
}

class RegistersVariable extends DebugVariable {
  constructor(stackEntry: StackEntry, isTop: boolean) {
    super("registers")

    for (let i = 0; i < stackEntry.regs.length; i += 1) {
      // put PC, SP, and PS at end of variables
      let index = i + 3
      if (index >= stackEntry.regs.length) {
        index -= stackEntry.regs.length
      }
      const reg = stackEntry.regs[index]
      this.addChild(new RegisterVariable(reg, isTop))
    }
  }
}


class RegisterVariable extends DebugVariable {

  constructor(private reg: StackRegister, private isTop: boolean) {
    super(reg.name)
    this.updateValueStr()
  }

  public override buildVariable(): DebugProtocol.Variable {
    let result = super.buildVariable()
    if (!this.isTop) {
      result.presentationHint = { attributes: ["readOnly"] }
    }
    return result
  }

  protected override setValue(dbg: LspDebugger, valueStr: string) {

    const value = this.parseRegValue(valueStr)
    if (value != undefined) {
      const request: SetRegisterRequest = {
        command: "setRegister",
        name: this.reg.name,
        value: value
      }
      dbg.sendRequest(request)
      this.reg.value = value
    }

    this.updateValueStr()

    let memoryReference: string | undefined
    if (this.name == "PC" || this.name == "SP") {
      memoryReference = this.reg.value.toString(16).toUpperCase().padStart(4, "0")
    }

    // DebugProtocol.SetVariableResponse.body
    return {
      value: this.valueStr,
      variablesReference: 0,
      memoryReference
    }
  }

  private parseRegValue(valueStr: string): number | undefined {

    valueStr = valueStr.trim()

    if (this.reg.flagNames) {
      let clearMask = 0
      let setMask = 0
      while (valueStr) {
        const char = valueStr[0]
        const upperChar = char.toUpperCase()
        const n = this.reg.flagNames.indexOf(upperChar)
        if (n < 0) {
          return
        }
        const mask = 1 << n
        if (char == upperChar) {
          setMask |= mask
        } else {
          clearMask |= mask
        }
        valueStr = valueStr.slice(1)
      }
      return (this.reg.value & ~clearMask) | setMask
    }

    const values = this.parseValues(valueStr, (this.reg.bitSize ?? 8) / 8)
    if (values?.length == 1) {
      return values[0]
    }
  }

  private updateValueStr() {
    this.valueStr = ""
    if (this.reg.flagNames) {
      for (let i = 0; i < this.reg.flagNames.length; i += 1) {
        let flagName = this.reg.flagNames[i]
        if (!(this.reg.value & (1 << i))) {
          flagName = flagName.toLowerCase()
        }
        this.valueStr = flagName + this.valueStr
      }
    } else {
      let value = this.reg.value
      let bitSize = this.reg.bitSize ?? 8
      if (this.reg.name == "SP" && bitSize == 8) {
        value += 0x0100
        bitSize = 16
      }
      this.valueStr = valueToString(this.reg.value, bitSize / 8)
    }
  }
}

//------------------------------------------------------------------------------

// TODO: move to common utilities

type Waiter = {
  resolve: () => void
  timer?: ReturnType<typeof setTimeout>
}

class AwaitEvent {

  private waiters: Waiter[] = []

  public wait(timeoutMs?: number): Promise<"notified" | "timeout"> {
    return new Promise(resolve => {
      let resolved = false

      const waiter: Waiter = {
        resolve: () => {
          if (!resolved) {
            resolved = true
            if (waiter.timer != undefined) {
              clearTimeout(waiter.timer)
              waiter.timer = undefined
            }
            resolve("notified")
          }
        }
      }
      this.waiters.push(waiter)

      if (timeoutMs != undefined) {
        waiter.timer = setTimeout(() => {
          if (!resolved) {
            resolved = true
            this.waiters = this.waiters.filter(w => w !== waiter)
            resolve("timeout")
          }
        }, timeoutMs)
      }
    })
  }

  notifyOne(): void {
    const waiter = this.waiters.shift()
    waiter?.resolve()
  }

  notifyAll(): void {
    while (this.waiters.length) {
      this.notifyOne()
    }
  }
}

//------------------------------------------------------------------------------

export class LspDebugger {

  private mainProject?: LspProject

  private socketServer?: WebSocketServer
  private socket?: WebSocket
  private nextRequestId: number = 1

  private pendingRequests = new Map<number, {
    resolve: (message: RequestHeader) => void
    reject: (reason?: any) => void
  }>()

  private breakpoints = new Map<string, number[]>()
  public variableHandles = new Handles<DebugVariable>()
  private stackFrameHandles = new Handles<StackEntry>()

  private connectEvent?: AwaitEvent
  private launchEvent?: AwaitEvent

  constructor(
      private lspServer: LspServer,
      private connection: lsp.Connection) {
  }

  public startup(mainProject: LspProject) {

    this.mainProject = mainProject
    this.connectEvent = new AwaitEvent()

    try {
      this.socketServer = new WebSocketServer({ port: 6502 })
    } catch (err) {
      const error = err as NodeJS.ErrnoException
      // TODO: how should port already in use be handled?
      return
    }

    this.socketServer.on("error", (error: Error) => {
      // TODO: do something with errors?
      console.log(error.message)
    })

    this.socketServer.on("connection", (socket: WebSocket) => {

      if (this.socket) {
        this.socket.close()
        this.socket = undefined
      }

      this.socket = socket

      this.socket.on("message", (data) => {
        const msgStr = data.toString()
        const msgObj = JSON.parse(msgStr)
        this.receiveMessage(msgObj)
      })

      this.socket.on("close", () => {
        this.socket = undefined
        this.cancelRequests()
        this.connection.sendNotification("rpw65.debuggerClosed")
      })

      this.connectEvent?.notifyAll()
    })
  }

  public shutdown() {
    if (this.socket) {
      this.socket.close()
    }
    if (this.socketServer) {
      this.socketServer.close()
    }
  }

  public isConnected(): boolean {
    return this.socket?.readyState == WebSocket.OPEN
  }

  private sendCommand(command: string) {
    if (this.socket?.readyState == WebSocket.OPEN) {
      this.socket.send(`{"command":"${command}"}`)
    }
  }

  public sendRequest(request: RequestHeader): Promise<any> {
    return new Promise((resolve, reject) => {
      request.id = this.nextRequestId++
      this.pendingRequests.set(request.id, { resolve, reject })
      if (this.socket?.readyState == WebSocket.OPEN) {
        this.socket.send(JSON.stringify(request))
      } else {
        reject(new Error("Socket closed"))
      }
    })
  }

  private cancelRequests() {
    for (const [_, pending] of this.pendingRequests) {
      pending.reject(new Error("Socket closed"));
    }
    this.pendingRequests.clear();
  }

  private async receiveMessage(message: any) {
    switch (message.command) {

      case "cpuStarted": {
        this.connection.sendNotification("rpw65.debuggerStarted")
        break
      }

      case "cpuStopped": {
        const msg = <StopNotification>message
        if (msg.reason == "breakpoint" && this.mainProject) {
          // TODO: need to use dataString in msg?
          const result = this.mainProject.findSourceByAddress(msg.pc)
          if (!result) {
            // if breakpoint address is in file that isn't loaded,
            //  restart target and don't report stop

            // TODO: Invalidate cycle count numbers because will
            //  cause them to be inaccurate.

            this.sendCommand("startCpu")
            break
          }
        }
        this.connection.sendNotification("rpw65.debuggerStopped", { reason: msg.reason })
        break
      }

      default: {
        const pending = this.pendingRequests.get(message.id);
        if (pending) {
          pending.resolve(message)
          this.pendingRequests.delete(message.id)
        }
        break
      }
    }
  }

  // direct writeMemory method for loading project binaries
  public async writeRam(address: number, data: Uint8Array | number[]) {
    if (Array.isArray(data)) {
      data = new Uint8Array(data)
    }
    const request: WriteRamRequest =  {
      command: "writeRam",
      dataAddress: address,
      dataString: base64.fromByteArray(data)
    }
    await this.sendRequest(request)
  }

  public async setDiskImage(fullPath: string, data: Uint8Array, driveIndex: number, writeProtected: boolean) {
    const dataString = base64.fromByteArray(data)
    const request: SetDiskImageRequest = {
      command: "setDiskImage",
      fullPath, dataString, driveIndex, writeProtected
    }
    await this.sendRequest(request)
  }

  public async setEntryPoint(entryPoint: number) {
    const request: SetRegisterRequest = {
      command: "setRegister",
      name: "PC",
      value: entryPoint
    }
    await this.sendRequest(request)
  }

  public async onExecuteCommand(params: lsp.ExecuteCommandParams): Promise<any> {

    if (!params.arguments || !this.mainProject) {
      return
    }

    const command = params.arguments[0]

    if (command == "launch") {
      return this.onLaunch(<DebugProtocol.LaunchRequestArguments>params.arguments![1])
    }
    if (command == "attach") {
      return this.onAttach(<DebugProtocol.AttachRequestArguments>params.arguments![1])
    }

    if (this.launchEvent) {
      const result = await this.launchEvent.wait(3 * 1000)
      this.launchEvent = undefined
    }

    switch (command) {

      case "disconnect":
        this.sendCommand("disconnect")
        break

      // translate from vscode to dbug commands
      case "pause":
        this.sendCommand("stopCpu")
        break
      case "continue":
        this.sendCommand("startCpu")
        break
      case "next":
        this.sendCommand("stepCpuOver")
        break
      case "stepIn":
        this.sendCommand("stepCpuInto")
        break
      case "stepOut":
        this.sendCommand("stepCpuOutOf")
        break

      // TODO: step forward

      case "breakpointLocations":
        return this.onBreakpointLocations(<DebugProtocol.BreakpointLocationsArguments>params.arguments![1])
      case "setBreakpoints":
        return this.onSetBreakpoints(<DebugProtocol.SetBreakpointsArguments>params.arguments![1])
      case "dataBreakpointInfo":
        return this.onDataBreakpointInfo(<DebugProtocol.DataBreakpointInfoArguments>params.arguments![1])
      case "setDataBreakpoints":
        return this.onDataBreakpointsInfo(<DebugProtocol.SetDataBreakpointsArguments>params.arguments![1])

      case "stackTrace":
        return this.onStackTrace(<DebugProtocol.StackTraceArguments>params.arguments![1])

      case "scopes":
        return this.onScopes(<DebugProtocol.ScopesArguments>params.arguments![1])

      case "variables":
        return this.onVariables(<DebugProtocol.VariablesArguments>params.arguments[1])

      case "setVariable":
        return this.onSetVariable(<DebugProtocol.SetVariableArguments>params.arguments[1])

      case "setExpression":
        return this.onSetExpression(<DebugProtocol.SetExpressionArguments>params.arguments[1])

      case "evaluate":
        return this.onEvaluate(<DebugProtocol.EvaluateArguments>params.arguments[1])

      case "readMemory":
        return this.onReadMemory(<DebugProtocol.ReadMemoryArguments>params.arguments[1])
      case "writeMemory":
        return this.onWriteMemory(<DebugProtocol.WriteMemoryArguments>params.arguments[1])

      case "gotoTargets":
        return this.onGotoTargets(<DebugProtocol.GotoTargetsArguments>params.arguments[1])
      case "goto":
        return this.onGoto(<DebugProtocol.GotoArguments>params.arguments[1])

      default:
        console.log("IGNORED " + params.arguments[0])
        break
    }
  }

  //--------------------------------------------------------
  // MARK: launch/attach

  private async onLaunch(args: DebugProtocol.LaunchRequestArguments) {
    this.launchOrAttach("launch", <any>args)
  }

  private async onAttach(args: DebugProtocol.AttachRequestArguments) {
    this.launchOrAttach("attach", <any>args)
  }

  private async launchOrAttach(command: string, args: any) {
    this.launchEvent = new AwaitEvent()

    if (!this.isConnected()) {
      const result = await this.connectEvent?.wait(3 * 1000)
      if (result != "notified") {
        return
      }
    }

    if (command == "launch") {
      await this.sendRequest({ command: "hardReset" })
      try {
        await this.mainProject?.binLoadProject(this)
      } catch (err) {
        let message = "Project load error"
        if (err instanceof Error) {
          message = "Project: " + err.message
        }
        this.connection.sendNotification("rpw65.debuggerError", { error: message })
        return
      }
    }

    const allArgs = <any>args
    const stopOnEntry = !!allArgs["stopOnEntry"]
    const request: AttachRequest = {
      command,
      version: ProtocolVersion,
      stopOnEntry
    }

    const response = await this.sendRequest(request)
    if (response.error) {
      this.connection.sendNotification("rpw65.debuggerError", { error: response.error })
      return
    }

    this.launchEvent?.notifyAll()
    this.launchEvent = undefined
  }

  //--------------------------------------------------------
  // MARK: breakpoints

  private onBreakpointLocations(args: DebugProtocol.BreakpointLocationsArguments) {
    const breakpoints: DebugProtocol.BreakpointLocation[] = []

    if (args.source.path) {
      const objectDoc = this.findObjectDoc(args.source.path)
      if (objectDoc) {
        const startLine = args.line
        const endLine = (args.endLine ?? startLine) + 1
        const lineCount = endLine - startLine
        const objectLines = objectDoc.getObjectLines(0, lineCount)
        for (let i = 0; i < lineCount; i += 1) {
          const objectLine = objectLines[i]
          if (objectLine.dataBytes) {
            breakpoints.push({ line: startLine + i})
          }
        }
      }
    }

    return { breakpoints }
  }

  private async onSetBreakpoints(args: DebugProtocol.SetBreakpointsArguments) {

    let objectDoc: ObjectDoc | undefined
    if (args.source.path) {
      objectDoc = this.findObjectDoc(args.source.path)
    }
    if (!objectDoc) {
      return []
    }

    const objectLines = objectDoc.getObjectLines(0, objectDoc.sourceFile.lines.length)

    // verify and convert source file breakpoint lines to addresses
    const addresses: number[] = []
    const breakpoints: DebugProtocol.Breakpoint[] = []
    for (let breakpoint of args.breakpoints!) {

      let verified = false
      let line = breakpoint.line - 1    // make line 0-based

      let objectLine = objectLines[line]
      if (objectLine) {

        // If line is empty but has an address, scan forward
        //  for a line with same address and some data bytes.
        //
        // TODO: should only do this when starting on line with label?
        // TODO: don't do this on empty or comment lines

        let objAddress = objectLine.dataAddress
        if (objectLine.dataBytes == undefined) {
          while (++line < objectLines.length) {
            const nextLine = objectLines[line]
            if (nextLine.dataAddress == undefined || !nextLine.dataBytes) {
              continue
            }
            if (objAddress == undefined) {
              objAddress = nextLine.dataAddress
            }
            if (nextLine.dataAddress == objAddress) {
              if (nextLine.dataBytes.length > 0) {
                objectLine = nextLine
                break
              }
            }
          }
        }

        if (objectLine.dataAddress && objectLine.dataBytes) {
          const statement = objectDoc.sourceFile.statements[line]
          if (statement instanceof OpStatement ||
              statement instanceof MacroInvokeStatement) {
            addresses.push(objectLine.dataAddress)
            verified = true
          }
        }
      }

      // make line 1-based
      const bp = new Breakpoint(verified, line + 1) as DebugProtocol.Breakpoint
      breakpoints.push(bp)
    }

    // add/replace breakpoint addresses for given file
    this.breakpoints.set(args.source.path!, addresses)

    // build flat list of all addresses with breakpoints, removing duplicates
    const flatMap = new Map<number, boolean>()
    for (let entry of this.breakpoints) {
      const addresses = entry[1]
      for (let address of addresses) {
        flatMap.set(address, true)
      }
    }

    const request: SetBreakpointsRequest = {
      command: "setBreakpoints",
      entries: []
    }

    for (let entry of flatMap) {
      request.entries.push({ address: entry[0] })
    }

    const response = await this.sendRequest(request)

    // DebugProtocol.SetBreakpointsResponse.body
    return { breakpoints }
  }

  // TODO: support these

  private onDataBreakpointInfo(args: DebugProtocol.DataBreakpointInfoArguments) {
  }

  private onDataBreakpointsInfo(args: DebugProtocol.SetDataBreakpointsArguments) {
  }

  //--------------------------------------------------------
  // MARK: goto

  private onGotoTargets(args: DebugProtocol.GotoTargetsArguments) {

    const targets: DebugProtocol.GotoTarget[] = []
    if (args.source.path) {
      const objectDoc = this.findObjectDoc(args.source.path)
      if (objectDoc) {
        const objectLine = objectDoc.getObjectLines(args.line - 1)[0]
        if (objectLine?.dataBytes) {
          targets.push({
            id: objectLine.dataAddress!,
            label: "",
            line: args.line
          })
        }
      }
    }
    return { targets }
  }

  private onGoto(args: DebugProtocol.GotoArguments) {
    const request: SetRegisterRequest = {
      command: "setRegister",
      name: "PC",
      value: args.targetId
    }
    this.sendRequest(request)
  }

  //--------------------------------------------------------
  // MARK: stack

  private async onStackTrace(args: DebugProtocol.StackTraceArguments) {

    const request: RequestHeader = {
      command: "getStack"
    }
    const response: StackResponse = await this.sendRequest(request)

    this.variableHandles.reset()
    this.stackFrameHandles.reset()

    const outStackFrames: StackFrame[] = []
    for (let entry of response.entries) {

      const entryPC = entry.regs[0].value
      let dataRange: DataRange | undefined
      if (entry.dataAddress && entry.dataString) {
        dataRange = new DataRange(entry.dataAddress, base64.toByteArray(entry.dataString))
      }
      const rangeMatch = this.mainProject!.findSourceByAddress(entryPC, dataRange)
      if (rangeMatch) {

        let funcName: string = "$" + entryPC.toString(16).toUpperCase().padStart(4, "0")

        const result = this.findProcLabel(rangeMatch, entry.proc)
        if (result) {
          funcName += ": " + result.statement.labelExp!.getString()
          funcName += "+$" + (entryPC - result.baseAddress).toString(16).toUpperCase().padStart(2, "0")
        }

        const sourceFile = rangeMatch.objectDoc.sourceFile
        const source = new Source(
          path.posix.basename(sourceFile.fullPath),
          sourceFile.fullPath)

        if (outStackFrames.length == 0) {
          (entry as any).topOfStack = true
        }
        const uniqueId = this.stackFrameHandles.create(entry)
        outStackFrames.push(new StackFrame(uniqueId, funcName, source, rangeMatch.sourceLine + 1))
      }
    }

    return { stackFrames: outStackFrames, totalFrames: response.entries.length }
  }

  private findProcLabel(pcRangeMatch: RangeMatch, procAddress: number):
      { statement: Statement, baseAddress: number } | undefined {

    let rangeMatch = pcRangeMatch.objectDoc.findRanges(procAddress)[0]
    for (let pass = 0; pass < 2; pass += 1) {
      if (rangeMatch) {
        const sourceFile = rangeMatch.objectDoc.sourceFile
        for (let i = rangeMatch.sourceLine; i >= 0; i -= 1) {
          const statement = sourceFile.statements[i]
          if (statement.labelExp && statement.PC !== undefined) {
            if (!statement.labelExp.isLocalType() && !statement.labelExp.isVariableType()) {
              // TODO: should PC be coming from an ObjectLine?
              return { statement, baseAddress: statement.PC }
            }
          }
        }
      }
      // If the proc wasn't found in the file, then it's probably
      //  ambiguous because of a jmp/jsr-rts.  Use the pcRangeMatch
      //  instead to search for a label.
      rangeMatch = pcRangeMatch
    }
  }

  //--------------------------------------------------------
  // MARK: scopes

  private onScopes(args: DebugProtocol.ScopesArguments) {

    const scopes: Scope[] = []
    const stackEntry = this.stackFrameHandles.get(args.frameId)
    if (stackEntry) {
      const topOfStack = (stackEntry as any).topOfStack ?? false

      scopes.push(new Scope("Registers", this.variableHandles.create(new RegistersVariable(stackEntry, topOfStack)), false))
      if (topOfStack) {
        // TODO: check for invalidated timing numbers above
        // scopes.push(new Scope("Timing", this.variableHandles.create(new DebugVariable("timing")), false))
      }
    }
    return { scopes }
  }

  //--------------------------------------------------------
  // MARK: variables

  private onVariables(args: DebugProtocol.VariablesArguments) {
    const v = this.variableHandles.get(args.variablesReference)
    return { variables: v?.buildChildVariables() ?? [] }
  }

  private onSetVariable(args: DebugProtocol.SetVariableArguments) {
    const v = this.variableHandles.get(args.variablesReference)
    return v?.setNamedValue(this, args.name, args.value)
  }

  //--------------------------------------------------------
  // MARK: expressions

  private findObjectDoc(fullPath: string): ObjectDoc | undefined {
    for (let module of this.mainProject!.modules) {
      for (let doc of module.objectDocs) {
        if (doc.sourceFile.fullPath == fullPath) {
          return doc
        }
      }
    }
  }

  public findTypeDef(typeName: string): TypeDef | undefined {
    let foundSym: Symbol | undefined
    for (let module of this.mainProject!.modules) {
      foundSym = module.symbolMap.get(typeName)
      if (foundSym) {
        return foundSym.typeDef
      }
    }
  }

  private async onEvaluate(args: DebugProtocol.EvaluateArguments) {
    let opBytes: number[] | undefined

    // hover is handled in lsp_server
    if (args.context == "hover") {
      return
    }

    // look for type name at end of expression and strip it off
    let expStr = args.expression.trim()
    let typeStr = ""
    const n = expStr.lastIndexOf(":")
    if (n >= 0) {
      typeStr = expStr.substring(n + 1).trim()
      expStr = expStr.substring(0, n).trim()
    }

    opBytes = evalOpExpression(this.mainProject!, expStr)
    if (!opBytes) {
      return
    }

    // [<type-name>][ "[" <number> "]" [ "[" <number> "]" ] ]

    let rows: number | undefined
    let columns: number | undefined
    let typeName: string | undefined
    let typeDef: TypeDef | undefined

    // see if expStr is a symbol with a typeRef
    for (let module of this.mainProject!.modules) {
      const foundSym = module.symbolMap.get(expStr)
      if (foundSym) {
        typeDef = foundSym.typeRef
        break
      }
    }

    if (typeStr) {

      let parseError = false

      const parser = new Parser()
      parser.setSourceLine(typeStr)
      parser.syntax = this.mainProject!.syntax

      // get optional type name
      let token = parser.getNextToken()
      if (token && token.getString() != "[") {
        typeName = token.getString()
        if (!isSimpleType(typeName)) {
          typeDef = this.findTypeDef(typeName)
          if (!typeDef) {
            parseError = true
          }
        }
        token = parser.getNextToken()
      }

      // get optional first bracketed term
      if (token) {
        if (token.getString() == "[") {
          token = parser.getNextToken()
          if (token) {
            if (token.type == TokenType.DecNumber) {
              columns = parseInt(token.getString())
              if (isNaN(columns)) {
                parseError = true
              }
              token = parser.getNextToken()
              if (token) {
                if (token.getString() != "]") {
                  parseError = true
                }
              } else {
                parseError = true
              }
            } else if (token.getString() == "]") {
              columns = 8
            } else {
              parseError = true
            }
          } else {
            parseError = true
          }
          token = parser.getNextToken()
        }
      }

      // get optional second bracketed term
      if (token && token.getString() == "[") {
        token = parser.getNextToken()
        if (token) {
          if (token.type == TokenType.DecNumber) {
            rows = columns
            columns = parseInt(token.getString())
            if (isNaN(columns)) {
              parseError = true
            }
            token = parser.getNextToken()
            if (token) {
              if (token.getString() != "]") {
                parseError = true
              }
            } else {
              parseError = true
            }
          } else {
            parseError = true
          }
        } else {
          parseError = true
        }
        token = parser.getNextToken()
      }

      if (parseError) {
        return
      }
    }

    const request: ReadOpMemoryRequest = {
      command: "readOpMemory",
      opBytes
    }

    if (typeDef) {
      if (columns != undefined) {
        if (rows != undefined) {
          // TODO: "typeDef[][]"
        } else {
          // TODO: "typeDef[]"
        }
      } else {
        // "typeDef"
        request.typeSize = typeDef.size
        const response: ReadMemoryResponse = await this.sendRequest(request)
        const dataBytes = base64.toByteArray(response.dataString)

        const structVar = new StructVariable(this, typeDef, response.dataAddress, dataBytes)
        const result = "{ }"
        return { result, variablesReference: structVar.handle }
      }
    } else {
      let typeSize
      if (typeName == "byte" || typeName == "text") {
        typeSize = 1
      } else if (typeName == "word") {
        typeSize = 2
      } else if (typeName == "long") {
        typeSize = 3
      } else {
        // TODO: choose length implicitly from opcode
        typeSize = 1
      }

      request.typeSize = typeSize
      let arrayView = false

      if (columns != undefined) {
        columns = Math.max(Math.min(columns, 16), 1)
        if (rows != undefined) {
          rows = Math.max(Math.min(rows, 16), 1)
        }
        request.typeSize = columns * typeSize * (rows ?? 1)
        arrayView = true
      }

      const response: ReadOpMemoryResponse = await this.sendRequest(request)
      const dataBytes = base64.toByteArray(response.dataString)
      let varRef = 0

      if (!arrayView && response.indexAddress != undefined) {
        columns = Math.min(dataBytes.length, 8)
        rows = Math.max(Math.floor(dataBytes.length / columns), 1)
        arrayView = true
      }

      if (arrayView) {
        if (rows == undefined) {
          rows = Math.floor(dataBytes.length / columns!)
        }

        const arrayVar = new ArrayVariable(rows, columns!, typeSize, response.dataAddress, response.indexAddress, dataBytes)
        varRef = this.variableHandles.create(arrayVar)
      }

      const offset = (response.indexAddress ?? response.dataAddress) - response.dataAddress

      let result = ""
      if (typeName == "text") {
        result = buildTextString(dataBytes)
      } else {
        result = dataToString(dataBytes, offset, typeSize)
      }
      return { result, variablesReference: varRef }
    }
  }

  private onSetExpression(args: DebugProtocol.SetExpressionArguments) {
    // TODO: need to implement this?
  }

  //--------------------------------------------------------
  // MARK: memory read/write

  private async onReadMemory(args: DebugProtocol.ReadMemoryArguments) {

    const address = parseInt(args.memoryReference, 16)
    if (isNaN(address)) {
      return
    }

    const request: ReadMemoryRequest = {
      command: "readMemory",
      dataAddress: address,
      readOffset: args.offset,
      readLength: args.count
    }

    const response: ReadMemoryResponse = await this.sendRequest(request)

    return {
      address: response.dataAddress.toString(),
      unreadableBytes: request.readLength! - response.dataLength,
      data: response.dataString
    }
  }

  private async onWriteMemory(args: DebugProtocol.WriteMemoryArguments) {

    const address = parseInt(args.memoryReference, 16)
    if (isNaN(address)) {
      return { bytesWritten: 0 }
    }

    const request: WriteMemoryRequest = {
      command: "writeMemory",
      dataAddress: address + (args.offset ?? 0),
      dataBank: 0,
      dataString: args.data,
      partialAllowed: args.allowPartial ?? false
    }

    const response: WriteMemoryResponse = await this.sendRequest(request)
    return {
      offset: args.offset ?? 0,
      bytesWritten: response.bytesWritten
    }
  }

  //--------------------------------------------------------
  // MARK: buildDebugHover

  public async buildDebugHover(sourcePath: string, line: number): Promise<string> {

    let opBytes: number[] | undefined

    const objectDoc = this.findObjectDoc(sourcePath)
    if (objectDoc) {
      const objectLine = objectDoc.getObjectLines(line)[0]
      if (objectLine?.dataBytes) {
        opBytes = objectLine.dataBytes
      }
    }
    if (!opBytes) {
      return ""
    }

    const request: ReadOpMemoryRequest = {
      command: "readOpMemory",
      opBytes
    }

    const resp: ReadOpMemoryResponse = await this.sendRequest(request)
    const dataBytes = base64.toByteArray(resp.dataString)
    let dataLength = dataBytes.length
    if (dataLength == 0) {
      return ""
    }

    // TODO: share/reuse array variable code

    let address = resp.dataAddress
    const addrLen = resp.dataAddress < 0x100 ? 2 : 4
    let rowWidth = 16
    let indexOffset: number | undefined
    if (resp.indexAddress != undefined) {
      indexOffset = resp.indexAddress - resp.dataAddress
      if (resp.indexAddress - resp.dataAddress < 8) {
        rowWidth = 8
        if (dataLength > 8) {
          dataLength = 8
        }
      }
    }

    let str = ""
    let rowCount = 0
    for (let i = 0; i < dataLength; i += 1) {
      if (rowCount == 0) {
        str += address.toString(16).toUpperCase().padStart(addrLen, "0") + "="
      } else if (rowCount == 8 && rowWidth > 8) {
        str += "\xa0"
      }
      let hexStr = dataBytes[i].toString(16).toUpperCase().padStart(2, "0")
      if (i == indexOffset) {
        hexStr = underlineString(hexStr)
      }

      str += " " + hexStr
      rowCount += 1
      if (rowCount == rowWidth) {
        str += "\n"
        rowCount = 0
      }
      address += 1
    }

    if (dataLength == 1) {
      str += " (#" + dataBytes[0].toString(10) + ")"
    }
    if (rowCount != 0) {
      str += "\n"
    }

    return "```\n" + str + "\n```"
  }
}

//------------------------------------------------------------------------------
