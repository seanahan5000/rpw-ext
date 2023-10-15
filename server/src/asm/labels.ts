
import { SourceFile } from "./project"
import { Symbol, SymbolType } from "./symbols"
import { SymbolExpression } from "./expressions"
import { Statement } from "./statements"

// TODO: maybe move to symbols?

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
  const oldName = symbol.getSimpleNameToken().getString()
  renameSymbolDefAndRefs(symbol, oldName, newName, edits)
  return edits.fileEdits.size ? edits.fileEdits : undefined
}


export function renumberLocals(sourceFile: SourceFile, startLine: number, endLine: number): FileEdits | undefined {
  let edits = new EditCollection()
  renumberLocalType(sourceFile, startLine, endLine, edits, SymbolType.CheapLocal)
  renumberLocalType(sourceFile, startLine, endLine, edits, SymbolType.ZoneLocal)
  return edits.fileEdits.size ? edits.fileEdits : undefined
}


function renumberLocalType(sourceFile: SourceFile, startLine: number,
  endLine: number, edits: EditCollection, symbolType: SymbolType) {

  // scan backwards for zone/cheap start
  let limitLine = startLine
  while (limitLine >= 0) {
    if (isLocalStart(sourceFile.statements[limitLine], symbolType)) {
      break
    }
    limitLine -= 1
  }

  // if no zone/cheap start found, scan forward for one
  if (limitLine < 0) {
    limitLine = startLine
    while (limitLine < endLine) {
      if (isLocalStart(sourceFile.statements[limitLine], symbolType)) {
        break
      }
      limitLine += 1
    }
    if (limitLine >= endLine) {
      return
    }
  }

  startLine = limitLine
  while (startLine < endLine) {
    // scan forward to next zone/cheap or eof
    limitLine = startLine + 1
    while (limitLine < sourceFile.statements.length) {
      if (isLocalStart(sourceFile.statements[limitLine], symbolType)) {
        break
      }
      limitLine += 1
    }
    renumberRange(sourceFile, startLine, limitLine, symbolType, edits)
    startLine = limitLine
  }
}


function isLocalStart(statement: Statement, symbolType: SymbolType): boolean {
  const symExp = statement.labelExp
  if (symExp && symExp.symbol) {
    if (symbolType == SymbolType.ZoneLocal) {
      return symExp.symbol.isZoneStart
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
    if (statement.labelExp.symbolType != symbolType) {
      continue
    }

    const symbol = statement.labelExp.symbol
    if (!symbol) {
      continue
    }

    const oldName = symbol.getSimpleNameToken().getString()
    if (!isSimpleLocal(oldName)) {
      continue
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


// Return true if local is a simple number or if it's of the form
//  :SKIPA and :LOOP1 (common in old Naja source code)
// TODO: remove this feature once all old code has been updated
function isSimpleLocal(nameStr: string): boolean {
  let index = parseInt(nameStr)
  if (index != index) {   // NaN != NaN
    if (nameStr.length != 6) {
      return false
    }
    let root = nameStr.substring(1, 5)
    if (root != "SKIP" && root != "LOOP") {
      return false
    }
  }
  return true
}


function renameSymExp(symExp: SymbolExpression, oldName: string,
    newName: string | undefined, edits: EditCollection) {
  const statement = symExp.sourceFile?.statements[symExp.lineNumber]
  if (!statement) {
    return
  }
  const range = symExp.getRange()
  if (range) {
    let editStart = range.start
    let editEnd = range.end
    let editText = ""
    // replace last instance of newName so rest of scope path is unchanged
    if (newName) {
      editText = symExp.getString()
      const n = editText.lastIndexOf(oldName)
      if (n >= 0) {
        editText = editText.substring(0, n) + newName + editText.substring(n + oldName.length)
      }
    }
    let oldSize = editEnd - editStart
    // grow old selection to match new name, while space available
    while (editText.length > oldSize) {
      if (statement.sourceLine[oldSize] != " ") {
        break
      }
      oldSize += 1
      editEnd += 1
    }
    // pad new name to match old size
    if (symExp.isDefinition) {
      if (statement.children.length > 1) {
        editText = editText.padEnd(oldSize, " ")
      }
    }
    if (symExp.sourceFile) {
      edits.addEdit(symExp.sourceFile, symExp.lineNumber, editStart, editEnd, editText)
    }
  }
}

//------------------------------------------------------------------------------
