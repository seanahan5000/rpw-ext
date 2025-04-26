
import * as vscode from 'vscode'
import * as vsclnt from 'vscode-languageclient'
import { client } from "./extension"

//------------------------------------------------------------------------------
// TODO: figure out how to share this with lsp_server

type GetCodeBytesArgs = {
  startLine?: number
  endLine?: number
  cycleCounts?: boolean
}

export type CodeBytesEntry = {
  a?: number      // address
  d?: number[]    // data bytes
  e?: boolean     // empty src line
  c?: string      // cycle count ("3", "2/3", "4+", etc.)
}

// response to GetCodeBytes
type CodeBytes = {
  startLine: number
  cycleCounts?: boolean
  entries: CodeBytesEntry[]
}

//------------------------------------------------------------------------------

type DecorationTypes = vscode.TextEditorDecorationType | vscode.TextEditorDecorationType[]

class CodeLine {
  public address?: number
  public data?: (number | undefined)[]
  public isEmpty?: boolean
  public cycleCount?: string

  public currDecorations?: DecorationTypes
  public nextDecorations?: DecorationTypes

  constructor (emptySrcLine = false) {
    this.isEmpty = emptySrcLine
  }

  public clearDecorations(editor: vscode.TextEditor, linenum: number) {
    this.nextDecorations = []
    this.applyDecorations(editor, linenum)
  }

  public applyDecorations(editor: vscode.TextEditor, linenum: number) {
    if (this.nextDecorations) {

      const decoration = { range: new vscode.Range(linenum, 0, linenum, 0) }

      // apply new decorations
      if (Array.isArray(this.nextDecorations)) {
        for (let type of this.nextDecorations) {
          editor.setDecorations(type, [ decoration ])
        }
      } else {
        editor.setDecorations(this.nextDecorations, [ decoration ])
      }

      // dispose now-old decorations
      if (this.currDecorations) {
        if (Array.isArray(this.currDecorations)) {
          for (let type of this.currDecorations) {
            type.dispose()
          }
        } else {
          this.currDecorations.dispose()
        }
      }

      this.currDecorations = this.nextDecorations
      this.nextDecorations = undefined
    }
  }

  public buildNextDecorations(entry: CodeBytesEntry, showCycleCounts: boolean): boolean {
    let changed = true
    if (this.currDecorations && entry) {
      if (this.address == entry.a && !this.data == !entry.d) {
        if (!this.isEmpty == !entry.e) {
          if (this.cycleCount == entry.c) {
            changed = false
            if (this.data) {
              if (this.data.length == entry.d.length) {
                for (let i = 0; i < this.data.length; i += 1) {
                  if (this.data[i] != entry.d[i]) {
                    changed = true
                    break
                  }
                }
              } else {
                changed = true
              }
            }
          }
        }
      }
    }
    if (changed) {
      this.address = entry.a
      this.data = entry.d
      // this.isEmpty = entry.e ?? false
      this.cycleCount = entry.c
      this.nextDecorations = this.buildDecoration(showCycleCounts)
    }
    return changed
  }

  // *** don't rebuild indents on lines that are already indented ***
  public rebuildDecorations_OLD(address: number | undefined, bytes: number[] | undefined, emptySrcLine: boolean, showCycleCounts: boolean) {
    this.address = address
    this.data = bytes
    this.isEmpty = emptySrcLine
    this.nextDecorations = this.buildDecoration(showCycleCounts)
  }

  public isIndent(): boolean {
    return this.address === undefined && this.data === undefined
  }

  // TODO: cleanup work to be done here
  private buildDecoration(showCycleCounts: boolean): DecorationTypes {
    const decorations: DecorationTypes = []

    let emptySrcLine = this.isEmpty

    // TODO: this case could eventually fold into general case
    if (this.address === undefined && this.data === undefined) {

      const contentStr = "".padEnd(5 + 3 + 3 + 3 + 1 + 2 + (showCycleCounts ? 5 : 0), "\xA0")
      decorations.push(vscode.window.createTextEditorDecorationType({
        before: {
          contentText: contentStr,
        }
      }))

    } else {

      // address is "0000:" or "????:"
      let addressStr = this.address?.toString(16).toUpperCase() ?? "????"
      if (addressStr.length <= 2) {
        addressStr = addressStr.padStart(2, "0").padStart(4, "\xA0") + ":"
      } else {
        addressStr = addressStr.padStart(4, "0") + ":"
      }

      // just an address/offset, no bytes
      if (this.data === undefined) {
        const contentStr = addressStr.padEnd(5 + 3 + 3 + 3 + 1 + 2 + (showCycleCounts ? 5 : 0), "\xA0")
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
            hasChanged = !curChanged  // force final flush
            if (this.data.length > 3) {
              curStr += "+"
            } else {
              curStr += "\xA0"
            }
            curStr += "\xA0\xA0"
            if (showCycleCounts) {
              if (this.cycleCount) {
                // *** what about red color? ***
                curStr += "\xA0\xA0" + this.cycleCount.padEnd(3, "\xA0")
              } else {
                curStr += "\xA0\xA0\xA0\xA0\xA0"
              }
            }
            byteStr = ""
          } else if (i >= this.data.length) {
            byteStr = "\xA0\xA0\xA0"
          } else if (this.data[i] === undefined || this.data[i] === null) {
            byteStr = "\xA0??"
          } else {
            let byteValue = this.data[i]
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
                color: curChanged ? "#F00" : "#999"
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

//------------------------------------------------------------------------------

type UpdateRange = {
  start: number
  end: number
}

class CodeList {

  public editor: vscode.TextEditor
  public document: vscode.TextDocument
  private showCycleCounts: boolean
  private codeLines: CodeLine[]
  private isCleared = true

  constructor(editor: vscode.TextEditor, showCycleCounts: boolean, visibleStart: number, visibleEnd: number) {
    this.editor = editor
    this.showCycleCounts = showCycleCounts
    this.document = editor.document
    const lines = this.document.getText().split(/\r?\n/)

    this.codeLines = []
    for (let i = 0; i < lines.length; i += 1) {
      const emptySrcLine = lines[i] == ""
      const codeLine = new CodeLine(emptySrcLine)
      this.codeLines.push(codeLine)

      if (i >= visibleStart && i < visibleEnd) {
        const entry: CodeBytesEntry = { e: emptySrcLine }
        codeLine.buildNextDecorations(entry, this.showCycleCounts)
        codeLine.applyDecorations(this.editor, i)
      }
    }
  }

  public clear() {
    this.clearDecorations(0, this.codeLines.length)
    this.isCleared = true
  }

  public applyCodeBytes(codeBytes: CodeBytes) {
    this.isCleared = false
    for (let i = codeBytes.startLine; i < codeBytes.startLine + codeBytes.entries.length; i += 1) {
      const codeEntry = codeBytes.entries[i - codeBytes.startLine]
      const codeLine = this.codeLines[i]
      if (codeLine) {
        codeLine.buildNextDecorations(codeEntry, codeBytes.cycleCounts ?? false)
        codeLine.applyDecorations(this.editor, i)
      }
    }
  }

  // TODO: clean up needed here
  public applyEdits(changes: readonly vscode.TextDocumentContentChangeEvent[]) {

    // modTime mismatch has caused all decorations to have been cleared
    if (this.isCleared) {
      return
    }

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
      let endLineInc = change.range.end.line
      const partialStart = change.range.start.character != 0

      // *** simple end of line return ***
        // *** not possible? ***

      if (startLine == endLineInc) {
        // single partial line of text to insert or delete
        const simpleInsert = newLines.length == 1 && partialInsertEnd
        const simpleDelete = newLines.length == 0
        if (simpleInsert || simpleDelete) {
          // just a single line is being edited
          if (this.codeLines[startLine].isIndent()) {
            // if line already has an indent decoration,
            //  do nothing more, avoiding flicker
            continue
          }
        }
      }

      // clear existing decorations from affected lines
      //  (do this first, before any new decorations)
      let clearCount = endLineInc + 1 - startLine
      this.clearDecorations(startLine, clearCount)

      // compute full lines to be added/removed

      let fullDeleteCount = endLineInc - startLine
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
          // *** empty lines or not? ***
          codeLine = new CodeLine(true)
          this.codeLines[i] = codeLine
        }
        // *** empty lines or not? ***
        codeLine.rebuildDecorations_OLD(undefined, undefined, true/*codeLine.isEmpty*/, this.showCycleCounts)
      }

      // save range for later application
      updateRanges.push({ start: startLine, end: startLine + indentCount })
    }

    // now that final ranges are known, apply decorations to current text layout
    //  (in reverse so updates are top to bottom)
    for (let i = updateRanges.length; --i >= 0; ) {
      const range = updateRanges[i]
      for (let i = range.start; i < range.end; i += 1) {
        this.codeLines[i].applyDecorations(this.editor, i)
      }
    }
  }

  private clearDecorations(startLine: number, count: number) {
    for (let i = startLine; i < startLine + count; i += 1) {
      if (this.codeLines[i]) {
        this.codeLines[i].clearDecorations(this.editor, i)
      }
    }
  }
}

//------------------------------------------------------------------------------

type RequestEntry = {
  command: string
  arguments: any[]
}

type UpdateEntry = {
  request: RequestEntry
  codeList: CodeList
}

export class Decorator {

  private enabled = true
  private codeLists: CodeList[] = []
  private fullUpdate = false
  private updateId?: NodeJS.Timeout

  constructor(enabled: boolean) {
    this.enabled = enabled
  }

  public enable(enabled: boolean) {
    if (enabled != this.enabled) {
      if (enabled) {
        this.enabled = true
        this.scheduleUpdate(true)
      } else {
        if (this.updateId !== undefined) {
          clearTimeout(this.updateId)
          delete this.updateId
        }
        for (let codeList of this.codeLists) {
          codeList.clear()
        }
        this.codeLists = []
        this.enabled = false
      }
    }
  }

  public scheduleUpdate(fullUpdate = false, timeout?: number) {
    if (this.enabled) {
      if (fullUpdate) {
        this.fullUpdate = true
      }
      if (this.updateId !== undefined) {
        clearTimeout(this.updateId)
      }
      // delay for at least 10ms so the visible ranges values stabilize
      const updateTimeout = timeout ?? 10
      this.updateId = setTimeout(() => {
        this.executeUpdate()
      }, updateTimeout)
    }
  }

  private async executeUpdate() {
    if (this.updateId !== undefined) {
      clearTimeout(this.updateId)
      delete this.updateId

      // TODO: is await appropriate here?
      await this.updateDecorations()
    }
  }

  private async updateDecorations() {
    const editors = vscode.window.visibleTextEditors
    const activeEditor = vscode.window.activeTextEditor

    const newLists: CodeList[] = []
    const updateEntries0: UpdateEntry[] = []
    const updateEntries1: UpdateEntry[] = []

    // Update order:
    //  - active text editor visible lines
    //  - all non-active text editor visible lines
    //  - active text editor not visible lines
    //  - all non-active text editor not visible lines

    for (let i = -1; i < editors.length; i += 1) {

      // favor active editor among visible editors
      let editor: vscode.TextEditor
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

        const showCycleCounts = false    // TODO: make a setting

        // Flatten visible ranges into a single range
        //  and pad to cover partial lines.
        let visibleStart = 999999
        let visibleEnd = -1
        for (let range of editor.visibleRanges) {
          if (visibleStart > range.start.line) {
            visibleStart = Math.max(range.start.line - 1, 0)
          }
          if (visibleEnd < range.end.line) {
            visibleEnd = range.end.line + 1
          }
        }
        if (visibleEnd < 0) {
          continue
        }

        let refresh = this.fullUpdate
        let codeList: CodeList | undefined

        for (let list of this.codeLists) {
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
          codeList = new CodeList(editor, showCycleCounts, visibleStart, visibleEnd)
          newLists.push(codeList)
          refresh = true
        }

        if (refresh) {

          const request0 = {
            command: "rpw65.getCodeBytes",
            arguments: []
          }
          request0.arguments.push(editor.document.uri.toString())
          request0.arguments.push({ startLine: visibleStart, endLine: visibleEnd + 1, cycleCounts: showCycleCounts })
          updateEntries0.push({ request: request0, codeList })

          if (visibleStart > 0) {
            const request1 = {
              command: "rpw65.getCodeBytes",
              arguments: []
            }
            request1.arguments.push(editor.document.uri.toString())
            request1.arguments.push({ startLine: 0, endLine: visibleStart, cycleCounts: showCycleCounts })
            updateEntries1.push({ request: request1, codeList })
          }

          const request1 = {
            command: "rpw65.getCodeBytes",
            arguments: []
          }
          request1.arguments.push(editor.document.uri.toString())
          request1.arguments.push({ startLine: visibleEnd, cycleCounts: showCycleCounts })
          updateEntries1.push({ request: request1, codeList })
        }
      }
    }
    this.codeLists = newLists
    this.fullUpdate = false

    // TODO: all these awaits seem questionable
    for (let entry of updateEntries0) {
      const content = await client.sendRequest(vsclnt.ExecuteCommandRequest.type, entry.request)
      if (content) {
        entry.codeList.applyCodeBytes(content)
      }
    }
    for (let entry of updateEntries1) {
      const content = await client.sendRequest(vsclnt.ExecuteCommandRequest.type, entry.request)
      if (content) {
        entry.codeList.applyCodeBytes(content)
      }
    }
  }

  public async onTextChanged(document: vscode.TextDocument, changes: readonly vscode.TextDocumentContentChangeEvent[]) {
    if (this.enabled) {

      await this.executeUpdate()

      for (let codeList of this.codeLists) {
        if (codeList.document == document) {
          codeList.applyEdits(changes)
        }
      }

      // longer delay after text changes
      // *** only if document matched above?
      // *** maybe only on save, not periodic?
      this.scheduleUpdate(true, 3000)
    }
  }
}

//------------------------------------------------------------------------------
