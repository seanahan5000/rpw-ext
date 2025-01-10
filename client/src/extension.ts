
import * as vscode from 'vscode'
import * as path from 'path'
import * as vsclnt from 'vscode-languageclient'
import * as cmd from "./commands"
// import { RpwDebugSession } from "./rpwDebug"
import { activateMockDebug } from './activateMockDebug';

import {
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
	TransportKind
} from 'vscode-languageclient/node'

let client: LanguageClient
let statusBarItem: vscode.StatusBarItem

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

	statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
	context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(() => updateStatusItem()))

	client.onNotification("rpw.syntaxChanged", () => { updateStatusItem() })

	// const provider = new RpwConfigurationProvider()
	// context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('rpw65', provider))

	// const factory = new InlineDebugAdapterFactory();
	// context.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory('rpw65', factory));
	// if ('dispose' in factory) {
	// 	context.subscriptions.push(factory)
	// }

	// context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('rpw65', {
	// 	provideDebugConfigurations(folder: vscode.WorkspaceFolder | undefined): vscode.ProviderResult<vscode.DebugConfiguration[]> {
	// 		return [
	// 			{
	// 				name: "Dynamic Launch",
	// 				request: "launch",
	// 				type: "rpw65",
	// 				program: "${file}"
	// 			},
	// 			{
	// 				name: "Another Dynamic Launch",
	// 				request: "launch",
	// 				type: "rpw65",
	// 				program: "${file}"
	// 			},
	// 			{
	// 				name: "Mock Launch",
	// 				request: "launch",
	// 				type: "rpw65",
	// 				program: "${file}"
	// 			}
	// 		];
	// 	}
	// }, vscode.DebugConfigurationProviderTriggerKind.Dynamic));

	activateMockDebug(context)
}

export function deactivate(): Thenable<void> | undefined {
	return client?.stop()
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
	if (content && content.edits.length > 0) {
		editor.edit(edit => {
			content.edits.forEach(myEdit => {
				const range = new vscode.Range(myEdit.range.start, myEdit.range.end)
				edit.replace(range, myEdit.newText)
			})
		})
	}
}

async function updateStatusItem() {
	const editor = vscode.window.activeTextEditor

	// this happens while in the middle of switching active text editor
	if (!editor?.document) {
		return
	}

	const content = await client.sendRequest(vsclnt.ExecuteCommandRequest.type, {
		command: "rpw65.getSyntax",
		arguments: [
			editor.document.uri.toString()
		]
	})

	if (content?.syntax && content.syntax != "") {
		statusBarItem.text = content.syntax
		statusBarItem.show()
	} else {
		statusBarItem.hide()
	}
}


// class RpwConfigurationProvider implements vscode.DebugConfigurationProvider {

// 	/**
// 	 * Massage a debug configuration just before a debug session is being launched,
// 	 * e.g. add all missing attributes to the debug configuration.
// 	 */
// 	resolveDebugConfiguration(folder: vscode.WorkspaceFolder | undefined, config: vscode.DebugConfiguration, token?: vscode.CancellationToken): vscode.ProviderResult<vscode.DebugConfiguration> {

// 		// if launch.json is missing or empty
// 		if (!config.type && !config.request && !config.name) {
// 			const editor = vscode.window.activeTextEditor;
// 			if (editor && editor.document.languageId === 'rpw65') {
// 				config.type = 'rpw65';
// 				config.name = 'Launch';
// 				config.request = 'launch';
// 				config.program = '${file}';
// 				config.stopOnEntry = true;
// 			}
// 		}

// 		if (!config.program) {
// 			return vscode.window.showInformationMessage("Cannot find a program to debug").then(_ => {
// 				return undefined;	// abort launch
// 			});
// 		}

// 		return config;
// 	}
// }

// class InlineDebugAdapterFactory implements vscode.DebugAdapterDescriptorFactory {

// 	createDebugAdapterDescriptor(_session: vscode.DebugSession): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
// 		return new vscode.DebugAdapterInlineImplementation(new RpwDebugSession());
// 	}
// }
