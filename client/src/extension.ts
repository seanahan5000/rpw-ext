
import * as vscode from 'vscode'
import * as path from 'path'
import * as vsclnt from 'vscode-languageclient'
import * as cmd from "./commands"
import { RpwDebugSession } from "./debugger"
import { CodeDecorator, LineRange } from "./codebytes"

// TODO:
//	? step instructions could be used to step into/through macros
//	- tabs -> spaces in this file

import {
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
	TransportKind
} from 'vscode-languageclient/node'

export let client: LanguageClient
let statusBarItem: vscode.StatusBarItem
export let decorator: CodeDecorator

//------------------------------------------------------------------------------
// also in server/src/lsp_server.ts
// TODO: figure out how to share this with client extension

export type ObjectBytesRange = {
  startLine: number
  startAddress: number
  offsetsString?: string
  dataString?: string
  refDataString?: string
  cyclesString?: string
}

export type ObjectBytesChangedParams = {
  uri: string
  version: number
  ranges?: ObjectBytesRange[]
  cyclesNames?: string[]
}

type ParsingChangedParams = {
	uri: string
	version: number
	syntax: string
	tabStops: number[]
	opcodeUpperCase: boolean
	keywordUpperCase: boolean
}

// NOTE: intentionally different than version in lsp_server.ts
type OpenDocState = {
  parsingState?: ParsingChangedParams
  objectState?: ObjectBytesChangedParams
}

export let openDocs = new Map<string, OpenDocState>()

//------------------------------------------------------------------------------

export function activate(context: vscode.ExtensionContext) {

	// The server is implemented in node
	const serverModule = context.asAbsolutePath(
		path.join('server', 'out', 'server.js')
	)

	const debugOptions = { execArgv: ['--nolazy', '--inspect=6009'] }

	// If the extension is launched in debug mode then the debug server options are used
	// Otherwise the run options are used
	const serverOptions: ServerOptions = {
		run: { module: serverModule, transport: TransportKind.ipc },
		debug: {
			module: serverModule,
			transport: TransportKind.ipc,
			options: debugOptions
		}
	}

	// Options to control the language client
	const clientOptions: LanguageClientOptions = {
		documentSelector: [{ scheme: 'file', language: 'rpw65' }],
		synchronize: {
			// Notify the server about file changes to '.clientrc files contained in the workspace
			fileEvents: vscode.workspace.createFileSystemWatcher('**/.clientrc')
		}
	}

	client = new LanguageClient('rpw65', 'RPW 6502', serverOptions, clientOptions)
	client.start()		// also starts server

	context.subscriptions.push(vscode.commands.registerCommand("rpw65.renumberLocals", renumberCmd))
	context.subscriptions.push(vscode.commands.registerCommand("rpw65.tabIndent", () => { cmd.tabIndentCmd(false) }))
	context.subscriptions.push(vscode.commands.registerCommand("rpw65.tabOutdent", () => { cmd.tabIndentCmd(true) }))
	context.subscriptions.push(vscode.commands.registerCommand("rpw65.delIndent", cmd.delIndentCmd))
	context.subscriptions.push(vscode.commands.registerCommand("rpw65.leftArrowIndent", () => { cmd.arrowIndentCmd(true) }))
	context.subscriptions.push(vscode.commands.registerCommand("rpw65.rightArrowIndent", () => { cmd.arrowIndentCmd(false) }))

	const config = vscode.workspace.getConfiguration("rpw65")
	decorator = new CodeDecorator(config.get("showCodeBytes"), config.get("showCycleCounts"))

	statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
	context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(() => updateStatusItem()))

	client.onNotification("rpw65.parsingChanged", (params: ParsingChangedParams) => {
		const document = vscode.workspace.textDocuments.find((doc) => {
			return doc.uri.toString() == params.uri
		})
		if (document == undefined) {
			return
		}
		if (params.version != document.version) {
			return
		}
    let state = openDocs.get(params.uri)
    if (!state) {
      state = {}
    }
    state.parsingState = params
		openDocs.set(params.uri, state)
		if (document == vscode.window.activeTextEditor.document) {
      updateStatusItem()
		}
	})

	client.onNotification("rpw65.objectBytesChanged", (params: ObjectBytesChangedParams) => {
		const document = vscode.workspace.textDocuments.find((doc) => {
			return doc.uri.toString() == params.uri
		})
		if (document == undefined) {
			return
		}
		if (params.version != document.version) {
			return
		}
    let state = openDocs.get(params.uri)
    if (!state) {
      state = {}
    }
    state.objectState = params
		openDocs.set(params.uri, state)
    decorator.scheduleUpdate()
	})

  vscode.window.onDidChangeVisibleTextEditors(event => {

		// do this as quickly as possible to minimize text jumping left to right
		decorator.updateVisibleEditors()
    decorator.scheduleUpdate()

    // tell server about change in visibility so it can prioritize updates
    const cmd: any = {
      command: "rpw65.visibleEditorsChanged",
      arguments: []
    }
    for (const editor of vscode.window.visibleTextEditors) {
      cmd.argument.push(editor.document.uri.toString())
    }
    client.sendRequest(vsclnt.ExecuteCommandRequest.type, cmd)
  })

  vscode.window.onDidChangeTextEditorVisibleRanges(event => {
    decorator.changeActiveRange(event.textEditor, event.visibleRanges)
  })

  vscode.workspace.onDidOpenTextDocument(event => {
		// do this as quickly as possible to minimize text jumping left to right
		decorator.updateVisibleEditors()
  })

  vscode.workspace.onDidChangeTextDocument(event => {
    // NOTE: server will know about this and reassemble/resend object bytes
    decorator.onTextChanged(event.document, event.contentChanges)
  })

	vscode.workspace.onDidCloseTextDocument(document => {
    const uri = document.uri.toString()
    openDocs.delete(uri)
	})

  vscode.workspace.onDidChangeConfiguration(event => {
    if (event.affectsConfiguration("rpw65.showCodeBytes")) {
      const config = vscode.workspace.getConfiguration("rpw65")
      decorator.enableCodeBytes(config.get("showCodeBytes"))
    }
    if (event.affectsConfiguration("rpw65.showCycleCounts")) {
      const config = vscode.workspace.getConfiguration("rpw65")
      decorator.enableCycleCounts(config.get("showCycleCounts"))
    }
  })

  // debugger support

	const provider = new RpwDebugConfigurationProvider();
	context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('rpw65', provider));

	const factory = new RpwDebugAdapterFactory();
	context.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory('rpw65', factory));
}

export function deactivate(): Thenable<void> | undefined {
	decorator?.enableCodeBytes(false)
	decorator?.enableCycleCounts(false)
	return client?.stop()
}

class RpwDebugConfigurationProvider implements vscode.DebugConfigurationProvider {
	async resolveDebugConfiguration(
		folder: vscode.WorkspaceFolder | undefined,
		config: vscode.DebugConfiguration,
		token?: vscode.CancellationToken): Promise<vscode.DebugConfiguration | undefined>
	{
		// if launch.json is missing or empty
		if (!config.type && !config.request && !config.name) {
			const editor = vscode.window.activeTextEditor
			if (editor && editor.document.languageId === 'rpw65') {
				config.type = 'rpw65'
				config.name = 'Launch RPW Debugger'
				config.request = 'launch'
				config.platform = 'apple2e'
				config.stopOnEntry = true
				config.remote = false
				config.internalConsoleOptions = "neverOpen"
			}
		}
		if (config.request == "launch" && !config.remote) {
			const ext = vscode.extensions.getExtension("seanahan5000.rpwa2")
			if (ext) {
				await ext.activate()
				const platform = config.platform ?? "apple2e"
				const stopOnEntry = config.stopOnEntry ?? true
				await vscode.commands.executeCommand("rpwa2.LaunchEmulator", platform, stopOnEntry)
			} else {
				throw new Error("RPWA2 extension not installed")
			}
		}
    return config
	}
}

class RpwDebugAdapterFactory implements vscode.DebugAdapterDescriptorFactory {
	createDebugAdapterDescriptor(_session: vscode.DebugSession): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
		return new vscode.DebugAdapterInlineImplementation(new RpwDebugSession())
	}
}

export async function renumberCmd() {
	const editor = vscode.window.activeTextEditor
	const content = await client.sendRequest(vsclnt.ExecuteCommandRequest.type, {
		command: "rpw65.renumberLocals",
		arguments: [
			editor.document.uri.toString(),
			editor.selection
		]
	})
	if (content && content.textDocument.version == editor.document.version && content.edits.length > 0) {
		editor.edit(edit => {
			content.edits.forEach(myEdit => {
				const range = new vscode.Range(myEdit.range.start, myEdit.range.end)
				edit.replace(range, myEdit.newText)
			})
		})
	}
}

function updateStatusItem() {
  const editor = vscode.window.activeTextEditor

  // this happens while in the middle of switching active text editor
  if (!editor?.document) {
    return
  }

  const docState = openDocs.get(editor.document.uri.toString())
  if (docState?.parsingState?.syntax) {
    statusBarItem.text = docState.parsingState.syntax
    statusBarItem.show()
  } else {
    statusBarItem.hide()
  }
}

//------------------------------------------------------------------------------
