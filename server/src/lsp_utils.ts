
import * as lsp from 'vscode-languageserver'
import { LspServer } from "./lsp_server"
import { SourceFile } from "./asm/project"
import { Token, TokenType } from "./asm/tokenizer"
import { Statement, OpStatement, OpMode } from "./asm/statements"
import { Opcodes6502 } from "./asm/opcodes"
import { SyntaxDefs } from "./asm/syntax"
import { SymbolType } from "./asm/symbols"
import { getLocalRange } from "./asm/labels"

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
  addLocals = 0
  addUnclassified = 0

  scan(sourceFile: SourceFile, lineNumber: number, position: number): lsp.CompletionItem[] | undefined {

    let loc: Loc | undefined
    const statement = sourceFile.statements[lineNumber]
    const labelRange = statement.labelExp?.getRange()
    const opRange = statement.opExp?.getRange()
    let checkXY = false
    let checkInd = false
    let appendIndY = false

    // no completions when in comment
    for (let token of statement.children) {
      if (token instanceof Token && token.type == TokenType.Comment) {
        if (position >= token.start) {
          return
        }
      }
    }

    const prevChar = statement.sourceLine[position - 1] ?? ""

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

    let index = 0
    if (loc == Loc.inLabel) {
      // use default completions
      // TODO: addKeywords if syntax supports them in column 0
    } else if (loc == Loc.afterLabel) {
      // new opcode completions
      this.addMacros = ++index
      this.addKeywords = ++index
      this.addOpcodes = ++index
    } else if (loc == Loc.beforeOpcode) {
      // use default completions
    } else if (loc == Loc.inOpcode) {
      // might depend on statement type
      this.addMacros = ++index
      this.addKeywords = ++index
      this.addOpcodes = ++index
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
              this.addCode = ++index
              this.addUnclassified = ++index
            } else {
              this.addZpage = ++index
              this.addData = ++index
              this.addUnclassified = ++index
            }
          }
        } else {
          switch (statement.mode) {
            case OpMode.A:
              // use default completions
              // TODO: how to force none?
              break
            case OpMode.IMM:
              this.addConstants = ++index
              this.addUnclassified = ++index
              // TODO: how to limit these to just #< and #> ?
              this.addData = ++index
              this.addCode = ++index
              break
            case OpMode.ZP:
              this.addZpage = ++index
              this.addUnclassified = ++index
              break
            case OpMode.ABS:
              if (statement.opNameLC == "jsr" || statement.opNameLC == "jmp") {
                // TODO: handle both zone and cheap locals
                if (prevChar == ":") {
                  this.addLocals = ++index
                } else {
                  this.addCode = ++index
                  this.addUnclassified = ++index
                }
              } else {
                this.addZpage = ++index
                this.addData = ++index
                this.addUnclassified = ++index
              }
              break
            case OpMode.ZPX:
            case OpMode.ZPY:
            case OpMode.ABSX:
            case OpMode.ABSY:
              this.addData = ++index
              this.addZpage = ++index
              this.addUnclassified = ++index
              checkXY = true
              break
            case OpMode.IND:
              this.addZpage = ++index
              this.addData = ++index
              this.addUnclassified = ++index
              checkInd = true
              break
            case OpMode.INDX:
            case OpMode.INDY:
              this.addZpage = ++index
              this.addUnclassified = ++index
              checkXY = true
              break
            case OpMode.BRANCH:
              // TODO: constrain to only close-by code
              // TODO: handle both zone and cheap locals
              if (prevChar == ":") {
                this.addLocals = ++index
              } else {
                this.addCode = ++index
                this.addUnclassified = ++index
              }
              break
          }
        }
      } else {
        // TODO: need better auto completes based on keyword
        // TODO: better completes for macros
        this.addConstants = ++index
        this.addZpage = ++index
        this.addData = ++index
        this.addCode = ++index
        this.addUnclassified = ++index
      }
    } else if (loc == Loc.beforeArgs || loc == Loc.afterArgs) {
      // TODO: make this much smarter using expression evaluation state
      this.addConstants = ++index
      this.addZpage = ++index
      this.addData = ++index
      this.addCode = ++index
      this.addUnclassified = ++index
    }

    // if "X" or "Y" at the end of an indirect opcode triggered
    //  a completion, don't return any results
    if (checkXY && position > 1) {
      let p = position
      const prevCharLC = statement.sourceLine[--p].toLowerCase()
      if (prevCharLC == "x" || prevCharLC == "y") {
        while (p > 0) {
          const c = statement.sourceLine[--p]
          if (c == " " || c == "\t") {
            continue
          }
          if (c == ",") {
            return
          }
          break
        }
      }
    } else if (checkInd) {
      if (prevChar == "(") {
        appendIndY = true
      }
    }

    const completions: lsp.CompletionItem[] = []

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

          // Reorder ZPAGE pointer names that end in L(ow) and H(igh),
          //  so that the L name comes first -- better default for (DATAL),Y
          // TODO: tie to Naja-only setting?
          const lastIndex = key.length - 1
          let lastChar = key[lastIndex].toLowerCase()
          if (lastChar == "l") {
            lastChar = "h"
          } else if (lastChar == "h") {
            lastChar = "l"
          }
          const sortKey = key.substring(0, lastIndex) + lastChar + key.substring(lastIndex)

          let keyText = key
          if (appendIndY) {
            keyText = keyText + "),y"
            if (sourceFile.module.project.upperCase) {
              keyText = keyText.toUpperCase()
            }
          }
          item = lsp.CompletionItem.create(keyText)
          item.sortText = `${this.addZpage}_${sortKey}`
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
        item.detail = "details" // TODO: kind? filename?, etc?

        item.data = { filePath: symbol.definition.sourceFile?.fullPath, line: symbol.definition.lineNumber }
        completions.push(item)
      }
    }

    // scan for locals near given statement
    // TODO: do both cheap and zone locals based on trigger character
    if (this.addLocals) {
      const symbolType = SymbolType.CheapLocal
      const range = getLocalRange(sourceFile, lineNumber, symbolType)
      for (let i = range.startLine; i < range.endLine; i += 1) {
        const symExp = sourceFile.statements[i].labelExp
        if (symExp) {
          const symbol = symExp.symbol
          if (symbol && symbol.type == symbolType) {
            const token = symbol.getSimpleNameToken(symExp)
            const localName = token.getString()
            const item = lsp.CompletionItem.create(localName)
            item.sortText = `${this.addLocals}_${localName}`
            item.kind = lsp.CompletionItemKind.Function
            completions.push(item)
          }
        }
      }
    }

    return completions.length ? completions : undefined
  }

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
