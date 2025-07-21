
import * as vscode from 'vscode'
import * as path from 'path'
import * as vsclnt from 'vscode-languageclient'
import * as cmd from "./commands"

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

	let projectInfo: Record<string, any> | undefined = undefined
	let clientRunning = false
	const trySendProjectInfo = () => {
		if (projectInfo && clientRunning) {
			client.sendNotification('rpw65.projectInfo', projectInfo);
		}
	}
	
	const cmakeExt = vscode.extensions.getExtension('ms-vscode.cmake-tools')
	if (cmakeExt) {
		cmakeExt.activate().then(async (cmake) => {
			const api = cmake?.getApi()
			if (api) {
				const activeFolderPath = api.getActiveFolderPath()
				const activeProjectUri = vscode.Uri.file(activeFolderPath)
				const activeProject = await api.getProject(activeProjectUri)
				activeProject?.onCodeModelChanged(() => {
					const configuration = activeProject.codeModel.configurations.find((config) => config.name === activeProject.project.activeVariant.value)
					if (configuration) {
						const project = configuration.projects.find((project) => project.sourceDirectory === activeFolderPath)
						if (project) {
							const target = project.targets.find((target) => target.name === project.name && target.sourceDirectory === project.sourceDirectory)
							if (target) {
								projectInfo = {
									name: project.name,
									rootDir: project.sourceDirectory,
									includePaths: [],
									artifacts: target.artifacts,
									type: target.type,
									sources: [],
									defines: [],
									includes: [],
								}
								for (const fileGroup of target.fileGroups) {
									if (!fileGroup.isGenerated && fileGroup.sources?.length > 0) {
										if (fileGroup.language === 'ASM')
											projectInfo.sources.push(...fileGroup.sources)
										else if (fileGroup.language === undefined)
											projectInfo.includes.push(...fileGroup.sources)
									}
									if (fileGroup.defines?.length > 0) {
										projectInfo.defines.push(...fileGroup.defines)
									}
									if (fileGroup.includePath?.length > 0) {
										projectInfo.includePaths.push(...fileGroup.includePath.map(({path}) => path))
									}
								}
								projectInfo.includePaths = [...new Set(projectInfo.includePaths)] // remove duplicates
								trySendProjectInfo()
							}
						}
					}
				})
			}
		})
	}
	client.onDidChangeState(async (state) => {
		if (state.newState === vsclnt.State.Running) {
			clientRunning = true
			trySendProjectInfo()
		}
  })
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
