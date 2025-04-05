
import { SourceFile } from "./project"
import { Symbol, SymbolType } from "./symbols"
import { SymbolExpression } from "./expressions"
import { ContinuedStatement, Statement } from "./statements"

// TODO: maybe move to symbols?
// *** or move to lsp_utils? ***

//------------------------------------------------------------------------------

export type LineEdit = {
  line: number,
  start: number,
  end: number,
  text: string
}

export type FileEdits = Map<SourceFile, LineEdit[]>

class EditCollection {

  public fileEdits = new Map<SourceFile, LineEdit[]>()

  addEdit(file: SourceFile, line: number, start: number, end: number, newText: string) {
    let lineEdits = this.fileEdits.get(file)
    if (!lineEdits) {
      lineEdits = []
      this.fileEdits.set(file, lineEdits)
    }
    lineEdits.push({ line, start, end, text: newText })
  }
}

//------------------------------------------------------------------------------

export function renameSymbol(symbol: Symbol, newName: string): FileEdits | undefined {
  let edits = new EditCollection()
  const oldName = symbol.definition.getSimpleName().asString
  renameSymbolDefAndRefs(symbol, oldName, newName, edits)
  return edits.fileEdits.size ? edits.fileEdits : undefined
}


export function renumberLocals(sourceFile: SourceFile, startLine: number, endLine: number): FileEdits | undefined {
  let edits = new EditCollection()
  renumberLocalType(sourceFile, startLine, endLine + 1, edits, SymbolType.CheapLocal)
  renumberLocalType(sourceFile, startLine, endLine + 1, edits, SymbolType.ZoneLocal)
  return edits.fileEdits.size ? edits.fileEdits : undefined
}

export function getLocalRange(sourceFile: SourceFile, startLine: number,
    symbolType: SymbolType): { startLine: number, endLine: number } {

  // scan backwards for zone/cheap start
  while (startLine > 0) {
    const statement = sourceFile.statements[startLine]
    if (isLocalStart(statement, symbolType) || !statement.enabled) {
      break
    }
    startLine -= 1
  }

  // scan forward to zone/cheap end
  let endLine = startLine + 1
  while (endLine < sourceFile.statements.length) {
    const statement = sourceFile.statements[endLine]
    if (isLocalStart(statement, symbolType) || !statement.enabled) {
      break
    }
    endLine += 1
  }

  return { startLine, endLine }
}


function renumberLocalType(sourceFile: SourceFile, startLine: number,
    endLine: number, edits: EditCollection, symbolType: SymbolType) {
  while (startLine < endLine) {
    const range = getLocalRange(sourceFile, startLine, symbolType)
    renumberRange(sourceFile, range.startLine, range.endLine, symbolType, edits)
    startLine = range.endLine
  }
}


function isLocalStart(statement: Statement, symbolType: SymbolType): boolean {
  const symExp = statement.labelExp
  if (symExp && symExp instanceof SymbolExpression && symExp.symbol) {
    if (symbolType == SymbolType.ZoneLocal) {
      return symExp.symbol.isZoneStart ?? false
    } else if (symbolType == SymbolType.CheapLocal) {
      return symExp.symbolType == SymbolType.Simple
    }
  }
  return false
}


type RenameEntry = {
  symbol: Symbol
  oldName: string
  newName?: string
}


function renumberRange(sourceFile: SourceFile, startLine: number, endLine: number,
    symbolType: SymbolType, edits: EditCollection) {

  const renames: RenameEntry[] = []
  let newIndex = 1
  for (let i = startLine; i < endLine; i += 1) {
    const statement = sourceFile.statements[i]

    // for now, cancel completely when conditionals are involved
    if (!statement.enabled) {
      return
    }

    // cancel completely if a statement has an error
    if (statement.hasError()) {
      return
    }

    if (!statement.labelExp) {
      continue
    }
    if (!(statement.labelExp instanceof SymbolExpression)) {
      continue
    }
    if (statement.labelExp.symbolType != symbolType) {
      continue
    }
    const symbol = statement.labelExp.symbol
    if (!symbol) {
      continue
    }

    const oldName = statement.labelExp.getSimpleName().asString
    const simpleIndex = parseInt(oldName)
    if (simpleIndex != simpleIndex) {   // NaN != NaN
      // look for :SKIPA and :LOOP1 locals, common in old Naja source code
      if (!oldName.startsWith("SKIP") && !oldName.startsWith("LOOP")) {
        continue
      }
    }

    let newName: string | undefined
    if (symbol.references.length > 0) {
      newName = newIndex.toString()
      newIndex += 1
      if (newName == oldName) {
        continue
      }
    }

    renames.push({ symbol, oldName, newName })
  }

  for (let i = 0; i < renames.length; i += 1) {
    const rename = renames[i]
    renameSymbolDefAndRefs(rename.symbol, rename.oldName, rename.newName, edits)
  }
}


function renameSymbolDefAndRefs(symbol: Symbol, oldName: string,
    newName: string | undefined, edits: EditCollection) {
  renameSymExp(symbol.definition, oldName, newName, edits)
  for (let i = 0; i < symbol.references.length; i += 1) {
    renameSymExp(symbol.references[i], oldName, newName, edits)
  }
}


function renameSymExp(symExp: SymbolExpression, oldName: string,
    newName: string | undefined, edits: EditCollection) {

  let editLineNumber = symExp.lineNumber
  let statement = symExp.sourceFile?.statements[editLineNumber]
  if (!statement) {
    return
  }

  const range = symExp.getRange()
  if (range) {
    let editStart = range.start
    let editEnd = range.end
    let editText = ""

    // adjust for line continuations
    while (statement.endOffset && editStart >= statement.endOffset) {
      editLineNumber += 1
      statement = symExp.sourceFile?.statements[editLineNumber]
      if (!statement) {
        return
      }
      if (!(statement instanceof ContinuedStatement)) {
        return
      }
    }
    if (statement.startOffset) {
      editStart -= statement.startOffset
      editEnd -= statement.startOffset
    }

    // replace last instance of newName so rest of scope path is unchanged
    if (newName) {
      editText = symExp.getString()
      const n = editText.lastIndexOf(oldName)
      if (n >= 0) {
        editText = editText.substring(0, n) + newName + editText.substring(n + oldName.length)
      }
    }
    // grow old selection to match new name, while space available
    let oldSize = editEnd - editStart
    while (editText.length > oldSize) {
      if (statement.sourceLine[editStart + oldSize] != " ") {
        break
      }
      oldSize += 1
      editEnd += 1
      // don't consume last available space before next text run
      if (statement.sourceLine[editStart + oldSize] != " ") {
        oldSize -= 1
        editEnd -= 1
        break
      }
    }
    // pad new name to match old size, if not at end of line
    if (editEnd != statement.sourceLine.length) {
      // if symbol was part of an expression, for example, don't pad
      // TODO: This could be made smarter by inserting padding before
      //  any trailing comment so it stays in place.
      if (statement.sourceLine[editEnd] == " ") {
        editText = editText.padEnd(oldSize, " ")
      }
    }
    if (symExp.sourceFile) {
      edits.addEdit(symExp.sourceFile, editLineNumber, editStart, editEnd, editText)
    }
  }
}

//------------------------------------------------------------------------------
