
import * as exp from "./expressions"
import { Parser } from "./parser"
import { Assembler, NestingType } from "./assembler"
import { Preprocessor, SymbolUtils } from "./preprocessor"
import { SymbolType, SymbolFrom } from "./symbols"
import { Syntax, Op } from "./syntaxes/syntax_types"
import { Node, Token, TokenType } from "./tokenizer"
import { Isa6502 } from "../isa6502"
import { KeywordDef } from "./syntaxes/syntax_types"

//==============================================================================
//#region Statement
//==============================================================================

export abstract class Statement extends exp.Expression {

  public sourceLine: string = ""
  public startOffset?: number
  public endOffset?: number
  public labelExp?: exp.SymbolExpression
  public opExp?: exp.Expression         // FIXME: easy to confuse with opExpression
  public args: exp.Expression[] = []
  public opNameLC = ""
  public keywordDef?: KeywordDef
  public enabled = true               // false for inactive conditional clauses
  public PC?: number

  // link between conditional statement groups, used to build code folding ranges
  public foldEnd?: Statement

  init(sourceLine: string, children: Node[],
      labelExp?: exp.SymbolExpression,
      opExp?: exp.Expression,
      keywordDef?: KeywordDef) {
    this.children = children
    this.sourceLine = sourceLine
    this.labelExp = labelExp
    this.opExp = opExp
    this.keywordDef = keywordDef
    // TODO: consider trimming off/separating prefix operator ("+", "!", ".")
    this.opNameLC = this.opExp?.getString().toLowerCase() ?? ""
  }

  public findArg(name: string): exp.Expression | undefined {
    for (let arg of this.args) {
      if (arg.name == name) {
        return arg
      }
    }
  }

  public hasTrailingOpenBrace(): boolean {
    // TODO: make this ACME-only?
    if (this.children.length) {
      return this.children[this.children.length - 1].getString() == "{"
    } else {
      return false
    }
  }

  // parse the statement line but don't change any external state
  parse(parser: Parser) {

    if (this.keywordDef?.paramsList) {

      if (this.keywordDef.label !== undefined) {
        if (this.keywordDef.label == "") {
          if (this.labelExp) {
            this.labelExp.setError("Label not allowed here")
          }
        } else if (this.keywordDef.label[0] == "<") {
          if (!this.labelExp) {
            parser.insertMissingLabel()
          }
        }
      }

      parser.paramsParser.parseExpressions(this.keywordDef.paramsList, parser)

      this.args = []
      for (let node of this.children) {
        if (node == this.labelExp || node == this.opExp) {
          continue
        }
        if (node instanceof exp.Expression) {
          this.args.push(node)
        }
      }
    }

    // TODO: does this default implementation still make sense?
    // TODO: just eat expressions? do nothing instead?
    // let token = parser.getNextToken()
    // while (token) {
    //   const expression = parser.parseExpression(token)
    //   if (!expression) {
    //     break
    //   }
    //   this.children.push(expression)

    //   const res = parser.mustAddToken(["", ","])
    //   if (res.index <= 0) {
    //     break
    //   }
    //   token = parser.getNextToken()
    // }
  }

  postParse(parser: Parser) {
  }

  // do any conditional preprocessing work but only change state if enabled is true
  preprocess(prep: Preprocessor, enabled: boolean) {
  }

  postProcessSymbols(symUtils: SymbolUtils) {
  }

  // TODO: should any statement need resolve() or getSize()?

  // only called if enabled
  // return size in bytes
  // *** same as getSize ***
  pass1(asm: Assembler): number | undefined {
    // *** layout of instructions, pc tracking
      // *** think about how this will work with nesting
    return
  }

  // only called if enabled
  pass2(asm: Assembler, dataBytes: number[]) {
    // *** generation of bytes
  }

  findExpressionAt(ch: number): { expression: exp.Expression, token: Token } | undefined {
    return super.findExpressionAt(ch + (this.startOffset ?? 0))
  }
}


export class GenericStatement extends Statement {
}


export class ContinuedStatement extends Statement {

  public firstStatement: Statement

  constructor(firstStatement: Statement, start: number, end: number) {
    super()
    this.firstStatement = firstStatement
    this.startOffset = start
    this.endOffset = end
    this.children = firstStatement.children
  }
}

//#endregion
//==============================================================================
//#region Opcodes
//==============================================================================

export enum OpMode {
  NONE,
  A,
  IMM,
  ZP,
  ZPX,
  ZPY,
  ABS,
  ABSX,
  ABSY,
  IND,
  INDX,
  INDY,
  REL
}


export enum OpCpu {
  M6502  = 0,
  M65C02 = 1,
  M65816 = 2
}

export class OpStatement extends Statement {

  public opcode: any
  public opSuffix: string
  public cpu: OpCpu
  private forceLong: boolean
  public mode: OpMode = OpMode.NONE
  private opByte?: number
  private expression?: exp.Expression

  constructor(opcode: any, opSuffix: string, cpu: OpCpu, forceLong: boolean) {
    super()
    this.opcode = opcode
    this.opSuffix = opSuffix
    this.cpu = cpu
    this.forceLong = forceLong
  }

  parse(parser: Parser) {
    let token: Token | undefined

    if (this.opcode.NONE === undefined) {
      token = parser.mustGetNextToken("expecting opcode expression")
    } else {
      token = parser.getNextToken()
    }

    if (!parser.syntax || parser.syntax == Syntax.DASM) {
      // TODO: use this.opSuffix to help choose mode
    }

    // NOTE: Guess at and set this.mode early so it's available
    //  while generating code completion options.

    let str = token?.getString().toLowerCase() ?? ""
    if (str == "") {
      if (this.opcode.NONE === undefined) {
        this.opExp?.setError("Mode not allowed for this opcode")
      }
      // TODO: check for INC/DEC and promote opcode to 65C02
      this.mode = OpMode.NONE
      this.opByte = this.opcode.NONE
    } else if (token) {
      if (str == "a") {
        parser.addToken(token)
        // TODO: check for INC/DEC and promote opcode to 65C02
        if (this.opcode.A === undefined) {
          token.setError("Accumulator mode not allowed for this opcode")
        } else if (parser.syntax == Syntax.ACME || parser.syntax == Syntax.DASM) {
          token.setError("Accumulator mode not allowed for this syntax")
        }
        token.type = TokenType.Opcode
        this.mode = OpMode.A
        this.opByte = this.opcode.A
      } else if (str == "#") {
        parser.addToken(token)
        if (this.opcode.IMM === undefined) {
          this.opExp?.setError("Opcode does not support this addressing mode")
        }
        token.type = TokenType.Opcode
        this.mode = OpMode.IMM
        this.opByte = this.opcode.IMM
        this.expression = parser.mustAddNextExpression()
      } else if (str == "/") {			// same as "#>"
        parser.addToken(token)
        if (this.opcode.IMM === undefined) {
          this.opExp?.setError("Opcode does not support this addressing mode")
        } else if (parser.syntax && parser.syntax != Syntax.LISA) {
          // *** don't bother with this message ***
          token.setError("Syntax specific to LISA assembler")
          // TODO: would be clearer to extend warning to entire expression
        }
        this.mode = OpMode.IMM
        this.opByte = this.opcode.IMM
        // *** this loses the implied ">" operation
        this.expression = parser.mustAddNextExpression()
      } else if ((str == "(" && !parser.requireBrackets)
          || (str == "[" && (parser.allowBrackets || parser.requireBrackets))) {
        const closingChar = str == "(" ? ")" : "]"
        parser.addToken(token)
        // *** check opcode has this address mode ***
        token.type = TokenType.Opcode
        this.mode = OpMode.IND
        this.opByte = this.opcode.IND
        this.expression = parser.mustAddNextExpression()

        let res = parser.mustAddToken([",", closingChar], TokenType.Opcode)
        if (res.index == 0) {               // (exp,X)
          this.mode = OpMode.INDX
          this.opByte = this.opcode.INDX
          const c = parser.peekVeryNextChar()
          res = parser.mustAddToken("x", TokenType.Opcode)
          if (res.index == 0 && res.token) {
            if (this.opcode.INDX === undefined) {
              this.opExp?.setError("Opcode does not support this addressing mode")
            } else {
              if (parser.syntax == Syntax.DASM) {
                if (c == " " || c == "\t") {
                  res.token.setError("DASM doesn't allow space between ',' and X register")
                }
              }
            }
            token.type = TokenType.Opcode
          }
          parser.mustAddToken(closingChar, TokenType.Opcode)
          return
        }
        if (res.index == 1) {        // (exp) or (exp),Y
          this.mode = OpMode.INDY
          this.opByte = this.opcode.INDY
          let nextToken = parser.addNextToken()
          if (!nextToken) {
            this.mode = OpMode.IND
            this.opByte = this.opcode.IND
            if (this.opcode.IND === undefined) {
              this.opExp?.setError("Opcode does not support this addressing mode")
            }
          } else {
            token = nextToken
            str = token.getString()
            if (str == ",") {
              token.type = TokenType.Opcode
              const c = parser.peekVeryNextChar()
              res = parser.mustAddToken("y", TokenType.Opcode)
              if (res.index == 0 && res.token) {
                if (this.opcode.INDY === undefined) {
                  this.opExp?.setError("Opcode does not support this addressing mode")
                } else {
                  if (parser.syntax == Syntax.DASM) {
                    if (c == " " || c == "\t") {
                      res.token.setError("DASM doesn't allow space between ',' and Y register")
                    }
                  }
                }
              }
            } else {
              // *** should maybe undo this push ***
              token.setError("Unexpected token")
            }
          }
        } else {
          return
        }
      } else {

        // handle special case branch/jump labels
        // *** TODO: this should all be folded into expression parsing

        if (this.opcode.REL || (this.opcode.ABS &&
            (this.opNameLC == "jmp" || this.opNameLC == "jsr"))) {

          // *** move to parser ***
          // *** these are valid outside of branch/jump opcodes ***

          if (this.opcode.REL) {
            this.mode = OpMode.REL            // exp
            this.opByte = this.opcode.REL
          } else {
            this.mode = OpMode.ABS            // exp
            this.opByte = this.opcode.ABS
          }

          const isDefinition = false
          if (str == ">" || str == "<") {
            if (!parser.syntax || parser.syntax == Syntax.LISA) {
              this.expression = parser.parseLisaLocal(token, isDefinition)
              parser.addExpression(this.expression)
              return
            }
          } else if (str[0] == ":" && parser.syntax == Syntax.CA65) {
            this.expression = parser.parseCA65Local(token, isDefinition)
            parser.addExpression(this.expression)
            return
          } else if (parser.syntaxDef.anonLocalChars && parser.syntaxDef.anonLocalChars.includes(str[0])) {
            if (str[0] == str[str.length - 1]) {
              // TODO: This only handles "-", not "+" because it would otherwise
              //  be parsed as a unary operator.  See Parser.parseValueExpression
              //  for the code that should be handling this.
              if (str.length > 9) {
                token.setError("Anonymous local is too long")
                parser.addExpression(new exp.BadExpression([token]))
                return
              }
              token.type = TokenType.Label
              this.expression = parser.newSymbolExpression([token], SymbolType.AnonLocal, isDefinition)
              parser.addExpression(this.expression)
              return
            }
          }
        }

        this.expression = parser.mustAddNextExpression(token)

        token = parser.addNextToken()
        if (!token) {
          if (this.opcode.REL) {
            this.mode = OpMode.REL            // exp
            this.opByte = this.opcode.REL
          } else if (this.opNameLC == "brk") {
            this.mode = OpMode.IMM            // exp
            this.opByte = this.opcode.IMM
          } else {
            this.mode = OpMode.ABS            // exp
            this.opByte = this.opcode.ABS
          }
        } else {
          if (token.getString() == ",") {   // exp,X or exp,Y
            token.type = TokenType.Opcode
            const c = parser.peekVeryNextChar()
            token = parser.mustAddNextToken("expecting 'X' or 'Y'")
            if (token.type != TokenType.Missing) {
              str = token.getString().toLowerCase()
              if (str == "x") {             // exp,X
                this.mode = OpMode.ABSX
                this.opByte = this.opcode.ABSX
                token.type = TokenType.Opcode
              } else if (str == "y") {      // exp,Y
                this.mode = OpMode.ABSY
                this.opByte = this.opcode.ABSY
                token.type = TokenType.Opcode
              } else if (str != "") {
                token.setError("Unexpected token, expecting 'X' or 'Y'")
                return
              }
              if (parser.syntax == Syntax.DASM) {
                if (c == " " || c == "\t") {
                  token.setError("DASM doesn't allow space between ',' and X or Y register")
                }
              }
            }
          } else {
            token.setError("Unexpected token, expecting ','")
          }
        }
      }
    }
  }

  // TODO: what is the TypeScript magic to avoid this?
  private checkMode(mode: OpMode): boolean {
    switch (mode) {
      case OpMode.NONE:
        return this.opcode.NONE !== undefined
      case OpMode.A:
        return this.opcode.A !== undefined
      case OpMode.IMM:
        return this.opcode.IMM !== undefined
      case OpMode.ZP:
        return this.opcode.ZP !== undefined
      case OpMode.ZPX:
        return this.opcode.ZPX !== undefined
      case OpMode.ZPY:
        return this.opcode.ZPY !== undefined
      case OpMode.ABS:
        return this.opcode.ABS !== undefined
      case OpMode.ABSX:
        return this.opcode.ABSX !== undefined
      case OpMode.ABSY:
        return this.opcode.ABSY !== undefined
      case OpMode.IND:
        return this.opcode.IND !== undefined
      case OpMode.INDX:
        return this.opcode.INDX !== undefined
      case OpMode.INDY:
        return this.opcode.INDY !== undefined
      case OpMode.REL:
        return this.opcode.REL !== undefined
    }
    return false
  }

  // called after symbols have been processed
  //  TODO: make this part of assemble phases
  postProcessSymbols(symUtils: SymbolUtils) {
    if (this.expression) {
      switch (this.mode) {
        case OpMode.NONE:
        case OpMode.A:
          // mode already checked
          break
        case OpMode.IMM:
          // mode already checked
          symUtils.markConstants(this.expression)
          const immValue = this.expression.resolve()
          if (immValue === undefined) {
            if (this.expression instanceof exp.StringExpression) {
              this.expression.setError("String expression not valid here")
            }
          } else {
            if (immValue > 255) {
              this.expression.setWarning(`Immediate value ${immValue} will be truncated`)
            }
          }
          break
        case OpMode.ZP:
        case OpMode.ZPX:
        case OpMode.ZPY:
          // will never be ZPAGE at this point
          break
        case OpMode.ABS:
          if (this.opNameLC == "jmp") {
            symUtils.markCode(this.expression)
            break
          }
          if (this.opNameLC == "jsr") {
            symUtils.markSubroutine(this.expression)
            break
          }
          // fall through
        case OpMode.ABSX:
        case OpMode.ABSY:
          const size = this.expression.getSize() ?? 0
          if (size == 1 && !this.forceLong) {
            let newMode: OpMode
            let newOpByte: number
            if (this.mode == OpMode.ABS) {
              newMode = OpMode.ZP
              newOpByte = this.opcode.ZP
            } else if (this.mode == OpMode.ABSX) {
              newMode = OpMode.ZPX
              newOpByte = this.opcode.ZPX
            } else {
              newMode = OpMode.ZPY
              newOpByte = this.opcode.ZPY
            }
            if (this.checkMode(newMode)) {
              this.mode = newMode
              this.opByte = newOpByte
              symUtils.markZPage(this.expression)
            } else {
              // TODO: warn that ABS mode will be used instead of ZP?
              this.opExp?.setWarning("ZP address forced to ABS")
            }
          } else {
            symUtils.markData(this.expression)
          }
          if (!this.checkMode(this.mode)) {
            // TODO: put this on an args expression instead
            this.opExp?.setError("Opcode does not support this addressing mode")
          }
          break
        case OpMode.IND:
          // mode already checked
          break
        case OpMode.INDX:
        case OpMode.INDY:
          // mode already checked
          symUtils.markZPage(this.expression)
          const value = this.expression.resolve()
          if (value !== undefined) {
            if (value > 255) {
              this.expression.setError("Expression too large for addressing mode")
            }
          }
          break
        case OpMode.REL:
          symUtils.markCode(this.expression)
          break
      }
    }

    // if opcode has label, label must be code
    if (this.labelExp) {
      symUtils.markCode(this.labelExp)
    }
  }

  pass1(asm: Assembler): number | undefined {
    if (this.opByte !== undefined) {
      return Isa6502.ops[this.opByte].bc
    }
  }

  pass2(asm: Assembler, dataBytes: number[]): void {
    if (this.opByte !== undefined) {
      dataBytes[0] = this.opByte
      if (this.expression) {
        let value = this.expression.resolve()
        if (value !== undefined) {
          const bc = Isa6502.ops[this.opByte].bc
          if (bc == 2) {
            if (this.mode == OpMode.REL) {
              value = value - this.PC! - 2
              if (value < -128 || value > 127) {
                this.expression.setError(`Branch delta ${value} out of range}`)
                return
              }
            } else {
              if (asm.syntax == Syntax.CA65) {
                // TODO: add this once structure offsets are implemented
                // if (value < 0 || value > 255) {
                //   this.expression.setError(`Expression value ${value} out of range 0..255`)
                //   return
                // }
              } else if (value < -128 || value > 255) {
                this.expression.setWarning(`Value ${value} will be truncated to 8 bits`)
              }
            }
            dataBytes[1] = value & 0xff
          } if (bc == 3) {
            dataBytes[1] = (value >> 0) & 0xff
            dataBytes[2] = (value >> 8) & 0xff
          }
        } else {
          value = this.expression.resolve() // ***
        }
      }
    }
  }
}

//#endregion
//==============================================================================
//#region Conditionals
//==============================================================================

export abstract class ConditionalStatement extends Statement {

  abstract applyConditional(preprocessor: Preprocessor): void

  pass1(asm: Assembler): number | undefined {
    return 0
  }
}


// MERLIN:  DO <exp>
//   DASM:  IF <exp>
//   ACME:  !if <exp> { <block> }
//   CA65:  .if <exp>
//   LISA:  .IF <exp>
//          NOTE: LISA does not support nested IF's.
// 64TASS:  .if <exp>

export class IfStatement extends ConditionalStatement {

  private op?: Op

  constructor(op?: Op) {
    super()
    this.op = op
  }

  applyConditional(prep: Preprocessor): void {

    const conditional = prep.conditional

    if (!conditional.push()) {
      this.setError("Exceeded nested conditionals maximum")
      return
    }

    prep.pushNesting(NestingType.Conditional)
    conditional.statement = this

    const expression = this.findArg("condition")
    const value = expression?.resolve() ?? 0
    conditional.setSatisfied(value != 0)
  }

  postProcessSymbols(symUtils: SymbolUtils): void {
    const expression = this.findArg("condition")
    if (expression) {
      symUtils.markConstants(expression)
    }
  }
}

export class AcmeIfStatement extends IfStatement {

  applyConditional(prep: Preprocessor): void {
    // TODO: fix this hack for ACME inline code
    const block = this.findArg("block")
    if (!block) {
      super.applyConditional(prep)
    }
  }
}


// MERLIN:
//   DASM:  IFCONST <symbol>
//          IFNCONST <symbol>
//   ACME:  !ifdef <symbol> { <block> }
//          !ifndef <symbol> { <block> }
//   CA65:
//   LISA:

export class IfDefStatement extends ConditionalStatement {

  private isTrue: boolean

  constructor(isTrue: boolean) {
    super()
    this.isTrue = isTrue
  }

  applyConditional(prep: Preprocessor): void {

    const conditional = prep.conditional

    if (!conditional.push()) {
      this.setError("Exceeded nested conditionals maximum")
      return
    }

    prep.pushNesting(NestingType.Conditional)
    conditional.statement = this

    const isSatisfied = this.checkCondition()
    conditional.setSatisfied(
      (isSatisfied && this.isTrue) || (!isSatisfied && !this.isTrue))
  }

  checkCondition(): boolean {
    const symbolArg = this.findArg("symbol-weakref")
    const symbol = (symbolArg as exp.SymbolExpression)?.symbol
    return symbol !== undefined
  }
}

export class IfConstStatement extends IfDefStatement {
  constructor(isTrue: boolean) {
    super(isTrue)
  }

  checkCondition(): boolean {
    const conditionArg = this.findArg("condition")
    return conditionArg?.resolve() !== undefined
  }
}

// MERLIN:
//   DASM:  ELIF <exp>
//   ACME:
//   CA65:  .elseif <exp>
//   LISA:
// 64TASS:  .elsif <exp>

export class ElseIfStatement extends ConditionalStatement {

  // *** what about folding here? ***

  applyConditional(prep: Preprocessor): void {
    const conditional = prep.conditional

    if (conditional.isComplete()) {
      this.setError("Unexpected ELIF without IF")
      return
    }

    if (conditional.statement) {
      conditional.statement.foldEnd = this
    } else {
      this.setError("no matching IF/ELIF statement")
      return
    }

    prep.popNesting()
    prep.pushNesting(NestingType.Conditional)
    conditional.statement = this

    const expression = this.findArg("condition")
    const value = expression?.resolve() ?? 0
    conditional.setSatisfied(!conditional.wasSatisfied() && value != 0)
  }

  postProcessSymbols(symUtils: SymbolUtils): void {
    const expression = this.findArg("condition")
    if (expression) {
      symUtils.markConstants(expression)
    }
  }
}


// MERLIN:  ELSE
//   DASM:  ELSE
//   ACME:  } else {
//   CA65:  .else
//   LISA:  .EL
// 64TASS:  .else

export class ElseStatement extends ConditionalStatement {

  applyConditional(prep: Preprocessor): void {
    const conditional = prep.conditional

    if (conditional.isComplete()) {
      this.setError("Unexpected ELSE without IF")
      return
    }

    if (conditional.statement) {
      conditional.statement.foldEnd = this
    } else {
      this.setError("No matching IF statement")
      return
    }

    prep.popNesting()
    prep.pushNesting(NestingType.Conditional)
    conditional.statement = this

    conditional.setSatisfied(!conditional.wasSatisfied())
  }
}

export class AcmeElseStatement extends ElseStatement {
  parse(parser: Parser) {
    if (this.opNameLC == "}") {
      const elseToken = parser.addNextToken()
      if (!elseToken) {
        parser.addMissingToken("expecting ELSE")
        return
      }
      if (elseToken.getString().toLowerCase() != "else") {
        elseToken.setError("Unexpected token, expecting ELSE")
        return
      }
      elseToken.type = TokenType.Keyword
      const res = parser.mustAddToken("{")
      if (res.index == 0) {
        // TODO: start new ACME group state
      }
    }
  }
}

// MERLIN:  FIN
//   DASM:  ENDIF
//          EIF
//   ACME:  }
//   CA65:  .endif
//   LISA:  .FI
// 64TASS:  .endif
//          .fi

export class EndIfStatement extends ConditionalStatement {

  // parse(parser: Parser) {
  // }

  // only called if brace statement is conditional
  applyConditional(prep: Preprocessor): void {
    const conditional = prep.conditional

    if (conditional.statement) {
      conditional.statement.foldEnd = this
    } else {
      this.setError("no matching IF/ELIF statement")
      return
    }

    if (!prep.isNested(NestingType.Conditional)) {
      this.setError("no IF/ELIF statement to end")
      return
    }

    if (prep.topNestingType() != NestingType.Conditional) {
      this.setError("no matching IF/ELIF statement")
      return
    }

    prep.popNesting()
    if (!conditional.pull()) {
      // Merlin ignores unused FIN
      // if (!assembler->SetMerlinWarning("Unexpected FIN/ENDIF")) {
      //   return
      // }
    }
  }
}


export class ClosingBraceStatement extends EndIfStatement {

  // only called if brace statement type is non-conditional
  preprocess(prep: Preprocessor, enabled: boolean): void {
    prep.popNesting(true)
  }
}

//#endregion
//==============================================================================
//#region Looping
//==============================================================================

// TODO: is label allowed or disallowed?

// MERLIN:  LUP <expression>
//   DASM:  REPEAT <expression>
//   ACME:  !for <var>, <start>, <end> { <block> }
//          !for <var>, <end> { <block> }
//          !do [<keyword-condition>] { <block> } [<keyword-condition>]
//          TODO: support !do
//   CA65:  .repeat <expression> [, var]
//   LISA:  n/a

export class RepeatStatement extends Statement {

  // private start?: exp.Expression    // ACME-only (default = 1)
  // private count?: exp.Expression    // end for ACME
  // private var?: exp.SymbolExpression

  preprocess(prep: Preprocessor, enabled: boolean): void {
    if (enabled) {
      prep.pushNesting(NestingType.Repeat, () => {
        // TODO: handle end repeat brace
      })
    }
  }

  // TODO: generalize this -- similar code used by MacroDefStatement, TypeBeginStatement
  // TODO: move into params.ts
  private getVarName(parser: Parser): exp.SymbolExpression | undefined {
    const token = parser.getNextToken()
    if (token) {
      if (token.type == TokenType.Symbol || token.type == TokenType.HexNumber) {
        const isDefinition = true
        // TODO: should be SymbolType.Variable
        const varNameExp = new exp.SymbolExpression([token], SymbolType.Simple,
          isDefinition, parser.sourceFile, parser.lineNumber)
        parser.addExpression(varNameExp)
        return varNameExp
      } else {
        token.setError("Unexpected token, expecting symbol")
        parser.addToken(token)
      }
    }
  }
}

// MERLIN:  --^
//   DASM:  [.]REPEND
//   ACME:  }
//   CA65:  .endrep[eat]
//   LISA:  n/a

export class EndRepStatement extends Statement {
  preprocess(prep: Preprocessor, enabled: boolean): void {
    if (enabled) {
      if (!prep.isNested(NestingType.Repeat)) {
        this.setError("Ending repeat without a start")
        return
      }
      if (prep.topNestingType() != NestingType.Repeat) {
        this.setError("Mismatched repeat end")
        return
      }
      prep.popNesting()
    }
  }
}

//#endregion
//==============================================================================
//#region Storage
//==============================================================================

// *** mark label as storage ***

// *** others ***

//   LISA:  .DA <exp>[,<exp>]
//          #<expression>
//          /<expression>
//          <expression>
//          "string"
//          'string'

const DataRanges: number[][] = [
  [          0,          0,           0 ],
  [       0xff,       0x7f,       -0x80 ],
  [     0xffff,     0x7fff,     -0x8000 ],
  [   0xffffff,   0x7fffff,   -0x800000 ],
  [ 0xffffffff, 0x7fffffff, -0x80000000 ],
]

class DataStatement extends Statement {

  protected dataSize: number
  protected signType: string
  protected bigEndian: boolean

  constructor(dataSize: number, signType: string, bigEndian = false) {
    super()
    this.dataSize = dataSize
    this.signType = signType
    this.bigEndian = bigEndian
  }

  postParse(parser: Parser) {
    if (this.labelExp && this.labelExp instanceof exp.SymbolExpression) {
      const symbol = this.labelExp.symbol
      if (symbol) {
        symbol.isData = true
      }
    }

    // TODO: may not need this -- let actual assembly catch range errors

    const uMax = DataRanges[this.dataSize][0]
    const sMax = DataRanges[this.dataSize][1]
    const sMin = DataRanges[this.dataSize][2]

    for (let arg of this.args) {
      const value = arg.resolve()
      if (value != undefined) {
        if (this.signType == "s") {
          if (value < sMin || value > sMax) {
            arg.setError(`Expression value ${value} out of range ${sMin}..${sMax}`)
          }
        } else if (this.signType == "u") {
          if (value < 0 || value > uMax) {
            arg.setError(`Expression value ${value} out of range 0..${uMax}`)
          }
        } else if (this.signType == "x") {
          if (value < sMin || value > uMax) {
            arg.setError(`Expression value ${value} out of range ${sMin}..${uMax}`)
          }
        }
      }
    }
  }

  preprocess(prep: Preprocessor, enabled: boolean): void {
    if (enabled) {
      if (prep.module.project.syntax == Syntax.CA65) {
        if (this.args.length == 0) {
          // TODO: only allow no dataElements if inside a .struct
        }
      }
    }
  }

  postProcessSymbols(symUtils: SymbolUtils) {
    // TODO: do for all sizes?
    if (this.dataSize == 1) {
      for (let expression of this.args) {
        symUtils.markConstants(expression)
      }
    }
  }

  pass1(asm: Assembler): number | undefined {
    return Math.max(this.args.length, 1) * this.dataSize
  }

  pass2(asm: Assembler, dataBytes: number[]) {
    let index = 0
    for (let element of this.args) {
      const value = element.resolve()
      if (value === undefined) {
        index += this.dataSize
        continue
      }
      if (this.dataSize == 1) {
        if (asm.syntax == Syntax.CA65) {
          if (value < 0 || value > 255) {
            element.setError(`Value ${value} out of range 0..255`)
          }
        } else if (value > 255 || value < -128) {
          element.setWarning(`Value ${value} overflows 8 bits`)
        }
        dataBytes[index++] = value & 0xff
      } else if (this.dataSize == 2) {
        const value0 = (value >> 0) & 0xff
        const value8 = (value >> 8) & 0xff
        if (this.bigEndian) {
          dataBytes[index++] = value8
          dataBytes[index++] = value0
        } else {
          dataBytes[index++] = value0
          dataBytes[index++] = value8
        }
      } else {
        // TODO: deal with 24 bit values
      }
    }
  }
}

// TODO: review all syntaxes use of these types
//  (which enforce sign bounds and which don't?)

export class DataStatement_U8 extends DataStatement {
  constructor() {
    super(1, "u", false)
  }
}

export class DataStatement_S8 extends DataStatement {
  constructor() {
    super(1, "s", false)
  }
}

export class DataStatement_X8 extends DataStatement {
  constructor() {
    super(1, "x", false)
  }
}

export class DataStatement_U16 extends DataStatement {
  constructor(bigEndian = false) {
    super(2, "u", bigEndian)
  }
}

export class DataStatement_S16 extends DataStatement {
  constructor(bigEndian = false) {
    super(2, "s", bigEndian)
  }
}

export class DataStatement_X16 extends DataStatement {
  constructor(bigEndian = false) {
    super(2, "x", bigEndian)
  }
}

export class DataStatement_U24 extends DataStatement {
  constructor(bigEndian = false) {
    super(3, "u", bigEndian)
  }
}

export class DataStatement_S24 extends DataStatement {
  constructor(bigEndian = false) {
    super(3, "s", bigEndian)
  }
}

export class DataStatement_X24 extends DataStatement {
  constructor(bigEndian = false) {
    super(3, "X", bigEndian)
  }
}

export class DataStatement_U32 extends DataStatement {
  constructor(bigEndian = false) {
    super(4, "u", bigEndian)
  }
}

export class DataStatement_S32 extends DataStatement {
  constructor(bigEndian = false) {
    super(4, "s", bigEndian)
  }
}

export class DataStatement_X32 extends DataStatement {
  constructor(bigEndian = false) {
    super(4, "X", bigEndian)
  }
}

//------------------------------------------------------------------------------

// MERLIN:  ds <count> [, <fill>]
//          ds \ [, <fill>]
//   DASM:  ds [{.b|.w|.l|.s}] <count> [, <fill> ]
//   ACME:  !fill <count-exp> [, <fill-value>]
//   CA65:  .res <count> [, <fill>]
//   LISA:  dfs <count> [, <fill>]
// 64TASS:  .fill <count> [, <fill>]

export class StorageStatement extends Statement {

  protected dataSize: number
  protected bigEndian: boolean
  private countValue?: number

  constructor(dataSize: number, bigEndian = false) {
    super()
    this.dataSize = dataSize
    this.bigEndian = bigEndian
  }

  postParse(parser: Parser): void {
    if (this.labelExp && this.labelExp instanceof exp.SymbolExpression) {
      const symbol = this.labelExp.symbol
      if (symbol) {
        symbol.isData = true
      }
    }
  }

  preprocess(prep: Preprocessor, enabled: boolean): void {
    if (enabled) {

      // reference any symbols that may be needed to resolve orgValue
      // TODO: get rid of this after switch to real assembly
      prep.processSymbolRefs(this)

      const countArg = this.findArg("count")
      if (countArg) {
        this.countValue = countArg.resolve()
        if (this.countValue === undefined) {
          countArg.setError("Must resolve on first pass")
        }
      } else {
        // assume if count isn't found, must be Merlin "\\"
        this.countValue = -prep.getCurrentPC() & 0xFF
      }
    }
  }

  // *** same as getSize() ***
  pass1(asm: Assembler): number | undefined {
    if (this.countValue !== undefined) {
      return this.countValue * this.dataSize
    }
  }

  pass2(asm: Assembler, dataBytes: number[]): void {
    let fillValue = 0
    const fillArg = this.findArg("fill")
    if (fillArg) {
      const value = fillArg.resolve()
      if (value === undefined) {
        fillArg.setError("Unresolved expression")
        return
      }
      fillValue = value
    }
    // TODO: handle >= 16 bit patterns differently
    dataBytes.fill(fillValue)
  }
}

// MERLIN:  n/a
//   DASM:  [.]ALIGN <boundary> [, <fill>]
//   ACME:  !align <and>, <equal> [, <fill>]
//          (default <fill> = $EA)
//   CA65:  .align <boundary> [,<fill>]
//   LISA:  n/a
// 64TASS:  [<boundary>[, {?|<fill>}[, <offset>]]]
//          (default <boundary> = 256)

export class AlignStatement extends Statement {

  private padValue?: number

  preprocess(prep: Preprocessor, enabled: boolean): void {
    if (enabled) {

      // reference any symbols that may be needed to resolve orgValue
      // TODO: get rid of this after switch to real assembly
      prep.processSymbolRefs(this)

      const andArg = this.findArg("and")
      const equalArg = this.findArg("equal")
      if (andArg && equalArg) {
        const andValue = andArg.resolve()
        if (andValue === undefined) {
          andArg.setError("Must resolve on first pass")
          return
        }
        const equalValue = equalArg.resolve()
        if (equalValue === undefined) {
          equalArg.setError("Must resolve on first pass")
          return
        }
        this.padValue = (equalValue - prep.getCurrentPC()) & andValue
        return
      }

      let boundaryValue = 256
      const boundaryArg = this.findArg("boundary")
      if (boundaryArg) {
        const value = boundaryArg.resolve()
        if (value === undefined) {
          boundaryArg.setError("Must resolve on first pass")
          return
        }
        boundaryValue = value
      }

      let offsetValue = 0
      const offsetArg = this.findArg("offset")
      if (offsetArg) {
        const value = offsetArg.resolve()
        if (value === undefined) {
          offsetArg.setError("Must resolve on first pass")
          return
        }
        offsetValue = value
      }

      const misalign = prep.getCurrentPC() % boundaryValue
      const size = (misalign ? boundaryValue - misalign : 0) + offsetValue
      // TODO: how are negative offsets handled in 64TASS?
      this.padValue = Math.max(size, 0)
    }
  }

  pass1(asm: Assembler): number | undefined {
    return this.padValue
  }

  pass2(asm: Assembler, dataBytes: number[]): void {
    let fillValue = asm.syntax == Syntax.ACME ? 0xEA : 0x00
    const fillArg = this.findArg("fill")
    if (fillArg) {
      const value = fillArg.resolve()
      if (value === undefined) {
        fillArg.setError("Unresolved expression")
      } else {
        fillValue = value
      }
    }
    dataBytes.fill(fillValue)
  }
}

//------------------------------------------------------------------------------

// MERLIN:  HEX <hex> [, ...]
//   DASM:  [.]HEX <hex> [ ...]
//   ACME:  !HEX <hex> [ ...]
//   CA65:  n/a
//   LISA:  HEX <hex>
// 64TASS:  n/a

// odd digits never allowed
// $ and 0x prefix never allowed

export class HexStatement extends Statement {

  private dataBytes: number[] = []

  postParse(parser: Parser) {
    if (this.labelExp && this.labelExp instanceof exp.SymbolExpression) {
      const symbol = this.labelExp.symbol
      if (symbol) {
        symbol.isData = true
      }
    }

    // TODO: in pass1 instead?
    this.dataBytes = []
    for (let arg of this.args) {
      if (!arg.hasError) {
        scanHex(arg.getString(), this.dataBytes)
      }
    }
  }

  // *** needed?
  getSize(): number | undefined {
    return this.dataBytes.length
  }

  pass1(asm: Assembler): number | undefined {
    return this.dataBytes.length
  }

  pass2(asm: Assembler, dataBytes: number[]): void {
    for (let i = 0; i < this.dataBytes.length; i += 1) {
      dataBytes[i] = this.dataBytes[i]
    }
  }
}

// NOTE: caller has checked for odd nibbles
function scanHex(hexString: string, buffer: number[]) {
  while (hexString.length > 0) {
    let byteStr = hexString.substring(0, 2)
    buffer.push(parseInt(byteStr, 16))
    hexString = hexString.substring(2)
  }
}

//#endregion
//==============================================================================
//#region Disk
//==============================================================================

// *** !convtab here too?

class FileStatement extends Statement {

  protected fileName?: exp.FileNameExpression

  postParse(parser: Parser) {
    this.fileName = this.findArg("filename")
  }

  pass1(asm: Assembler): number | undefined {
    return 0
  }
}

// MERLIN:  PUT filename
//          USE filename
//   DASM:  [.]INCLUDE "filename"
//   ACME:  !SOURCE "filename"
//          !SOURCE <filename>
//   CA65:  .INCLUDE "filename"
//   LISA:  ICL "filename"
// 64TASS:  .include "filename"

export class IncludeStatement extends FileStatement {

  preprocess(preprocessor: Preprocessor, enabled: boolean) {
    if (enabled && this.fileName) {
      // TODO: move this to FileStatement class
      let fileNameStr = this.fileName.getString() || ""
      if (fileNameStr.length > 0) {
        // TODO: only strip quotes for non-Merlin?
        // TODO: require quoting for CA65? other syntaxes?
        let quoteChar = fileNameStr[0]
        if (quoteChar == "'" || quoteChar == '"' || quoteChar == "<") {
          fileNameStr = fileNameStr.substring(1)
          if (fileNameStr.length > 0) {
            const lastChar = fileNameStr[fileNameStr.length - 1]
            if (lastChar == quoteChar || (quoteChar == "<" && lastChar == ">")) {
              fileNameStr = fileNameStr.substring(0, fileNameStr.length - 1)
            }
          }
        }
      }
      if (!preprocessor.includeFile(fileNameStr)) {
        this.fileName.setError("File not found")
      }
    }
  }
}

// MERLIN:  SAV filename
//   DASM:  n/a
//   ACME:  n/a
//   CA65:  n/a
//   LISA:  SAV "filename"

export class SaveStatement extends FileStatement {
}


// MERLIN:  DSK filename
//   DASM:  n/a
//   ACME:  !TO "filename" [, file-format]
//   CA65:  n/a
//   LISA:  n/a

export class DiskStatement extends FileStatement {
}

// MERLIN:  n/a
//   DASM:  [.]INCDIR "directory"
//   ACME:  n/a
//   CA65:  n/a
//   LISA:  n/a

export class IncDirStatement extends FileStatement {
  // TODO:
}

// MERLIN:  n/a
//   DASM:  [.]INCBIN "filename" [, offset]
//   ACME:  !BINARY "filename" [, [size] [, [offset]]]
//   CA65:  .INCBIN "filename" [, offset [, size]]
//   LISA:  n/a
// 64TASS:  .binary "filename"

export class IncBinStatement extends FileStatement {

  pass1(asm: Assembler): number | undefined {
    // TODO: return actual data size
    return
  }
}

//#endregion
//==============================================================================
//#region Macros, Structures, Unions, Enums
//==============================================================================

// *** .repeat and !for also use type-params

// DefineDefStatement is a greatly simplified version of
//  of TypeDefBeginStatement that doesn't follow the
//  begin/end pattern.
export class DefineDefStatement extends Statement {

  public typeName?: exp.SymbolExpression

  postParse(parser: Parser) {
    const name = this.findArg("define-name")
    if (name instanceof exp.SymbolExpression) {
      this.typeName = name
    }
  }

  preprocess(prep: Preprocessor, enabled: boolean): void {
    if (enabled) {
      if (this.typeName) {
        // assign typeName's full symbol name before scope changes
        // prep.preprocessSymbol(this.typeName)
        if (this.typeName.symbol) {
          this.typeName.symbol.isZoneStart = true
        }
        prep.scopeState.pushZone(this.typeName.getString())
        prep.startTypeDef(NestingType.Define)
      }
    }
  }

  // specific to DefineDefStatement
  endPreprocess(prep: Preprocessor, enabled: boolean) {
    prep.scopeState.popZone()
    prep.endTypeDef()
  }
}

export class TypeDefBeginStatement extends Statement {

  private nestingType: NestingType
  private canRecurse: boolean
  public typeName?: exp.SymbolExpression

  constructor(nestingType: NestingType, canRecurse: boolean) {
    super()
    this.nestingType = nestingType
    this.canRecurse = canRecurse
  }

  postParse(parser: Parser) {

    const name = this.findArg("type-name")
    if (name instanceof exp.SymbolExpression) {
      this.typeName = name
    } else if (this.labelExp) {
      this.typeName = this.labelExp
      this.typeName.setSymbolType(SymbolType.TypeName)
    }
  }

  preprocess(prep: Preprocessor, enabled: boolean): void {
    if (enabled) {

      if (!this.canRecurse) {
        if (prep.isNested(this.nestingType)) {
          this.setError("Cannot be restarted")
          return
        }
      }

      const currentPC = prep.getCurrentPC()
      prep.pushNesting(this.nestingType, () => {
        if (enabled) {
          prep.setNextPC(currentPC)
          // prep.scopeState.popZone()   // TODO: ACME-only?
          prep.scopeState.popScope()  // *** need scope for struct/enum/union
          // prep.scopeState.endType()
          prep.endTypeDef()
        }
      })

      if (enabled) {

        // assign typeName's full symbol name before scope changes
        if (this.typeName) {
          prep.preprocessSymbol(this.typeName)
        }

        // *** different for enum?
        // *** different if anonymous type?
        prep.setNextPC(0)
        // prep.scopeState.pushZone()    // TODO: ACME-only?
        prep.scopeState.pushScope(this.typeName?.getString() ?? "")
        // prep.scopeState.startType(this.typeName?.getString() ?? "")
        prep.startTypeDef(this.nestingType)
      }
    }
  }

  pass1(asm: Assembler): number | undefined {
    return 0
  }
}

export class TypeDefEndStatement extends Statement {
  private nestingType: NestingType

  constructor(nestingType: NestingType) {
    super()
    this.nestingType = nestingType
  }

  preprocess(prep: Preprocessor, enabled: boolean): void {
    if (enabled) {
      if (!prep.isNested(this.nestingType)) {
        this.setError("Missing begin for this end")
        return
      }

      if (prep.topNestingType() != this.nestingType) {
        this.setError("Dangling scoped type")
        return
      }
      prep.popNesting(true)
      // prep.scopeState.popScope()
    }
  }

  pass1(asm: Assembler): number | undefined {
    return 0
  }
}

// MERLIN:  <name> MAC           (label required)
//   DASM:         MAC <name>    (no label allowed)
//                 MACRO <name>
//   ACME:         !macro <name> [<param>,...] {
//   CA65:         .mac <name> [<param>,...]
//                 .macro <name> [<param>,...]
// 64TASS:  <name> .macro [<param>,...]
//   LISA:  n/a

// ACME: params start with "." and are locals
// CA65: params are simple symbols

export class MacroDefStatement extends TypeDefBeginStatement {

  constructor() {
    super(NestingType.Macro, false)
  }
}

// MERLIN:  EOM       (label is allowed)
//          <<<
//   DASM:  ENDM      (no label allowed)
//   ACME:  }
//   CA65:  .endmacro
//          .endmac
// 64TASS:  .endmacro
//          .endm
//   LISA:  n/a

export class EndMacroDefStatement extends TypeDefEndStatement {

  constructor() {
    super(NestingType.Macro)
  }

  pass1(asm: Assembler): number | undefined {
    return 0
  }
}

export class EnumStatement extends TypeDefBeginStatement {
  constructor() {
    super(NestingType.Enum, false)  // cannot nest
  }
}

export class EndEnumStatement extends TypeDefEndStatement {
  constructor() {
    super(NestingType.Enum)
  }
}

export class StructStatement extends TypeDefBeginStatement {
  constructor() {
    super(NestingType.Struct, true)  // can nest
  }
}

export class EndStructStatement extends TypeDefEndStatement {
  constructor() {
    super(NestingType.Struct)
  }
}

export class UnionStatement extends TypeDefBeginStatement {
  constructor() {
    super(NestingType.Union, true)  // TODO: can nest?
  }
}

export class EndUnionStatement extends TypeDefEndStatement {
  constructor() {
    super(NestingType.Union)
  }
}

// TODO: proc and scope belong elsewhere, in scoping group

export class ProcStatement extends TypeDefBeginStatement {
  constructor() {
    super(NestingType.Proc, true) // can nest
  }
}

export class EndProcStatement extends TypeDefEndStatement {
  constructor() {
    super(NestingType.Proc)
  }
}

export class ScopeStatement extends TypeDefBeginStatement {
  constructor() {
    super(NestingType.Scope, true) // can nest
  }
}

export class EndScopeStatement extends TypeDefEndStatement {
  constructor() {
    super(NestingType.Scope)
  }
}

//#endregion
//==============================================================================
//#region Everything else
//==============================================================================

// *** watch for assigning a value to a local label
//  *** LISA, for example, doesn't allow that
// *** mark symbol as being assigned rather than just a label?

// MERLIN: symbol EQU [#]exp
//         symbol = exp
// DASM:   symbol [.]EQU [#]exp
//         symbol = exp
// CA65:   symbol = exp
//         symbol := exp

export class EquStatement extends Statement {

  private value?: exp.Expression

  parse(parser: Parser) {
    if (!this.labelExp) {
      parser.insertMissingLabel()
      return
    }
    if (!this.labelExp.isVariableType()) {
      // look for leading "#" for DASM and Merlin
      //  TODO: should this be done for expressions in general?
      if (!parser.syntax
          || parser.syntax == Syntax.DASM
          || parser.syntax == Syntax.MERLIN) {
        const token = parser.peekNextToken()
        if (token && token.getString() == "#") {
          parser.addNextToken()
        }
      }
      this.value = parser.mustAddNextExpression()
      // TODO: if ":=", mark symbol as address
      // TODO: deal with ":?=" conditional assignment
      this.labelExp.symbol?.setValue(this.value, SymbolFrom.Equate)

    } else {
      this.labelExp.setError("Variable label not allowed")
    }
  }

  pass1(asm: Assembler): number | undefined {
    return 0
  }
}

// MERLIN: varSymbol = exp
// DASM:   varSymbol [.]SET exp
// ACME:             !SET varSymbol = exp
// CA65:   varSymbol .SET exp

export class VarAssignStatement extends Statement {

  private value?: exp.Expression

  parse(parser: Parser) {

    if (this.opNameLC != "!set") {
      if (!this.labelExp) {
        parser.insertMissingLabel()
        return
      }
    }

    if (this.opNameLC == "set" || this.opNameLC == ".set") {
      this.labelExp?.setSymbolType(SymbolType.Variable)

    } else if (this.opNameLC == "!set") {
      // TODO: fix this
      parser.getNextToken()   // var symbol
      parser.getNextToken()   // "="
    } else if (this.opNameLC != "=") {
      this.opExp?.setError("Expecting '='")
      return
    }

    this.value = parser.mustAddNextExpression()
  }
}

//------------------------------------------------------------------------------

// MERLIN:  XC [OFF]
//   DASM:  [.]PROCESSOR <type>
//   ACME:  !cpu <type> [ { <block> } ]
//   CA65:
//   LISA:  n/a
// 64TASS:  .cpu "<type>"

export class CpuStatement extends Statement {

  private pushState = false

  postParse(parser: Parser) {
    this.pushState = this.hasTrailingOpenBrace()
  }

  preprocess(prep: Preprocessor, enabled: boolean): void {
    if (enabled) {
      if (this.pushState) {
        prep.pushNesting(NestingType.Cpu, () => {
          if (enabled) {
            // TODO: update cpu state
          }
        })
      }
    }
  }
}


export class OrgStatement extends Statement {

  preprocess(prep: Preprocessor, enabled: boolean): void {
    if (enabled) {

      // reference any symbols that may be needed to resolve orgValue
      // TODO: get rid of this after switch to real assembly
      prep.processSymbolRefs(this)

      const valueArg = this.args[0]
      if (valueArg) {
        const orgValue = valueArg.resolve()
        if (orgValue === undefined) {
          valueArg.setError("Must resolve in first pass")
        } else if (orgValue < 0 || orgValue > 0xFFFF) {
          valueArg.setError("Invalid org value " + orgValue)
        } else {
          prep.setNextPC(orgValue)
        }
      } else {
        // TODO: Merlin treats an org with address as a reorg
        //  to sync back to the previous org
      }
    }
  }

  pass1(asm: Assembler): number | undefined {
    return 0
  }
}


export class EntryStatement extends Statement {

  postParse(parser: Parser) {
    if (this.labelExp) {
      if (!this.labelExp.isVariableType()) {
        if (this.labelExp.symbol) {
          this.labelExp.symbol.isEntryPoint = true
        }
      } else {
        this.labelExp.setError("Variable label not allowed")
      }
    }
  }

  pass1(asm: Assembler): number | undefined {
    return 0
  }
}


export class UsrStatement extends Statement {

  parse(parser: Parser) {

    while (true) {
      let token = parser.getNextToken()
      if (!token) {
        break
      }

      // *** special case () for NajaText ? ***

      // *** not on first pass ***
      const str = token.getString()
      if (str == ",") {
        parser.addToken(token)
        continue
      }

      if (str == "(") {
        const strExpression = parser.parseStringExpression(token, true, false)
        parser.addExpression(strExpression)
        continue

        // *** attempt NajaText
        // *** attempt 6502 addressing
      }

      const expression = parser.addNextExpression(token)
      if (!expression) {
        break
      }
    }
  }
}

// MERLIN:  ASC <string-args>
//          DCI <string-args>
//          REV <string-args>
//          STR <string-args>
//          TXT <naja-string>
//          TXC <naja-string>
//          TXI <naja-string>
//
// ACME:    !pet <string-args>
//          !raw <string-args>
//          !scr <string-args>
//          !text <string-args>

// 64TASS:  .text <string-args>

// TODO: make this the basis for all the various string/text statements
export class TextStatement extends Statement {

  pass1(asm: Assembler): number | undefined {
    // TODO: temporary to force "??"
    return 1
  }
}

//------------------------------------------------------------------------------

// MERLIN:  <label> <macro> [<param>;...]
//   DASM:  <label> <macro> [<param>, ...]
//   ACME:  <label> +<macro> [<param>, ...]
//   CA65:
// 64TASS:  <label> #<macro> [<param>, ...]
//   LISA:  n/a

export class MacroInvokeStatement extends Statement {

  // *** where is this coming from? in this.labelExp?
  // public macroName?: exp.SymbolExpression

  parse(parser: Parser) {

    let pushedExpression = false
    while (true) {
      let token = parser.getNextToken()
      if (!token) {
        break
      }

      const str = token.getString()

      // TODO: hacks to allow macros to look like opcodes
      if (parser.syntax == Syntax.CA65) {   // HACK
        if (str == "#") {
          parser.addToken(token)
          continue
        }
        if (str == ":") {
          this.args.push(parser.parseCA65Local(token, false))
          continue
        }
      }

      // TODO: fix this multi-statement hack to suppress errors
      if (parser.syntax == Syntax.ACME) {   // HACK
        if (str == ":") {
          parser.ungetToken(token)
          break
        }
      }

      if (parser.syntaxDef.macroInvokeDelimiters.includes(str)) {
        if (!pushedExpression) {
          // TODO: push empty expression
        }
        parser.addToken(token)
        pushedExpression = false
        continue
      }

      if (pushedExpression) {
        parser.addMissingToken(`Missing delimiter "${parser.syntaxDef.macroInvokeDelimiters}"`)
        break
      }

      const expression = parser.addNextExpression(token)
      if (!expression) {
        break
      }

      this.args.push(expression)
      pushedExpression = true
    }
  }

  pass1(asm: Assembler): number | undefined {
    // TODO: for now, just so ??'s are generated
    return 1
  }
}

//------------------------------------------------------------------------------

export class DummyStatement extends Statement {

  postParse(parser: Parser) {
    // TODO: put back in once Naja code is cleaned up
    // if (this.opNameLC == "dummy") {
    //   this.opExp?.setWarning("Use DUM instead")
    // }
  }

  preprocess(prep: Preprocessor, enabled: boolean): void {
    if (enabled) {

      // NOTE: With Merlin, the start of a dummy section implicitly
      //  closes any currently active dummy section first.
      // TODO: consider controlling this with a strict/lax switch
      if (prep.module.project.syntax == Syntax.MERLIN) {
        if (prep.isNested(NestingType.Struct)) {
          prep.popNesting()
          prep.scopeState.popScope()
        }
      }

      const currentPC = prep.getCurrentPC()
      prep.pushNesting(NestingType.Struct, () => {
        if (enabled) {
          prep.setNextPC(currentPC)
        }
      })

      // reference any symbols that may be needed to resolve orgValue
      // TODO: get rid of this after switch to real assembly
      prep.processSymbolRefs(this)

      const valueArg = this.args[0]
      if (valueArg) {
        const orgValue = valueArg.resolve()
        if (orgValue === undefined) {
          // *** TODO: only if doing full assemble ***
          valueArg.setError("Must resolve in first pass")
        } else {
          prep.setNextPC(orgValue)
        }
      }
    }
  }

  pass1(asm: Assembler): number | undefined {
    return 0
  }
}

export class DummyEndStatement extends Statement {

  preprocess(prep: Preprocessor, enabled: boolean): void {
    if (enabled) {
      if (!prep.isNested(NestingType.Struct)) {
        this.setError("Missing begin for this dummy")
        return
      }

      if (prep.topNestingType() != NestingType.Struct) {
        this.setError("Dangling scoped type")
        return
      }
      prep.popNesting(true)   // pass true so pop proc gets called
      prep.scopeState.popScope()
    }
  }

  pass1(asm: Assembler): number | undefined {
    return 0
  }
}


// DASM:  SEG[.U] [<name>]
// CA65:  .segment "<name>" [: (direct|zeropage|absolute)]
//                          "direct" means immediate

// TODO: reconcile seg.u and dummy statements (currently DASM-only)
export class SegmentStatement extends Statement {

  private impliedName?: string

  constructor(impliedName?: string) {
    super()
    this.impliedName = impliedName
  }

  pass1(asm: Assembler): number | undefined {
    return 0
  }
}

//------------------------------------------------------------------------------

export class ListStatement extends Statement {
  pass1(asm: Assembler): number | undefined {
    return 0
  }
}

//==============================================================================
// CA65-only
//==============================================================================

// .feature labels_without_colons
// .feature bracket_as_indirect
// TODO: others

export class FeatureStatement extends Statement {

  postParse(parser: Parser) {
    // TODO: check all args for valid feature names
  }
}

//------------------------------------------------------------------------------

// CA65:  .IMPORT <name>[:<mode>] [, ...]
//        .EXPORT <name>[:<mode>] [, ...]
//        .IMPORTZP <name> [, ...]
//        .EXPORTZP <name>[, ...]

export class ImportExportStatement extends Statement {

  private isExport: boolean
  private isZpage: boolean

  constructor(isExport: boolean, isZpage: boolean) {
    super()
    this.isExport = isExport
    this.isZpage = isZpage
  }

  pass1(asm: Assembler): number | undefined {
    return 0
  }
}

//------------------------------------------------------------------------------

export class AssertTrueStatement extends Statement {

  private typeName?: string
  private always: boolean
  private assertTrue: boolean

  constructor(typeName?: string, always = false, assertTrue = true) {
    super()
    this.typeName = typeName
    this.always = always
    this.assertTrue = assertTrue
  }

  preprocess(prep: Preprocessor, enabled: boolean): void {

    let condArg: exp.Expression | undefined
    let condition = this.always
    if (!condition) {

      // TODO: make this automatic when looking for <condition>?
      prep.processSymbolRefs(this)

      condArg = this.findArg("condition")
      if (condArg) {
        const value = condArg.resolve()
        if (condition === undefined) {
          // TODO: decide to ignore or trigger when condition not resolved
          return
        }
        condition = value != 0
      }
    }

    if (condition != this.assertTrue) {

      let type = this.typeName
      if (!type) {
        const typeArg = this.findArg("assert-type")
        if (typeArg) {
          type = typeArg.getString()
        } else {
          type = "error"
        }
      }

      const error = (type == "error" || type == "lderror" || type == "fatal")
      const warning = (type == "warning" || type == "ldwarning")
      if (error || warning) {

        let message = ""
        this.forEachExpression((expression) => {
          if (expression.name == "message" ||
              expression.name == "string-value" ||
              expression instanceof exp.StringExpression) {
            message += expression.getString()
          }
        })

        if (error) {
          (condArg ?? this).setError("ERROR: " + message)
        } else {
          (condArg ?? this).setWarning("Warning: " + message)
        }
      }
    }
  }
}

export class AssertFalseStatement extends AssertTrueStatement {
  constructor(type?: string) {
    super(type, false, false)
  }
}

//==============================================================================
// DASM-only
//==============================================================================

// MERLIN:
//   DASM:  [<label>] SUBROUTINE    (label is optional)
//   ACME:  (see !zone below)
//   CA65:
//   LISA:

export class SubroutineStatement extends Statement {

  postParse(parser: Parser) {
    if (!this.labelExp) {
      // insert implied label
      this.labelExp = new exp.SymbolExpression([], SymbolType.Simple, true,
        parser.sourceFile, parser.lineNumber)
      this.children.unshift(this.labelExp)
    }
    if (this.labelExp.isVariableType()) {
      this.labelExp.setError("Variable not allowed as label")
      return
    }
    if (this.labelExp.symbol) {
      this.labelExp.symbol.isZoneStart = true
    }
  }
}

//==============================================================================
// ACME-only
//==============================================================================

//   ACME:  <label> !zone [<name>] [ { <block> } ]
//          <label> !zn [<name>] [ { <block> } ]

export class ZoneStatement extends Statement {

  private zoneTitle?: string
  private pushState = false

  postParse(parser: Parser) {

    this.pushState = this.hasTrailingOpenBrace()

    const zoneArg = this.findArg("name")
    if (zoneArg instanceof exp.SymbolExpression) {
      if (zoneArg.symbol) {
        zoneArg.symbol.isZoneStart = true
      }
      this.zoneTitle = zoneArg.getString()
    }

    if (this.zoneTitle) {
      // TODO: use zoneTitle as scope name
      // TODO: support switching back to a previously used zone title
    } else {
      // if no zone title, use label
      // if no label, insert an implied label
      if (!this.labelExp) {
        // insert implied label
        this.labelExp = new exp.SymbolExpression([], SymbolType.Simple, true,
          parser.sourceFile, parser.lineNumber)
        this.children.unshift(this.labelExp)
      }
      if (this.labelExp.symbol) {
        this.labelExp.symbol.isZoneStart = true
      }
    }
  }

  preprocess(prep: Preprocessor, enabled: boolean): void {
    if (this.pushState) {
      prep.pushNesting(NestingType.Zone, () => {
        if (enabled) {
          prep.scopeState.popZone()
        }
      })
    }

    if (enabled) {
      if (this.pushState) {
        prep.scopeState.pushZone(this.zoneTitle)
      } else {
        prep.scopeState.setZone(this.zoneTitle)
      }
    }
  }
}

//   ACME:  <label> !pseudopc <expresion> { <block> }
// TODO: consider folding into OrgStatement?
export class PseudoPcStatement extends Statement {

  preprocess(prep: Preprocessor, enabled: boolean): void {
    prep.pushNesting(NestingType.PseudoPc, () => {
      if (enabled) {
        // TODO: pop behaviour
      }
    })
    if (enabled) {
      // TODO: actually change PC
    }
  }
}

//   ACME:  !xor expression [ { <block> } ]

export class XorStatement extends Statement {

  private pushState = false

  postParse(parser: Parser) {
    this.pushState = this.hasTrailingOpenBrace()
  }

  preprocess(prep: Preprocessor, enabled: boolean): void {
    if (this.pushState) {
      prep.pushNesting(NestingType.Xor, () => {
        if (enabled) {
          // TODO: manage xor value state
        }
      })
    }

    if (enabled) {
      // TODO: manage xor value state
    }
  }
}

//   ACME:  !address expression [ { <block> } ]
//          !addr

export class AddressStatement extends Statement {

  private pushState = false

  postParse(parser: Parser) {
    this.pushState = this.hasTrailingOpenBrace()
  }

  preprocess(prep: Preprocessor, enabled: boolean): void {
    if (this.pushState) {
      prep.pushNesting(NestingType.Addr, () => {
        if (enabled) {
          // TODO: manage addr state
        }
      })
    }

    if (enabled) {
      // TODO: manage addr state
    }
  }
}

//   ACME:  !convtab {pet|raw|scr|<filename>} [\\{ [<block> \\}]]

export class ConvTabStatement extends Statement {

  private pushState = false

  postParse(parser: Parser) {
    this.pushState = this.hasTrailingOpenBrace()
  }

  preprocess(prep: Preprocessor, enabled: boolean): void {
    if (this.pushState) {
      prep.pushNesting(NestingType.ConvTab, () => {
        if (enabled) {
          // TODO: manage converstion table state
        }
      })
    }

    if (enabled) {
      // TODO: manage converstion table state
    }
  }
}

//#endregion
//==============================================================================
