
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

	constructor (emptySrcLine = false) {
	}

	// *** don't rebuild indents on lines that are already indented ***

	public rebuildDecorations(address?: number, bytes?: number[], emptySrcLine = false) {
		this.address = address
		this.bytes = bytes
		this.decorations = this.buildDecoration(emptySrcLine)
	}

	public isIndent(): boolean {
		return this.address === undefined && this.bytes === undefined
	}

	private buildDecoration(emptySrcLine: boolean): DecorationTypes {
		const decorations: DecorationTypes = []

		// TODO: this case could eventually fold into general case
		if (this.address === undefined && this.bytes === undefined) {

			// TODO: figure out how to work around vscode bug
			//	and avoid this hack using two decorations

			const contentStr = "".padEnd(5 + 3 + 3 + 3 + 1/*2*/, "\xA0")
			// const contentStr = "xxxx: xx xx xx\xA0\xA0"
			decorations.push(vscode.window.createTextEditorDecorationType({
				before: {
					contentText: contentStr,
					// width: "114px"		// TODO: get rid of
				}
			}))
			// decorations.push(vscode.window.createTextEditorDecorationType({
			// 	before: {
			// 		contentText: " ",
			// 		// width: "114px"		// TODO: get rid of
			// 	}
			// }))

			emptySrcLine = true

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

		if (emptySrcLine) {
			decorations.push(vscode.window.createTextEditorDecorationType({
				before: {
					contentText: "\xA0"
				}
			}))
		}

		return decorations.length == 1 ? decorations[0] : decorations
	}
}


type UpdateRange = {
	start: number
	end: number
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
			const emptySrcLine = lines[i] == ""
			const codeLine = new CodeLine(emptySrcLine)
			this.codeLines.push(codeLine)
		}
	}

	public applyCodeBytes(codeBytes: CodeBytes) {
		if (this.codeLines.length != codeBytes.entries.length) {
			// TODO: figure out what to do on mismatch (remove all for now)
			this.clearDecorations(0, this.codeLines.length)
			return
		}

		for (let i = 0; i < codeBytes.entries.length; i += 1) {
			this.clearDecorations(i, 1)

			const codeEntry = codeBytes.entries[i]
			this.codeLines[i].rebuildDecorations(codeEntry.a, codeEntry.d)
			this.applyDecorations(i, this.codeLines[i].decorations)
		}
	}

	public applyEdits(changes: readonly vscode.TextDocumentContentChangeEvent[]) {

		let updateRanges: UpdateRange[] = []

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

			// *** simple end of line return ***
				// *** not possible? ***

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
			let fullInsertCount = newLines.length
			if (partialInsertEnd) {
				fullInsertCount -= 1
			}

			const deltaCount = fullInsertCount - fullDeleteCount
			if (deltaCount != 0) {
				let deltaStart = startLine
				if (deltaCount > 0) {
					const newSlots = new Array(deltaCount)
					if (partialStart) {
						deltaStart += 1
					}
					this.codeLines.splice(deltaStart, 0, ...newSlots)
				} else {
					this.codeLines.splice(deltaStart, -deltaCount)
				}
				// adjust previous ranges by number of lines added/removed
				for (let range of updateRanges) {
					if (range.start >= deltaStart) {
						range.start += deltaCount
						range.end += deltaCount
					}
				}
			}

			// add indent decorations for all affected lines
			let indentCount = clearCount + fullInsertCount - fullDeleteCount
			for (let i = startLine; i < startLine + indentCount; i += 1) {
				let codeLine = this.codeLines[i]
				if (!codeLine) {
					codeLine = new CodeLine()
					this.codeLines[i] = codeLine
				}
				codeLine.rebuildDecorations(undefined, undefined)
			}

			// save range for later application
			updateRanges.push({ start: startLine, end: startLine + indentCount})
		}

		// now that final ranges are known, apply decorations to current text layout
		//	(in reverse so updates are top to bottom)
		for (let i = updateRanges.length; --i >= 0; ) {
			const range = updateRanges[i]
			for (let i = range.start; i < range.end; i += 1) {
				this.applyDecorations(i, this.codeLines[i].decorations)
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
			if (decorations) {
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
}

let codeLists: CodeList[] = []

async function updateDecorations(forceUpdate = false) {
	let newLists: CodeList[] = []
	const editors = vscode.window.visibleTextEditors
	const activeEditor = vscode.window.activeTextEditor

	// TODO: consider using TextEditor.visibleRanges to
	//	optimize/reduce the amount of decorations changed.

	for (let i = -1; i < editors.length; i += 1) {
		let editor: vscode.TextEditor

		// favor active editor among visible editors
		if (i < 0) {
			editor = activeEditor
			if (!editor) {
				continue
			}
		} else {
			editor = editors[i]
			if (editor == activeEditor) {
				continue
			}
		}

		if (editor.document.languageId == "rpw65") {

			let codeList: CodeList | undefined
			let refresh = forceUpdate

			for (let list of codeLists) {
				if (list.editor != editor) {
					continue
				}
				if (list.document != editor.document) {
					continue
				}
				codeList = list
				newLists.push(codeList)
				break
			}

			if (!codeList) {
				codeList = new CodeList(editor)
				newLists.push(codeList)
				refresh = true
			}

			if (refresh) {

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

function changeDecorations(document: vscode.TextDocument, changes: readonly vscode.TextDocumentContentChangeEvent[]) {
	for (let codeList of codeLists) {
		if (codeList.document == document) {
			codeList.applyEdits(changes)
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
	client.onNotification("rpw.asmCodeChanged", () => { updateDecorations(true) })

	vscode.workspace.onDidChangeTextDocument(event => {
		changeDecorations(event.document, event.contentChanges)
	})

	vscode.window.onDidChangeVisibleTextEditors(event => {
		updateDecorations()
	})

	// vscode.window.onDidChangeActiveTextEditor(event => {
	// 	// *** check language first
	// 	// openDocument(vscode.window.activeTextEditor)
	// })
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
