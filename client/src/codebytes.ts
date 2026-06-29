
import * as vscode from 'vscode'
import * as base64 from 'base64-js'
import { ObjectBytesChangedParams, openDocs } from "./extension"

//------------------------------------------------------------------------------

export type LineRange = {
  startLine: number
  endLine: number
}

// code bytes is the decoded version of object bytes
type CodeBytesRange = {
  startLine: number
  startAddress: number
  offsets: number[]     // length == line count + 1
  dataArray: number[]
  dataBytes: Uint8Array
  refDataBytes?: Uint8Array
  cycleCounts?: string[]
}

type CodeBytes = {
  ranges: CodeBytesRange[]
}

function decodeObjectRanges(obParams: ObjectBytesChangedParams): CodeBytes {

  let codeBytes: CodeBytes = {
    ranges: []
  }

  for (const obRange of obParams.ranges) {

    let offsets: number[] | undefined
    if (obRange.offsetsString) {
      offsets = []
      const offsetsDataBytes = base64.toByteArray(obRange.offsetsString)
      for (let i = 0; i < offsetsDataBytes.length; i += 1) {
        let value = offsetsDataBytes[i]
        if (value >= 254) {
          while (true) {
            let nextValue = offsetsDataBytes[++i]
            value += nextValue
            if (nextValue != 254) {
              break
            }
          }
        }
        offsets.push(value)
      }
    }

    let dataBytes: Uint8Array | undefined
    let dataArray: number[] | undefined
    if (obRange.dataString) {
      dataBytes = base64.toByteArray(obRange.dataString)
      dataArray = [...dataBytes]
    }

    let refDataBytes: Uint8Array | undefined
    if (obRange.refDataString) {
      refDataBytes = base64.toByteArray(obRange.refDataString)
      for (let i = 0; i < dataArray.length; i += 1) {
        if (refDataBytes[i] != dataBytes[i]) {
          dataArray[i] = -dataArray[i]
        }
      }
    }

    let cycleCounts: string[] | undefined
    if (obRange.cyclesString) {
      const cyclesIndexes = base64.toByteArray(obRange.cyclesString)
      cycleCounts = []
      for (let i = 0; i < cyclesIndexes.length; i += 1) {
        cycleCounts.push(obParams.cyclesNames![cyclesIndexes[i]])
      }
    }

    if (offsets) {
      const cbRange: CodeBytesRange = {
        startLine: obRange.startLine,
        startAddress: obRange.startAddress,
        offsets,
        dataArray,
        dataBytes,
        refDataBytes,
        cycleCounts
      }
      codeBytes.ranges.push(cbRange)
    }
  }
  return codeBytes
}

//------------------------------------------------------------------------------

class CodeLine {

  private codeList: CodeList
  public codeStr?: string
  public errStr?: string

  constructor(codeList: CodeList) {
    this.codeList = codeList
    this.clearDecContent()
  }

  public clearDecContent() {
    this.codeStr = this.codeList.getEmptyCodeStr()
    this.errStr = undefined
  }

  public buildDecContent(
      address: number,
      dataArray: number[],
      offset: number,
      length: number,
      cycleCount?: string) {

    if (length == 0) {
      this.clearDecContent()
      return
    }

    this.codeStr = undefined
    this.errStr = undefined

    if (this.codeList.showCodeBytes) {

      let addressStr = address.toString(16).toUpperCase()
      if (addressStr.length <= 2) {
        addressStr = addressStr.padStart(2, "0").padStart(4, "\xA0") + ":"
      } else {
        addressStr = addressStr.padStart(4, "0") + ":"
      }

      this.codeStr = addressStr
      for (let i = 0; i < 3; i += 1) {
        if (i < length) {
          let byteValue = dataArray[i + offset]
          if (byteValue < 0) {
            byteValue = -byteValue
            if (!this.errStr) {
              this.errStr = ""
            }
          }
          this.syncStrings()
          const byteStr = "\xA0" + byteValue.toString(16).toUpperCase().padStart(2, "0")
          if (byteValue == dataArray[i + offset]) {
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
      if (length > 3) {

        // scan remaining bytes for errors
        let inRemaining = false
        for (let i = 3; i < length; i += 1) {
          if (dataArray[i + offset] < 0) {
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
    }

    if (this.codeList.showCycleCounts) {
      if (this.codeStr == undefined) {
        this.codeStr = ""
      }
      if (cycleCount) {
        this.codeStr += cycleCount.padEnd(5, "\xA0")
      } else {
        this.codeStr += "\xA0\xA0\xA0\xA0\xA0"
      }
      this.syncStrings()
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
  public showCodeBytes: boolean
  public showCycleCounts: boolean
  public codeBytes?: CodeBytes
  private codeLines: CodeLine[]
  private activeRange?: LineRange

  private codeDecType: vscode.TextEditorDecorationType
  private errorDecType: vscode.TextEditorDecorationType

  // cached for use by CodeLines
  private emptyCodeStr: string = ""

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
  }

  public setShowFlags(showCodeBytes: boolean, showCycleCounts: boolean) {
    this.showCodeBytes = showCodeBytes
    this.showCycleCounts = showCycleCounts
    this.emptyCodeStr = ""
  }

  public getEmptyCodeStr(): string | undefined {
    if (this.showCodeBytes || this.showCycleCounts) {
      if (!this.emptyCodeStr) {
        let padCount = 5 + 3 + 3 + 3 + 1 + 2
        if (this.showCycleCounts) {
          padCount += 5
        }
        this.emptyCodeStr = "".padEnd(padCount, "\xA0")
      }
      return this.emptyCodeStr
    }
  }

  public dispose() {
    this.codeDecType.dispose()
    this.errorDecType.dispose()
  }

  public changeActiveRange(visibleRanges: readonly vscode.Range[]) {

    const fullRange = this.getVisibleRange(visibleRanges)
    let newRange: LineRange | undefined

    if (fullRange) {
      // TODO: incorporate scroll direction?
      newRange = {
        startLine: Math.max(fullRange.startLine - 100, 0),
        endLine: Math.min(fullRange.endLine + 100, this.codeLines.length)
      }
    }

    if (!this.activeRange || !newRange ||
        newRange.startLine < this.activeRange.startLine ||
        newRange.endLine > this.activeRange.endLine) {

      this.clearActiveRange()
      this.activeRange = newRange
      if (this.codeBytes) {
        this.updateActiveRange()
      }
      this.setDecorations(0, this.codeLines.length)
    }
  }

  private getVisibleRange(visibleRanges: readonly vscode.Range[]): LineRange | undefined {
    let fullRange: LineRange | undefined
    for (const range of visibleRanges) {
      const rangeStart = Math.max(range.start.line - 1, 0)
      const rangeEnd = range.end.line + 2
      if (!fullRange) {
        fullRange = { startLine: rangeStart, endLine: rangeEnd }
      } else {
        if (fullRange.startLine > rangeStart) {
          fullRange.startLine = rangeStart
        }
        if (fullRange.endLine < rangeEnd) {
          fullRange.endLine = rangeEnd
        }
      }
    }
    return fullRange
  }

  private clearActiveRange() {
    if (this.activeRange) {
      for (let i = this.activeRange.startLine; i < this.activeRange.endLine; i += 1) {
        this.codeLines[i].clearDecContent()
      }
      this.activeRange = undefined
    }
  }

  public updateActiveRange() {
    if (this.codeBytes && this.activeRange) {

      let lineIndex = this.activeRange.startLine

      for (const range of this.codeBytes.ranges) {

        if (range.startLine + range.offsets.length - 1 <= lineIndex) {
          continue
        }

        const startIndex = range.startLine
        const endIndex = startIndex + range.offsets.length - 1
        for (let i = lineIndex; i < endIndex; i += 1) {

          const codeLine = this.codeLines[i]
          const offset = range.offsets[i - startIndex]
          const length = range.offsets[i - startIndex + 1] - offset
          codeLine?.buildDecContent(
            range.startAddress + offset,
            range.dataArray,
            offset,
            length,
            range.cycleCounts[i - startIndex])

          lineIndex += 1
          if (lineIndex == this.activeRange.endLine) {
            return
          }
        }
      }
    }
  }

  public applyEdits(changes: readonly vscode.TextDocumentContentChangeEvent[]): number {

    let totalRemoved = 0

    for (let change of changes) {

      const startLine = change.range.start.line
      const endLineInc = change.range.end.line
      const newLines = change.text.split(/\r?\n/)
      // NOTE: newLines will always have at least one entry,
      //  even if change.text is empty

      const linesRemoved = endLineInc - startLine + 1
      const linesAdded = newLines.length
      const linesDelta = linesAdded - linesRemoved
      totalRemoved += linesRemoved

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

      this.clearDecContent(clearStart, clearEnd - clearStart)

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

    // After an edit is is just setting decorations that could
    //  currenty be seen.  All other lines will appear left-aligned
    //  because they have no decoration.
    const visibleRange = this.getVisibleRange(this.editor.visibleRanges)
    this.setDecorations(visibleRange.startLine ?? 0, visibleRange.endLine ?? 0)
    this.codeBytes = undefined

    return totalRemoved
  }

  public clearDecContent(startLine: number, count: number) {
    for (let i = startLine; i < startLine + count; i += 1) {
      if (this.codeLines[i]) {
        this.codeLines[i].clearDecContent()
      }
    }
  }

  public setDecorations(visibleStart: number, visibleEnd: number) {

    let codeDecOptions: vscode.DecorationOptions[] = []
    let errDecOptions: vscode.DecorationOptions[] = []

    if (this.showCodeBytes || this.showCycleCounts) {

      if (visibleEnd > this.codeLines.length) {
        visibleEnd = this.codeLines.length
      }

      const margin = (this.showCodeBytes ? 17 : 0) + (this.showCycleCounts ? 5 : 0)
      const marginStr = `0 0 0 -${margin}ch`

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
                margin: marginStr,
                contentText: codeLine.errStr
              }
            }
          })
        }
      }
    }

    this.editor.setDecorations(this.codeDecType, codeDecOptions)
    this.editor.setDecorations(this.errorDecType, errDecOptions)
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

  private async enable(showCodeBytes: boolean, showCycleCounts: boolean) {
    if (this.showCodeBytes != showCodeBytes || this.showCycleCounts != showCycleCounts) {

      if (this.updateId !== undefined) {
        clearTimeout(this.updateId)
        delete this.updateId
      }

      await this.updateComplete

      this.showCodeBytes = showCodeBytes
      this.showCycleCounts = showCycleCounts
      this.scheduleUpdate(undefined, true)
    }
  }

  private findCodeList(editor: vscode.TextEditor): CodeList | undefined {
    for (const codeList of this.codeLists) {
      if (codeList.editor == editor) {
        return codeList
      }
    }
  }

  // update newly visible editors with empty lines as early as possible
  //  to minimize left to right jumping
  public updateVisibleEditors() {
    if (this.showCodeBytes || this.showCycleCounts) {
      for (const editor of vscode.window.visibleTextEditors) {
        if (editor.document.languageId == "rpw65") {
          let codeList = this.findCodeList(editor)
          if (!codeList) {
            codeList = new CodeList(editor, this.showCodeBytes, this.showCycleCounts)
            this.codeLists.push(codeList)

            // NOTE: This sets every line in the source file to empty, regardless
            //  of visibility. At this point, visibility ranges aren't valid and
            //  it doesn't appear to make any performance difference if some
            //  versus all the lines are set to empty.
            codeList.setDecorations(0, editor.document.lineCount)
          }

          codeList.changeActiveRange(editor.visibleRanges)
        }
      }
    }
  }

  // NOTE: called whenever the visible range of a document changes,
  //  normally after a scroll operation
  public changeActiveRange(editor: vscode.TextEditor, visibleRanges: readonly vscode.Range[]) {
    const codeList = this.findCodeList(editor)
    codeList?.changeActiveRange(visibleRanges)
  }

  public scheduleUpdate(timeout?: number, forceUpdate = false) {
    if (this.showCodeBytes || this.showCycleCounts || forceUpdate) {

      if (this.updateId !== undefined) {
        clearTimeout(this.updateId)
      }

      // delay for at least 10ms so the visible ranges values stabilize
      const updateTimeout = timeout ?? 10
      this.updateId = setTimeout(async () => {

        clearTimeout(this.updateId)
        delete this.updateId

        this.updateDecorations()

      }, updateTimeout)
    }
  }

  public async onTextChanged(
      document: vscode.TextDocument,
      changes: readonly vscode.TextDocumentContentChangeEvent[]) {

    if (this.showCodeBytes || this.showCycleCounts) {

      // await this.updateComplete

      let largeDelete = false
      for (let codeList of this.codeLists) {
        if (codeList.editor.document == document) {
          const linesRemoved = codeList.applyEdits(changes)
          if (linesRemoved > 4) {
            largeDelete = true
          }
        }
      }

      // NOTE: at this point, only the visible lines have any decorations

      // When deleting large chunks of text with code decorators,
      //  counteract the big scroll to the right caused by the
      //  remaining decorators.
      // NOTE: This seems like a VSCode bug because it does do
      //  the correct thing when deleting text but not when cutting
      //  it or redoing a cut.
      if (largeDelete) {
        const editor = vscode.window.activeTextEditor
        setTimeout(() => {
          const pos = editor.selection.active
          const range = new vscode.Range(pos, pos)
          editor.revealRange(range)
        }, 0)
      }

      // longer delay after text changes
      this.scheduleUpdate(1000)
    }
  }

  private updateDecorations() {

    // build list of visible editors with the active editor first
    const editors = [...vscode.window.visibleTextEditors]
    const activeEditor = vscode.window.activeTextEditor
    for (let i = 0; i < editors.length; i += 1) {
      if (editors[i] == activeEditor) {
        if (i > 0) {
          editors.splice(i, 1)
          editors.unshift(activeEditor)
        }
        break
      }
    }

    // move still-visible lists into newList
    const newLists: CodeList[] = []
    for (const editor of editors) {
      if (editor.document.languageId == "rpw65") {
        for (let i = 0; i < this.codeLists.length; i += 1) {
          const codeList = this.codeLists[i]
          if (codeList.editor == editor) {
            // remove lists from current set and add to newList
            //  (for editors that remain visible after update)
            codeList.setShowFlags(this.showCodeBytes, this.showCycleCounts)
            this.codeLists.splice(i, 1)
            newLists.push(codeList)
            break
          }
        }
      }
    }

    // apply objectBytes data to each code list and then update visible decorators
    for (const codeList of newLists) {
      const state = openDocs.get(codeList.editor.document.uri.toString())
      if (state?.objectState) {
        codeList.codeBytes = decodeObjectRanges(state.objectState)
      }
      codeList.updateActiveRange()
      codeList.setDecorations(0, codeList.editor.document.lineCount)
    }

    // dispose lists not moved to newLists (those that are no longer visible)
    for (const codeList of this.codeLists) {
      codeList.dispose()
    }
    this.codeLists = newLists
  }
}

//------------------------------------------------------------------------------
