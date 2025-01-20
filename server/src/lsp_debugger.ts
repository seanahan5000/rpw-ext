
import * as lsp from 'vscode-languageserver'
import { LspServer, LspProject } from "./lsp_server"
import { ObjectDoc } from "./code/lst_parser"
import { StackEntry } from "./shared/types"
import { Statement } from "./asm/statements"

// TODO:
//  - allow breakpoints
//  - set/clear/trigger breakpoints
//  - register locals
//  - read/write memory
//  - loaded status
//  - run to cursor
//  - step forward
//  ? split stack update

//------------------------------------------------------------------------------

// also in debugger.ts

export type RpwStackRequest = {
  startFrame?: number
  levels?: number
}

export type RpwStackFrame = {
  index: number   // 0-based
  name: string
  path: string
  line: number    // 0-based
}

export type RpwStackResponse = {
  frames: RpwStackFrame[]
  totalFrames: number
}

//------------------------------------------------------------------------------

type RequestHeader = {
  id: number
  type: string
}

type StackResponse = RequestHeader & {
  entries: StackEntry[]
}

//------------------------------------------------------------------------------

import { WebSocket, Server } from "ws"

export class LspDebugger {

  private lspServer: LspServer        // *** get rid of?
  private connection: lsp.Connection

  private socketServer: Server
  private socket?: WebSocket
  private responseProc?: any

  constructor(lspServer: LspServer, connection: lsp.Connection ) {
    this.lspServer = lspServer
    this.connection = connection

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

  private async receiveMessage(msgObj: any) {
    if (msgObj.id === undefined) {
      if (msgObj.type == "cpuStarted") {
        this.connection.sendNotification("rpw65.debuggerStarted")
      } else if (msgObj.type == "cpuStopped") {
        // TODO: get reason from msgObj and apply to notification
        this.connection.sendNotification("rpw65.debuggerStopped")
      }
    } else {
      // TODO: verify that msgObj.id is expected value
      if (this.responseProc) {
        this.responseProc(msgObj)
        this.responseProc = undefined
      }
    }
  }

  public async onExecuteCommand(project: LspProject, params: lsp.ExecuteCommandParams): Promise<any> {

    if (!params.arguments || !this.socket) {
      return
    }

    const debugCmd = params.arguments[0] ?? ""

    if (debugCmd == "getStack") {

      // *** make sure !this.responseProc ***

      const promise  = new Promise((resolve, reject) => {
        this.responseProc = (responseMsg: any) => {
          resolve(responseMsg)
        }
      })

      this.socket?.send('{"id":99,"type":"getStack"}')  // *** id
      const msgResponse = <StackResponse>await promise

      const cmdResponse: RpwStackResponse = {
        frames: [],
        totalFrames: msgResponse.entries.length
      }

      for (let entry of msgResponse.entries) {

        let objectDoc: ObjectDoc | undefined
        let objectLineNum: number = -1

        for (let module of project.modules) {
          if (module.objectDocs) {
            for (let doc of module.objectDocs) {
              // TODO: need to look at loaded percentage
              objectLineNum = doc.findLineByAddress(entry.pc)
              if (objectLineNum != -1) {
                objectDoc = doc
                break
              }
            }
          }
          if (objectDoc) {
            break
          }
        }

        if (objectDoc) {

          let funcName: string = "$" + entry.pc.toString(16).toUpperCase().padStart(4, "0")

          const statement = this.findNearestLabel(objectDoc, entry.proc)
          if (statement && statement.labelExp) {
            funcName += ": " + statement.labelExp.getString()
            if (entry.proc != entry.pc) {
              funcName += "+$" + (entry.pc - entry.proc).toString(16).toUpperCase().padStart(4, "0")
            }
          }

          cmdResponse.frames.push({
            index: 0,
            name: funcName,
            path: objectDoc.name,
            line: objectLineNum })
        }
      }
      return cmdResponse
    }

    // all commands that don't send response
    this.socket?.send(`{"id":99,"type":"${debugCmd}"}`)  // *** id
  }

  findNearestLabel(objectDoc: ObjectDoc, address: number): Statement | undefined {
    let funcLine = objectDoc.findLineByAddress(address)
    if (funcLine >= 0) {
      const sourceFile = this.lspServer.findSourceFile(objectDoc.name)
      if (sourceFile) {
        while (true) {
          const objLine = objectDoc.objectLines[funcLine]
          if (objLine.address != -1 && objLine.address != address) {
            break
          }
          const statement = sourceFile.statements[funcLine]
          if (statement.labelExp) {
            return statement
          }
          funcLine -= 1
          if (funcLine < 0) {
            break
          }
        }
      }
    }
  }
}

//------------------------------------------------------------------------------
