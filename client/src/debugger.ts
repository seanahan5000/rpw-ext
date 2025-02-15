
import { DebugProtocol } from "@vscode/debugprotocol"
import { DebugSession, InitializedEvent, StoppedEvent, BreakpointEvent, ContinuedEvent } from "@vscode/debugadapter"
import { Thread, StackFrame, Scope, Source } from "@vscode/debugadapter"
import { client } from "./extension"
import * as vsclnt from 'vscode-languageclient'

// TODO: is this really needed?
import { Subject } from 'await-notify'

// TODO: think about how logging could be used by A2 debugger

//------------------------------------------------------------------------------

// forward commands to language server

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
  }

  protected initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): void {

    response.body = response.body || {}
    response.body.supportsConfigurationDoneRequest = true
    response.body.supportsGotoTargetsRequest = true
    response.body.supportsSetVariable = true
    // response.body.supportsDelayedStackTraceLoading = true
    // response.body.supportsBreakpointLocationsRequest = true

    // TODO: enable/support this if stack trace loading is slow
    // response.body.supportsDelayedStackTraceLoading = true

    this.sendResponse(response)
    this.sendEvent(new InitializedEvent())
  }

  protected configurationDoneRequest(response: DebugProtocol.ConfigurationDoneResponse, args: DebugProtocol.ConfigurationDoneArguments): void {
    super.configurationDoneRequest(response, args)

    // notify the launchRequest that configuration has finished
    this.configurationDone.notify()

    this.sendEvent(new StoppedEvent('entry', 1))  // ***
  }

  protected async launchRequest(
    response: DebugProtocol.LaunchResponse,
    args: DebugProtocol.LaunchRequestArguments,
    request?: DebugProtocol.Request) {

    // TODO: is this really needed?
    await this.configurationDone.wait(1000)

    // TODO: could check for failed compile first and return error

    // *** send resetCpu? attach?

    this.sendResponse(response)
  }

  // protected breakpointLocationsRequest(
  //   response: DebugProtocol.BreakpointLocationsResponse,
  //   args: DebugProtocol.BreakpointLocationsArguments,
  //   request?: DebugProtocol.Request): void
  // {
  //   // TODO: enable/implement
  //   this.sendResponse(response) // TODO: fill in details
  // }

  protected async setBreakPointsRequest(
    response: DebugProtocol.SetBreakpointsResponse,
    args: DebugProtocol.SetBreakpointsArguments,
    request?: DebugProtocol.Request): Promise<void>
  {
    this.forwardCommand(response, args)
  }

  protected threadsRequest(
    response: DebugProtocol.ThreadsResponse,
    request?: DebugProtocol.Request): void
  {
    response.body = {
      threads: [ new Thread(1, "Thread") ]
    }
    this.sendResponse(response)
  }

  protected stackTraceRequest(
    response: DebugProtocol.StackTraceResponse,
    args: DebugProtocol.StackTraceArguments,
    request?: DebugProtocol.Request): void
  {
    this.forwardCommand(response, args)
  }

  protected scopesRequest(
    response: DebugProtocol.ScopesResponse,
    args: DebugProtocol.ScopesArguments,
    request?: DebugProtocol.Request): void
  {
    this.forwardCommand(response, args)
  }

  protected variablesRequest(
    response: DebugProtocol.VariablesResponse,
    args: DebugProtocol.VariablesArguments,
    request?: DebugProtocol.Request): void
  {
    this.forwardCommand(response, args)
  }

  protected setVariableRequest(
    response: DebugProtocol.SetVariableResponse,
    args: DebugProtocol.SetVariableArguments): void
  {
    this.forwardCommand(response, args)
  }

    this.sendResponse(response)
  }

  // *** set new PC?
  protected gotoTargetsRequest(response: DebugProtocol.GotoTargetsResponse, args: DebugProtocol.GotoTargetsArguments, request?: DebugProtocol.Request): void {
    // TODO: enable/implement
    this.sendResponse(response) // TODO: fill in details
  }

  // *** what does this do? ***
  protected gotoRequest(response: DebugProtocol.GotoResponse, args: DebugProtocol.GotoArguments, request?: DebugProtocol.Request): void {
    // TODO: enable/implement
    this.sendResponse(response)
  }

  protected pauseRequest(
    response: DebugProtocol.PauseResponse,
    args: DebugProtocol.PauseArguments,
    request?: DebugProtocol.Request): void
  {
    this.forwardCommand(response, args)
  }

  protected continueRequest(
    response: DebugProtocol.ContinueResponse,
    args: DebugProtocol.ContinueArguments): void
  {
    this.forwardCommand(response, args)
  }

  protected nextRequest(
    response: DebugProtocol.NextResponse,
    args: DebugProtocol.NextArguments): void
  {
    this.forwardCommand(response, args)
  }

  protected stepInRequest(
    response: DebugProtocol.StepInResponse,
    args: DebugProtocol.StepInArguments): void
  {
    this.forwardCommand(response, args)
  }

  protected stepOutRequest(
    response: DebugProtocol.StepOutResponse,
    args: DebugProtocol.StepOutArguments): void
  {
    this.forwardCommand(response, args)
  }

  private async forwardCommand(response: DebugProtocol.Response, args: any) {
    const result = await client.sendRequest(vsclnt.ExecuteCommandRequest.type, {
      command: "rpw65.debugger",
      arguments: [ response.command, args ]
    })
    response.body = result
    this.sendResponse(response)
  }
}

//------------------------------------------------------------------------------
