
import * as lsp from 'vscode-languageserver'
import { LspServer, LspProject } from "./lsp_server"

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
      console.log("WS server is live on port 6502") // ***
    })

    // *** close socket?
    const errHandle = (err: any) => {
      if (err) {
        throw err
      }
    }

    this.socketServer.on("connection", (socket: WebSocket) => {

      // console.log("connecting")

      if (this.socket) {
        // console.log("closed previous socket")
        this.socket.close()
        this.socket = undefined
      }

      // console.log("socket connected")
      this.socket = socket

      this.socket.on("message", (data) => {
        const msgStr = data.toString()
        const msgObj = JSON.parse(msgStr)
        this.receiveMessage(msgObj)
      })

      this.socket.on("close", () => {
        this.socket = undefined
        this.responseProc = undefined
        // console.log("socket closed")
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
      const msgResponse = await promise

      // *** request stack from socket talking to emulator ***
        // *** convert address to name/file ***

      const sourceFile = project.modules[0]?.sourceFiles[0] // *** fake
      if (sourceFile === undefined) {
        return
      }

      const cmdResponse: RpwStackResponse = {
        frames: [],
        totalFrames: 1
      }

      // *** show actual address too?
      // *** use msgResponse

      cmdResponse.frames.push({ index: 0, name: "FUNCTION_NAME+$0000", path: sourceFile.fullPath, line: 20 })
      return cmdResponse
    }

    // all commands that don't send response
    this.socket?.send(`{"id":99,"type":"${debugCmd}"}`)  // *** id
  }
}

//------------------------------------------------------------------------------
