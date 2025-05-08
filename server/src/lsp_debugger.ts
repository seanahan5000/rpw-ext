
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

// TODO:
//  - show timing
//  - step forward
//  - add default key-combos for all stepping operations
//
//  - read/write memory
//  - watch variables
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
  id?: number
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

type ReadMemoryRequest = RequestHeader & {
  opBytes?: number[]    // instruction bytes, to determine addressing mode
  dataAddress?: number  // direct read address, ignoring opMode, opBytes
  readOffset?: number   // offset applied after final address is computed
  readLength?: number   // number of bytes to read (default 1)
  indexed?: boolean     // split baseAddress and baseOffset in response
}

type ReadMemoryResponse = RequestHeader & {
  baseAddress?: number  // read address minus index reg
  baseOffset?: number   // index register offset
  dataAddress: number   // effective read address
  dataLength: number    // number of bytes actually read
  dataString: string    // actual data read in base64, possibly < readLength
}

type WriteMemoryRequest = RequestHeader & {
  dataAddress: number     // direct write address
  dataString: string      // bytes to write in base64
  partialAllowed: boolean // can write just some of the bytes
}

type WriteMemoryResponse = RequestHeader & {
  bytesWritten: number  // bytes successfully written
}

//------------------------------------------------------------------------------

type DebugVariableType = number | boolean | string | DebugVariable[]

class DebugVariable {

  public children = new Map<string, DebugVariable>()
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
  private nextRequestId: number = 1

  private pendingRequests = new Map<number, {
    resolve: (message: RequestHeader) => void
    reject: (reason?: any) => void
  }>()

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
        this.cancelRequests()
      })
    })
  }

  // *** never seems to be called ***
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

  private sendRequest(request: RequestHeader): Promise<any> {
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
          // *** need to use dataString in msg? ***
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

  public async onExecuteCommand(params: lsp.ExecuteCommandParams): Promise<any> {

    if (!params.arguments || !this.socket || !this.mainProject) {
      return
    }

    switch (params.arguments[0]) {

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

      // *** step forward ***

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
  // MARK: breakpoints

  private onBreakpointLocations(args: DebugProtocol.BreakpointLocationsArguments) {
    // ***
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

  private onDataBreakpointInfo(args: DebugProtocol.DataBreakpointInfoArguments) {
    // ***
  }

  private onDataBreakpointsInfo(args: DebugProtocol.SetDataBreakpointsArguments) {
    // ***
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

    // TODO: respect args.format.hex

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

    // TODO: respect args.format.hex

    const variables: Variable[] = []

    const v: DebugVariable = this.variableHandles.get(args.variablesReference)
    if (!v) {
      return { variables }
    }

    const stackEntry = this.stackFrameHandles.get(v.value as number)
    const topOfStack = (stackEntry as any)?.topOfStack ?? false

    if (v.name == "registers") {

      if (!stackEntry) {
        return { variables }
      }

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
        if (reg.name == "PC" || reg.name == "SP") {
          regVar.memoryReference = reg.value.toString(16).toUpperCase().padStart(4, "0")
        }
        if (!topOfStack) {
          regVar.presentationHint = { attributes: ["readOnly"] }
        }
        variables.push(regVar)
      }

    } else if (v.name == "timing") {

      // TODO: show timing numbers

      if (topOfStack) {
        // TODO: delta cycles and delta ms -- always readonly
      }
    }
    return { variables }
  }

  private onSetVariable(args: DebugProtocol.SetVariableArguments) {

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
          const request: SetRegisterRequest = {
            command: "setRegister",
            name: reg.name,
            value: reg.value
          }
          this.sendRequest(request)
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
  // MARK: expressions

	// interface EvaluateArguments {
	// 	/** The expression to evaluate. */
	// 	expression: string;
	// 	/** Evaluate the expression in the scope of this stack frame. If not specified, the expression is evaluated in the global scope. */
	// 	frameId?: number;
	// 	/** The contextual line where the expression should be evaluated. In the 'hover' context, this should be set to the start of the expression being hovered. */
	// 	line?: number;
	// 	/** The contextual column where the expression should be evaluated. This may be provided if `line` is also provided.
	//
	// 		It is measured in UTF-16 code units and the client capability `columnsStartAt1` determines whether it is 0- or 1-based.
	// 	*/
	// 	column?: number;
	// 	/** The contextual source in which the `line` is found. This must be provided if `line` is provided. */
	// 	source?: Source;
	// 	/** The context in which the evaluate request is used.
	// 		Values:
	// 		'watch': evaluate is called from a watch view context.
	// 		'repl': evaluate is called from a REPL context.
	// 		'hover': evaluate is called to generate the debug hover contents.
	// 		This value should only be used if the corresponding capability `supportsEvaluateForHovers` is true.
	// 		'clipboard': evaluate is called to generate clipboard contents.
	// 		This value should only be used if the corresponding capability `supportsClipboardContext` is true.
	// 		'variables': evaluate is called from a variables view context.
	// 		etc.
	// 	*/
	// 	context?: 'watch' | 'repl' | 'hover' | 'clipboard' | 'variables' | string;
	// 	/** Specifies details on how to format the result.
	// 		The attribute is only honored by a debug adapter if the corresponding capability `supportsValueFormattingOptions` is true.
	// 	*/
	// 	format?: ValueFormat; (hex?: boolean)
	// }

  private findObjectDoc(fullPath: string): ObjectDoc | undefined {
    for (let module of this.mainProject!.modules) {
      for (let doc of module.objectDocs) {
        if (doc.sourceFile.fullPath == fullPath) {
          return doc
        }
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
    let expStr = args.expression
    let typeStr = ""
    const n = expStr.indexOf(":")
    if (n >= 0) {
      typeStr = expStr.substring(n + 1)
      expStr = expStr.substring(0, n)
    }

    opBytes = evalOpExpression(this.mainProject!, expStr)
    if (!opBytes) {
      return
    }

    const request: ReadMemoryRequest = {
      command: "readMemory",
      opBytes,
      // TODO: get value size from opcode?
      readLength: 1
    }

    const response: ReadMemoryResponse = await this.sendRequest(request)
    const dataBytes = base64.toByteArray(response.dataString)

    if (typeStr) {
      // *** check for existing variable of same name? ***
      return { result: "...", variablesReference }
    } else {
      const value = dataBytes[0]
      const result = "$" + value.toString(16).toUpperCase().padStart(2, "0") +
        " (#" + value.toString(10) + ")"
      return { result, variablesReference: 0 }
    }
  }

	// interface EvaluateResponse extends Response {
	// 	body: {
	// 		/** The result of the evaluate request. */
	// 		result: string;
	// 		/** The type of the evaluate result.
	// 			This attribute should only be returned by a debug adapter if the corresponding capability `supportsVariableType` is true.
	// 		*/
	// 		type?: string;
	// 		/** Properties of an evaluate result that can be used to determine how to render the result in the UI. */
	// 		presentationHint?: VariablePresentationHint;
	// 		/** If `variablesReference` is > 0, the evaluate result is structured and its children can be retrieved by passing `variablesReference` to the `variables` request as long as execution remains suspended. See 'Lifetime of Object References' in the Overview section for details. */
	// 		variablesReference: number;
	// 		/** The number of named child variables.
	// 			The client can use this information to present the variables in a paged UI and fetch them in chunks.
	// 			The value should be less than or equal to 2147483647 (2^31-1).
	// 		*/
	// 		namedVariables?: number;
	// 		/** The number of indexed child variables.
	// 			The client can use this information to present the variables in a paged UI and fetch them in chunks.
	// 			The value should be less than or equal to 2147483647 (2^31-1).
	// 		*/
	// 		indexedVariables?: number;
	// 		/** A memory reference to a location appropriate for this result.
	// 			For pointer type eval results, this is generally a reference to the memory address contained in the pointer.
	// 			This attribute may be returned by a debug adapter if corresponding capability `supportsMemoryReferences` is true.
	// 		*/
	// 		memoryReference?: string;
	// 		/** A reference that allows the client to request the location where the returned value is declared. For example, if a function pointer is returned, the adapter may be able to look up the function's location. This should be present only if the adapter is likely to be able to resolve the location.

	// 			This reference shares the same lifetime as the `variablesReference`. See 'Lifetime of Object References' in the Overview section for details.
	// 		*/
	// 		valueLocationReference?: number;
	// 	};
	// }

  private onSetExpression(args: DebugProtocol.SetExpressionArguments) {
    // ***
    console.log() // ***
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


  // interface WriteMemoryArguments {
	// 	/** Memory reference to the base location to which data should be written. */
	// 	memoryReference: string;
	// 	/** Offset (in bytes) to be applied to the reference location before writing data. Can be negative. */
	// 	offset?: number;
	// 	/** Property to control partial writes. If true, the debug adapter should attempt to write memory even
  //    if the entire memory region is not writable. In such a case the debug adapter should stop after hitting
  //    the first byte of memory that cannot be written and return the number of bytes written in the response
  //    via the `offset` and `bytesWritten` properties.
	// 		If false or missing, a debug adapter should attempt to verify the region is writable before writing, and fail the response if it is not.
	// 	*/
	// 	allowPartial?: boolean;
	// 	/** Bytes to write, encoded using base64. */
	// 	data: string;
	// }

  private onWriteMemory(args: DebugProtocol.WriteMemoryArguments) {

    console.log()   // ***

		// const variable = this._variableHandles.get(Number(memoryReference));
		// if (typeof variable === 'object') {
		// 	const decoded = base64.toByteArray(data);
		// 	variable.setMemory(decoded, offset);
		// 	response.body = { bytesWritten: decoded.length };
		// } else {
		// 	response.body = { bytesWritten: 0 };
		// }
    //
		// this.sendResponse(response);
		// this.sendEvent(new InvalidatedEvent(['variables']))

    // return {
    //   offset?: Number,
    //   bytesWritten?: number
    // }
  }

  // interface WriteMemoryResponse extends Response {
  // 	body?: {
  // 		/** Property that should be returned when `allowPartial` is true to indicate the offset of the first byte of data successfully written. Can be negative. */
  // 		offset?: number;
  // 		/** Property that should be returned when `allowPartial` is true to indicate the number of bytes starting from address that were successfully written. */
  // 		bytesWritten?: number;
  // 	};
  // }

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

    const request: ReadMemoryRequest = {
      command: "readMemory",
      opBytes,
      indexed: true
    }

    const resp: ReadMemoryResponse = await this.sendRequest(request)
    const dataBytes = base64.toByteArray(resp.dataString)
    let dataLength = dataBytes.length
    if (dataLength == 0) {
      return ""
    }

    let address = resp.baseAddress ?? resp.dataAddress
    const addrLen = resp.dataAddress < 0x100 ? 2 : 4
    let rowWidth = 16
    if (resp.baseOffset != undefined) {
      if (resp.baseOffset < 8) {
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
        str += address.toString(16).toUpperCase().padStart(addrLen, "0") + ":"
      } else if (rowCount == 8 && rowWidth > 8) {
        str += "\xa0"
      }
      str += " " + dataBytes[i].toString(16).toUpperCase().padStart(2, "0")
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

    if (resp.baseOffset !== undefined) {
      const index = resp.baseOffset % 16
      str += "".padEnd(addrLen + 1 + index * 3, "\xA0") + " ^^"
    }

    return "```\n" + str + "\n```"
  }
}

//------------------------------------------------------------------------------
