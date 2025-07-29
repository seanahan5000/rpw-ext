
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

  private codeList: CodeList
  public codeStr?: string
  public errStr?: string
  public cyclesStr?: string

  constructor(codeList: CodeList) {
    this.codeList = codeList
    this.rebuildContents()
  }

  public buildDecorations(entry: CodeBytesEntry) {
    this.rebuildContents(entry.a, entry.d, entry.c)
  }

  public clearDecorations() {
    if (this.codeList.showCodeBytes) {
      this.codeStr = this.getEmptyCodeStr()
      this.errStr = undefined
    }
    if (this.codeList.showCycleCounts) {
      this.cyclesStr = "\xA0\xA0\xA0\xA0\xA0"
    }
  }

  private rebuildContents(address?: number, dataBytes?: (number | undefined)[], cycleCount?: string) {

    if (this.codeList.showCodeBytes) {

      // address is "0000:" or "????:"
      let addressStr = address?.toString(16).toUpperCase() ?? "????"
      if (addressStr.length <= 2) {
        addressStr = addressStr.padStart(2, "0").padStart(4, "\xA0") + ":"
      } else {
        addressStr = addressStr.padStart(4, "0") + ":"
      }

      this.errStr = undefined

      if (dataBytes) {

        this.codeStr = addressStr
        for (let i = 0; i < 3; i += 1) {
          if (i < dataBytes.length) {
            if (dataBytes[i] === undefined) {
              this.syncStrings()
              this.codeStr += "\xA0??"
              continue
            }
            let byteValue = dataBytes[i]
            if (byteValue < 0) {
              byteValue = -byteValue
              if (!this.errStr) {
                this.errStr = ""
              }
            }
            this.syncStrings()
            const byteStr = "\xA0" + byteValue.toString(16).toUpperCase().padStart(2, "0")
            if (byteValue == dataBytes[i]) {
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
        if (dataBytes.length > 3) {

          // scan remaining bytes for errors
          let inRemaining = false
          for (let i = 3; i < dataBytes.length; i += 1) {
            if (dataBytes[i] < 0) {
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

        this.syncStrings()
        this.codeStr += "\xA0\xA0"

        // final sync
        this.syncStrings()

      } else {
        if (address === undefined) {
          this.codeStr = this.getEmptyCodeStr()
        } else {
          this.codeStr = addressStr.padEnd(5 + 3 + 3 + 3 + 1 + 2, "\xA0")
        }
      }
    }

    if (this.codeList.showCycleCounts) {
      if (cycleCount) {
        this.cyclesStr = cycleCount.padEnd(5, "\xA0")
      } else {
        this.cyclesStr = "\xA0\xA0\xA0\xA0\xA0"
      }
    }
  }

  private getEmptyCodeStr(): string {
    if (!this.codeList.emptyCodeStr) {
      this.codeList.emptyCodeStr = "".padEnd(5 + 3 + 3 + 3 + 1 + 2, "\xA0")
    }
    return this.codeList.emptyCodeStr
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
  public showCodeBytes: boolean
  public showCycleCounts: boolean
  private codeLines: CodeLine[]

  private codeDecType: vscode.TextEditorDecorationType
  private errorDecType: vscode.TextEditorDecorationType
  private cyclesDecType: vscode.TextEditorDecorationType

  // cached for use by CodeLines
  public emptyCodeStr: string = ""

  constructor(editor: vscode.TextEditor, showCodeBytes: boolean, showCycleCounts: boolean) {
    this.editor = editor
    this.showCodeBytes = showCodeBytes
    this.showCycleCounts = showCycleCounts

    this.codeLines = []
    const lineCount = this.editor.document.lineCount
    for (let i = 0; i < lineCount; i += 1) {
      const codeLine = new CodeLine(this)
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
    this.cyclesDecType = vscode.window.createTextEditorDecorationType({
      before: {
        color: "gray"
      }
    })
  }

  public dispose() {
    this.codeDecType.dispose()
    this.errorDecType.dispose()
    this.cyclesDecType.dispose()
  }

  public applyCodeBytes(codeBytes: CodeBytes) {
    for (let i = 0; i < codeBytes.entries.length; i += 1) {
      const codeLine = this.codeLines[codeBytes.startLine + i]
      if (codeLine) {
        codeLine.buildDecorations(codeBytes.entries[i])
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
          newSlots.push(new CodeLine(this))
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
        this.codeLines[i].clearDecorations()
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
    let cyclesDecOptions: vscode.DecorationOptions[] = []

    if (visibleEnd > this.codeLines.length) {
      visibleEnd = this.codeLines.length
    }

    for (let i = visibleStart; i < visibleEnd; i += 1) {

      const codeLine = this.codeLines[i]

      if (this.showCodeBytes) {
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
                margin: "0 0 0 -17ch",
                contentText: codeLine.errStr
              }
            }
          })
        }
      }

      if (this.showCycleCounts) {
        if (codeLine.cyclesStr) {
          cyclesDecOptions.push({
            range: new vscode.Range(i, 0, i, 0),
            renderOptions: {
              before: {
                contentText: codeLine.cyclesStr
              }
            }
          })
        }
      }
    }

    this.editor.setDecorations(this.codeDecType, codeDecOptions)
    this.editor.setDecorations(this.errorDecType, errDecOptions)
    this.editor.setDecorations(this.cyclesDecType, cyclesDecOptions)
  }
}

//------------------------------------------------------------------------------

export class CodeDecorator {

  private showCodeBytes: boolean
  private showCycleCounts: boolean

  private codeLists: CodeList[] = []
  private updateId?: ReturnType<typeof setTimeout>
  private updateComplete = Promise.resolve()

  constructor(codeBytes: boolean, cycleCounts: boolean) {
    this.showCodeBytes = codeBytes
    this.showCycleCounts = cycleCounts
  }

  public async enableCodeBytes(codeBytes: boolean) {
    this.enable(codeBytes, this.showCycleCounts)
  }

  public async enableCycleCounts(cycleCounts: boolean) {
    this.enable(this.showCodeBytes, cycleCounts)
  }

  private async enable(codeBytes: boolean, cycleCounts: boolean) {
    if (this.showCodeBytes != codeBytes || this.showCycleCounts != cycleCounts) {

      if (this.updateId !== undefined) {
        clearTimeout(this.updateId)
        delete this.updateId
      }

      await this.updateComplete

      this.showCodeBytes = codeBytes
      this.showCycleCounts = cycleCounts
      this.scheduleUpdate(undefined, true)
    }
  }

  public scheduleUpdate(timeout?: number, forceUpdate = false) {
    if (this.showCodeBytes || this.showCycleCounts || forceUpdate) {

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

    if (this.showCodeBytes || this.showCycleCounts) {

      await this.updateComplete

      for (let codeList of this.codeLists) {
        if (codeList.editor.document == document) {
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

        let codeList: CodeList | undefined

        for (let i = 0; i < this.codeLists.length; i += 1) {
          const list = this.codeLists[i]
          if (list.editor == editor) {
            codeList = list
            codeList.showCodeBytes = this.showCodeBytes
            codeList.showCycleCounts = this.showCycleCounts
            this.codeLists.splice(i, 1)
            newLists.push(codeList)
            break
          }
        }

        let visRange = codeList?.getVisibleRange()

        if (!codeList) {
          codeList = new CodeList(editor, this.showCodeBytes, this.showCycleCounts)
          visRange = codeList.getVisibleRange()
          codeList.setDecorations(visRange.start, visRange.end)
          newLists.push(codeList)
        }

        // update just the visible lines first, for fast refresh

        const request = {
          command: "rpw65.getCodeBytes",
          arguments: []
        }
        request.arguments.push(editor.document.uri.toString())
        request.arguments.push({ startLine: visRange.start, endLine: visRange.end, cycleCounts: this.enableCycleCounts })

        const content = await client.sendRequest(vsclnt.ExecuteCommandRequest.type, request)
        if (content) {
          codeList.applyCodeBytes(content)
          codeList.setDecorations(visRange.start, visRange.end)
        }

        // do a final full refresh

        const lineCount = codeList.editor.document.lineCount
        if (visRange.start > 0 || visRange.end < lineCount) {

          const request = {
            command: "rpw65.getCodeBytes",
            arguments: []
          }
          request.arguments.push(editor.document.uri.toString())
          request.arguments.push({ cycleCounts: this.showCycleCounts })

          const content = await client.sendRequest(vsclnt.ExecuteCommandRequest.type, request)
          if (content) {
            codeList.applyCodeBytes(content)
          }

          codeList.setDecorations(0, lineCount)
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
