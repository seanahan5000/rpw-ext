
import * as base64 from 'base64-js'
import * as path from 'path'
import * as lsp from 'vscode-languageserver'
import { DebugProtocol } from "@vscode/debugprotocol"
import { Handles, Breakpoint, StackFrame, Source, Scope, Variable } from "@vscode/debugadapter"
import { WebSocket, WebSocketServer } from "ws"
import { LspServer, LspProject } from "./lsp_server"
import { StackEntry, StackRegister } from "./shared/types"
import { Statement, OpStatement, MacroInvokeStatement } from "./asm/statements"
import { SourceFile } from "./asm/project"
import { ObjectDoc, DataRange, RangeMatch } from "./asm/object_doc"

// TODO:
//  - show timing
//  - jump to cursor
//  - step forward
//  - add default key-combos for all stepping operations
//  - fix breakpoints on dead lines
//
//  - read/write memory
//  - watch variables
//  - runtime hover + editor hover
//
//  ? split stack update
//  - exceptions on handled errors
//    - (stack tracking, for example)
//  - runtime completions
//  ? data breakpoints
//  ? conditional breakpoints

//------------------------------------------------------------------------------

// NOTE: duplicated in dbug_vsc.ts

type RequestHeader = {
  command: string
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

//------------------------------------------------------------------------------

type DebugVariableType = number | boolean | string | DebugVariable[]

class DebugVariable {

  public children = new Map<string,DebugVariable>()
  public register?: StackRegister

  constructor(
    public readonly name: string,
    public value: DebugVariableType,
    public valueStr: string)
  {
  }

  addChild(variable: DebugVariable) {
    this.children.set(variable.name, variable)
  }
}

export class LspDebugger {

  private mainProject?: LspProject

  private socketServer?: WebSocketServer
  private socket?: WebSocket
  private responseProc?: any

  private breakpoints = new Map<string, number[]>()
  private variableHandles = new Handles<DebugVariable>()
  private stackFrameHandles = new Handles<StackEntry>()

  constructor(private lspServer: LspServer, private connection: lsp.Connection ) {
  }

  public startup(mainProject: LspProject) {

    this.mainProject = mainProject

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
        this.responseProc = undefined
      })
    })
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
          const result = this.mainProject.findSourceByAddress(msg.pc)
          if (!result) {
            // if breakpoint address is in file that isn't loaded,
            //  restart target and don't report stop

            // TODO: Invalidate cycle count numbers because will
            //  cause them to be inaccurate.

            this.socket?.send(`{"command":"startCpu"}`)
            break
          }
        }
        this.connection.sendNotification("rpw65.debuggerStopped", { reason: msg.reason })
        break
      }

      default: {
        if (this.responseProc) {
          this.responseProc(message)
          this.responseProc = undefined
        }
        break
      }
    }
  }

  public async onExecuteCommand(params: lsp.ExecuteCommandParams): Promise<any> {

    if (!params.arguments || !this.socket || !this.mainProject) {
      return
    }

    switch (params.arguments[0]) {

      // translate from vscode to dbug commands
      case "pause":
        this.socket.send('{"command":"stopCpu"}')
        break
      case "continue":
        this.socket.send('{"command":"startCpu"}')
        break
      case "next":
        this.socket.send('{"command":"stepCpuOver"}')
        break
      case "stepIn":
        this.socket.send('{"command":"stepCpuInto"}')
        break
      case "stepOut":
        this.socket.send('{"command":"stepCpuOutOf"}')
        break

      case "setBreakpoints":
        return this.onSetBreakpoints(<DebugProtocol.SetBreakpointsArguments>params.arguments![1])

      case "stackTrace":
        return this.onStackTrace(<DebugProtocol.StackTraceArguments>params.arguments![1])

      case "scopes":
        return this.onScopes(<DebugProtocol.ScopesArguments>params.arguments![1])

      case "variables":
        return this.onVariables(<DebugProtocol.VariablesArguments>params.arguments[1])

      case "setVariable":
        return this.onSetVariables(<DebugProtocol.SetVariableArguments>params.arguments[1])
    }
  }

  //--------------------------------------------------------
  // MARK: setBreakpoints

  private findSourceFile(project: LspProject, sourcePath: string): SourceFile | undefined {
    for (let module of project.modules) {
      for (let sourceFile of module.sourceFiles) {
        if (sourceFile.fullPath == sourcePath) {
          return sourceFile
        }
      }
    }
  }

  private onSetBreakpoints(args: DebugProtocol.SetBreakpointsArguments) {

    let objectDoc: ObjectDoc | undefined
    for (let module of this.mainProject!.modules) {
      for (let doc of module.objectDocs) {
        if (doc.sourceFile.fullPath == args.source.path!) {
          objectDoc = doc
          break
        }
      }
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

    this.socket!.send(JSON.stringify(request))
    // TODO: await a response for sync purposes?

    // DebugProtocol.SetBreakpointsResponse.body
    return { breakpoints }
  }

  //--------------------------------------------------------
  // MARK: stackTrace

  private async onStackTrace(args: DebugProtocol.StackTraceArguments) {

    // *** make sure !this.responseProc ***

    const promise = new Promise((resolve, reject) => {
      this.responseProc = (responseMsg: any) => {
        resolve(responseMsg)
      }
    })

    this.socket!.send('{"command":"getStack"}')
    const msgResponse = <StackResponse>await promise

    this.variableHandles.reset()
    this.stackFrameHandles.reset()

    const outStackFrames: StackFrame[] = []
    for (let entry of msgResponse.entries) {

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

    return { stackFrames: outStackFrames, totalFrames: msgResponse.entries.length }
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
              // *** should PC be coming from an ObjectLine? ***
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

      scopes.push(new Scope("Registers", this.variableHandles.create(new DebugVariable("registers", args.frameId, "")), false))
      if (topOfStack) {
        // TODO: check for invalidated timing numbers above
        scopes.push(new Scope("Timing", this.variableHandles.create(new DebugVariable("timing", args.frameId, "")), false))
      }
    }

    return { scopes }
  }

  //--------------------------------------------------------
  // MARK: variables

  private onVariables(args: DebugProtocol.VariablesArguments) {

    const variables: Variable[] = []

    const v: DebugVariable = this.variableHandles.get(args.variablesReference)
    if (!v) {
      return { variables }
    }

    const stackEntry = this.stackFrameHandles.get(v.value as number)
    if (!stackEntry) {
      return { variables }
    }
    const topOfStack = (stackEntry as any).topOfStack ?? false

    if (v.name == "registers") {

      for (let i = 0; i < stackEntry.regs.length; i += 1) {
        // put PC, SP, and PS at end of variables
        let index = i + 3
        if (index >= stackEntry.regs.length) {
          index -= stackEntry.regs.length
        }
        const reg = stackEntry.regs[index]
        const valueStr = this.regToString(reg)
        const debugVar = new DebugVariable(reg.name, reg.value, valueStr)
        debugVar.register = reg
        v.addChild(debugVar)
        let regVar: DebugProtocol.Variable = {
          name: debugVar.name,
          value: debugVar.valueStr,
          variablesReference: 0
        }
        if (!topOfStack) {
          regVar.presentationHint = { attributes: ["readOnly"] }
        }
        variables.push(regVar)
      }

    } else if (v.name == "timing") {

      // *** show timing numbers ***

      if (topOfStack) {
        // *** delta cycles and delta ms -- always readonly ***
      }
    }
    return { variables }
  }

  //--------------------------------------------------------
  // MARK: setVariables

  private onSetVariables(args: DebugProtocol.SetVariableArguments) {

    const v: DebugVariable = this.variableHandles.get(args.variablesReference)
    if (!v) {
      return
    }
    if (v.name == "registers") {
      const debugVar = v.children.get(args.name)
      if (debugVar) {
        const reg = debugVar.register!
        this.parseRegValue(reg, args.value)
        if (reg.value != debugVar.value) {
          this.socket!.send(`{"command":"setRegister","name":"${reg.name}","value":${reg.value}}`)
        }
        debugVar.value = reg.value
        debugVar.valueStr = this.regToString(reg)
        return {
          value: debugVar.valueStr,
          variablesReference: 0
        }
      }
    }
  }

  //--------------------------------------------------------
  // MARK: utils

  private regToString(reg: StackRegister): string {
    let valueStr = ""
    if (reg.flagNames) {
      for (let i = 0; i < reg.flagNames.length; i += 1) {
        let flagName = reg.flagNames[i]
        if (!(reg.value & (1 << i))) {
          flagName = flagName.toLowerCase()
        }
        valueStr = flagName + valueStr
      }
    } else {
      let value = reg.value
      let bitSize = reg.bitSize ?? 8
      if (reg.name == "SP" && bitSize == 8) {
        value += 0x0100
        bitSize = 16
      }
      if (bitSize == 8) {
        valueStr = "$" + reg.value.toString(16).toUpperCase().padStart(2, "0")
        valueStr += (" (#" + reg.value.toString()) + ")"
      } else {
        valueStr = "$" + reg.value.toString(16).toUpperCase().padStart(4, "0")
      }
    }
    return valueStr
  }

  private parseRegValue(reg: StackRegister, valueStr: string) {
    valueStr = valueStr.trim()

    if (reg.flagNames) {
      let clearMask = 0
      let setMask = 0
      while (valueStr) {
        const char = valueStr[0]
        const upperChar = char.toUpperCase()
        const n = reg.flagNames.indexOf(upperChar)
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
      reg.value = (reg.value & ~clearMask) | setMask
      return
    }

    let base = 10
    let sign = 1
    if (valueStr[0] == "#") {
      base = 10
      valueStr = valueStr.slice(1)
    } else if (valueStr[0] == "$") {
      base = 16
      valueStr = valueStr.slice(1)
    }
    if (valueStr[0] == "-") {
      valueStr = valueStr.slice(1)
      sign = -1
    }
    let value = parseInt(valueStr, base)
    if (isNaN(value)) {
      return
    }
    value *= sign

    let bitSize = reg.bitSize ?? 8
    if (reg.name == "SP" && bitSize == 8) {
      if (value < 0 || value >= 0x0200) {
        return
      }
    }
    if (bitSize == 8) {
      value &= 0xff
    } else {
      value &= 0xffff
    }
    reg.value = value
  }
}

//------------------------------------------------------------------------------
