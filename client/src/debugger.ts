
import { DebugProtocol } from "@vscode/debugprotocol"
import { DebugSession, InitializedEvent, StoppedEvent, TerminatedEvent } from "@vscode/debugadapter"
import { BreakpointEvent, ContinuedEvent } from "@vscode/debugadapter"
import { Thread } from "@vscode/debugadapter"
import { client } from "./extension"
import * as vsclnt from 'vscode-languageclient'
import * as vscode from 'vscode'

// TODO: think about how logging could be used by A2 debugger

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
      let settled = false

      const waiter: Waiter = {
        resolve: () => {
          if (!settled) {
            settled = true
            if (waiter.timer != undefined) {
              clearTimeout(waiter.timer)
            }
            resolve("notified")
          }
        }
      }
      this.waiters.push(waiter)

      if (timeoutMs != undefined) {
        waiter.timer = setTimeout(() => {
          if (!settled) {
            settled = true
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

// forward commands to language server

export class RpwDebugSession extends DebugSession {

  private configDone? = new AwaitEvent()

  constructor() {
    super()

    // TODO: confirm that these are wanted
    this.setDebuggerLinesStartAt1(false)
    this.setDebuggerColumnsStartAt1(false)

    client.onNotification("rpw65.debuggerStarted", () => {
      this.sendEvent(new ContinuedEvent(1))
    })

    client.onNotification("rpw65.debuggerStopped", (params) => {

      const reason = params?.reason ?? "step"
      // *** filter known vs unknow reason types ***

      // *** more information for stopped reason (human-readable)

      // *** choose event based on reason ***
      // "entry"
      // "step"
      // "breakpoint"
      // "exception"

      // BreakpointEvent
      //  "changed"

      // *** reset variable ref counter here? ***

      // NOTE: Without this delay, the VSCode debugger gets in a state
      //  where it knows the target has stopped but the UI doesn't reflect that.
      //  Only clicking on the Pause button would get it out of that state.
      setTimeout(() => {
        const stoppedEvent = new StoppedEvent('step', 1)
        this.sendEvent(stoppedEvent)
      }, 100)
    })

    client.onNotification("rpw65.debuggerClosed", () => {
      this.sendEvent(new TerminatedEvent())
    })

    client.onNotification("rpw65.debuggerError", (params) => {
      let error = "Debugger error"
      if (params?.error) {
        error = "Debugger: " + params.error
      }
      vscode.window.showErrorMessage(error)
      this.sendEvent(new TerminatedEvent())
    })
  }

  protected initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): void {

    response.body = response.body || {}
    response.body.supportsConfigurationDoneRequest = true
    response.body.supportsGotoTargetsRequest = true
    response.body.supportsSetVariable = true
    response.body.supportsBreakpointLocationsRequest = true

    // TODO: enable/support this if stack trace loading is slow
    // response.body.supportsDelayedStackTraceLoading = true

    response.body.supportsReadMemoryRequest = true
    response.body.supportsWriteMemoryRequest = true
    response.body.supportsEvaluateForHovers = true

    // enables option to view values in hex
    response.body.supportsValueFormattingOptions = true

    this.sendResponse(response)
    this.sendEvent(new InitializedEvent())
  }

  // NOTE: VSCode sends this after all breakpoints and
  //  other setup have been completed after launch.
  protected configurationDoneRequest(response, args): void {
    super.configurationDoneRequest(response, args)

    // notify the launchRequest that configuration has finished
    this.configDone.notifyAll()
    this.configDone = undefined
  }

  protected async launchRequest(response, args) {

    const result = await client.sendRequest(vsclnt.ExecuteCommandRequest.type, {
      command: "rpw65.debugger",
      arguments: [ "launch", args ]
    })

    // NOTE: This wait for all initial configuration
    //  (breakpoints, etc.) to be completed
    if (this.configDone) {
      try {
        await this.configDone.wait(3 * 1000)
      } catch {
        console.log("configDone wait failed")
      }
    }

    // TODO: could check for failed compile first and return error

    this.sendResponse(response)
  }

  protected async attachRequest(response, args) {

    const result = await client.sendRequest(vsclnt.ExecuteCommandRequest.type, {
      command: "rpw65.debugger",
      arguments: [ "attach", args ]
    })

    // NOTE: This wait for all initial configuration
    //  (breakpoints, etc.) to be completed
    if (this.configDone) {
      try {
        await this.configDone.wait(3 * 1000)
      } catch {
        console.log("configDone wait failed")
      }
    }

    this.sendResponse(response)
  }

  protected disconnectRequest(response, args) {
    this.forwardCommand(response, args)
  }

  protected breakpointLocationsRequest(response, args) {
    this.forwardCommand(response, args)
  }

  protected async setBreakPointsRequest(response, args) {
    this.forwardCommand(response, args)
  }

  protected dataBreakpointInfoRequest(response, args) {
    this.forwardCommand(response, args)
  }

  protected setDataBreakpointsRequest(response, args) {
    this.forwardCommand(response, args)
  }

  protected sourceRequest(response, args) {
    this.forwardCommand(response, args)
  }

  protected threadsRequest(response, args) {
    response.body = {
      threads: [ new Thread(1, "Thread") ]
    }
    this.sendResponse(response)
  }

  protected stackTraceRequest(response, args) {
    this.forwardCommand(response, args)
  }

  protected scopesRequest(response, args) {
    this.forwardCommand(response, args)
  }

  protected variablesRequest(response, args) {
    this.forwardCommand(response, args)
  }

  protected setVariableRequest(response, args) {
    this.forwardCommand(response, args)
  }

  protected setExpressionRequest(response, args) {
    this.forwardCommand(response, args)
  }

  protected evaluateRequest(response, args) {
    this.forwardCommand(response, args)
  }

  protected readMemoryRequest(response, args) {
    this.forwardCommand(response, args)
  }

  protected writeMemoryRequest(response, args) {
    this.forwardCommand(response, args)
  }

  protected gotoTargetsRequest(response, args) {
    this.forwardCommand(response, args)
  }

  protected gotoRequest(response, args) {
    this.forwardCommand(response, args)
  }

  protected pauseRequest(response, args) {
    this.forwardCommand(response, args)
  }

  protected continueRequest(response, args) {
    this.forwardCommand(response, args)
  }

  protected nextRequest(response, args) {
    this.forwardCommand(response, args)
  }

  protected stepInRequest(response, args) {
    this.forwardCommand(response, args)
  }

  protected stepOutRequest(response, args) {
    this.forwardCommand(response, args)
  }

  private async forwardCommand(response: DebugProtocol.Response, args: any) {
    const result = await client.sendRequest(vsclnt.ExecuteCommandRequest.type, {
      command: "rpw65.debugger",
      arguments: [ response.command, args ]
    })
    response.body = result
    this.sendResponse(response)

    //*** if responding to writeMemory
		// this.sendEvent(new InvalidatedEvent(['variables']))
  }
}

//------------------------------------------------------------------------------
