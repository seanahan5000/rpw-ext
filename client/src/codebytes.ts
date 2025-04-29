
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
  c?: string      // cycle count ("3", "2/3", "4+", etc.)
}

// response to GetCodeBytes
type CodeBytes = {
  startLine: number
  cycleCounts?: boolean
  entries: CodeBytesEntry[]
}

//------------------------------------------------------------------------------

class CodeLine {

  private static emptyStr   = "".padEnd(5 + 3 + 3 + 3 + 1 + 0 + 2, "\xA0")
  private static emptyStrCC = "".padEnd(5 + 3 + 3 + 3 + 1 + 5 + 2, "\xA0")

  public address?: number
  public data?: (number | undefined)[]
  public cycleCount?: string

  constructor(showCycleCounts: boolean) {
    this.rebuildContents(showCycleCounts)
  }

  public buildDecorations(entry: CodeBytesEntry, showCycleCounts: boolean) {
    this.address = entry.a
    this.data = entry.d
    this.cycleCount = entry.c
    this.rebuildContents(showCycleCounts)
  }

  public clearDecorations(showCycleCounts: boolean) {
    this.codeStr = showCycleCounts ? CodeLine.emptyStrCC : CodeLine.emptyStr
    this.errStr = undefined
  }

  public codeStr?: string
  public errStr?: string

  private rebuildContents(showCycleCounts: boolean) {

    // address is "0000:" or "????:"
    let addressStr = this.address?.toString(16).toUpperCase() ?? "????"
    if (addressStr.length <= 2) {
      addressStr = addressStr.padStart(2, "0").padStart(4, "\xA0") + ":"
    } else {
      addressStr = addressStr.padStart(4, "0") + ":"
    }

    this.errStr = undefined

    if (this.data) {

      this.codeStr = addressStr
      for (let i = 0; i < 3; i += 1) {
        if (i < this.data.length) {
          if (this.data[i] === undefined) {
            this.syncStrings()
            this.codeStr += "\xA0??"
            continue
          }
          let byteValue = this.data[i]
          if (byteValue < 0) {
            byteValue = -byteValue
            if (!this.errStr) {
              this.errStr = ""
            }
          }
          this.syncStrings()
          const byteStr = "\xA0" + byteValue.toString(16).toUpperCase().padStart(2, "0")
          if (byteValue == this.data[i]) {
            this.codeStr += byteStr
          } else {
            this.errStr += byteStr
          }
        } else {
          this.syncStrings()
          this.codeStr += "\xA0\xA0\xA0"
        }
      }

      // check remaining data
      if (this.data.length > 3) {

        // scan remaining bytes for errors
        let inRemaining = false
        for (let i = 3; i < this.data.length; i += 1) {
          if (this.data[i] < 0) {
            inRemaining = true
            if (this.errStr === undefined) {
              this.errStr = ""
            }
            break
          }
        }

        // if error found, draw "+" in red
        this.syncStrings()
        if (inRemaining) {
          this.errStr += "+"
        } else {
          this.codeStr += "+"
        }

      } else {
        this.syncStrings()
        this.codeStr += "\xA0"
      }

      if (showCycleCounts) {
        this.syncStrings()
        if (this.cycleCount) {
          this.codeStr += "\xA0\xA0" + this.cycleCount.padEnd(3, "\xA0")
        } else {
          this.codeStr += "\xA0\xA0\xA0\xA0\xA0"
        }
      }

      this.syncStrings()
      this.codeStr += "\xA0\xA0"

      // final sync
      this.syncStrings()

    } else {
      if (this.address === undefined) {
        this.codeStr = showCycleCounts ? CodeLine.emptyStrCC : CodeLine.emptyStr
      } else {
        this.codeStr = addressStr.padEnd(5 + 3 + 3 + 3 + 1 + (showCycleCounts ? 5 : 0) + 2, "\xA0")
      }
    }
  }

  private syncStrings() {
    if (this.codeStr !== undefined && this.errStr !== undefined) {
      const dataLength = this.codeStr.length
      const errLength = this.errStr.length
      if (dataLength > errLength) {
        this.errStr = this.errStr.padEnd(dataLength, "\xA0")
      } else if (dataLength < errLength) {
        this.codeStr = this.codeStr.padEnd(errLength, "\xA0")
      }
    }
  }
}

//------------------------------------------------------------------------------

class CodeList {
  public editor: vscode.TextEditor
  public document: vscode.TextDocument
  private showCycleCounts: boolean
  private codeLines: CodeLine[]

  private codeDecType: vscode.TextEditorDecorationType
  private errorDecType: vscode.TextEditorDecorationType

  constructor(editor: vscode.TextEditor, showCycleCounts: boolean, ) {
    this.editor = editor
    this.showCycleCounts = showCycleCounts
    this.document = editor.document

    this.codeLines = []
    for (let i = 0; i < this.document.lineCount; i += 1) {
      const codeLine = new CodeLine(this.showCycleCounts)
      this.codeLines.push(codeLine)
    }

    this.codeDecType = vscode.window.createTextEditorDecorationType({
      before: {
        color: "gray"
      }
    })

    this.errorDecType = vscode.window.createTextEditorDecorationType({
      before: {
        color: "red"
      }
    })
  }

  public dispose() {
    this.codeDecType.dispose()
    this.errorDecType.dispose()
  }

  public applyCodeBytes(codeBytes: CodeBytes) {
    for (let i = codeBytes.startLine; i < codeBytes.startLine + codeBytes.entries.length; i += 1) {
      const codeLine = this.codeLines[i]
      if (codeLine) {
        const codeEntry = codeBytes.entries[i - codeBytes.startLine]
        codeLine.buildDecorations(codeEntry, codeBytes.cycleCounts ?? false)
      }
    }
  }

  public applyEdits(changes: readonly vscode.TextDocumentContentChangeEvent[]) {

    for (let change of changes) {

      const startLine = change.range.start.line
      const endLineInc = change.range.end.line
      const newLines = change.text.split(/\r?\n/)
      // NOTE: newLines will always have at least one entry,
      //  even if change.text is empty

      const linesRemoved = endLineInc - startLine + 1
      const linesAdded = newLines.length
      const linesDelta = linesAdded - linesRemoved

      let clearStart = startLine
      let clearEnd = endLineInc + 1

      // return at end of line
      // return on full line
      // delete of entire line
      // return in middle of line (can't, need old line width)
      // delete at start of empty line (can't, need old line width)

      // insertion text starting with "\n"
      if (newLines[0] == "") {
        // simple delete -- start and end with "\n"
        if (newLines.length == 1) {
          if (change.range.end.character == 0) {
            clearEnd -= 1
          }
        } else {
          // NOTE: Ideally this would look at the line length and only
          //  apply this optimization when at the end of the line, but
          //  that information isn't available here because edit has
          //  already been applied to text
          if (linesDelta > 0) {
            clearStart += 1
          }
        }
      }

      // NOTE: if newLines is a single return,
      //  previous case has already handled it
      if (newLines.length > 1) {
        if (newLines[newLines.length - 1] == "") {
          // insertion text ending in "\n" at start of line
          if (change.range.end.character == 0) {
            clearEnd -= 1
          }
        }
      }

      this.clearDecorations(clearStart, clearEnd - clearStart)

      if (linesDelta > 0) {
        const newSlots: CodeLine[] = []
        for (let i = 0; i < linesDelta; i += 1) {
          newSlots.push(new CodeLine(this.showCycleCounts))
        }
        this.codeLines.splice(clearStart, 0, ...newSlots)
      } else if (linesDelta < 0) {
        this.codeLines.splice(clearStart, -linesDelta)
      }
    }

    const visibleRange = this.getVisibleRange()
    this.setDecorations(visibleRange.start, visibleRange.end)
  }

  private clearDecorations(startLine: number, count: number) {
    for (let i = startLine; i < startLine + count; i += 1) {
      if (this.codeLines[i]) {
        this.codeLines[i].clearDecorations(this.showCycleCounts)
      }
    }
  }

  public getVisibleRange(): { start: number, end: number } {
    // Flatten visible ranges into a single range
    //  and pad to cover partial lines.
    let start = 999999
    let end = -1
    for (let range of this.editor.visibleRanges) {
      if (start > range.start.line) {
        start = Math.max(range.start.line - 1, 0)
      }
      if (end < range.end.line) {
        end = range.end.line + 1
      }
    }
    if (end < start) {
      end = start
    }
    return { start, end }
  }

  public setDecorations(visibleStart: number, visibleEnd: number) {

    let codeDecOptions: vscode.DecorationOptions[] = []
    let errDecOptions: vscode.DecorationOptions[] = []

    if (visibleEnd > this.codeLines.length) {
      visibleEnd = this.codeLines.length
    }

    for (let i = visibleStart; i < visibleEnd; i += 1) {

      const codeLine = this.codeLines[i]

      if (codeLine.codeStr) {
        codeDecOptions.push({
          range: new vscode.Range(i, 0, i, 0),
          renderOptions: {
            before: {
              contentText: codeLine.codeStr
            }
          }
        })
      }

      if (codeLine.errStr) {
        errDecOptions.push({
          range: new vscode.Range(i, 0, i, 0),
          renderOptions: {
            before: {
              margin: this.showCycleCounts ? "0 0 0 -22ch" : "0 0 0 -17ch",
              contentText: codeLine.errStr
            }
          }
        })
      }
    }

    this.editor.setDecorations(this.codeDecType, codeDecOptions)
    this.editor.setDecorations(this.errorDecType, errDecOptions)
  }
}

//------------------------------------------------------------------------------

export class CodeDecorator {

  private enabled: boolean
  private codeLists: CodeList[] = []
  private updateId?: NodeJS.Timeout
  private updateComplete = Promise.resolve()

  constructor(enabled: boolean) {
    this.enabled = enabled
  }

  public async enable(enabled: boolean) {
    if (enabled != this.enabled) {
      if (enabled) {
        this.enabled = true
        this.scheduleUpdate()
      } else {

        if (this.updateId !== undefined) {
          clearTimeout(this.updateId)
          delete this.updateId
        }

        await this.updateComplete

        for (let codeList of this.codeLists) {
          codeList.dispose()
        }
        this.codeLists = []
        this.enabled = false
      }
    }
  }

  public scheduleUpdate(timeout?: number) {
    if (this.enabled) {

      if (this.updateId !== undefined) {
        clearTimeout(this.updateId)
      }

      // delay for at least 10ms so the visible ranges values stabilize
      const updateTimeout = timeout ?? 10
      this.updateId = setTimeout(async () => {

        await this.updateComplete

        clearTimeout(this.updateId)
        delete this.updateId

        this.updateComplete = this.updateDecorations()

      }, updateTimeout)
    }
  }

  public async onTextChanged(
      document: vscode.TextDocument,
      changes: readonly vscode.TextDocumentContentChangeEvent[]) {

    if (this.enabled) {

      await this.updateComplete

      for (let codeList of this.codeLists) {
        if (codeList.document == document) {
          codeList.applyEdits(changes)
        }
      }

      // longer delay after text changes
      this.scheduleUpdate(1000)
    }
  }

  private async updateDecorations() {

    const editors = vscode.window.visibleTextEditors
    const activeEditor = vscode.window.activeTextEditor
    const newLists: CodeList[] = []

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

        const showCycleCounts = false    // TODO: make this a setting

        let codeList: CodeList | undefined

        for (let i = 0; i < this.codeLists.length; i += 1) {
          const list = this.codeLists[i]
          if (list.editor != editor) {
            continue
          }
          if (list.document != editor.document) {
            continue
          }
          codeList = list
          this.codeLists.splice(i, 1)
          newLists.push(codeList)
          break
        }

        let visibleRange = codeList?.getVisibleRange()

        if (!codeList) {
          codeList = new CodeList(editor, showCycleCounts)
          visibleRange = codeList.getVisibleRange()
          codeList.setDecorations(visibleRange.start, visibleRange.end)
          newLists.push(codeList)
        }

        // update just the visible lines first, for fast refresh

        const request = {
          command: "rpw65.getCodeBytes",
          arguments: []
        }
        request.arguments.push(editor.document.uri.toString())
        request.arguments.push({ startLine: visibleRange.start, endLine: visibleRange.end, cycleCounts: showCycleCounts })

        const content = await client.sendRequest(vsclnt.ExecuteCommandRequest.type, request)
        if (content) {
          codeList.applyCodeBytes(content)
          codeList.setDecorations(visibleRange.start, visibleRange.end)
        }

        // do a final full refresh

        if (visibleRange.start > 0 || visibleRange.end < codeList.document.lineCount) {

          const request = {
            command: "rpw65.getCodeBytes",
            arguments: []
          }
          request.arguments.push(editor.document.uri.toString())
          request.arguments.push({ cycleCounts: showCycleCounts })

          const content = await client.sendRequest(vsclnt.ExecuteCommandRequest.type, request)
          if (content) {
            codeList.applyCodeBytes(content)
          }

          codeList.setDecorations(0, codeList.document.lineCount)
        }
      }
    }

    for (let codeList of this.codeLists) {
      codeList.dispose()
    }

    this.codeLists = newLists
  }
}

//------------------------------------------------------------------------------
