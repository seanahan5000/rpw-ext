import * as vscode from 'vscode';

// TODO: get these from settings or pass them in
// NOTE: code assumes first column is always 0
const tabColumns: number[] = [ 0, 16, 20, 40 ];

function getStartLineText(editor): string {
	return getLineText(editor, editor.selection.start.line);
}

function getLineText(editor, line: number): string {
	const range = new vscode.Range(line, 0, line + 1, 0);
	return editor.document.getText(range);
}

function findCommentStart(lineText: string): number {
	let commentStart = 0;
	let prevChar = "";
	while (commentStart < lineText.length) {
		const c = lineText[commentStart];
		if (c == ";" && (prevChar == " " || prevChar == "\t" || prevChar == "")) {
			break
		} else if (c == "*" && prevChar == "") {
			break
		}
		prevChar = c;
		commentStart += 1;
	}
	return commentStart;
}

function findTextStart(lineText: string, textStart = 0): number {
	while (textStart < lineText.length) {
		const c = lineText[textStart]
		if (c != " " && c != "\t") {
			break
		}
		textStart += 1
	}
	return textStart
}

// get tab column *before* current position or 0 if at start
function getPrevTabColumn(ch: number): number {
	let stop = 0;
	if (ch > 0) {
		for (let i = 0; i < tabColumns.length; i += 1) {
			if (tabColumns[i] >= ch) {
				break;
			}
			stop = tabColumns[i];
		}
	}
	return stop;
}

// get tab column after current position
function getNextTabColumn(ch: number): number {
	let stop = -1;
	for (let i = 0; i < tabColumns.length; i += 1) {
		if (tabColumns[i] > ch) {
			stop = tabColumns[i];
			break;
		}
	}
	if (stop == -1) {
		stop = ch + (4 - (ch % 4));
	}
	return stop;
}

// tab:
//	partial line, replace selection with tab
//	full single line, indent line
//	more than one line, indent lines
//	insertion point, tab to next stop
	// unless inside comment, then tab to 4-char stop

// shift-tab: always outdent entire line/s
	// use first non-space to pick stop

export async function tabIndentCmd(shift: boolean) {
	const editor = vscode.window.activeTextEditor
	const oldSelections = editor.selections
	const newSelections: vscode.Selection[] = []

	editor.edit(edit => {
		for (let selection of oldSelections) {
			const startLine = selection.start.line
			let endLine = selection.end.line
			if (shift) {
				if (startLine != endLine && selection.end.character == 0) {
					endLine -= 1;
				}
				for (let line = startLine; line <= endLine; line += 1) {
					const lineText = getLineText(editor, line);
					const textStart = findTextStart(lineText)
					let startChar
					if (shift) {
						// shift-tab ignores tabstops so misalignment is possible
						let delta = textStart % 4
						if (delta == 0 && textStart > 0) {
							delta = 4
						}
						startChar = textStart - delta
					} else {
						startChar = getPrevTabColumn(textStart)
					}
					const range = new vscode.Range(line, startChar, line, textStart);
					edit.delete(range);
				}
			} else {
				// if selection runs from start to end of line, make it full line
				if (startLine == endLine) {
					if (selection.start.character == 0) {
						const lineText = getStartLineText(editor);
						if (selection.end.character + 1 == lineText.length) {
							endLine = startLine + 1;
						}
					}
				} else if (selection.end.character > 0) {
					endLine += 1;
				}
				// if selection is empty or is only part of a single line,
				//	treat as a normal tab
				if (startLine == endLine) {
					const ch = selection.start.character
					const lineText = getLineText(editor, startLine)
					let commentStart = findCommentStart(lineText)
					let end: number
					if (ch <= commentStart) {
						end = getNextTabColumn(ch)
						// consume whitespace to align next text to next tab column
						const textStart = findTextStart(lineText, selection.end.character)
						selection = new vscode.Selection(startLine, ch, startLine, textStart)
					} else {
						end = ch + (4 - (ch % 4))
					}
					let indent = "".padEnd(end - ch, " ")
					// if tabbing to comment column, also add ";"
					if (end == tabColumns[tabColumns.length - 1]) {
						if (ch + 1 == lineText.length) {
							indent += ";"
							end += 1
						}
					}
					edit.replace(selection, indent)
					selection = new vscode.Selection(startLine, end, startLine, end)
				} else {
					for (let line = startLine; line < endLine; line += 1) {
						const lineText = getLineText(editor, line);
						const textStart = findTextStart(lineText);
						const end = getNextTabColumn(textStart);
						const position = new vscode.Position(line, textStart);
						const indent = "".padEnd(end - textStart, " ");
						edit.insert(position, indent)
						selection = new vscode.Selection(startLine, end, startLine, end)
					}
				}
			}

			newSelections.push(new vscode.Selection(selection.anchor, selection.active))
		}
	})
	editor.selections = newSelections
}

// partial line, delete selection
// multiple lines, delete selection
// insertion point, delete to prev tab stop
	// unless inside comment, then just delete character

export async function delIndentCmd() {
	const editor = vscode.window.activeTextEditor
	editor.edit(edit => {
		for (let selection of editor.selections) {
			if (selection.isEmpty) {
				const line = selection.start.line
				const ch = selection.start.character
				if (ch > 0) {
					const lineText = getLineText(editor, line)
					const commentStart = findCommentStart(lineText)
					// default to normal delete of single character
					let startChar = ch - 1
					// if not inside a comment, delete spaces back to tab column
					if (startChar < commentStart) {
						let c = lineText[startChar]
						if (c == " ") {
							const stop = getPrevTabColumn(ch)
							while (startChar > stop && startChar != 0) {
								c = lineText[startChar - 1]
								if (c != " ") {
									break
								}
								startChar -= 1
							}
						}
					}
					const range = new vscode.Range(line, startChar, line, ch)
					edit.delete(range)
				} else if (line > 0) {
					// delete to previous line
					const range = new vscode.Range(line - 1, 1000, line, ch)
					edit.delete(range)
				}
			} else {
				// normal delete of selection
				edit.delete(selection)
			}
		}
	});
}

export async function arrowIndentCmd(left: boolean) {
	const moveBy = { to: left ? "left" : "right", by: "character", value: 1 }
	const editor = vscode.window.activeTextEditor
	const sel = editor.selections[0]
	if (sel.start.line == sel.end.line) {
		const lineText = getStartLineText(editor)
		const commentStart = findCommentStart(lineText);
		const ch = left ? sel.start.character : sel.end.character
		let pos = ch
		if (left) {
			if (ch <= commentStart) {
				const stop = getPrevTabColumn(ch)
				while (pos > stop) {
					if (lineText[pos - 1] != " ") {
						break
					}
					pos -= 1
				}
				moveBy.value = Math.max(ch - pos, 1)
			}
		} else {
			if (ch < commentStart) {
				const stop = getNextTabColumn(ch)
				while (pos < stop) {
					if (lineText[pos] != " ") {
						break
					}
					pos += 1
				}
				moveBy.value = Math.max(pos - ch, 1)
			}
		}
	}
	vscode.commands.executeCommand("cursorMove", moveBy)
}
