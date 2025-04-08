
// import * as base64 from 'base64-js'
import * as path from 'path'
import * as lsp from 'vscode-languageserver'
import { DebugProtocol } from "@vscode/debugprotocol"
import { Handles, Breakpoint, StackFrame, Source, Scope, Variable } from "@vscode/debugadapter"
import { WebSocket, Server } from "ws"
import { LspServer, LspProject } from "./lsp_server"
import { StackEntry, StackRegister } from "./shared/types"
import { Statement } from "./asm/statements"
import { DataRange } from "./asm/project"

type ObjectDoc = any

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
  dataBytes?: string
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

  public mainProject?: LspProject

  private socketServer: Server
  private socket?: WebSocket
  private responseProc?: any

  private breakpoints = new Map<string, number[]>()
  private variableHandles = new Handles<DebugVariable>()
  private stackFrameHandles = new Handles<StackEntry>()

  constructor(private lspServer: LspServer, private connection: lsp.Connection ) {

    this.socketServer = new Server({ port: 6502 }, () => {
    })

    // *** close socket?
    const errHandle = (err: any) => {
      if (err) {
        throw err
      }
    }

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
        this.variableHandles.reset()
        this.stackFrameHandles.reset()
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

      case "setBreakpoints": {

        const args = <DebugProtocol.SetBreakpointsArguments>params.arguments[1]

        const objectDoc = this.findObjectDoc(this.mainProject, args.source.path!)
        if (!objectDoc) {
          return []
        }

        // // verify and convert source file breakpoint lines to addresses
        // const addresses: number[] = []
        const outBreakpoints: DebugProtocol.Breakpoint[] = []
        // for (let breakpoint of args.breakpoints!) {
        //
        //   let verified = false
        //   let line = breakpoint.line
        //
        //   let objectLine = objectDoc.objectLines[breakpoint.line - 1]
        //   if (objectLine) {
        //
        //     // If line is empty but has an address, scan forward
        //     //  for a line with same address and some data bytes.
        //     //
        //     // TODO: should only do this when starting on line with label?
        //     // TODO: don't do this on empty or comment lines
        //
        //     // *** look up and use source statement for more information ***
        //
        //     let objAddress = objectLine.address
        //     if (objectLine.objLength == 0) {
        //       while (++line < objectDoc.objectLines.length) {
        //         const nextLine = objectDoc.objectLines[line - 1]
        //         if (nextLine.address == -1) {
        //           continue
        //         }
        //         if (objAddress == -1) {
        //           objAddress = nextLine.address
        //         }
        //         if (nextLine.address == objAddress) {
        //           if (nextLine.objLength > 0) {
        //             objectLine = nextLine
        //             break
        //           }
        //         }
        //       }
        //     }
        //
        //     if (objectLine.objLength > 0) {
        //       // TODO: check that line is code, not storage
        //       addresses.push(objectLine.address)
        //       verified = true
        //     }
        //   }
        //
        //   const bp = new Breakpoint(verified, line) as DebugProtocol.Breakpoint
        //   outBreakpoints.push(bp)
        // }
        //
        // // add/replace breakpoint addresses for given file
        // this.breakpoints.set(args.source.path!, addresses)
        //
        // // build flat list of all addresses with breakpoints, removing duplicates
        // const flatMap = new Map<number, boolean>()
        // for (let entry of this.breakpoints) {
        //   const addresses = entry[1]
        //   for (let address of addresses) {
        //     flatMap.set(address, true)
        //   }
        // }
        //
        // const request: SetBreakpointsRequest = {
        //   command: params.arguments[0],
        //   entries: []
        // }
        //
        // for (let entry of flatMap) {
        //   request.entries.push({ address: entry[0] })
        // }
        //
        // this.socket.send(JSON.stringify(request))
        // // TODO: await a response for sync purposes?
        //
        // DebugProtocol.SetBreakpointsResponse.body
        return { breakpoints: outBreakpoints }
      }

      case "stackTrace": {

        const args = <DebugProtocol.StackTraceArguments>params.arguments[1]

        // *** make sure !this.responseProc ***

        const promise = new Promise((resolve, reject) => {
          this.responseProc = (responseMsg: any) => {
            resolve(responseMsg)
          }
        })

        this.socket.send('{"command":"getStack"}')
        const msgResponse = <StackResponse>await promise

        // *** figure out function name if at top of stack ***

        const outStackFrames: StackFrame[] = []
        for (let entry of msgResponse.entries) {

          const entryPC = entry.regs[0].value
          const dataRange = DataRange.create(entry)
          const result = this.mainProject.findSourceByAddress(entryPC, dataRange)
          // if (result) {
          //
          //   let funcName: string = "$" + entryPC.toString(16).toUpperCase().padStart(4, "0")
          //
          //   // *** source code should help with this? ***
          //   const statement = this.findNearestLabel(result.objectDoc, entry.proc)
          //   if (statement && statement.labelExp) {
          //     funcName += ": " + statement.labelExp.getString()
          //     if (entry.proc != entryPC) {
          //       funcName += "+$" + (entryPC - entry.proc).toString(16).toUpperCase().padStart(4, "0")
          //     }
          //   }
          //
          //   const source = new Source(
          //     path.posix.basename(result.objectDoc.name),
          //     result.objectDoc.name)
          //
          //   if (outStackFrames.length == 0) {
          //     (entry as any).topOfStack = true
          //   }
          //   const uniqueId = this.stackFrameHandles.create(entry)
          //   outStackFrames.push(new StackFrame(uniqueId, funcName, source, result.line + 1))
          // }
        }

        return { stackFrames: outStackFrames, totalFrames: msgResponse.entries.length }
      }

      case "scopes": {

        const args = <DebugProtocol.ScopesArguments>params.arguments[1]
        const stackEntry = this.stackFrameHandles.get(args.frameId)
        const topOfStack = (stackEntry as any).topOfStack ?? false

        const outScopes = [
          new Scope("Registers", this.variableHandles.create(new DebugVariable("registers", args.frameId, "")), false)
        ]
        if (topOfStack) {
          // TODO: check for invalidated timing numbers above
          outScopes.push(new Scope("Timing", this.variableHandles.create(new DebugVariable("timing", args.frameId, "")), false))
        }
        return { scopes: outScopes }
      }

      case "variables": {

        const args = <DebugProtocol.VariablesArguments>params.arguments[1]
        const v: DebugVariable = this.variableHandles.get(args.variablesReference)
        const outVariables: Variable[] = []

        const stackEntry = this.stackFrameHandles.get(v.value as number)
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
            outVariables.push(regVar)
          }

        } else if (v.name == "timing") {

          // *** show timing numbers ***

          if (topOfStack) {
            // *** delta cycles and delta ms -- always readonly ***
          }
        }
        return { variables: outVariables }
      }

      case "setVariable": {

        const args = <DebugProtocol.SetVariableArguments>params.arguments[1]
        const v: DebugVariable = this.variableHandles.get(args.variablesReference)
        if (v.name == "registers") {
          const debugVar = v.children.get(args.name)
          if (debugVar) {
            const reg = debugVar.register!
            this.parseRegValue(reg, args.value)
            if (reg.value != debugVar.value) {
              this.socket.send(`{"command":"setRegister","name":"${reg.name}","value":${reg.value}}`)
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
    }
  }

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

  private findObjectDoc(project: LspProject, sourcePath: string): /*ObjectDoc |*/ undefined {
    // for (let module of project.modules) {
    //   if (module.objectDocs) {
    //     for (let doc of module.objectDocs) {
    //       if (doc.name == sourcePath) {
    //         return doc
    //       }
    //     }
    //   }
    // }
    return
  }

  private findNearestLabel(objectDoc: ObjectDoc, address: number): Statement | undefined {
    // let funcLine = objectDoc.findLineByAddress(address)
    // if (funcLine >= 0) {
    //   const sourceFile = this.lspServer.findSourceFile(objectDoc.name)
    //   if (sourceFile) {
    //     while (true) {
    //       const objLine = objectDoc.objectLines[funcLine]
    //       if (objLine.address != -1 && objLine.address != address) {
    //         break
    //       }
    //       const statement = sourceFile.statements[funcLine]
    //       if (statement.labelExp) {
    //         return statement
    //       }
    //       funcLine -= 1
    //       if (funcLine < 0) {
    //         break
    //       }
    //     }
    //   }
    // }
    return
  }
}

//------------------------------------------------------------------------------
