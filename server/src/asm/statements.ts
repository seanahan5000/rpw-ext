
import * as exp from "./expressions"
import { Parser } from "./parser"
import { Preprocessor, SymbolUtils, NestingType } from "./preprocessor"
import { SymbolFrom, SymbolType } from "./symbols"
import { Syntax, } from "./syntax"
import { Node, Token, TokenType } from "./tokenizer"

//------------------------------------------------------------------------------

export abstract class Statement extends exp.Expression {

  public sourceLine: string = ""
  public labelExp?: exp.SymbolExpression
  public opExp?: exp.Expression         // FIXME: easy to confuse with opExpression
  public opNameLC = ""
  public enabled = true

  // link between conditional statement groups, used to build code folding ranges
  public foldEnd?: Statement

  init(sourceLine: string, children: Node[],
      labelExp?: exp.SymbolExpression,
      opExp?: exp.Expression) {
    this.children = children
    this.sourceLine = sourceLine
    this.labelExp = labelExp
    this.opExp = opExp
    // TODO: consider trimming off/separating prefix operator ("+", "!", ".")
    this.opNameLC = this.opExp?.getString().toLowerCase() ?? ""
  }

  // parse the statement line but don't change any external state
  parse(parser: Parser) {
    // TODO: does this default implementation still make sense?
    // TODO: just eat expressions? do nothing instead?
    const token = parser.getNextToken()
    if (token) {
      const expression = parser.parseExpression(token)
      if (expression) {
        this.children.push(expression)
      }
    }
  }

  // do any conditional preprocessing work but only change state if enabled is true
  preprocess(prep: Preprocessor, enabled: boolean) {
  }

  postProcessSymbols(symUtils: SymbolUtils) {
  }

  // TODO: should any statement need resolve() or getSize()?
}


export class GenericStatement extends Statement {
}

//==============================================================================
// Opcodes
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
  BRANCH
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
  public mode: OpMode = OpMode.NONE
  private expression?: exp.Expression

  constructor(opcode: any, opSuffix: string, cpu: OpCpu) {
    super()
    this.opcode = opcode
    this.opSuffix = opSuffix
    this.cpu = cpu
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
      } else if (str == "#") {
        parser.addToken(token)
        if (this.opcode.IMM === undefined) {
          this.opExp?.setError("Opcode does not support this addressing mode")
        }
        token.type = TokenType.Opcode
        this.mode = OpMode.IMM
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
        // *** this loses the implied ">" operation
        this.expression = parser.mustAddNextExpression()
      } else if ((str == "(" && !parser.requireBrackets)
          || (str == "[" && (parser.allowBrackets || parser.requireBrackets))) {
        const closingChar = str == "(" ? ")" : "]"
        parser.addToken(token)
        // *** check opcode has this address mode ***
        token.type = TokenType.Opcode
        this.mode = OpMode.IND
        this.expression = parser.mustAddNextExpression()

        let res = parser.mustAddToken([",", closingChar], TokenType.Opcode)
        if (res.index == 0) {               // (exp,X)
          this.mode = OpMode.INDX
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
          let nextToken = parser.addNextToken()
          if (!nextToken) {
            this.mode = OpMode.IND
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

        if (this.opcode.BRAN || (this.opcode.ABS &&
            (this.opNameLC == "jmp" || this.opNameLC == "jsr"))) {

          // *** move to parser ***
          // *** these are valid outside of branch/jump opcodes ***

          const isDefinition = false
          if (str == ">" || str == "<") {
            if (!parser.syntax || parser.syntax == Syntax.LISA) {
              parser.addExpression(parser.parseLisaLocal(token, isDefinition))
              return
            }
          } else if (str[0] == ":" && parser.syntax == Syntax.CA65) {
            parser.addExpression(parser.parseCA65Local(token, isDefinition))
            return
          } else if ((str[0] == "-" || str[0] == "+")
              && (str[0] == str[str.length - 1])) {
            if (!parser.syntax || parser.syntax == Syntax.ACME) {
              if (str.length > 9) {
                token.setError("Anonymous local is too long")
                parser.addExpression(new exp.BadExpression([token]))
                return
              }
              token.type = TokenType.Label
              parser.addExpression(parser.newSymbolExpression([token], SymbolType.AnonLocal, isDefinition))
              return
            }
          }
        }

        this.expression = parser.mustAddNextExpression(token)

        token = parser.addNextToken()
        if (!token) {
          this.mode = OpMode.ABS            // exp
        } else {
          if (token.getString() == ",") {   // exp,X or exp,Y
            token.type = TokenType.Opcode
            const c = parser.peekVeryNextChar()
            token = parser.mustAddNextToken("expecting 'X' or 'Y'")
            if (token.type != TokenType.Missing) {
              str = token.getString().toLowerCase()
              if (str == "x") {             // exp,X
                this.mode = OpMode.ABSX
                token.type = TokenType.Opcode
              } else if (str == "y") {      // exp,Y
                this.mode = OpMode.ABSY
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
      case OpMode.BRANCH:
        return this.opcode.BRANCH !== undefined
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
          if (immValue !== undefined) {
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
          if (this.opcode.BRAN) {
            this.mode = OpMode.BRANCH
            symUtils.markCode(this.expression)
            break
          }
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
          if (size == 1) {
            const newMode = this.mode - OpMode.ABS + OpMode.ZP
            if (this.checkMode(newMode)) {
              this.mode = newMode
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
        case OpMode.BRANCH:
          // will never be BRANCH at this point
          break
      }
    }

    // if opcode has label, label must be code
    if (this.labelExp) {
      symUtils.markCode(this.labelExp)
    }
  }
}

//==============================================================================
// Conditionals
//==============================================================================

export abstract class ConditionalStatement extends Statement {

  abstract applyConditional(preprocessor: Preprocessor): void

  parseTrailingOpenBrace(parser: Parser): boolean {
    // *** syntax instead ***
    if (this.opNameLC.startsWith("!")) {      // *** stop doing this ***
      const res = parser.mustAddToken("{")
      if (res.index == 0) {
        return true
      }
    }
    return false
  }
}


// MERLIN:  DO <exp>
//   DASM:  IF <exp>
//   ACME:  !if <exp> { <block> }
//   CA65:  .if <exp>
//   LISA:  .IF <exp>
//          NOTE: LISA does not support nested IF's.
//  SBASM:  .DO <exp>

export class IfStatement extends ConditionalStatement {

  private expression?: exp.Expression
  private isInline = false

  parse(parser: Parser) {
    // TODO: give hint that this expression is for conditional code
    this.expression = parser.mustAddNextExpression()
    if (this.parseTrailingOpenBrace(parser)) {
      // TODO: parse inline code after opening brace to
      //  closing brace and maybe else statement
      // TODO: fix this hack to eat ACME inline code
      let token = parser.getNextToken()
      if (token) {
        this.isInline = true

        parser.startExpression()
        while (true) {
          if (token.getString() == "}") {
            parser.addToken(token)
            token = parser.getNextToken()
            if (!token) {
              break
            }
          }
          // TODO: for now, just eat everything inside inline braces
          // token.setError("Unexpected token")
          // parser.addToken(token)
          token = parser.getNextToken()
          if (!token) {
            break
          }
          if (token.getString() == "{") {
            parser.addToken(token)
          }
        }
        parser.addExpression(new exp.BadExpression(parser.endExpression()))
        if (token) {
          parser.addToken(token)
        }
      }
    }
  }

  applyConditional(prep: Preprocessor): void {

    const conditional = prep.conditional

    // TODO: fix this hack for ACME inline code
    if (this.isInline) {
      return
    }

    if (!conditional.push()) {
      this.setError("Exceeded nested conditionals maximum")
      return
    }

    prep.pushNesting(NestingType.Conditional)

    conditional.statement = this

    let value = this.expression?.resolve() ?? 0
    conditional.setSatisfied(value != 0)
  }

  postProcessSymbols(symUtils: SymbolUtils): void {
    if (this.expression) {
      symUtils.markConstants(this.expression)
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
//  SBASM:

export class IfDefStatement extends ConditionalStatement {

  private isDefined: boolean
  private symExpression?: exp.SymbolExpression

  constructor(isDefined: boolean) {
    super()
    this.isDefined = isDefined
  }

  parse(parser: Parser) {
    // TODO: should call this a conditional expression instead
    //  of setting expression.suppressUnknown
    const expression = parser.mustAddNextExpression()
    if (expression instanceof exp.SymbolExpression) {
      this.symExpression = expression
      expression.suppressUnknown = true
    } else {
      expression.setError("Symbol expression required")
    }

    this.parseTrailingOpenBrace(parser)
  }

  applyConditional(prep: Preprocessor): void {

    const conditional = prep.conditional

    if (!conditional.push()) {
      this.setError("Exceeded nested conditionals maximum")
      return
    }

    prep.pushNesting(NestingType.Conditional)

    conditional.statement = this

    const symDefined = this.symExpression?.symbol !== undefined
    conditional.setSatisfied(
      (symDefined && this.isDefined) || (!symDefined && !this.isDefined))
  }
}


// MERLIN:
//   DASM:  ELIF <exp>
//   ACME:
//   CA65:  .elseif <exp>
//   LISA:
//  SBASM:

export class ElseIfStatement extends ConditionalStatement {

  private expression?: exp.Expression

  parse(parser: Parser) {
    // TODO: give hint that this expression is for conditional code
    this.expression = parser.mustAddNextExpression()
  }

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

    let value = this.expression?.resolve() ?? 0
    conditional.setSatisfied(!conditional.wasSatisfied() && value != 0)
  }

  postProcessSymbols(symUtils: SymbolUtils): void {
    if (this.expression) {
      symUtils.markConstants(this.expression)
    }
  }
}


// MERLIN:  ELSE
//   DASM:  ELSE
//   ACME:  } else {
//   CA65:  .else
//   LISA:  .EL
//  SBASM:  .EL

export class ElseStatement extends ConditionalStatement {

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


// MERLIN:  FIN
//   DASM:  ENDIF
//          EIF
//   ACME:  }
//   CA65:  .endif
//   LISA:  .FI
//  SBASM:  .FI

export class EndIfStatement extends ConditionalStatement {

  parse(parser: Parser) {
  }

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

//==============================================================================
// Looping
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

  private start?: exp.Expression    // ACME-only
  private count?: exp.Expression    // end for ACME
  private var?: exp.SymbolExpression

  parse(parser: Parser) {

    if (parser.syntax == Syntax.ACME) {

      this.var = this.getVarName(parser)
      if (!this.var) {
        return
      }

      if (parser.mustAddToken([","]).index < 0) {
        return
      }

      this.count = parser.mustAddNextExpression()

      const res = parser.mustAddToken(["", ",", "{"])
      if (res.index < 0) {
        return
      }

      if (res.index == 1) {
        this.start = this.count
        this.count = parser.mustAddNextExpression()

        if (parser.mustAddToken("{").index < 0) {
          return
        }
      }

    } else {
      this.count = parser.mustAddNextExpression()

      const res = parser.mustAddToken(["", ","])
      if (res.index < 0) {
        return
      }

      if (res.index > 0) {
        if (parser.syntax == Syntax.MERLIN || parser.syntax == Syntax.DASM) {
          res.token?.setError("Unexpected token")
          return
        }
        this.var = this.getVarName(parser)
        if (!this.var) {
          return
        }
      }

      if (!parser.syntax) {
        parser.mustAddToken(["", "{"])
      }
    }
  }

  preprocess(prep: Preprocessor, enabled: boolean): void {
    if (enabled) {
      prep.pushNesting(NestingType.Repeat, () => {
        // TODO: handle end repeat brace
      })
    }
  }

  // TODO: generalize this -- similar code used by MacroDefStatement, TypeBeginStatement
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

//==============================================================================
// Storage
//==============================================================================

// *** mark label as storage ***

// *** others ***

//   LISA:  .DA <exp>[,<exp>]
//          #<expression>
//          /<expression>
//          <expression>
//          "string"
//          'string'

export class DataStatement extends Statement {

  protected dataSize: number
  protected bigEndian: boolean
  protected dataElements: exp.Expression[] = []

  constructor(dataSize: number, bigEndian = false) {
    super()
    this.dataSize = dataSize
    this.bigEndian = bigEndian
  }

  parse(parser: Parser) {

    if (this.labelExp && this.labelExp instanceof exp.SymbolExpression) {
      const symbol = this.labelExp.symbol
      if (symbol) {
        symbol.isData = true
      }
    }

    while (true) {
      let token: Token | undefined

      token = parser.getNextToken()
      if (!token) {
        if (parser.syntax && parser.syntax != Syntax.DASM && parser.syntax != Syntax.CA65) {
          parser.addMissingToken("expecting data expression")
        }
        break
      }

      // DASM allows ".byte #<MYLABEL", for example
      if (!parser.syntax || parser.syntax == Syntax.DASM) {
        if (token.getString() == "#") {
          parser.addToken(token)
          token = undefined
        }
      }

      // *** token could be "," here ***

      const expression = parser.addNextExpression(token)
      if (!expression) {
        // *** what happens to token?
        break
      }

      if (this.dataSize == 1) {
        const value = expression.resolve()
        if (value != undefined) {
          if (value < -127 || value > 255) {
            expression.setError("Expression value too large")
          }
        }
      }

      this.dataElements.push(expression)
      if (parser.mustAddToken(["", ","]).index <= 0) {
        break
      }
    }
  }

  preprocess(prep: Preprocessor, enabled: boolean): void {
    if (enabled) {
      if (prep.module.project.syntax == Syntax.CA65) {
        if (this.dataElements.length == 0) {
          // TODO: only allow no dataElements if inside a .struct
        }
      }
    }
  }

  postProcessSymbols(symUtils: SymbolUtils) {
    // TODO: do for all sizes?
    if (this.dataSize == 1) {
      for (let expression of this.dataElements) {
        symUtils.markConstants(expression)
      }
    }
  }
}

//------------------------------------------------------------------------------

//  CA65: .res <count> [, <fill-value>]
//        .tag <struct-name>

export class StorageStatement extends Statement {

  protected dataSize: number
  protected bigEndian: boolean

  private sizeArg?: exp.Expression
  private patternArg?: exp.Expression

  constructor(dataSize: number, bigEndian = false) {
    super()
    this.dataSize = dataSize
    this.bigEndian = bigEndian
  }

  parse(parser: Parser) {

    if (this.labelExp && this.labelExp instanceof exp.SymbolExpression) {
      const symbol = this.labelExp.symbol
      if (symbol) {
        symbol.isData = true
      }
    }

    let token: Token | undefined

    token = parser.mustGetNextToken("expecting storage size expression")
    // *** empty??? ***
    if (token.isEmpty()) {
      parser.addToken(token)
      return
    }

    if (token.type == TokenType.Symbol || token.type == TokenType.HexNumber) {
      if (this.opNameLC == ".tag") {
        token.type = TokenType.TypeName
        parser.addToken(token)
        return
      }
    }

    if (token.getString() == "\\") {
      if (!parser.syntax || parser.syntax == Syntax.MERLIN) {
        this.sizeArg = new exp.AlignExpression(new exp.NumberExpression([token], 256, false))
        parser.addExpression(this.sizeArg)
      } else {
        parser.addToken(token)
        token.setError("Invalid storage size")
        return
      }
    } else {
      this.sizeArg = parser.mustAddNextExpression(token)
      if (!this.sizeArg) {
        return
      }

      //*** error if resolved value is out of range
    }

    if (parser.mustAddToken(["", ","]).index <= 0) {
      return
    }

    this.patternArg = parser.mustAddNextExpression()
  }
}

// MERLIN:  n/a
//   DASM:  [.]ALIGN <boundary> [, <fill>]
//   ACME:  !align <and>, <equal> [, <fill>]
//   CA65:  .align <boundary> [,<fill>]
//   LISA:  n/a

export class AlignStatement extends Statement {

  private boundary?: exp.Expression
  private equal?: exp.Expression
  private fill?: exp.Expression

  parse(parser: Parser) {

    this.boundary = parser.mustAddNextExpression()
    if (parser.mustAddToken(["", ","]).index <= 0) {
      return
    }

    this.fill = parser.mustAddNextExpression()

    if (!parser.syntax || parser.syntax == Syntax.ACME) {
      if (parser.mustAddToken(["", ","]).index <= 0) {
        return
      }
      this.equal = this.fill
      this.fill = parser.mustAddNextExpression()
    }
  }
}

//------------------------------------------------------------------------------

// MERLIN:  HEX <hex-num> [, ...]
//   DASM:  [.]HEX <hex-num> [ ...]
//   ACME:  !HEX <hex-num> [ ...]
//   CA65:  n/a
//   LISA:  HEX <hex-num>

// odd digits never allowed
// $ and 0x prefix never allowed

export class HexStatement extends Statement {
  private dataBytes: number[] = []

  parse(parser: Parser) {

    if (this.labelExp && this.labelExp instanceof exp.SymbolExpression) {
      const symbol = this.labelExp.symbol
      if (symbol) {
        symbol.isData = true
      }
    }

    let token: Token | undefined
    while (true) {
      if (!token) {
        token = parser.addNextToken()
        if (!token) {
          parser.addMissingToken("Hex value expected")
          break
        }
      }

      let hexString = token.getString().toUpperCase()
      if (hexString == "$") {
        token.setError("$ prefix not allowed on HEX statement values")
        token = parser.addNextToken()
        if (!token) {
          break
        }
        hexString = token.getString().toUpperCase()
      }

      if (token.type != TokenType.DecNumber && token.type != TokenType.HexNumber) {
        token.setError("Unexpected token type, expecting hex value")
        break
      }

      token.type = TokenType.HexNumber
      if (hexString.length & 1) {
        token.setError("Odd number of nibbles")
      } else {
        scanHex(hexString, this.dataBytes)
      }

      token = parser.addNextToken()
      if (!token) {
        break
      }

      if (parser.syntax == Syntax.LISA) {
        token.setError("Unexpected token")
        break
      }

      if (token.getString() == ",") {
        if (parser.syntax && parser.syntax != Syntax.MERLIN) {
          token.setError("Comma delimiter not allowed in this syntax")
          break
        }
        token = undefined
        continue
      }

      if (parser.syntax == Syntax.MERLIN) {
        token.setError("Unexpected token, expecting ','")
        break
      }
    }
  }

  getSize(): number | undefined {
    return this.dataBytes.length
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

//==============================================================================
// Disk
//==============================================================================

// *** !convtab here too?

class FileStatement extends Statement {

  protected fileName?: exp.FileNameExpression

  parse(parser: Parser) {
    // TODO: pass in list of required quoting characters, based on syntax?
    // *** check if quoting is optional for some assemblers ***
    this.fileName = parser.getNextFileNameExpression()
    if (!this.fileName) {
      parser.addMissingToken("Missing argument, expecting file path")
      return
    }
    parser.addExpression(this.fileName)

    // TODO: check for quoted fileName, based on syntax
      // optional on DASM
      // never on MERLIN
  }
}

// MERLIN:  PUT filename
//          USE filename
//   DASM:  [.]INCLUDE "filename"
//   ACME:  !SOURCE "filename"
//          !SOURCE <filename>
//   CA65:  .INCLUDE "filename"
//   LISA:  ICL "filename"

export class IncludeStatement extends FileStatement {

  preprocess(preprocessor: Preprocessor, enabled: boolean) {
    if (enabled && this.fileName) {
      // TODO: move this to FileStatement class
      let fileNameStr = this.fileName.getString() || ""
      if (fileNameStr.length > 0) {
        // TODO: only strip quotes for non-Merlin?
        // TODO: require quoting for CA65? other syntaxes?
        let quoteChar = fileNameStr[0]
        if (quoteChar == "'" || quoteChar == '"') {
          fileNameStr = fileNameStr.substring(1)
          if (fileNameStr.length > 0) {
            const lastChar = fileNameStr[fileNameStr.length - 1]
            if (lastChar == quoteChar) {
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

  parse(parser: Parser) {
    super.parse(parser)

    // *** TODO: add parser.mayAddToken so this can be parsed when !parser.syntax
    if (parser.syntax == Syntax.ACME) {
      // TODO: not required -- defaults to cbm and warns
      if (parser.mustAddToken(["", ","]).index <= 0) {
        return
      }
      if (parser.mustAddToken(["cbm", "plain", "apple"], TokenType.Keyword).index < 0) {
        return
      }
    }
  }
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
//   DASM:  [.]INCBIN "filename" [, skip-bytes]
//   ACME:  !BINARY "filename" [, [size] [, [skip]]]
//   CA65:  .INCBIN "filename" [, start [, size]]
//   LISA:  n/a

export class IncBinStatement extends FileStatement {

  private offsetArg?: exp.Expression
  private sizeArg?: exp.Expression

  parse(parser: Parser) {
    super.parse(parser)

    if (parser.mustAddToken(["", ","]).index <= 0) {
      return
    }

    let firstArg: exp.Expression | undefined
    let secondArg: exp.Expression | undefined

    // parse first argument
    let token: Token | undefined
    if (!parser.syntax || parser.syntax == Syntax.ACME) {
      token = parser.getNextToken()
      if (token?.getString() != ",") {
        firstArg = parser.mustAddNextExpression(token)
        token = parser.getNextToken()
      }
    } else {
      firstArg = parser.mustAddNextExpression()
      token = parser.getNextToken()
    }

    // parse second argument
    if (token) {
      if (token.getString() != ",") {
        token.setError("expected ,")
        return
      }

      secondArg = parser.mustAddNextExpression()
    }

    // order arguments based on syntax
    if (parser.syntax == Syntax.ACME) {
      // ACME parameters are reversed from other assemblers
      this.offsetArg = secondArg
      this.sizeArg = firstArg
    } else {
      this.offsetArg = firstArg
      // DASM does not support size, just offset/skip
      if (parser.syntax == Syntax.DASM) {
        if (secondArg) {
          secondArg.setError("Unexpected expression")
        }
      } else {
        this.sizeArg = secondArg
      }
    }
  }
}

//------------------------------------------------------------------------------

// *** watch for assigning a value to a local label
//  *** LISA, for example, doesn't allow that
// *** SBASM requires resolvable value with no forward references
// *** mark symbol as being assigned rather than just a label?

// MERLIN: symbol EQU exp
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
      // look for leading "#" for DASM
      //  TODO: should this be done for expressions in general?
      if (!parser.syntax || parser.syntax == Syntax.DASM) {
        const token = parser.peekNextToken()
        if (token && token.getString() == "#") {
          parser.addNextToken()
        }
      }
      this.value = parser.mustAddNextExpression()
      // TODO: if ":=", mark symbol as address
      this.labelExp.symbol?.setValue(this.value, SymbolFrom.Equate)
    } else {
      this.labelExp.setError("Variable label not allowed")
    }
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
      this.labelExp!.symbolType = SymbolType.Variable
      if (this.labelExp!.symbol) {
        this.labelExp!.symbol.type = SymbolType.Variable
      }
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

// MERLIN:  XC
//   DASM:  [.]PROCESSOR <type>
//   ACME:  !cpu <type> [ { <block> } ]
//   CA65:
//   LISA:  n/a

export class CpuStatement extends Statement {

  private pushState = false

  parse(parser: Parser) {
    if (this.opNameLC == "xc") {
      // no arguments for Merlin operation
    } else {

      const res = parser.mustAddToken(["6502", "65c02", "65816"], TokenType.Keyword)
      if (res.index < 0) {
        return
      }

      if (!parser.syntax || parser.syntax == Syntax.ACME) {
        const res = parser.mustAddToken(["", "{"])
        if (res.index <= 0) {
          return
        }
        this.pushState = true
      }
    }
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

  private value?: exp.Expression

  parse(parser: Parser) {
    if (this.opNameLC == "*") {
      const res = parser.mustAddToken("=")
      if (res.index < 0) {
        return
      }
    }

    this.value = parser.mustAddNextExpression()
  }
}


export class EntryStatement extends Statement {
  parse(parser: Parser) {
    if (this.labelExp) {
      if (!this.labelExp.isVariableType()) {
        if (this.labelExp.symbol) {
          this.labelExp.symbol.isEntryPoint = true
        }
      } else {
        this.labelExp.setError("Variable label not allowed")
      }
    } else {
      parser.insertMissingLabel()
    }
  }
}


// TODO: could this be combined with AssertStatement?
export class ErrorStatement extends Statement {

  private errExpression?: exp.Expression

  parse(parser: Parser) {
    // *** maybe use a different variation like parseControlExpression?
    this.errExpression = parser.parseExpression()
    if (this.errExpression) {
      parser.addExpression(this.errExpression)
    }
  }

  // ***
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

// TODO: make this the basis for all the various string/text statements
export class TextStatement extends Statement {

  private textElements: exp.Expression[] = []

  parse(parser: Parser) {
    while (true) {
      const expression = parser.mustAddNextExpression()
      if (!expression) {
        break
      }

      this.textElements.push(expression)

      if (parser.mustAddToken(["", ","]).index <= 0) {
        break
      }
    }
  }
}

//==============================================================================
// Macros
//==============================================================================

// MERLIN:  <name> MAC           (label required)
//   DASM:         MAC <name>    (no label allowed)
//                 MACRO <name>
//   ACME:  !macro <name> [<param>,...] {
//   CA65:         .mac <name> [<param>,...]
//                 .macro <name> [<param>,...]
//   LISA:
//  SBASM:  <name> .MA [<params-list>]

export class MacroDefStatement extends Statement {

  public macroName?: exp.SymbolExpression

  parse(parser: Parser) {

    if (this.labelExp) {
      if (!this.labelExp.isVariableType()) {
        if (parser.syntax == Syntax.DASM
            || parser.syntax == Syntax.ACME
            || parser.syntax == Syntax.CA65) {
          this.labelExp.setError("Label not allowed")
        } else if (this.labelExp.isLocalType()) {
          this.labelExp.setError("Local label not allowed")
        } else {
          this.macroName = this.labelExp
          this.macroName.symbolType = SymbolType.Macro
          if (this.macroName.symbol) {
            this.macroName.symbol.type = SymbolType.Macro
          }
        }
      } else {
        this.labelExp.setError("Variable label not allowed")
        return
      }
    } else if (parser.syntax == Syntax.MERLIN) {
      /*|| parser.syntax == Syntax.SBASM*/
      parser.insertMissingLabel()
    }

    // TODO: rewrite/split this logic to be clearer
    if (parser.syntax != Syntax.MERLIN) {
      let token = parser.getNextToken()
      if (token) {
        // macro name
        // TODO: generlize this
        if (token.type == TokenType.Symbol
            || token.type == TokenType.HexNumber) {
          const isDefinition = true
          this.macroName = new exp.SymbolExpression([token], SymbolType.Macro,
            isDefinition, parser.sourceFile, parser.lineNumber)
          parser.addExpression(this.macroName)
          token = parser.getNextToken()
        }
        if (token) {
          if (token.getString() == "{") {
            if (!this.macroName) {
              token.setError("Unexpected token, expected macro name")
            } else if (parser.syntax && parser.syntax != Syntax.ACME) {
              token.setError("Unexpected token")
            }
            parser.addToken(token)
          } else {
            // parse comma-delimited parameter list
            while (token) {
              const expression = parser.addNextExpression(token)
              if (!expression) {
                break
              }

              token = parser.getNextToken()
              if (!token) {
                break
              }
              const str = token.getString()
              if (!parser.syntax || parser.syntax == Syntax.ACME) {
                if (str == "{") {
                  parser.addToken(token)
                  break
                }
              }
              if (str != ",") {
                token.setError("Unexpected token")
                break
              }
              parser.addToken(token)
              token = parser.getNextToken()
            }
          }
        } else if (parser.syntax == Syntax.ACME) {
          parser.addMissingToken("opening brace expected")
        }
      } else {
        if (parser.syntax == Syntax.DASM
            || parser.syntax == Syntax.ACME
            || parser.syntax == Syntax.CA65) {
          parser.addMissingToken("macro name expected")
        }
      }

      // *** explicit trailing brace? ***
    }
  }

  preprocess(prep: Preprocessor, enabled: boolean) {

    if (!this.macroName) {
      // parser should have already caught this
      return
    }

    if (enabled) {
      if (prep.isNested(NestingType.Macro)) {
        this.setError("Nested macro definitions not allowed")
        return
      }

      prep.pushNesting(NestingType.Macro, () => {
        if (enabled) {
          prep.endMacroDef()
        }
      })

      // TODO: pass in parameter list too?
      // TODO: start new label scope here?
      prep.startMacroDef(this.macroName)
    }
  }
}

// MERLIN:  EOM       (label is allowed)
//          <<<
//   DASM:  ENDM      (no label allowed)
//   ACME:  }
//   CA65:  .endmac
//          .endmacro
//   LISA:
//  SBASM:  <name> .EM

export class EndMacroDefStatement extends Statement {

  parse(parser: Parser) {
    // *** enforce label or not ***
  }

  preprocess(prep: Preprocessor, enabled: boolean) {
    if (enabled) {

      if (!prep.isNested(NestingType.Macro)) {
        this.setError("End of macro without start")
        return
      }
      if (prep.topNestingType() != NestingType.Macro) {
        // TODO: figure out what exactly is unclosed and add to message
        this.setError("End of macro with enclosed nested type")
        return
      }
      prep.popNesting()

      // TODO: pop label scope here?
      prep.endMacroDef()
    }
  }
}

//------------------------------------------------------------------------------

// TODO: probably needs to be split by syntax

// MERLIN:  <label> <macro> [<param>;...]
//   DASM:
//   ACME:  <label> +<macro> [<param>, ...]
//   CA65:
//   LISA:
//  SBASM:

export class MacroInvokeStatement extends Statement {

  public macroName?: exp.SymbolExpression
  protected params: exp.Expression[] = []

  parse(parser: Parser) {

    if (this.opNameLC.startsWith("+")) {
      // *** maybe make parser.parseOpcode smarter instead? ***
      if (!parser.syntax || parser.syntax == Syntax.ACME) {
        // *** split into two tokens and replace in this.children
        // *** this.opToken becomes second new token
      } else {
        // *** force error ***
      }
    }

    // *** create symExpression from opToken
    // *** replace opToken in this.children

    while (true) {
      const token = parser.getNextToken()
      if (!token) {
        break
      }

      const str = token.getString()

      // TODO: hacks to allow macros to look like opcodes
      if (parser.syntax == Syntax.CA65) {
        if (str == "#") {
          parser.addToken(token)
          continue
        }
        if (str == ":") {
          this.params.push(parser.parseCA65Local(token, false))
          continue
        }
      }

      // TODO: not on first pass
      if (!parser.syntax || parser.syntax == Syntax.MERLIN) {
        if (str == ";") {
          parser.addToken(token)
          continue
        }
      }

      // TODO: which other syntaxes for this?
      if (!parser.syntax || parser.syntax == Syntax.ACME || parser.syntax == Syntax.CA65) {

        // TODO: shouldn't look for comma on first iteration
        if (str == ",") {
          parser.addToken(token)
          continue
        }

        // TODO: fix this multi-statement hack to suppress errors
        if (parser.syntax == Syntax.ACME) {
          if (str == ":") {
            parser.ungetToken(token)
            break
          }
        }
      }

      // TODO: clean up this hack support for Naja text macros
      if (parser.syntax == Syntax.MERLIN) {
        if (str == "(") {
          // *** must at least one ";" before doing this??? ***
          const strExpression = parser.parseStringExpression(token, true, false)
          parser.addExpression(strExpression)
          continue

          // *** attempt NajaText
          // *** attempt 6502 addressing
        }
      }

      const expression = parser.addNextExpression(token)
      if (!expression) {
        break
      }

      this.params.push(expression)
    }
  }
}

//------------------------------------------------------------------------------

export class DummyStatement extends Statement {

  private value?: exp.Expression

  parse(parser: Parser) {
    if (this.labelExp) {
      if (parser.syntax == Syntax.MERLIN) {
        this.labelExp.setError("Label not allowed")
      }
    }

    this.value = parser.mustAddNextExpression()
  }

  preprocess(prep: Preprocessor, enabled: boolean): void {
    if (enabled) {
      prep.pushNesting(NestingType.Struct)
    }
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
      prep.popNesting()
      prep.scopeState.popScope()
    }
  }
}


// DASM:  SEG[.U] <name>
// CA65:  .segment "<name>" [: (direct|zeropage|absolute)]

// TODO: reconcile seg.u and dummy statements (currently DASM-only)
export class SegmentStatement extends Statement {

  private impliedName?: string

  constructor(impliedName?: string) {
    super()
    this.impliedName = impliedName
  }

  parse(parser: Parser) {
    if (this.labelExp) {
      this.labelExp.setError("Label not allowed")
    }

    if (!this.impliedName) {

      const nameToken = parser.mustGetNextToken("expecting segment name")
      if (nameToken.getString() == '"') {
        if (!parser.syntax || parser.syntax == Syntax.CA65) {
          const strExpression = parser.parseStringExpression(nameToken, true, false)
          parser.addExpression(strExpression)
        } else {
          parser.addToken(nameToken)
          nameToken.setError("Expecting segment name")
          return
        }
      } else {
        // TODO: pick a better symbol type
        nameToken.type = TokenType.String
        parser.addToken(nameToken)
        if (parser.syntax == Syntax.CA65) {
          nameToken.setError("Expecting quoted segment name")
          return
        }
      }
      // TODO: save name expression

      if (!parser.syntax || parser.syntax == Syntax.CA65) {

        let res = parser.mustAddToken(["", ":"])
        if (res.index <= 0) {
          return
        }
        // NOTE: "direct" means immediate
        res = parser.mustAddToken(["direct", "absolute", "zeropage"], TokenType.Keyword)
        if (res.index < 0) {
          return
        }
        // TODO: save type index
      }
    }
  }
}

//------------------------------------------------------------------------------

export class ListStatement extends Statement {
  parse(parser: Parser) {
    const token = parser.addNextToken()
    let options: string[] = []
    if (this.opNameLC == "tr") {
      options = ["on", "off"]
    } else if (this.opNameLC == "lst") {
      options = ["on", "off", ""]
    } else if (this.opNameLC == "lstdo") {
      options = ["off", ""]
    } else if (this.opNameLC == "exp") {
      options = ["on", "off", "only"]
    } else if (this.opNameLC == "pag") {
      options = [""]
    }
    const opStrLC = token?.getString().toLowerCase() ?? ""
    const index = options.indexOf(opStrLC)
    if (index < 0) {
      let message = "expecting "
      for (let i = 0; i < options.length; i += 1) {
        if (i > 0) {
          message += ", "
        }
        message += "'" + options[i] + "'"
      }
      if (token) {
        token.setError("Unexpected token, " + message)
      } else {
        parser.addMissingToken(message)
      }
    } else if (token) {
      token.type = TokenType.Keyword
    }
  }
}

//==============================================================================
// CA65-only
//==============================================================================

// .feature labels_without_colons
// .feature bracket_as_indirect
// TODO: others

export class FeatureStatement extends Statement {
  parse(parser: Parser) {
    const token = parser.addNextToken()
    if (token) {
      // TODO: enforce known features
      // TODO: correctly auto-complete with those options
      token.type = TokenType.Keyword
    } else {
      parser.addMissingToken("Missing expression, feature name expected")
    }
  }
}

//------------------------------------------------------------------------------

export class TypeBeginStatement extends Statement {

  private nestingType: NestingType
  private canRecurse: boolean
  private scopeName = ""

  constructor(nestingType: NestingType, canRecurse: boolean) {
    super()
    this.nestingType = nestingType
    this.canRecurse = canRecurse
  }

  parse(parser: Parser): void {
    // *** share this ***
    const token = parser.mustGetNextToken("expecting symbol name")
    if (token) {
      if (token.type == TokenType.Symbol || token.type == TokenType.HexNumber) {
        token.type = TokenType.TypeName
        parser.addToken(token)
        this.scopeName = token.getString()
      } else {
        token.setError("Unexpected token, expecting symbol")
        parser.addToken(token)
      }
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
      prep.pushNesting(this.nestingType)
      prep.scopeState.pushScope(this.scopeName)
    }
  }
}

export class TypeEndStatement extends Statement {
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
      prep.popNesting()
      prep.scopeState.popScope()
    }
  }
}

export class EnumStatement extends TypeBeginStatement {
  constructor() {
    super(NestingType.Enum, false)  // cannot nest
  }
}

export class EndEnumStatement extends TypeEndStatement {
  constructor() {
    super(NestingType.Enum)
  }
}

export class StructStatement extends TypeBeginStatement {
  constructor() {
    super(NestingType.Struct, true)  // can nest
  }
}

export class EndStructStatement extends TypeEndStatement {
  constructor() {
    super(NestingType.Struct)
  }
}

export class UnionStatement extends TypeBeginStatement {
  constructor() {
    super(NestingType.Union, true)  // TODO: can nest?
  }
}

export class EndUnionStatement extends TypeEndStatement {
  constructor() {
    super(NestingType.Union)
  }
}

export class ProcStatement extends TypeBeginStatement {
  constructor() {
    super(NestingType.Proc, true) // can nest
  }
}

export class EndProcStatement extends TypeEndStatement {
  constructor() {
    super(NestingType.Proc)
  }
}

export class ScopeStatement extends TypeBeginStatement {
  constructor() {
    super(NestingType.Scope, true) // can nest
  }
}

export class EndScopeStatement extends TypeEndStatement {
  constructor() {
    super(NestingType.Scope)
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

  parse(parser: Parser): void {
    while (true) {
      const token = parser.mustGetNextToken("expecting symbol name")
      if (!token) {
        return
      }
      if (token.type == TokenType.Symbol || token.type == TokenType.HexNumber) {
        token.type = TokenType.Symbol
        if (!this.isExport) {
          const isDefinition = true //***
          // *** external symbol? ***
          parser.addExpression(new exp.SymbolExpression([token], SymbolType.Simple,
            isDefinition, parser.sourceFile, parser.lineNumber))
        }
      } else {
        token.setError("Unexpected token, expecting symbol")
        parser.addToken(token)
        return
      }

      let res = parser.mustAddToken(["", ",", ":"])
      if (res.index <= 0) {
        return
      }
      // TODO: share with segment
      if (res.index == 2) {
        if (this.isZpage) {
          res.token?.setError("Unexpected token")
          return
        }
        // NOTE: "direct" means immediate
        res = parser.mustAddToken(["direct", "absolute", "zeropage"], TokenType.Keyword)
        if (res.index < 0) {
          return
        }
        // TODO: apply size to symbol based on mode or this.zpage
        res = parser.mustAddToken(["", ","])
        if (res.index <= 0) {
          return
        }
      }
    }
  }
}


// TODO: could this be combined with ErrorStatement?

// CA65:  .assert <expression>, (error|warning), "<message>"

export class AssertStatement extends Statement {

  private errExpression?: exp.Expression

  parse(parser: Parser) {
    // *** maybe use a different variation like parseControlExpression?
    this.errExpression = parser.mustAddNextExpression()

    let res = parser.mustAddToken([","])
    if (res.index < 0) {
      return
    }

    res = parser.mustAddToken(["error", "warning"], TokenType.Keyword)
    if (res.index < 0) {
      return
    }

    res = parser.mustAddToken([","])
    if (res.index < 0) {
      return
    }

    // TODO: need parser.mustAddStringExpression()
    const token = parser.getNextToken()
    if (!token) {
      parser.addMissingToken("expecting quoted string")
      return
    }
    if (token.getString() != '"') {
      parser.addToken(token)
      token.setError("Expecting quoted string")
      return
    }

    const strExpression = parser.parseStringExpression(token)
    parser.addExpression(strExpression)
  }
}

//==============================================================================
// DASM-only
//==============================================================================

// MERLIN:
//   DASM:  <label> SUBROUTINE    (label is optional)
//   ACME:  (see !zone below)
//   CA65:
//   LISA:
//  SBASM:

export class SubroutineStatement extends Statement {

  parse(parser: Parser) {

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

//   ACME:  <label> !zone [<title>] [ { <block> } ]
//          <label> !zn [<title>] [ { <block> } ]

export class ZoneStatement extends Statement {

  private zoneTitle?: string
  private pushState = false

  parse(parser: Parser) {

    let t = parser.getNextToken()
    while (t) {
      const str = t.getString()
      if (str == "{") {
        this.pushState = true
        break
      }
      this.zoneTitle = str
      t = parser.getNextToken()
    }

    if (!this.zoneTitle) {
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

  private value?: exp.Expression

  parse(parser: Parser) {
    this.value = parser.mustAddNextExpression()
    const res = parser.mustAddToken("{")
  }

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

//------------------------------------------------------------------------------
