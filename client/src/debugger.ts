
import { DebugProtocol } from "vscode-debugprotocol"
import { DebugSession, InitializedEvent, StoppedEvent, BreakpointEvent, ContinuedEvent } from "vscode-debugadapter"
import { Thread, StackFrame, Scope, Source } from "vscode-debugadapter"
import { client } from "./extension"
import * as vsclnt from 'vscode-languageclient'
import * as path from 'path'

// TODO: is this really needed?
import { Subject } from 'await-notify'

// TODO: think about how logging could be used by A2 debugger

//------------------------------------------------------------------------------

// also in lsp_debugger.ts

export type RpwStackRequest = {
  startFrame?: number
  endFrame?: number
}

export type RpwStackFrame = {
  index: number   // 0-based?
  name: string
  path: string
  line: number    // 0-based?
}

export type RpwStackResponse = {
  frames: RpwStackFrame[]
  totalFrames: number
}

//------------------------------------------------------------------------------

export class RpwDebugSession extends DebugSession {

  private configurationDone = new Subject()

  constructor() {
    super()

    // TODO: confirm that these are wanted
    this.setDebuggerLinesStartAt1(false)
    this.setDebuggerColumnsStartAt1(false)

    BreakpointEvent

    client.onNotification("rpw65.debuggerStarted", () => {
      // TODO: probably not required
      // this.sendEvent(new ContinuedEvent(1))
    })

    client.onNotification("rpw65.debuggerStopped", () => {

      // *** more information for stopped reason (human-readable)

      // *** choose event based on reason ***
      // "entry"
      // "step"
      // "breakpoint"
      // "exception"

      // BreakpointEvent
      //  "changed"

      // NOTE: Without this delay, the VSCode debugger gets in a state
      //  where it knows the target has stopped but the UI doesn't reflect that.
      //  Only clicking on the Pause button would get it out of that state.
      setTimeout(() => {
        const stoppedEvent = new StoppedEvent('step', 1)
        this.sendEvent(stoppedEvent)
      }, 100)
    })
  }

  protected initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): void {
    response.body = response.body || {}
    response.body.supportsConfigurationDoneRequest = true
    this.sendResponse(response)
    this.sendEvent(new InitializedEvent())
  }

  protected configurationDoneRequest(response: DebugProtocol.ConfigurationDoneResponse, args: DebugProtocol.ConfigurationDoneArguments): void {
    super.configurationDoneRequest(response, args)

    // notify the launchRequest that configuration has finished
    this.configurationDone.notify()

    this.sendEvent(new StoppedEvent('entry', 1))  // ***
  }

  protected async launchRequest(response: DebugProtocol.LaunchResponse, args: DebugProtocol.LaunchRequestArguments, request?: DebugProtocol.Request) {

    // TODO: is this really needed?
    await this.configurationDone.wait(1000)

    // TODO: could check for failed compile first and return error

    // *** send resetCpu? attach?

    // verify breakpoints

    this.sendResponse(response)
  }

  protected breakpointLocationsRequest(response: DebugProtocol.BreakpointLocationsResponse, args: DebugProtocol.BreakpointLocationsArguments, request?: DebugProtocol.Request): void {
    // TODO: enable/implement
    this.sendResponse(response) // TODO: fill in details
  }

  protected setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments, request?: DebugProtocol.Request): void {
    // TODO: enable/implement
    this.sendResponse(response)
  }

  protected pauseRequest(response: DebugProtocol.PauseResponse, args: DebugProtocol.PauseArguments, request?: DebugProtocol.Request): void {
    this.sendCommand("stopCpu")
    this.sendResponse(response)
  }

  protected continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments): void {
    this.sendCommand("startCpu")
    // TODO: should response.body be filled in?
    this.sendResponse(response)
  }

  protected nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): void {
    this.sendCommand("stepCpuOver")
    this.sendResponse(response)
  }

  protected stepInRequest(response: DebugProtocol.StepInResponse, args: DebugProtocol.StepInArguments): void {
    this.sendCommand("stepCpuInto")
    this.sendResponse(response)
  }

  protected stepOutRequest(response: DebugProtocol.StepOutResponse, args: DebugProtocol.StepOutArguments): void {
    this.sendCommand("stepCpuOutOf")
    this.sendResponse(response)
  }

  private sendCommand(type: string) {
    client.sendRequest(vsclnt.ExecuteCommandRequest.type, {
      command: "rpw65.debugger",
      arguments: [ type ]
    })
  }

  protected gotoTargetsRequest(response: DebugProtocol.GotoTargetsResponse, args: DebugProtocol.GotoTargetsArguments, request?: DebugProtocol.Request): void {
    // TODO: enable/implement
    this.sendResponse(response) // TODO: fill in details
  }

  protected gotoRequest(response: DebugProtocol.GotoResponse, args: DebugProtocol.GotoArguments, request?: DebugProtocol.Request): void {
    // TODO: enable/implement
    this.sendResponse(response)
  }

  protected threadsRequest(response: DebugProtocol.ThreadsResponse, request?: DebugProtocol.Request): void {
    response.body = {
      threads: [
        new Thread(1, "Thread")
      ]
    }
    this.sendResponse(response)
  }

  protected async stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments, request?: DebugProtocol.Request) {

    const result: RpwStackResponse = await client.sendRequest(vsclnt.ExecuteCommandRequest.type, {
      command: "rpw65.debugger",
      arguments: [
        "getStack",
        { startFrame: args.startFrame, levels: args.levels }
      ]
    })

    const stackFrames: StackFrame[] = []
    for (let i = 0; i < result.frames.length; i += 1) {
      const frame = result.frames[i]
      const source = new Source(
        path.posix.basename(frame.path),
        this.convertDebuggerPathToClient(frame.path),
        frame.index)
      const frameId = 0x80 + i      // ***
      const line = frame.line + 1
      const column = 0
      stackFrames.push(new StackFrame(frameId, frame.name, source, line, column))
    }
    response.body = { stackFrames, totalFrames: result.totalFrames }
    this.sendResponse(response)
  }

  protected scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments, request?: DebugProtocol.Request): void {

    // TODO: look at args.frameId

    response.body = {
      scopes: [
        new Scope("Locals", 1, false),
        new Scope("Globals", 2, false),
          // *** vars are A,X,Y,SP and CCs
      ]
    }
    this.sendResponse(response)
  }
}
