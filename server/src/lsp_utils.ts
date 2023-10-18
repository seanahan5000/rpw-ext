
import * as lsp from 'vscode-languageserver'
import { LspServer } from "./lsp_server"
import { SourceFile } from "./asm/project"
import { Token, TokenType } from "./asm/tokenizer"
import { Statement, OpStatement, OpMode } from "./asm/statements"
import { Opcodes6502 } from "./asm/opcodes"
import { SyntaxDefs } from "./asm/syntax"
import { SymbolType } from "./asm/symbols"

//------------------------------------------------------------------------------

// ^ ^
// inLabel
// afterLabel

// LABEL ^
// ^----^
// inLabel
// afterLabel

// ^^OPCODE ^
//   ^-----^
// inLabel
// beforeOpcode
// inOpcode
// afterOpcode

// LABEL ^OPCODE ^
// ^----^ ^-----^
// inLabel
// beforeOpcode
// inOpcode
// afterOpcode

// LABEL ^OPCODE ^ARGS ^
// ^----^ ^-----^ ^---^
// inLabel
// beforeOpcode
// inOpcode
// beforeArgs
// inArgs
// afterArgs

enum Loc {
  inLabel      = 0,
  afterLabel   = 1,
  beforeOpcode = 2,
  inOpcode     = 3,
  afterOpcode  = 4,
  beforeArgs   = 5,
  inArgs       = 6,
  afterArgs    = 7,
}

export class Completions {

  addOpcodes = 0
  addKeywords = 0
  addMacros = 0
  addConstants = 0
  addZpage = 0
  addCode = 0
  addData = 0
  addUnclassified = 0

  // *** return CompletionList instead? ***
  scan(sourceFile: SourceFile, statement: Statement, position: number): lsp.CompletionItem[] | undefined {

    let loc: Loc | undefined
    const labelRange = statement. labelExp?.getRange()
    const opRange = statement.opExp?.getRange()

    if (statement.opExp && opRange) {
      if (statement.labelExp && labelRange) {
        if (position >= labelRange.start && position <= labelRange.end) {
          loc = Loc.inLabel
        }
      }
      if (loc == undefined) {
        if (position < opRange.start) {
          loc = Loc.beforeOpcode
        } else if (position <= opRange.end) {
          loc = Loc.inOpcode
        }
      }
      if (loc == undefined) {
        // TODO: check for args
        //  loc = Loc.beforeArgs
        //  loc = Loc.inArgs
        //  loc = Loc.afterArgs
        loc = Loc.afterOpcode
      }
    } else if (statement.labelExp && labelRange) {
      if (position >= labelRange.start && position <= labelRange.end) {
        loc = Loc.inLabel
      } else {
        loc = Loc.afterLabel
      }
    } else if (position == 0) {
      loc = Loc.inLabel
    } else {
      loc = Loc.afterLabel
    }

    if (loc == Loc.inLabel) {
      // use default completions
      // TODO: addKeywords if syntax supports them in column 0
    } else if (loc == Loc.afterLabel) {
      // new opcode completions
      this.addMacros = 1
      this.addKeywords = 2
      this.addOpcodes = 3
    } else if (loc == Loc.beforeOpcode) {
      // use default completions
    } else if (loc == Loc.inOpcode) {
      // might depend on statement type
      this.addMacros = 1
      this.addKeywords = 2
      this.addOpcodes = 3
    } else if (loc == Loc.afterOpcode || loc == Loc.inArgs) {
      // initial args completions
      if (statement instanceof OpStatement) {
        if (statement.mode == OpMode.NONE) {
          if (statement.opcode.NONE) {
            // use default completions
            // TODO: how to force none?
          } else {
            // NOTE: nothing has been typed yet to assign a mode,
            //  so everything is possible at this point
            if (statement.opNameLC == "jsr" || statement.opNameLC == "jmp") {
              this.addCode = 1
              this.addUnclassified = 2
            } else {
              this.addZpage = 1
              this.addData = 2
              this.addUnclassified = 3
            }
          }
        } else {
          switch (statement.mode) {
            case OpMode.A:
              // use default completions
              // TODO: how to force none?
              break
            case OpMode.IMM:
              this.addConstants = 1
              this.addUnclassified = 2
              // TODO: how to limit these to just #< and #> ?
              this.addData = 3
              this.addCode = 4
              break
            case OpMode.ZP:
              this.addZpage = 1
              this.addUnclassified = 3
              break
            case OpMode.ABS:
              if (statement.opNameLC == "jsr" || statement.opNameLC == "jmp") {
                this.addCode = 1
                this.addUnclassified = 2
              } else {
                this.addZpage = 1
                this.addData = 2
                this.addUnclassified = 3
              }
              break
            case OpMode.ZPX:
            case OpMode.ZPY:
            case OpMode.ABSX:
            case OpMode.ABSY:
              this.addData = 1
              this.addZpage = 2
              this.addUnclassified = 3
              break
            case OpMode.IND:
              this.addZpage = 1
              this.addData = 2
              this.addUnclassified = 3
              break
            case OpMode.INDX:
            case OpMode.INDY:
              this.addZpage = 1
              this.addUnclassified = 2
              break
            case OpMode.BRANCH:
              // TODO: constrain to only close-by code
              // TODO: could also include in zone locals
              this.addCode = 1
              this.addUnclassified = 2
              break
          }
        }
      } else {
        // TODO: need better auto completes based on keyword
        // TODO: better completes for macros
        this.addConstants = 1
        this.addZpage = 2
        this.addData = 3
        this.addCode = 4
        this.addUnclassified = 5
      }
    } else if (loc == Loc.beforeArgs || loc == Loc.afterArgs) {
      // TODO: make this much smarter using expression evaluation state
      this.addConstants = 1
      this.addZpage = 2
      this.addData = 3
      this.addCode = 4
      this.addUnclassified = 5
    }

    const completions: lsp.CompletionItem[] = []
    const isIncomplete = false

    if (this.addOpcodes) {
      for (let key in Opcodes6502) {
        let opcode = (Opcodes6502 as {[key: string]: any})[key]
          if (sourceFile.module.project.upperCase) {
            key = key.toUpperCase()
          }
          // only add trailing space for opcodes that have addressing modes
          if (!opcode.NONE) {
            key = key.padEnd(4, " ")
          }
          let item = lsp.CompletionItem.create(key)
          item.sortText = `${this.addOpcodes}_${key}`
          item.kind = lsp.CompletionItemKind.Text
          completions.push(item)
      }
    }

    if (this.addKeywords) {
      const syntax = sourceFile.module.project.syntax
      if (syntax) {
        for (let [key] of SyntaxDefs[syntax].keywordMap) {
          if (sourceFile.module.project.upperCase) {
            key = key.toUpperCase()
          }
          // TODO: only pad keywords that have arguements
          key = key.padEnd(4, " ")
          let item = lsp.CompletionItem.create(key)
          item.sortText = `${this.addKeywords}_${key}`
          item.kind = lsp.CompletionItemKind.Text
          completions.push(item)
        }
      }
    }

    if (this.addConstants || this.addZpage || this.addData || this.addCode
        || this.addMacros || this.addUnclassified) {
      for (const [key, symbol] of sourceFile.module.symbolMap) {

        if (symbol.type == SymbolType.Macro) {
          if (this.addMacros) {
            // TODO: add leading "+" for ACME syntax? trigger character?
            const item = lsp.CompletionItem.create(key)
            item.sortText = `${this.addMacros}_${key}`
            item.kind = lsp.CompletionItemKind.Function
            item.data = { filePath: symbol.definition.sourceFile?.fullPath, line: symbol.definition.lineNumber }
            completions.push(item)
          }
          continue
        }

        if (symbol.type != SymbolType.Simple) {
          continue
        }

        let item: lsp.CompletionItem
        if (symbol.isConstant) {
          if (!this.addConstants) {
            continue
          }
          item = lsp.CompletionItem.create(key)
          item.sortText = `${this.addConstants}_${key}`
          item.kind = lsp.CompletionItemKind.Constant
        } else if (symbol.isZPage) {
          if (!this.addZpage) {
            continue
          }
          item = lsp.CompletionItem.create(key)
          item.sortText = `${this.addZpage}_${key}`
          item.kind = lsp.CompletionItemKind.Variable
        } else if (symbol.isData) {
          if (!this.addData) {
            continue
          }
          item = lsp.CompletionItem.create(key)
          item.sortText = `${this.addData}_${key}`
          item.kind = lsp.CompletionItemKind.Variable   //*** what kind?
        } else if (symbol.isSubroutine || symbol.isCode) {
          if (!this.addCode) {
            continue
          }
          // hack snippet for Naja graphics system
          if (key == "DRAW_PICT") {
            item = lsp.CompletionItem.create(key)
            item.sortText = `${this.addCode}_${key}`
            item.insertTextFormat = lsp.InsertTextFormat.Snippet
            item.kind = lsp.CompletionItemKind.Snippet
            item.insertText = "DRAW_PICT\n$1\nPictEnd"
          } else {
            item = lsp.CompletionItem.create(key)
            item.sortText = `${this.addCode}_${key}`
            item.kind = lsp.CompletionItemKind.Function
          }
        } else {
          // all other unknown symbol types
          if (!this.addUnclassified) {
            continue
          }
          item = lsp.CompletionItem.create(key)
          item.sortText = `${this.addUnclassified}_${key}`
          item.kind = lsp.CompletionItemKind.Text   // *** what kind?
        }

        // *** item.detail = "detail text"
        // *** item.labelDetails = { detail: " label det", description: "label det desc" }

        // *** consider adding source file name where found, in details ***

        item.data = { filePath: symbol.definition.sourceFile?.fullPath, line: symbol.definition.lineNumber }
        completions.push(item)
      }
    }

    // *** return empty or undefined? ***
    return completions
  }

  // *** resolve completion item ***
  static resolve(server: LspServer, item: lsp.CompletionItem): lsp.CompletionItem {
    if (item.data && item.data.filePath) {
      const sourceFile = server.findSourceFile(item.data.filePath)
      if (sourceFile) {
        if (item.kind == lsp.CompletionItemKind.Function) {
          const header = getCommentHeader(sourceFile, item.data.line)
          if (header) {
            item.documentation = { kind: "markdown", value: header }
          }
        } else {
          // *** something for constants and vars ***
        }
      }
    }
    return item
  }
}

//------------------------------------------------------------------------------

// TODO: move some of this into sourceFile?
export function getCommentHeader(atFile: SourceFile, atLine: number): string | undefined {

  // scan up from hover line looking for comment blocks
  let startLine = atLine
  while (startLine > 0) {
    startLine -= 1
    const token = atFile.statements[startLine].children[0]

    // include empty statements
    if (token == undefined) {
      continue
    }

    // stop when first non-comment statement found
    if (!(token instanceof Token) || token.type != TokenType.Comment) {
      startLine += 1
      break
    }
  }

  while (startLine < atLine) {
    const sourceLine = atFile.statements[startLine].sourceLine;
    if (sourceLine != ";" && sourceLine != "" && !sourceLine.startsWith(";-")) {
      break;
    }
    startLine += 1;
  }

  while (atLine > startLine) {
    const sourceLine = atFile.statements[atLine - 1].sourceLine;
    if (sourceLine != ";" && sourceLine != "" && !sourceLine.startsWith(";-")) {
      break;
    }
    atLine -= 1;
  }

  if (startLine != atLine) {
    let header = "```  \n"
    for (let i = startLine; i < atLine; i += 1) {
      const statement = atFile.statements[i]
      header += statement.sourceLine + "  \n"
    }
    header += "```"
    return header
  }
}

//------------------------------------------------------------------------------
