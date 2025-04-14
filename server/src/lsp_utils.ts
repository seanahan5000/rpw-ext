
import * as lsp from 'vscode-languageserver'
import { LspServer } from "./lsp_server"
import { SourceFile } from "./asm/project"
import { Token, TokenType } from "./asm/tokenizer"
import { ContinuedStatement, OpStatement } from "./asm/statements"
import { SyntaxDefs } from "./asm/syntaxes/syntax_defs"
import { SymbolType, Symbol } from "./asm/symbols"
import { getLocalRange } from "./asm/labels"
import { Expression, SymbolExpression } from "./asm/expressions"
import { ParamsParser } from "./asm/syntaxes/params"
import { isaSet65xx, OpMode } from "./isa65xx"

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

function inHexToken(expression: Expression, position: number): boolean {
  for (let node of expression.children) {
    if (node instanceof Token) {
      if (position < node.start) {
        return false
      }
      if (position <= node.end) {
        return node.type == TokenType.HexNumber
      }
    } else if (node instanceof Expression) {
      if (inHexToken(node, position)) {
        return true
      }
    }
  }
  return false
}

export class Completions {

  addOpcodes = 0
  addKeywords = 0
  addKeyConstants = 0
  addMacros = 0
  addConstants = 0
  addZpage = 0
  addCode = 0
  addData = 0
  addLocals = 0
  addUnclassified = 0

  scan(sourceFile: SourceFile, lineNumber: number, curPosition: number): lsp.CompletionItem[] | undefined {

    let loc: Loc | undefined
    const curStatement = sourceFile.statements[lineNumber]
    const firstStatement = (curStatement instanceof ContinuedStatement) ? curStatement.firstStatement : curStatement
    const labelRange = firstStatement.labelExp?.getRange()
    const opRange = firstStatement.opExp?.getRange()
    let checkXY = false
    let checkInd = false
    let appendIndY = false
    let leadingSymbol = ""

    const firstPosition = curPosition + (curStatement.startOffset ?? 0)
    const syntaxDef = SyntaxDefs[sourceFile.project.syntax]

    // no completions when in comment (top-level token)
    for (let token of firstStatement.children) {
      if (token instanceof Token && token.type == TokenType.Comment) {
        if (firstPosition >= token.start) {
          return
        }
      }
    }

    // when inside a hex value, don't suggest completions
    //  ("$C" should not suggest "COUNT", for example)
    const inHex = inHexToken(firstStatement, firstPosition)

    const prevChar = firstStatement.sourceLine[firstPosition - 1] ?? ""

    if (firstStatement.opExp && opRange) {
      if (firstStatement.labelExp && labelRange) {
        if (firstPosition >= labelRange.start && firstPosition <= labelRange.end) {
          loc = Loc.inLabel
        }
      }
      if (loc == undefined) {
        if (firstPosition < opRange.start) {
          loc = Loc.beforeOpcode
        } else if (firstPosition <= opRange.end) {
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
    } else if (firstStatement.labelExp && labelRange) {
      if (firstPosition >= labelRange.start && firstPosition <= labelRange.end) {
        loc = Loc.inLabel
      } else {
        loc = Loc.afterLabel
      }
    } else if (firstPosition == 0) {
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
      const firstChar = opRange ? opRange.sourceLine[opRange.start] : ""
      if (syntaxDef.keywordPrefixes.includes(firstChar)) {
        // TODO: what if prefix is also used for symbol? (dasm)
        this.addKeywords = ++index
        leadingSymbol = firstChar
      } else if (syntaxDef.macroInvokePrefixes.includes(firstChar)) {
        this.addMacros = ++index
        leadingSymbol = firstChar
      } else {
        // might depend on statement type
        this.addMacros = ++index
        this.addKeywords = ++index
        this.addOpcodes = ++index
      }
    } else if ((loc == Loc.afterOpcode || loc == Loc.inArgs) && !inHex) {
      // initial args completions
      if (firstStatement instanceof OpStatement) {
        if (firstStatement.mode == OpMode.NONE) {
          if (firstStatement.opcode.get(OpMode.NONE)) {
            // use default completions
            // TODO: how to force none?
          } else {
            // NOTE: nothing has been typed yet to assign a mode,
            //  so everything is possible at this point
            if (firstStatement.opNameLC == "jsr" || firstStatement.opNameLC == "jmp") {
              this.addCode = ++index
              this.addUnclassified = ++index
            } else {
              this.addZpage = ++index
              this.addData = ++index
              this.addUnclassified = ++index
            }
          }
        } else {
          switch (firstStatement.mode) {
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
            case OpMode.LABS:
                if (firstStatement.opNameLC == "jsr" || firstStatement.opNameLC == "jmp") {
                // *** TODO: handle both zone and cheap locals
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
            case OpMode.LABX:
              this.addData = ++index
              this.addZpage = ++index
              this.addUnclassified = ++index
              checkXY = true
              break
            case OpMode.AXI:
              checkXY = true
              // fall through
            case OpMode.IND:
            case OpMode.ALI:
              this.addZpage = ++index
              this.addData = ++index
              this.addUnclassified = ++index
              checkInd = true
              break
            case OpMode.INDX:
            case OpMode.INDY:
            case OpMode.LIY:
              this.addZpage = ++index
              this.addUnclassified = ++index
              checkXY = true
              break
            case OpMode.INZ:
            case OpMode.LIN:
              this.addZpage = ++index
              this.addUnclassified = ++index
              break
            case OpMode.REL:
            case OpMode.LREL:
              // TODO: constrain to only close-by code
              // *** TODO: handle both zone and cheap locals
              if (prevChar == ":") {
                this.addLocals = ++index
              } else {
                this.addCode = ++index
                this.addUnclassified = ++index
              }
              break

            // TODO: smart completions for these modes
              // STS, // stack,S
              // SIY, // (stack,S),Y
              // SD,  // #$FF,#$FF
              // STR, // stack,R
              // RIY, // (stack,R),Y
          }
        }
      } else {
        if (!inHex) {
          // TODO: need better auto completes based on keyword
          // TODO: better completes for macros
          this.addKeyConstants = ++index
          this.addConstants = ++index
          this.addZpage = ++index
          this.addData = ++index
          this.addCode = ++index
          this.addUnclassified = ++index
        }
      }
    } else if (loc == Loc.beforeArgs || loc == Loc.afterArgs) {
      if (!inHex) {
        // TODO: make this much smarter using expression evaluation state
        this.addConstants = ++index
        this.addZpage = ++index
        this.addData = ++index
        this.addCode = ++index
        this.addUnclassified = ++index
      }
    // } else if (loc == Loc.afterOpcode || loc == Loc.inArgs) {
    //   // ***
    }

    // if "X" or "Y" at the end of an indirect opcode triggered
    //  a completion, don't return any results
    if (checkXY && firstPosition > 1) {
      let p = firstPosition
      const prevCharLC = firstStatement.sourceLine[--p].toLowerCase()
      if (prevCharLC == "x" || prevCharLC == "y") {
        while (p > 0) {
          const c = firstStatement.sourceLine[--p]
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

      // TODO: how should this be chosen? get from statement?
      const isa = isaSet65xx.getIsa("65816")

      isa.opcodeByName.forEach((value, key) => {
        if (sourceFile.project.upperCase) {
          key = key.toUpperCase()
        }
        // only add trailing space for opcodes that have addressing modes
        if (!value.get(OpMode.NONE)) {
          key = key.padEnd(4, " ")
        }
        let item = lsp.CompletionItem.create(key)
        item.sortText = `${this.addOpcodes}_${key}`
        item.kind = lsp.CompletionItemKind.Text
        completions.push(item)
      })
    }

    if (this.addKeywords) {
      const syntax = sourceFile.project.syntax
      if (syntax) {
        for (let [key, keywordDef] of syntaxDef.keywordMap) {
          if (sourceFile.project.upperCase) {
            key = key.toUpperCase()
          }

          // don't include keywords that don't start with the leading symbol
          if (leadingSymbol != "" && !key.startsWith(leadingSymbol)) {
            continue
          }

          const params = keywordDef.params ?? ""
          const desc = keywordDef.desc ?? ""

          // only pad keywords that have arguments
          if (params != "") {
            // TODO: use settings instead of 4
            key = key.padEnd(3 - leadingSymbol.length, " ")
            key += " "
          }
          let item = lsp.CompletionItem.create(key)
          item.sortText = `${this.addKeywords}_${key}`
          item.kind = lsp.CompletionItemKind.Text

          // add keyword documentation
          // TODO: better formatting (markdown?)
          if (params != "") {
            // TODO: sanitize parameter string to human-readable
            item.detail = params
          }
          if (desc != "") {
            item.documentation = desc
          }

          // *** TODO: tie this to syntax, check for "!", and/or "+"
          if (leadingSymbol == key[0]) {
            item.insertText = key.substring(1)
          }
          completions.push(item)
        }
      }
    }

    if (this.addConstants || this.addZpage || this.addData || this.addCode
        || this.addMacros || this.addUnclassified) {

      const symbolMap = sourceFile.getSymbolMap()
      for (const [key, symbol] of symbolMap) {

        if (symbol.type == SymbolType.TypeName) {
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
            if (sourceFile.project.upperCase) {
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
            const indent = "".padStart(sourceFile.project.tabStops[1], " ")
            item = lsp.CompletionItem.create(key)
            item.sortText = `${this.addCode}_${key}`
            item.insertTextFormat = lsp.InsertTextFormat.Snippet
            item.insertTextMode = lsp.InsertTextMode.asIs
            item.kind = lsp.CompletionItemKind.Snippet
            item.insertText = "DRAW_PICT\n" + indent + "$0\n" + indent + "PictEnd"
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
        if (symExp && symExp instanceof SymbolExpression) {
          const symbol = symExp.symbol
          if (symbol && symbol.type == symbolType) {
            const localName = symExp.getSimpleName().asString
            const item = lsp.CompletionItem.create(localName)
            item.sortText = `${this.addLocals}_${localName}`
            item.kind = lsp.CompletionItemKind.Function
            completions.push(item)
          }
        }
      }
    }

    if (this.addKeyConstants) {
      if (firstStatement.keywordDef?.paramsList) {
        const constNames = ParamsParser.getConstantNames(firstStatement.keywordDef.paramsList, syntaxDef.paramDefMap)
        for (let name of constNames) {
          const item = lsp.CompletionItem.create(name)
          item.sortText = `${this.addKeyConstants}_${name}`
          item.kind = lsp.CompletionItemKind.Constant
          completions.push(item)
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
          let header = getCommentHeader(sourceFile, item.data.line)
          if (header) {
            header = "```\n" + header + "```"
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
    let header = ""
    for (let i = startLine; i < atLine; i += 1) {
      const statement = atFile.statements[i]
      header += statement.sourceLine + "  \n"
    }
    return header
  }
}

//------------------------------------------------------------------------------
