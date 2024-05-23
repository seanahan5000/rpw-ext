
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

//------------------------------------------------------------------------------

// *** TODO: figure out how to share this with server ***

type CodeBytesEntry = {
	a?: number			// address
	d?: number[]		// data bytes
//c?: number			// cycle count *** string instead? "2/3", "4+"
}

type CodeBytes = {
	// TODO: other information?
	entries: CodeBytesEntry[]
}

//------------------------------------------------------------------------------

type DecorationTypes = vscode.TextEditorDecorationType | vscode.TextEditorDecorationType[]

// *** consider showing cycle counts ***

// *** save indent string info to know update is really needed
	// *** may need to force when lines combine via delete

class CodeLine {
	public address?: number
	public bytes?: (number | undefined)[]
	public decorations: DecorationTypes
	// TODO: replacement code overlay

	constructor (address?: number, bytes?: number[]) {
		this.address = address
		this.bytes = bytes
		// *** create decorations here?
		this.decorations = this.buildDecoration()
	}

	// *** don't rebuild indents on lines that are already indented ***

	public rebuildDecorations(address?: number, bytes?: number[]) {
		this.address = address
		this.bytes = bytes
		this.decorations = this.buildDecoration()
	}

	public isIndent(): boolean {
		return this.address === undefined && this.bytes === undefined
	}

	private buildDecoration(): DecorationTypes {
		const decorations: DecorationTypes = []

		// TODO: this case could eventually fold into general case
		if (this.address === undefined && this.bytes === undefined) {

			// TODO: figure out how to work around vscode bug
			//	and avoid this hack using two decorations

			const contentStr = "".padEnd(5 + 3 + 3 + 3 + 2, "\xA0")
			decorations.push(vscode.window.createTextEditorDecorationType({
				before: {
					contentText: contentStr,
					// width: "114px"		// TODO: get rid of
				}
			}))
			// decorationType.push(vscode.window.createTextEditorDecorationType({
			// 	before: {
			// 		contentText: " ",
			// 	}
			// }))

		} else {

			// address is "0000:" or "????:"
			const addressStr = this.address === undefined ? "????:"
				: this.address.toString(16).toUpperCase().padStart(4, "0") + ":"

			// just an address/offset, no bytes
			if (this.bytes === undefined) {
				const contentStr = addressStr.padEnd(5 + 3 + 3 + 3 + 2, "\xA0")
				decorations.push(vscode.window.createTextEditorDecorationType({
					before: {
						contentText: contentStr
					}
				}))
			} else {
				let curStr = addressStr
				let curChanged = false
				for (let i = 0; i < 4; i += 1) {
					let byteStr: string
					let hasChanged = false
					if (i == 3) {
						hasChanged = !curChanged	// force final flush
						curStr += "\xA0\xA0"
						byteStr = ""
					} else if (i >= this.bytes.length) {
						byteStr = "\xA0\xA0\xA0"
					} else if (this.bytes[i] === undefined) {
						byteStr = "\xA0??"
					} else {
						let byteValue = this.bytes[i]
						if (byteValue < 0) {
							hasChanged = true
							byteValue = -byteValue
						}
						byteStr = "\xA0" + byteValue.toString(16).toUpperCase().padStart(2, "0")
					}
					if (curChanged != hasChanged) {
						decorations.push(vscode.window.createTextEditorDecorationType({
							before: {
								contentText: curStr,
								// *** settings to choose these colors? ***
								// *** dark and light settings? ***
								color: curChanged ? "#F00" : "#888"
							}
						}))
						curStr = byteStr
						curChanged = hasChanged
					} else {
						curStr += byteStr
					}
				}
			}
		}

		return decorations.length == 1 ? decorations[0] : decorations
	}
}


class CodeList {

	public editor: vscode.TextEditor
	public document: vscode.TextDocument
	private codeLines: CodeLine[]

	constructor(editor: vscode.TextEditor) {

		this.editor = editor
		this.document = editor.document
		const lines = this.document.getText().split(/\r?\n/)

		this.codeLines = []
		for (let i = 0; i < lines.length; i += 1) {

			let address = 0x1000 + i + 1			// ***
			let dataBytes = [0, 0, 0]					// ***

			const codeLine = new CodeLine(address, dataBytes)
			this.codeLines.push(codeLine)
			this.applyDecorations(i, codeLine.decorations)
		}
	}

	public applyCodeBytes(codeBytes: CodeBytes) {
		// clear all of this.codeLines
			// *** later, smart update
		this.clearDecorations(0, this.codeLines.length)

		if (this.codeLines.length != codeBytes.entries.length) {
			// *** figure out what to do on mismatch
			return
		}

		for (let i = 0; i < codeBytes.entries.length; i += 1) {
			const codeEntry = codeBytes.entries[i]
			this.codeLines[i].rebuildDecorations(codeEntry.a, codeEntry.d)
			this.applyDecorations(i, this.codeLines[i].decorations)
		}
	}

	// *** test with multi-selection ***
	// *** change to applyEdits ***
	public applyChanges(changes: readonly vscode.TextDocumentContentChangeEvent[]) {
		for (let change of changes) {

			// split new lines to be inserted
			const newLines = change.text.split(/\r?\n/)
			let partialInsertEnd = true
			if (newLines[newLines.length - 1] == "") {
				partialInsertEnd = false
				newLines.pop()
			}

			let startLine = change.range.start.line
			let endLine = change.range.end.line
			let partialStart = change.range.start.character != 0
			let partialEnd = change.range.end.character != 0

			if (startLine == endLine) {
				// single partial line of text to insert or delete
				const simpleInsert = newLines.length == 1 && partialInsertEnd
				const simpleDelete = newLines.length == 0
				if (simpleInsert || simpleDelete) {
					// just a single line is being edited
					if (this.codeLines[startLine].isIndent()) {
						// if line already has an indent decoration,
						//	do nothing more, avoiding flicker
						continue
					}
				}
			}

			// clear existing decorations from affected lines
			//	(do this first, before any new decorations)
			let clearCount = endLine + 1 - startLine
			this.clearDecorations(startLine, clearCount)

			// compute full lines to be added/removed

			let fullDeleteCount = endLine - startLine
			if (partialStart) {
				fullDeleteCount -= 1
			}
			if (partialEnd) {
				fullDeleteCount += 1
			}

			let fullInsertCount = newLines.length
			if (partialInsertEnd) {
				fullInsertCount -= 1
			}

			if (fullInsertCount != fullDeleteCount) {
				if (fullInsertCount > fullDeleteCount) {
					const newSlots = new Array(fullInsertCount - fullDeleteCount)
					this.codeLines.splice(startLine, 0, ...newSlots)
				} else {
					this.codeLines.splice(startLine, fullDeleteCount - fullInsertCount)
				}
			}

			// apply indent decorations for all affected lines

			let indentCount = clearCount + fullInsertCount - fullDeleteCount
			for (let i = startLine; i < startLine + indentCount; i += 1) {
				let codeLine = this.codeLines[i]
				if (codeLine) {
					codeLine.rebuildDecorations(undefined, undefined)
				} else {
					codeLine = new CodeLine(undefined, undefined)
					this.codeLines[i] = codeLine
				}
				this.applyDecorations(i, codeLine.decorations)
			}
		}
	}

	private applyDecorations(line: number, decorations: DecorationTypes) {
		const range = new vscode.Range(line, 0, line, 0)
		const decoration = { range: range }
		if (Array.isArray(decorations)) {
			for (let type of decorations) {
				this.editor.setDecorations(type, [ decoration ])
			}
		} else {
			this.editor.setDecorations(decorations, [ decoration ])
		}
	}

	private clearDecorations(startLine: number, count: number) {
		for (let i = startLine; i < startLine + count; i += 1) {
			const decorations = this.codeLines[i].decorations
			if (Array.isArray(decorations)) {
				for (let type of decorations) {
					this.editor.setDecorations(type, [])
				}
			} else {
				this.editor.setDecorations(decorations, [])
			}
		}
	}
}

let codeLists: CodeList[] = []

async function updateDecorations() {
	let newLists: CodeList[] = []
	const editors = vscode.window.visibleTextEditors
	for (let editor of editors) {
		if (editor.document.languageId == "rpw65") {
			let matched = false
			for (let codeList of codeLists) {
				if (codeList.editor != editor) {
					continue
				}
				if (codeList.document != editor.document) {
					continue
				}
				newLists.push(codeList)
				matched = true
				break
			}

			if (!matched) {
				const codeList = new CodeList(editor)
				// *** constructor should just have indented ***
				newLists.push(codeList)

				// request code info from server by file name
				const content = await client.sendRequest(vsclnt.ExecuteCommandRequest.type, {
					command: "rpw65.getCodeBytes",
					arguments: [
						editor.document.uri.toString()
					]
				})
				if (content) {
					codeList.applyCodeBytes(content)
				}
			}
		}
	}
	codeLists = newLists
}

// *** test with same document open in multiple panes ***
function changeDecorations(document: vscode.TextDocument, changes: readonly vscode.TextDocumentContentChangeEvent[]) {
	for (let codeList of codeLists) {
		if (codeList.document == document) {
			codeList.applyChanges(changes)
		}
	}
}

//------------------------------------------------------------------------------

let client: LanguageClient
let statusBarItem: vscode.StatusBarItem

export function activate(context: vscode.ExtensionContext) {

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

	// *** register for notifications about assembly code
		// *** turn message contents into decorations on documents
		// *** support in client for editing files with assembly bytes

	// vscode.window.onDidChangeActiveTextEditor(event => {
	// 	// *** check language first
	// 	// openDocument(vscode.window.activeTextEditor)
	// })

	vscode.workspace.onDidChangeTextDocument(event => {
		// *** match document to active editor
		// updateDocument(vscode.window.activeTextEditor/*, event.document*/, event)
		changeDecorations(event.document, event.contentChanges)
	})

	vscode.window.onDidChangeVisibleTextEditors(event => {
		updateDecorations()
	})

	// *** don't do this until server is known to be up and running ***
	updateDecorations()
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
