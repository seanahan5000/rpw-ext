import * as vscode from 'vscode';

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
		if (c == ";") {
			// TODO: only do this for merlin
			if (prevChar == " " || prevChar == "\t" || prevChar == "") {
				break
			}
		} else if (c == "*" && prevChar == "") {
			break
		}
		prevChar = c;
		commentStart += 1;
	}
	return commentStart;
}

function findNextTextStart(lineText: string, textStart = 0): number {
	while (textStart < lineText.length) {
		const c = lineText[textStart]
		if (c != " " && c != "\t") {
			break
		}
		textStart += 1
	}
	return textStart
}

function findPrevTextStart(lineText: string, textStart: number): number {
	while (textStart > 0) {
		const c = lineText[textStart - 1]
		if (c == " " || c == "\t") {
			break
		}
		textStart -= 1
	}
	return textStart
}

// get tab column *before* current position or 0 if at start
function getPrevTabColumn(tabStops: number[], ch: number): number {
	let stop = 0;
	if (ch > 0) {
		for (let i = 0; i < tabStops.length; i += 1) {
			if (tabStops[i] >= ch) {
				break;
			}
			stop = tabStops[i];
		}
	}
	return stop;
}

// get tab column after current position
function getNextTabColumn(tabStops: number[], ch: number): number {
	let stop = -1;
	for (let i = 0; i < tabStops.length; i += 1) {
		if (tabStops[i] > ch) {
			stop = tabStops[i];
			break;
		}
	}
	if (stop == -1) {
		stop = ch + (4 - (ch % 4));
	}
	return stop;
}

function getTabStops(): number[] {
	const config = vscode.workspace.getConfiguration("rpw65")
	const c1 = config.get<number>("columns.c1", 16)
	const c2 = config.get<number>("columns.c2", 4)
	const c3 = config.get<number>("columns.c3", 20)
	return [0, c1, c1 + c2, c1 + c2 + c3]
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
	const tabStops = getTabStops()
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
					const textStart = findNextTextStart(lineText)
					let startChar
					if (shift) {
						// shift-tab ignores tabstops so misalignment is possible
						let delta = textStart % 4
						if (delta == 0 && textStart > 0) {
							delta = 4
						}
						startChar = textStart - delta
					} else {
						startChar = getPrevTabColumn(tabStops, textStart)
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

						// consume whitespace to align next text to next tab column
						let textStart = findNextTextStart(lineText, selection.end.character)

						// compute where the tabstop is based on the beginning of the word
						//	(used to detect skipped tabstops)
						const prevStart = findPrevTextStart(lineText, ch)
						const prevNextCol = getNextTabColumn(tabStops, prevStart)

						end = getNextTabColumn(tabStops, ch)
						// if text has covered a tab stop, move to the end of the word + 1
						//	instead of skipping the tab stop
						if (prevNextCol < end) {
							textStart = selection.end.character
							if (lineText[textStart] == " ") {
								textStart += 1
							}
							end = ch + 1
						}
						selection = new vscode.Selection(startLine, ch, startLine, textStart)
					} else {
						end = ch + (4 - (ch % 4))
					}
					let indent = "".padEnd(end - ch, " ")
					// if tabbing to comment column and not already in line comment, also add ";"
					if (end == tabStops[tabStops.length - 1]) {
						if (ch + 1 == lineText.length && ch <= commentStart) {
							indent += ";"
							end += 1
						}
					}
					edit.replace(selection, indent)
					selection = new vscode.Selection(startLine, end, startLine, end)
				} else {
					for (let line = startLine; line < endLine; line += 1) {
						const lineText = getLineText(editor, line);
						const textStart = findNextTextStart(lineText);
						const end = getNextTabColumn(tabStops, textStart);
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
	const tabStops = getTabStops()
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
							const stop = getPrevTabColumn(tabStops, ch)
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
	const tabStops = getTabStops()
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
				const stop = getPrevTabColumn(tabStops, ch)
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
				const stop = getNextTabColumn(tabStops, ch)
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
